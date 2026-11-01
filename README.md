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

Configuration: `AUDIO_ENGINE_URL` (web; Python service origin); `MAX_AUDIO_BYTES` (engine; default 67108864); `MAX_AUDIO_SECONDS` (engine; default 300); `MAX_ANALYSIS_SECONDS` (engine; default 1200). The web proxy has a fixed 65 MiB multipart limit, so increasing the engine limit also requires changing the proxy. No secrets are required locally. The engine is not authenticated and should not be exposed publicly.

## Workflow

Record or upload a monophonic melody, preview it and analyse the whole recording or a range. The default limits are 64 MiB and five minutes per analysis. Pitch tracking automatically processes overlapping eight-second chunks and stitches them on the original timeline; recordings longer than one minute get 30-second navigation parts in the editor. A longer file under the upload limit can be analysed in manually selected ranges of up to five minutes. To limit browser memory use, recordings over ten minutes should be trimmed externally before importing; if a large file has no readable duration metadata, waveform and section preview may be unavailable. In the result, seek through the waveform, loop or reanalyse a named section, select notes to change pitch or timing, remove notes, or insert one into a following gap. Changing reference key reinterprets solfa without changing the underlying notes; transposing shifts displayed notes while preserving their solfa. The original audio is not pitch-shifted. If a stereo file already has an isolated vocal on one channel, select Left or Right under Audio source before analysis; this does not perform source separation. For section analysis, the selected channel is first copied to a mono WAV in the browser. The extracted melody is played with synthesized sine tones. Save projects explicitly to preserve changes. Two saved projects can be compared in Recent projects by the edit distance between their semitone-interval sequences. The similarity percentage is an interval-sequence score, **not a probability**; it ignores timing and can be distorted by transcription errors.

## Architecture and API

The web route proxies multipart `POST /api/jobs` to the engine, returning `{id}` with HTTP 202. The multipart fields are `file` (required) and `channel` (`mix`, `left`, or `right`; default `mix`). Poll `GET /api/jobs/{id}` for `queued`, `processing`, `completed`, or `failed`, progress, message and result. FastAPI documents its internal API at `/docs`. Both services bound incoming multipart bytes; the engine then writes the file to a temporary location, decodes with FFmpeg into bounded mono PCM and removes the files after processing. The engine's pre-parser body guard buffers up to the configured file limit plus 1 MiB per concurrent request; put a proper upload gateway and stricter concurrency limits in front of a deployed service. A process crash can leave temporary files. The in-process queue admits at most eight jobs and runs one isolated analysis subprocess at a time. A worker is stopped after `MAX_ANALYSIS_SECONDS`, and the resulting failure is reported to the user. Finished jobs expire from memory after one hour when another job is submitted. This queue is not durable and must be replaced with a persistent queue for multi-instance deployment. Starting a new workspace invalidates an in-flight UI result but does not cancel its server job.

Pitch extraction uses librosa pYIN (C2–C7) in overlapped eight-second chunks to reduce peak memory use, voiced-probability gating and median smoothing; semitone runs are segmented to notes, with pronounced amplitude valleys used as a conservative same-pitch re-articulation heuristic. A rough background-sound warning is computed only when enough unvoiced frames are available; it is not a full noise or competing-source classifier. Key estimation correlates a duration-weighted pitch-class histogram with the 24 Krumhansl–Schmuckler profiles. Scores are correlations, **not calibrated probabilities**. The first note is never treated as the key. Accompaniment, short phrases, octave errors, vibrato, repeated notes on the same pitch and ambiguous modes can cause mistakes. Candidates and manual key selection are provided. The algorithm does not perform harmonic source separation or independent chromagram analysis. Silence gaps over 0.2 seconds are displayed as rests, with continuous time in seconds rather than inferred notation/metre.

Movable Do uses tonic-based minor (d r me f s le te). Chromatic semitones use `di ri fi si li` for raised major degrees and `di mi fi la ti` alongside minor degrees. Enharmonic spelling is fixed, not context sensitive. Manually edited notes are marked `edited` with a null machine confidence in JSON. The original detected key and the selected reference key are kept separate.

Projects, edits, transposition and audio are stored in browser IndexedDB, not PostgreSQL, and do not sync between devices. A new analysis from a selected section reports original timeline offsets. Browser print supplies PDF output. Authentication, shared persistence, robust re-articulation, automatic phrase detection and polyphonic transcription are not implemented. The browser retries transient status-request failures up to twelve times; failed analysis jobs must be retried manually. Before internet exposure, add authenticated object storage, PostgreSQL and migrations, durable isolated job workers, authorization, rate limits, service authentication, monitoring, retention policy and real-vocal evaluation. Do not put private or irreplaceable recordings into an untrusted deployment.

