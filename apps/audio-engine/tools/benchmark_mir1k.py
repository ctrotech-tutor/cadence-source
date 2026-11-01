"""Evaluate quantized note output on external MIR-1K recordings (not included).

Run from apps/audio-engine: python -m tools.benchmark_mir1k /path/to/MIR-1K \
  --files tools/mir1k_heldout.txt --channel vocal
Reference .pv frames are MIDI semitones at 20 ms intervals, starting at 20 ms.
For research/evaluation only; obtain the dataset under its applicable terms.
"""
import argparse
import json
from pathlib import Path
import librosa
import numpy as np
import soundfile as sf
from app.analysis import analyse


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset', type=Path, help='directory containing Wavfile/ and PitchLabel/')
    parser.add_argument('--files', type=Path, required=True, help='text file of MIR-1K clip IDs, one per line')
    parser.add_argument('--channel', choices=('vocal','mix'), default='vocal')
    args=parser.parse_args()
    ids=[line.strip() for line in args.files.read_text(encoding='utf-8').splitlines() if line.strip() and not line.startswith('#')]
    if not ids: parser.error('No clip IDs specified.')
    rows=[]
    for clip in ids:
        wav=args.dataset/'Wavfile'/f'{clip}.wav'
        label=args.dataset/'PitchLabel'/f'{clip}.pv'
        audio,sr=sf.read(wav,dtype='float32',always_2d=True)
        if audio.shape[1]<2: raise ValueError(f'{wav} is missing the MIR-1K stereo channels')
        signal=audio[:,1] if args.channel=='vocal' else audio.mean(axis=1)
        signal=librosa.resample(signal,orig_sr=sr,target_sr=22050)
        truth=np.loadtxt(label,ndmin=1)
        times=.02+np.arange(len(truth))*.02
        result=analyse(signal,22050)
        predicted=np.zeros_like(truth)
        for note in result['notes']:
            predicted[(times>=note['start'])&(times<note['end'])]=note['midi']
        reference_voiced=truth>0; output_voiced=predicted>0
        rows.append({'clip':clip,'voiced':int(reference_voiced.sum()),'unvoiced':int((~reference_voiced).sum()),
                     'within_50_cents':int((reference_voiced & output_voiced & (np.abs(predicted-truth)<=.5)).sum()),
                     'voiced_detected':int((reference_voiced & output_voiced).sum()),
                     'false_voiced':int(((~reference_voiced) & output_voiced).sum())})
    total={k:sum(row[k] for row in rows) for k in ('voiced','unvoiced','within_50_cents','voiced_detected','false_voiced')}
    total['note_frame_match_rate']=round(total['within_50_cents']/total['voiced'],4) if total['voiced'] else None
    total['voicing_recall']=round(total['voiced_detected']/total['voiced'],4) if total['voiced'] else None
    total['false_voicing_rate']=round(total['false_voiced']/total['unvoiced'],4) if total['unvoiced'] else None
    print(json.dumps({'channel':args.channel,'clips':rows,'total':total},indent=2))

if __name__=='__main__': main()
