"""Monophonic pitch analysis. Key scores are relative profile matches, not probabilities."""
import numpy as np
import librosa
from scipy.ndimage import median_filter
from scipy.signal import find_peaks

MAJOR = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
MINOR = np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
NAMES = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B']
# Tonic-based minor: d r me f s le te; major: d r m f s l t.
SOLFA_MAJOR = ['d','di','r','ri','m','f','fi','s','si','l','li','t']
SOLFA_MINOR = ['d','di','r','me','mi','f','fi','s','le','la','te','ti']

def solfa(midi, tonic, mode):
    return (SOLFA_MINOR if mode == 'minor' else SOLFA_MAJOR)[(int(midi)-int(tonic)) % 12]

def note_name(midi):
    return NAMES[int(midi)%12] + str(int(midi)//12-1)

def estimate_key(notes):
    chroma = np.zeros(12)
    for n in notes:
        chroma[n['midi']%12] += n['end']-n['start']
    if not chroma.any(): return []
    candidates=[]
    for mode, profile in [('major', MAJOR), ('minor', MINOR)]:
        for root in range(12):
            score=float(np.corrcoef(chroma, np.roll(profile,root))[0,1]) if np.std(chroma)>0 else 0.
            candidates.append({'tonic':root,'mode':mode,'name':f'{NAMES[root]} {mode.title()}', 'score':round(score,3)})
    candidates.sort(key=lambda x:x['score'],reverse=True)
    return candidates[:5]

def track_pitch_in_chunks(y, sr, hop, progress=lambda *args: None, chunk_seconds=8.0):
    """Bound pYIN memory by tracking overlapped, frame-aligned chunks.

    The retained center of each chunk has context on both sides. pYIN runs
    its Viterbi decoder independently on each chunk, so a boundary can still
    differ slightly from a single whole-file pass.
    """
    frame_length=2048
    chunk_frames=max(1, round(chunk_seconds*sr/hop))
    context_frames=max(1, round(.4*sr/hop))
    total_frames=1+len(y)//hop
    f0_parts=[]; probability_parts=[]
    for start in range(0,total_frames,chunk_frames):
        end=min(total_frames,start+chunk_frames)
        context_start=max(0,start-context_frames)
        context_end=min(total_frames,end+context_frames)
        segment=y[context_start*hop:min(len(y),context_end*hop)]
        f0, _, probability=librosa.pyin(
            segment, fmin=librosa.note_to_hz('C2'), fmax=librosa.note_to_hz('C7'),
            sr=sr, frame_length=frame_length, hop_length=hop, fill_na=np.nan)
        a=start-context_start; b=end-context_start
        if len(f0)<b: raise RuntimeError('Pitch tracker returned an incomplete frame sequence.')
        f0_parts.append(f0[a:b]); probability_parts.append(probability[a:b])
        progress(25+round(35*end/total_frames),f'Tracking vocal pitch ({min(round(end/total_frames*100),100)}%)')
    return np.concatenate(f0_parts), np.concatenate(probability_parts)

def analyse(y, sr, progress=lambda *args: None):
    y=np.asarray(y,dtype=np.float32)
    duration=len(y)/sr
    if duration<0.4: raise ValueError('Recording is too short. Please provide at least 0.4 seconds of audio.')
    rms=float(np.sqrt(np.mean(y*y))); peak=float(np.max(np.abs(y)))
    warnings=[]
    if rms < .003: raise ValueError('No usable signal detected. Try recording closer to your microphone.')
    if rms < .025: warnings.append('This recording is quiet; try singing closer to the microphone.')
    if np.mean(np.abs(y)>.99) > .005: warnings.append('Clipping detected. Reduce your microphone input level.')
    if duration<3: warnings.append('A short melody may not establish a unique key.')
    progress(25,'Tracking vocal pitch')
    # Keep the original level for a conservative noise-floor check.
    original = y.copy()
    # Moderate normalisation preserves timing and avoids suppressing fundamental frequencies.
    y=y/max(peak, .001)*.9
    hop=256
    f0, probability=track_pitch_in_chunks(y,sr,hop,progress)
    midi_float=librosa.hz_to_midi(f0)
    # Median filter pitch only within voiced islands to prevent glides and vibrato fragmenting notes.
    mask=np.isfinite(midi_float) & (probability >= .35)
    smooth=np.full_like(midi_float,np.nan)
    starts=np.where(mask & ~np.r_[False,mask[:-1]])[0]
    ends=np.where(mask & ~np.r_[mask[1:],False])[0]+1
    for a,b in zip(starts,ends):
        smooth[a:b]=median_filter(midi_float[a:b],size=5,mode='nearest')
    quant=np.where(np.isfinite(smooth),np.rint(np.nan_to_num(smooth)), -1).astype(int)
    # Merge tiny gaps and short semitone wobble between matching notes.
    for i in range(1,len(quant)-2):
        if quant[i]==-1 and quant[i-1]>=0 and quant[i+1]==quant[i-1]: quant[i]=quant[i-1]
    progress(65,'Finding notes and tonal centre')
    # Rearticulations may keep the same F0 through pYIN's long analysis window.
    # Only split on pronounced local amplitude valleys; do not invent attacks
    # from vibrato alone. This remains a heuristic, especially with legato singing.
    envelope=librosa.feature.rms(y=y,frame_length=512,hop_length=hop)[0]
    distance=max(1,round(.14*sr/hop))
    valleys,_=find_peaks(-envelope, distance=distance, prominence=.035)
    radius=max(2,round(.10*sr/hop))
    split_frames=[]
    for v in valleys:
        if v<radius or v+radius>=len(envelope) or v>=len(quant): continue
        before=float(np.max(envelope[v-radius:v])); after=float(np.max(envelope[v+1:v+radius+1]))
        if min(before,after)>.035 and envelope[v]<.48*min(before,after):
            split_frames.append(int(v))
    notes=[]; i=0
    while i<len(quant):
        if quant[i]<0: i+=1; continue
        j=i+1
        while j<len(quant) and quant[j]==quant[i]: j+=1
        boundaries=[i]+[v for v in split_frames if i+round(.085*sr/hop)<v<j-round(.085*sr/hop)]+[j]
        # Remove cuts too close to each other, keeping a minimum note duration.
        kept=[boundaries[0]]
        for v in boundaries[1:-1]:
            if (v-kept[-1])*hop/sr>=.085: kept.append(v)
        kept.append(j)
        for a,b in zip(kept,kept[1:]):
            start=max(0,a*hop/sr); end=min(duration,b*hop/sr)
            if end-start>=.085:
                notes.append({'midi':int(quant[i]),'name':note_name(quant[i]),'start':round(start,3),'end':round(end,3),'confidence':round(float(np.mean(probability[a:b])),3)})
        i=j
    if not notes: raise ValueError('No clear pitched notes found. Try an unaccompanied melody with less background noise.')
    # Estimate residual sound only in frames pYIN classified as unvoiced;
    # avoid reporting a noise estimate when no such segment exists.
    energy=librosa.feature.rms(y=original,frame_length=2048,hop_length=hop)[0]
    length=min(len(energy),len(mask)); unvoiced=energy[:length][~mask[:length]]; voiced_energy=energy[:length][mask[:length]]
    if len(unvoiced)>round(.3*sr/hop) and len(voiced_energy)>0:
        residual=float(np.median(unvoiced)); voice_level=float(np.median(voiced_energy))
        if voice_level>0 and residual/voice_level>.30:
            warnings.append('Background sound may be prominent. Try a quieter room or sing closer to the microphone.')
    keys=estimate_key(notes)
    if len(notes)<4 or keys[0]['score']-keys[1]['score']<.08:
        warnings.append('The tonal centre is ambiguous. Compare the alternatives or choose a key yourself.')
    warnings.append('Best suited to a single unaccompanied voice. Accompaniment and repeated notes may reduce accuracy.')
    top=keys[0]
    for n in notes: n['solfa']=solfa(n['midi'],top['tonic'],top['mode'])
    return {'duration':round(duration,2),'notes':notes,'key':top,'candidates':keys,'startingNote':notes[0]['name'],'range':f"{note_name(min(n['midi'] for n in notes))} – {note_name(max(n['midi'] for n in notes))}",'warnings':warnings,'quality':{'rms':round(rms,4),'peak':round(peak,4)},'method':'pYIN · duration-weighted Krumhansl–Schmuckler profiles'}
