import numpy as np
from app.analysis import solfa, estimate_key, analyse

def test_transposition_invariance():
    assert [solfa(x,0,'major') for x in [60,62,64,65,67]] == [solfa(x+7,7,'major') for x in [60,62,64,65,67]]

def test_minor_and_chromatic():
    assert [solfa(x,9,'minor') for x in [69,71,72,74,76,77,79]] == ['d','r','me','f','s','le','te']
    assert solfa(61,0,'major') == 'di'

def test_profiles():
    ns=[{'midi':x,'start':i,'end':i+1} for i,x in enumerate([60,64,67,60,62,64,65,67,71,72])]
    assert estimate_key(ns)[0]['tonic']==0

def test_silence():
    import pytest
    with pytest.raises(ValueError,match='signal'): analyse(np.zeros(22050),22050)

def test_real_synthetic_pitch():
    sr=22050; t=np.arange(sr*2)/sr
    y=.5*np.sin(2*np.pi*440*t)
    result=analyse(y,sr)
    assert abs(result['notes'][0]['midi']-69)<=1
    assert result['notes'][0]['end']-result['notes'][0]['start']>1

def test_invalid_upload():
    from fastapi.testclient import TestClient
    from app.main import app
    import time
    client=TestClient(app)
    assert client.post('/jobs',files={'file':('empty.wav',b'','audio/wav')}).status_code==400
    r=client.post('/jobs',files={'file':('fake.wav',b'not audio','audio/wav')})
    assert r.status_code==202
    for _ in range(100):
        job=client.get('/jobs/'+r.json()['id']).json()
        if job['status']=='failed': break
        time.sleep(.05)
    assert job['status']=='failed'
    assert 'decoded' in job['message']

# Controlled signals: these test the entire pitch/key pipeline, not just mapping.
# They are deliberately simple sinusoids, not a substitute for recorded singers.
def make_melody(pitches, note_seconds=.4, rest_seconds=.06, noise=0):
    sr=22050
    chunks=[]
    for pitch in pitches:
        t=np.arange(round(sr*note_seconds))/sr
        envelope=np.minimum(1,np.minimum(t/.025,(note_seconds-t)/.035))
        chunks.extend([(0.45*envelope*np.sin(2*np.pi*440*2**((pitch-69)/12)*t)).astype('float32'), np.zeros(round(sr*rest_seconds),dtype='float32')])
    y=np.concatenate(chunks)
    if noise: y += np.random.default_rng(4).normal(0,noise,len(y)).astype('float32')
    return y,sr

def test_synthetic_keys_pitch_timing_and_transposition():
    base=[60,62,64,65,67,64,62,60]
    reference=None
    for offset, expected in [(0,'C Major'),(7,'G Major'),(5,'F Major'),(3,'E♭ Major')]:
        y,sr=make_melody([n+offset for n in base])
        r=analyse(y,sr)
        assert r['key']['name']==expected
        assert [n['midi'] for n in r['notes']]==[n+offset for n in base]
        assert all(abs(n['start']-i*.46)<.10 for i,n in enumerate(r['notes']))
        current=[n['solfa'] for n in r['notes']]
        if reference is None: reference=current
        else: assert current==reference

def test_synthetic_minor():
    melody=[69,72,76,69,71,72,74,76,77,76,74,72,71,69,69]
    y,sr=make_melody(melody)
    r=analyse(y,sr)
    assert r['key']['name']=='A Minor'
    assert [n['midi'] for n in r['notes']]==melody
    assert r['notes'][1]['solfa']=='me'

def test_repeated_notes_and_vibrato():
    sr=22050; t=np.arange(sr*2)/sr
    env=np.ones_like(t); mask=np.abs(t-1)<.04
    env[mask]=np.abs(t[mask]-1)/.04
    repeated=analyse(.45*env*np.sin(2*np.pi*440*t),sr)
    assert len(repeated['notes'])==2
    assert all(n['midi']==69 for n in repeated['notes'])
    assert abs(repeated['notes'][1]['start']-1)<.08
    vibrato=analyse(.45*np.sin(2*np.pi*440*t-3*np.cos(2*np.pi*5*t)),sr)
    assert len(vibrato['notes'])==1 and vibrato['notes'][0]['midi']==69
    assert any('ambiguous' in warning for warning in vibrato['warnings'])

def test_noisy_melody_and_rests():
    y,sr=make_melody([60,64,67,60],rest_seconds=.25,noise=.01)
    r=analyse(y,sr)
    assert [n['midi'] for n in r['notes']]==[60,64,67,60]
    assert all(r['notes'][i+1]['start']-r['notes'][i]['end']>.1 for i in range(3))

def test_chromatic_note_is_not_forced_into_scale():
    y,sr=make_melody([60,62,64,65,67,66,65,64,62,60,60])
    r=analyse(y,sr)
    assert r['key']['name']=='C Major'
    assert any(n['midi']==66 and n['solfa']=='fi' for n in r['notes'])

def test_soft_accompaniment_and_warning():
    y,sr=make_melody([60,62,64,65,67,64,62,60])
    t=np.arange(len(y))/sr
    # Soft continuous chord; this does not represent realistic polyphonic music.
    y=y+.02*(np.sin(2*np.pi*130.81*t)+np.sin(2*np.pi*164.81*t)+np.sin(2*np.pi*196*t))
    r=analyse(y,sr)
    assert [n['midi'] for n in r['notes']]==[60,62,64,65,67,64,62,60]
    assert any('Accompaniment' in warning for warning in r['warnings'])

