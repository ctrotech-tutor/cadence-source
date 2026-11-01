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
