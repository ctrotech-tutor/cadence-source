import os, uuid, tempfile, subprocess, threading, time, json, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal
import soundfile as sf
import imageio_ffmpeg
from fastapi import FastAPI, UploadFile, File, Form, HTTPException

app=FastAPI(title='Cadence audio engine', version='0.1.0')
# Bounded, in-process jobs are intended for single-instance development only.
jobs={}; lock=threading.Lock(); executor=ThreadPoolExecutor(max_workers=1)
MAX_BYTES=int(os.getenv('MAX_AUDIO_BYTES',str(64*1024*1024)))
MAX_SECONDS=int(os.getenv('MAX_AUDIO_SECONDS','300'))
ANALYSIS_TIMEOUT=int(os.getenv('MAX_ANALYSIS_SECONDS','1200'))

class UploadLimitMiddleware:
    """Bound request bytes *before* the multipart parser, including chunked requests."""
    def __init__(self, inner): self.inner=inner
    async def __call__(self, scope, receive, send):
        if scope['type']!='http' or scope.get('method')!='POST' or scope.get('path')!='/jobs':
            await self.inner(scope,receive,send); return
        limit=MAX_BYTES+1024*1024
        parts=[]; total=0
        while True:
            message=await receive()
            if message['type']=='http.disconnect': return
            if message['type']!='http.request': continue
            chunk=message.get('body',b''); total+=len(chunk)
            if total>limit:
                payload=json.dumps({'detail':'Upload exceeds the file-size limit.'}).encode()
                await send({'type':'http.response.start','status':413,'headers':[(b'content-type',b'application/json'),(b'content-length',str(len(payload)).encode())]})
                await send({'type':'http.response.body','body':payload}); return
            parts.append(chunk)
            if not message.get('more_body',False): break
        data=b''.join(parts);del parts
        consumed=False
        async def replay():
            nonlocal consumed
            if not consumed:
                consumed=True
                return {'type':'http.request','body':data,'more_body':False}
            return await receive()
        await self.inner(scope,replay,send)

app.add_middleware(UploadLimitMiddleware)

def update(id,**kwargs):
    with lock:
        if id in jobs: jobs[id].update(kwargs)