## Tests and known limitations

Run `cd apps/audio-engine && python -m pytest -q`. The automated synthetic tests exercise C, G, F and E♭ major, A minor, chromatic notes, rests, vibrato, repeated notes, noise, soft accompaniment, transposition invariance, invalid uploads and upload bounds. On these particular synthetic major/minor fixtures, all five expected keys and all 47 note pitches matched; this is **not an accuracy estimate for real singers**. A manually tried stronger synthetic chord caused incorrect pitches and key, illustrating the monophonic limitation. Full vocal, microphone-device and accompaniment evaluation remains necessary.

For a browser smoke test, start both services, then run `cd apps/web && npx playwright install chromium && npm run test:e2e`. Linux may additionally need `npx playwright install-deps chromium`. The test uses generated WAV audio and Chromium's fake microphone, exercises upload, actual analysis, edits, save/reopen, transposition, section playback and analysis, exports, comparison, a 62-second recording, status retry and a mobile viewport. It does **not** replace real-device microphone testing.

## Small real-vocal evaluation (not a universal accuracy claim)

We tested the previous and current note transcription on ten held-out MIR-1K clips, using each recording's isolated right-channel vocal and its manually annotated pitch contour ([MIR-1K dataset and annotations](https://zenodo.org/records/3532216); [frame timing](https://music-ir.org/mirex/wiki/2016:Audio_Melody_Extraction)). Nine singers in this hold-out set were not in our ten-clip threshold-tuning sample; one is a different clip from a tuning singer. We compare the **quantized output notes** to reference pitch at 20 ms intervals. On this small sample, the proportion of reference-voiced frames within 50 cents improved from 1,703/2,821 (60.4%) to 1,860/2,821 (65.9%). Voiced-frame recall improved from 68.5% to 75.7%; the false-voicing rate on reference-unvoiced frames increased from 4.4% to 6.3%. The more permissive pYIN gate can recover quiet notes but can also create more false notes. Notes with weaker pYIN voicing evidence are marked **check**; that marker is not a calibrated pitch-confidence score.

On the same ten clips with vocal and accompaniment simply mixed to mono, the new method matched 373/2,821 voiced frames (13.2%) and falsely voiced 303/1,326 unvoiced frames (22.9%). **It is not a reliable melody extractor for accompanied music**, and the channel selector only helps when an isolated vocal already exists on one channel. These results are not note-event, key-detection, rhythm or all-singer accuracy measurements, nor evidence of performance on the user's own recordings. The threshold was tuned on a separate small subset; future changes should be evaluated on larger, independent singer splits and ground-truth note events before claiming general improvement.

The dataset is not bundled. If you have obtained it under its terms, run from `apps/audio-engine`:

```sh
python -m tools.benchmark_mir1k /path/to/MIR-1K --files tools/mir1k_heldout.txt --channel vocal
python -m tools.benchmark_mir1k /path/to/MIR-1K --files tools/mir1k_heldout.txt --channel mix
```

It expects `Wavfile/` and `PitchLabel/` folders. The benchmark and clip-ID list are included; the copyrighted audio and annotations are not.

## Windows troubleshooting: audio service unavailable

A `POST /api/jobs 202` means the audio engine accepted the upload. Repeated successful job status responses followed by a 503 mean the connection to the engine failed or timed out *later*; they do not prove the engine was never started. Read the Python/audio-engine terminal for the actual error. A `GET /sw.js 404` is not a Cadence audio-engine request and is not sufficient to explain the analysis failure.

In PowerShell, check the engine without restarting it first:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

A healthy service returns `ok : True`. If it fails or hangs, capture the output from the separate Python/audio-engine terminal, including any traceback, along with your audio duration and Windows/Python versions. If you are using Docker, run `docker compose logs audio-engine` from the repository root.

For a non-Docker Windows setup, keep **two** PowerShell windows open. From the repository root, first install Python 3.12 and create the environment once:

```powershell
cd apps\audio-engine
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In a second window, from the repository root:

```powershell
cd apps\web
npm ci
npx next dev --hostname 127.0.0.1
```

Open `http://localhost:3000`. For subsequent runs the installation commands are unnecessary; start both services again. The first pYIN run may take longer while dependencies initialise. If you have local edits, inspect `git status` before pulling or applying a patch.
