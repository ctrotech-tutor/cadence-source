# Cadence

A local-first, monophonic vocal transcription studio. Record or upload audio, run pYIN pitch extraction, inspect a key estimate, edit pitch and timing, transpose, compare saved melodies, and export text/JSON/MIDI or print to PDF. It is a functional development foundation, not a production-secure product.

## Run locally

Requirements: Node 20+, Python 3.11–3.13. FFmpeg is provided by `imageio-ffmpeg`.

```sh
cd apps/audio-engine
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
# another terminal
cd apps/web
npm ci
npm run dev
```

Open http://localhost:3000. Microphone permission requires HTTPS or localhost. The web server proxies `/api/jobs` to `AUDIO_ENGINE_URL` (default `http://127.0.0.1:8000`), so the browser never connects to the Python port directly. Docker: `docker compose up --build`.

Configuration: `AUDIO_ENGINE_URL` (web; Python service origin); `MAX_AUDIO_BYTES` (engine; default 26214400); `MAX_AUDIO_SECONDS` (engine; default 60). The web proxy has a fixed 26 MiB multipart limit, so increasing the engine limit also requires changing the proxy. No secrets are required locally. The engine is not authenticated and should not be exposed publicly.

## Workflow

Record or upload a monophonic melody, preview it and analyse the whole recording or a range. In the result, seek through the waveform, loop or reanalyse a named section, select notes to change pitch or timing, remove notes, or insert one into a following gap. Changing reference key reinterprets solfa without changing the underlying notes; transposing shifts displayed notes while preserving their solfa. The original audio is not pitch-shifted. The extracted melody is played with synthesized sine tones. Save projects explicitly to preserve changes. Two saved projects can be compared in Recent projects by the edit distance between their semitone-interval sequences. The similarity percentage is an interval-sequence score, **not a probability**; it ignores timing and can be distorted by transcription errors.

## Architecture and API

The web route proxies multipart `POST /api/jobs` to the engine, returning `{id}` with HTTP 202. Poll `GET /api/jobs/{id}` for `queued`, `processing`, `completed`, or `failed`, progress, message and result. FastAPI documents its internal API at `/docs`. Both services bound incoming multipart bytes; the engine then writes the file to a temporary location, decodes with FFmpeg into bounded mono PCM and removes the files after processing. The engine's pre-parser body guard buffers up to the configured file limit plus 1 MiB per concurrent request; put a proper upload gateway and stricter concurrency limits in front of a deployed service. A process crash can leave temporary files. At most two worker threads and eight queued/running jobs are allowed. Finished jobs expire from memory after one hour when another job is submitted. This queue is not durable and must be replaced with a persistent queue for multi-instance deployment. Starting a new workspace invalidates an in-flight UI result but does not cancel its server job.

Pitch extraction uses librosa pYIN (C2–C7), voiced-probability gating and median smoothing; semitone runs are segmented to notes, with pronounced amplitude valleys used as a conservative same-pitch re-articulation heuristic. A rough background-sound warning is computed only when enough unvoiced frames are available; it is not a full noise or competing-source classifier. Key estimation correlates a duration-weighted pitch-class histogram with the 24 Krumhansl–Schmuckler profiles. Scores are correlations, **not calibrated probabilities**. The first note is never treated as the key. Accompaniment, short phrases, octave errors, vibrato, repeated notes on the same pitch and ambiguous modes can cause mistakes. Candidates and manual key selection are provided. The algorithm does not perform harmonic source separation or independent chromagram analysis. Silence gaps over 0.2 seconds are displayed as rests, with continuous time in seconds rather than inferred notation/metre.

Movable Do uses tonic-based minor (d r me f s le te). Chromatic semitones use `di ri fi si li` for raised major degrees and `di mi fi la ti` alongside minor degrees. Enharmonic spelling is fixed, not context sensitive. Manually edited notes are marked `edited` with a null machine confidence in JSON. The original detected key and the selected reference key are kept separate.

Projects, edits, transposition and audio are stored in browser IndexedDB, not PostgreSQL, and do not sync between devices. A new analysis from a selected section reports original timeline offsets. Browser print supplies PDF output. Authentication, shared persistence, robust re-articulation, automatic phrase detection and polyphonic transcription are not implemented. There is no automatic retry; users can retry manually. Before internet exposure, add authenticated object storage, PostgreSQL and migrations, durable isolated job workers, authorization, rate limits, service authentication, monitoring, retention policy and real-vocal evaluation. Do not put private or irreplaceable recordings into an untrusted deployment.

## Tests and known limitations

Run `cd apps/audio-engine && python -m pytest -q`. The automated synthetic tests exercise C, G, F and E♭ major, A minor, chromatic notes, rests, vibrato, repeated notes, noise, soft accompaniment, transposition invariance, invalid uploads and upload bounds. On these particular synthetic major/minor fixtures, all five expected keys and all 47 note pitches matched; this is **not an accuracy estimate for real singers**. A manually tried stronger synthetic chord caused incorrect pitches and key, illustrating the monophonic limitation. Full vocal, microphone-device and accompaniment evaluation remains necessary.

For a browser smoke test, start both services, then run `cd apps/web && npx playwright install chromium && npm run test:e2e`. Linux may additionally need `npx playwright install-deps chromium`. The test uses generated WAV audio and Chromium's fake microphone, exercises upload, actual analysis, edits, save/reopen, transposition, section playback and analysis, exports, comparison, and checks a mobile viewport. It does **not** replace real-device microphone testing.