def process(id,path,channel="mix"):
    wav=path+'.wav'
    try:
        update(id,status='processing',progress=8,message='Decoding audio')
        # Decode content, not filename/MIME. Bound decode time and decoded duration.
        cmd=[imageio_ffmpeg.get_ffmpeg_exe(),'-nostdin','-v','error','-protocol_whitelist','file,pipe','-format_whitelist','wav,mp3,mov,flac,matroska,webm,ogg,aac','-i',path,'-t',str(MAX_SECONDS+1)]
        if channel!='mix': cmd.extend(['-af',f"pan=mono|c0=c{0 if channel=='left' else 1}"])
        cmd.extend(['-ac','1','-ar','22050','-f','wav',wav])
        p=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=45)
        if p.returncode: raise ValueError('Audio could not be decoded. Check the selected channel, or try WAV, MP3, M4A, FLAC or WebM.')
        info=sf.info(wav)
        if info.duration>MAX_SECONDS: raise ValueError(f'Audio exceeds the {MAX_SECONDS}-second limit. Select a shorter section and try again.')
        update(id,progress=15,message='Starting analysis worker')
        # pYIN/Viterbi can monopolise the GIL and memory on long recordings.
        # A child process keeps the HTTP server responsive and can be timed out.
        env=os.environ.copy()
        env['OPENBLAS_NUM_THREADS']='1'; env['OMP_NUM_THREADS']='1'; env['MKL_NUM_THREADS']='1'
        with tempfile.TemporaryFile(mode='w+b') as errors:
            worker=subprocess.Popen([sys.executable,'-u','-m','app.worker',wav],
                stdout=subprocess.PIPE,stderr=errors,text=True,encoding='utf-8',errors='replace',env=env,
                cwd=str(Path(__file__).resolve().parent.parent))
            timed_out=threading.Event()
            def terminate():
                timed_out.set()
                try: worker.kill()
                except OSError: pass
            timer=threading.Timer(ANALYSIS_TIMEOUT,terminate); timer.daemon=True; timer.start()
            result=None; worker_error=None
            try:
                assert worker.stdout is not None
                for line in worker.stdout:
                    try: message=json.loads(line)
                    except (json.JSONDecodeError,ValueError): continue
                    if message.get('type')=='progress':
                        update(id,progress=message['progress'],message=message['message'])
                    elif message.get('type')=='result': result=message['result']; result['inputChannel']=channel
                    elif message.get('type')=='error': worker_error=message.get('message')
                return_code=worker.wait()
            finally:
                timer.cancel()
                if worker.poll() is None:
                    worker.kill(); worker.wait()
                if worker.stdout: worker.stdout.close()
            if timed_out.is_set(): raise ValueError('Analysis took too long. Try selecting a shorter section and analyse again.')
            if return_code!=0 or result is None:
                errors.seek(0); detail=errors.read()[-4000:].decode('utf-8',errors='replace')
                if detail: print('Analysis worker error:',detail,flush=True)
                if channel!='mix' and worker_error and worker_error.startswith('No usable signal'):
                    raise ValueError(f'The selected {channel} channel is silent or unavailable. Choose another channel and try again.')
                raise ValueError(worker_error or 'The analysis worker stopped unexpectedly. Try a shorter recording and check the audio engine log.')
        update(id,status='completed',progress=100,message='Analysis complete',result=result)
    except ValueError as e: update(id,status='failed',message=str(e))
    except subprocess.TimeoutExpired: update(id,status='failed',message='Audio decoding timed out. Try a shorter recording.')
    except Exception as e:
        print('Analysis error:',repr(e),flush=True); update(id,status='failed',message='Analysis failed. Try another recording.')
    finally:
        for f in (path,wav):
            try: os.unlink(f)
            except OSError: pass

@app.get('/health')
def health(): return {'ok':True}

@app.post('/jobs',status_code=202)
async def create_job(file:UploadFile=File(...),channel:Literal['mix','left','right']=Form(default='mix')):
    with lock:
        now=time.time()
        for k in list(jobs):
            if now-jobs[k]['created']>3600 and jobs[k]['status'] in ('completed','failed'): del jobs[k]
        if sum(j['status'] in ('queued','processing') for j in jobs.values())>=8: raise HTTPException(429,'Analysis queue is full. Please try again shortly.')
    path=None
    try:
        with tempfile.NamedTemporaryFile(prefix='cadence-',delete=False) as tmp:
            path=tmp.name; size=0
            while True:
                chunk=await file.read(1024*1024)
                if not chunk: break
                size+=len(chunk)
                if size>MAX_BYTES: raise HTTPException(413,f'File exceeds the configured {MAX_BYTES // (1024*1024)} MiB limit.')
                tmp.write(chunk)
        if size==0: raise HTTPException(400,'The uploaded file is empty.')
        id=uuid.uuid4().hex
        with lock:
            # Recheck after upload, since several requests may have arrived concurrently.
            if sum(j['status'] in ('queued','processing') for j in jobs.values())>=8:
                raise HTTPException(429,'Analysis queue is full. Please try again shortly.')
            jobs[id]={'id':id,'status':'queued','progress':0,'message':'Waiting for an available worker','created':time.time()}
        executor.submit(process,id,path,channel)
        return {'id':id}
    except Exception:
        if path and os.path.exists(path): os.unlink(path)
        raise
    finally: await file.close()

@app.get('/jobs/{id}')
def get_job(id:str):
    with lock: job=jobs.get(id)
    if not job: raise HTTPException(404,'Job not found or expired.')
    return dict(job)