def test_bounded_multipart_request(monkeypatch):
    from fastapi.testclient import TestClient
    import app.main as main
    monkeypatch.setattr(main,'MAX_BYTES',100)
    with TestClient(main.app) as client:
        response=client.post('/jobs',files={'file':('huge.wav',b'x'*(1024*1024+1024),'audio/wav')})
    assert response.status_code==413

def test_long_job_stays_responsive_and_preserves_chunk_boundary():
    from fastapi.testclient import TestClient
    from app.main import app
    import io, soundfile as sf, time
    sr=22050; t=np.arange(sr*65)/sr
    tone=.4*np.sin(2*np.pi*440*t).astype('float32')
    buf=io.BytesIO();sf.write(buf,tone,sr,format='WAV');buf.seek(0)
    with TestClient(app) as client:
        response=client.post('/jobs',files={'file':('long.wav',buf,'audio/wav')})
        assert response.status_code==202
        id=response.json()['id']; deadline=time.monotonic()+150; slowest=0; observed=set()
        while time.monotonic()<deadline:
            start=time.monotonic();status=client.get('/jobs/'+id);slowest=max(slowest,time.monotonic()-start)
            assert status.status_code==200
            job=status.json();observed.add(job['status'])
            if job['status'] in ('failed','completed'): break
            time.sleep(.2)
    assert job['status']=='completed',job
    assert slowest<5, f'Polling stalled for {slowest:.1f}s'
    assert [n['midi'] for n in job['result']['notes']]==[69]
    assert job['result']['notes'][0]['end']>64.8
    assert 'processing' in observed

def test_worker_timeout_reports_actionable_error(monkeypatch):
    from fastapi.testclient import TestClient
    import app.main as main
    import io, soundfile as sf, time
    monkeypatch.setattr(main,'ANALYSIS_TIMEOUT',.01)
    sr=22050; t=np.arange(sr)/sr; b=io.BytesIO();sf.write(b,.3*np.sin(2*np.pi*440*t),sr,format='WAV');b.seek(0)
    with TestClient(main.app) as client:
        res=client.post('/jobs',files={'file':('tone.wav',b,'audio/wav')});assert res.status_code==202
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            job=client.get('/jobs/'+res.json()['id']).json()
            if job['status'] in ('failed','completed'): break
            time.sleep(.1)
    assert job['status']=='failed'
    assert 'shorter section' in job['message']


def test_noise_without_pitch_not_transcribed():
    import pytest
    rng=np.random.default_rng(71)
    with pytest.raises(ValueError, match='No clear pitched notes'):
        analyse(rng.normal(0,.01,22050*3).astype('float32'),22050)

def test_selecting_stereo_channel_uses_the_requested_source():
    from fastapi.testclient import TestClient
    from app.main import app
    import io, soundfile as sf, time
    sr=22050; t=np.arange(sr*2)/sr
    stereo=np.stack([.4*np.sin(2*np.pi*130.8128*t),.4*np.sin(2*np.pi*440*t)],axis=1)
    samples=io.BytesIO(); sf.write(samples,stereo,sr,format='WAV'); payload=samples.getvalue()
    with TestClient(app) as client:
        assert client.post('/jobs',data={'channel':'invalid'},files={'file':('x.wav',payload,'audio/wav')}).status_code==422
        for channel, expected in [('left',48),('right',69)]:
            response=client.post('/jobs',data={'channel':channel},files={'file':('stereo.wav',payload,'audio/wav')})
            assert response.status_code==202
            deadline=time.monotonic()+60
            while time.monotonic()<deadline:
                job=client.get('/jobs/'+response.json()['id']).json()
                if job['status'] in ('failed','completed'): break
                time.sleep(.1)
            assert job['status']=='completed',job
            assert job['result']['inputChannel']==channel
            assert job['result']['notes'][0]['midi']==expected

def test_duration_limit_asks_for_shorter_section(monkeypatch):
    from fastapi.testclient import TestClient
    import app.main as main
    import io, soundfile as sf, time
    monkeypatch.setattr(main,'MAX_SECONDS',1)
    buffer=io.BytesIO();sf.write(buffer,np.zeros(22050*2),22050,format='WAV');buffer.seek(0)
    with TestClient(main.app) as client:
        response=client.post('/jobs',files={'file':('long.wav',buffer,'audio/wav')})
        assert response.status_code==202
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            job=client.get('/jobs/'+response.json()['id']).json()
            if job['status'] in ('failed','completed'):break
            time.sleep(.1)
    assert job['status']=='failed' and 'shorter section' in job['message']

def test_right_channel_of_mono_audio_reports_silent_channel():
    from fastapi.testclient import TestClient
    from app.main import app
    import io, soundfile as sf, time
    sr=22050; t=np.arange(sr)/sr;buffer=io.BytesIO()
    sf.write(buffer,.3*np.sin(2*np.pi*440*t),sr,format='WAV');buffer.seek(0)
    with TestClient(app) as client:
        response=client.post('/jobs',data={'channel':'right'},files={'file':('mono.wav',buffer,'audio/wav')})
        assert response.status_code==202
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            job=client.get('/jobs/'+response.json()['id']).json()
            if job['status'] in ('failed','completed'):break
            time.sleep(.1)
    assert job['status']=='failed' and 'right channel is silent or unavailable' in job['message']
