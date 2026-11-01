"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  FileAudio,
  Headphones,
  Info,
  KeyboardMusic,
  Mic,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Square,
  Trash2,
  UploadCloud,
  Volume2,
  X,
} from "lucide-react";

type Note = {
  midi: number;
  name: string;
  start: number;
  end: number;
  solfa: string;
  confidence: number | null;
  edited?: boolean;
};
type Key = {
  tonic: number;
  mode: "major" | "minor";
  name: string;
  score: number;
};
type Result = {
  duration: number;
  notes: Note[];
  key: Key;
  candidates: Key[];
  startingNote: string;
  range: string;
  warnings: string[];
  method: string;
};
type Project = {
  id: string;
  title: string;
  date: number;
  result: Result;
  audio: Blob;
  filename: string;
  selectedKey?: Key;
  transpose?: number | null;
};
const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const maj = ["d", "di", "r", "ri", "m", "f", "fi", "s", "si", "l", "li", "t"];
const min = [
  "d",
  "di",
  "r",
  "me",
  "mi",
  "f",
  "fi",
  "s",
  "le",
  "la",
  "te",
  "ti",
];
const noteName = (m: number) =>
  names[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
const syllable = (m: number, k: Key) =>
  (k.mode === "minor" ? min : maj)[(((m - k.tonic) % 12) + 12) % 12];
const keyOf = (tonic: number, mode: "major" | "minor"): Key => ({
  tonic,
  mode,
  name: `${names[tonic]} ${mode === "major" ? "Major" : "Minor"}`,
  score: 0,
});
const time = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("cadence-projects", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("projects", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function store(p: Project) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction("projects", "readwrite");
    t.objectStore("projects").put(p);
    t.oncomplete = () => {
      d.close();
      resolve();
    };
    t.onerror = () => reject(t.error);
  });
}
async function allProjects(): Promise<Project[]> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const r = d.transaction("projects").objectStore("projects").getAll();
    r.onsuccess = () => {
      d.close();
      resolve(r.result.sort((a: Project, b: Project) => b.date - a.date));
    };
    r.onerror = () => reject(r.error);
  });
}
async function removeProject(id: string) {
  const d = await db();
  return new Promise<void>((resolve, reject) => {
    const t = d.transaction("projects", "readwrite");
    t.objectStore("projects").delete(id);
    t.oncomplete = () => {
      d.close();
      resolve();
    };
    t.onerror = () => reject(t.error);
  });
}
function compareMelodies(a: Note[], b: Note[]) {
  const intervals = (notes: Note[]) =>
    notes.slice(1).map((n, i) => n.midi - notes[i].midi);
  const x = intervals(a),
    y = intervals(b);
  if (!x.length || !y.length) return null;
  let previous = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const current = [i];
    for (let j = 1; j <= y.length; j++)
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  const edits = previous[y.length];
  return {
    score: Math.round((1 - edits / Math.max(x.length, y.length)) * 100),
    exact: edits === 0,
    intervalsA: x.length,
    intervalsB: y.length,
    shift: b[0].midi - a[0].midi,
  };
}
function download(data: BlobPart, name: string, type: string) {
  const u = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
function wav(buffer: AudioBuffer, start: number, end: number) {
  const sr = buffer.sampleRate;
  const a = Math.floor(start * sr),
    b = Math.min(buffer.length, Math.floor(end * sr));
  const out = new ArrayBuffer(44 + (b - a) * 2),
    v = new DataView(out);
  const text = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + (b - a) * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, (b - a) * 2, true);
  for (let i = a; i < b; i++) {
    let x = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++)
      x += buffer.getChannelData(c)[i] / buffer.numberOfChannels;
    v.setInt16(44 + (i - a) * 2, Math.max(-1, Math.min(1, x)) * 32767, true);
  }
  return new Blob([out], { type: "audio/wav" });
}

export default function Home() {
  const [view, setView] = useState<"workspace" | "recent">("workspace");
  const [tab, setTab] = useState<"record" | "upload">("record");
  const [audio, setAudio] = useState<Blob | null>(null);
  const [filename, setFilename] = useState("");
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [wave, setWave] = useState<number[]>([]);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState("");
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [selectedKey, setSelectedKey] = useState<Key | null>(null);
  const [transpose, setTranspose] = useState<number | null>(null);
  const [activeNote, setActiveNote] = useState<number | null>(null);
  const [title, setTitle] = useState("Untitled melody");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [drag, setDrag] = useState(false);
  const [sectionStart, setSectionStart] = useState(0);
  const [sectionEnd, setSectionEnd] = useState(0);
  const [sectionOnly, setSectionOnly] = useState(false);
  const [sectionName, setSectionName] = useState("Selection");
  const [loopSection, setLoopSection] = useState(false);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const analysisVersion = useRef(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const recordCanvas = useRef<HTMLCanvasElement>(null);
  const playingSelection = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const raf = useRef<number>(0);
  const ctx = useRef<AudioContext | null>(null);
  const cancelled = useRef(false);
  const refresh = useCallback(() => {
    allProjects()
      .then(setProjects)
      .catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    return () => {
      cancelled.current = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      cancelAnimationFrame(raf.current);
      ctx.current?.close().catch(() => {});
    };
  }, [refresh]);
  useEffect(() => {
    if (!audio) {
      setUrl("");
      setWave([]);
      return;
    }
    const u = URL.createObjectURL(audio);
    setUrl(u);
    let alive = true;
    const c = new AudioContext();
    audio
      .arrayBuffer()
      .then((b) => c.decodeAudioData(b))
      .then((b) => {
        if (!alive) return;
        setDuration(b.duration);
        setSectionEnd(Math.floor(b.duration * 100) / 100);
        const channel = b.getChannelData(0),
          buckets = 180,
          step = Math.max(1, Math.floor(channel.length / buckets)),
          v = [];
        for (let i = 0; i < buckets; i++) {
          let peak = 0;
          for (
            let j = i * step;
            j < Math.min((i + 1) * step, channel.length);
            j += Math.max(1, Math.floor(step / 100))
          )
            peak = Math.max(peak, Math.abs(channel[j]));
          v.push(peak);
        }
        setWave(v);
      })
      .catch(() => {
        if (alive)
          setError(
            "Could not preview this audio in your browser. You can still try analysis.",
          );
      })
      .finally(() => c.close());
    return () => {
      alive = false;
      URL.revokeObjectURL(u);
    };
  }, [audio]);
  function reset() {
    analysisVersion.current++;
    setBusy(false);
    setAudio(null);
    setFilename("");
    setResult(null);
    setSelectedKey(null);
    setTranspose(null);
    setActiveNote(null);
    setError("");
    setNotice("");
    setTitle("Untitled melody");
    setProjectId("");
    setCurrent(0);
    setDuration(0);
    setSectionStart(0);
    setSectionOnly(false);
    setSectionName("Selection");
    setLoopSection(false);
    playingSelection.current = false;
    setView("workspace");
  }
  function accept(file: File) {
    analysisVersion.current++;
    setBusy(false);
    setError("");
    if (file.size > 25 * 1024 * 1024) {
      setError("File is larger than 25 MB. Please choose a smaller file.");
      return;
    }
    if (!file.size) {
      setError("This file is empty.");
      return;
    }
    setAudio(file);
    setFilename(file.name);
    setTitle(file.name.replace(/\.[^.]+$/, "") || "Untitled melody");
    setResult(null);
    setSelectedKey(null);
    setProjectId("");
    setCurrent(0);
  }
  async function startRecording() {
    if (starting || recording) return;
    setError("");
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        "Recording is unavailable in this browser. Try uploading an audio file instead.",
      );
      return;
    }
    setStarting(true);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: device ? { deviceId: { exact: device } } : true,
      });
      analysisVersion.current++;
      setBusy(false);
      stream.current = s;
      const found = await navigator.mediaDevices.enumerateDevices();
      setDevices(found.filter((d) => d.kind === "audioinput"));
      const r = new MediaRecorder(s);
      recorder.current = r;
      chunks.current = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      r.onerror = () => {
        setError("Recording was interrupted. Please try again.");
        stopRecording();
      };
      r.onstop = () => {
        const blob = new Blob(chunks.current, {
          type: r.mimeType || "audio/webm",
        });
        if (blob.size) {
          setAudio(blob);
          setFilename("Voice recording.webm");
          setTitle("Voice recording");
          setResult(null);
          setProjectId("");
        } else setError("No audio was captured. Please try again.");
        s.getTracks().forEach((t) => t.stop());
        stream.current = null;
        cancelAnimationFrame(raf.current);
        ctx.current?.close().catch(() => {});
        ctx.current = null;
        setLevel(0);
      };
      s.getAudioTracks()[0].onended = () => {
        if (r.state !== "inactive") {
          stopRecording();
          setError(
            "Microphone disconnected. Your captured audio is available below.",
          );
        }
      };
      r.start(200);
      setRecording(true);
      setPaused(false);
      setElapsed(0);
      timer.current = setInterval(() => setElapsed((x) => x + 1), 1000);
      const c = new AudioContext();
      ctx.current = c;
      const source = c.createMediaStreamSource(s),
        analyser = c.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const arr = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(arr);
        let sum = 0;
        for (const v of arr) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / arr.length) * 5));
        const canvas = recordCanvas.current,
          draw = canvas?.getContext("2d");
        if (canvas && draw) {
          draw.clearRect(0, 0, canvas.width, canvas.height);
          draw.beginPath();
          draw.strokeStyle = "#c8df8c";
          draw.lineWidth = 1.5;
          for (let i = 0; i < arr.length; i++) {
            const x = (i / (arr.length - 1)) * canvas.width,
              y = (arr[i] / 255) * canvas.height;
            if (i === 0) draw.moveTo(x, y);
            else draw.lineTo(x, y);
          }
          draw.stroke();
        }
        raf.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      if (recorder.current?.state === "recording") stopRecording();
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(
        e instanceof Error
          ? `Could not start microphone: ${e.message}`
          : "Could not start microphone.",
      );
    } finally {
      setStarting(false);
    }
  }
  function stopRecording() {
    if (recorder.current && recorder.current.state !== "inactive")
      recorder.current.stop();
    if (timer.current) clearInterval(timer.current);
    setRecording(false);
    setPaused(false);
  }
  function togglePause() {
    const r = recorder.current;
    if (!r) return;
    if (r.state === "recording") {
      r.pause();
      if (timer.current) clearInterval(timer.current);
      setPaused(true);
    } else if (r.state === "paused") {
      r.resume();
      timer.current = setInterval(() => setElapsed((x) => x + 1), 1000);
      setPaused(false);
    }
  }
  async function runAnalysis(forceSection = false) {
    if (!audio || busy) return;
    const version = ++analysisVersion.current;
    setError("");
    setNotice("");
    setBusy(true);
    setProgress(0);
    try {
      let input = audio;
      const useSection = sectionOnly || forceSection;
      if (useSection) {
        if (
          sectionStart < 0 ||
          sectionEnd > duration ||
          sectionEnd - sectionStart < 0.4
        )
          throw Error(
            "Choose a valid section of at least 0.4 seconds within the recording.",
          );
        const ac = new AudioContext();
        try {
          const decoded = await ac.decodeAudioData(await audio.arrayBuffer());
          input = wav(decoded, sectionStart, sectionEnd);
        } finally {
          await ac.close();
        }
      }
      const form = new FormData();
      form.append("file", input, filename || "recording.webm");
      const id = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/jobs");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setStatus("Uploading audio");
            setProgress(Math.round((e.loaded / e.total) * 10));
          }
        };
        xhr.onerror = () =>
          reject(Error("Upload failed. Check your connection and try again."));
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 400)
              reject(Error(data.detail || "Upload failed."));
            else resolve(data.id);
          } catch {
            reject(Error("Unexpected response from the server."));
          }
        };
        xhr.send(form);
      });
      if (version !== analysisVersion.current) return;
      let finished = false;
      let transientFailures = 0;
      const deadline = Date.now() + 8 * 60 * 1000;
      while (!finished) {
        if (version !== analysisVersion.current) return;
        if (Date.now() > deadline)
          throw Error(
            "Analysis is taking too long. Please try a shorter recording.",
          );
        await new Promise((r) => setTimeout(r, 1000));
        let response: Response;
        try {
          response = await fetch("/api/jobs/" + id, { cache: "no-store" });
        } catch {
          if (++transientFailures <= 3) {
            setStatus("Connection interrupted. Retrying status…");
            continue;
          }
          throw Error("Could not contact the audio engine. Check its terminal, then try again.");
        }
        if (version !== analysisVersion.current) return;
        if (response.status === 503 && ++transientFailures <= 3) {
          setStatus("Audio engine is slow to respond. Retrying status…");
          continue;
        }
        const job = await response.json();
        if (!response.ok)
          throw Error(job.detail || "Could not retrieve analysis.");
        transientFailures = 0;
        setProgress(job.progress);
        setStatus(job.message);
        if (job.status === "failed") throw Error(job.message);
        if (job.status === "completed") {
          let res = job.result as Result;
          if (useSection) {
            res = {
              ...res,
              notes: res.notes.map((n) => ({
                ...n,
                start: n.start + sectionStart,
                end: n.end + sectionStart,
              })),
              warnings: [
                ...res.warnings,
                `${sectionName || "Selection"} covers ${time(sectionStart)}–${time(sectionEnd)} of the original recording.`,
              ],
            };
          }
          if (!duration) {
            setDuration(res.duration);
            setSectionEnd(res.duration);
          }
          setResult(res);
          setSelectedKey(res.key);
          setTranspose(null);
          setActiveNote(null);
          finished = true;
        }
      }
    } catch (e) {
      if (version === analysisVersion.current)
        setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      if (version === analysisVersion.current) setBusy(false);
    }
  }
  function setKey(v: string) {
    const [root, mode] = v.split(":");
    const k = keyOf(Number(root), mode as "major" | "minor");
    setSelectedKey(k);
    if (result)
      setResult({
        ...result,
        notes: result.notes.map((n) => ({ ...n, solfa: syllable(n.midi, k) })),
      });
    setTranspose(null);
  }
  function updateNote(i: number, m: number) {
    if (!result || !Number.isFinite(m) || m < 24 || m > 108) return;
    setResult({
      ...result,
      notes: result.notes.map((n, j) =>
        j === i
          ? {
              ...n,
              midi: m,
              name: noteName(m),
              solfa: syllable(m, selectedKey || result.key),
              confidence: null,
              edited: true,
            }
          : n,
      ),
    });
  }
  const displayed =
    result && selectedKey
      ? result.notes.map((n) => {
          const shift =
            transpose === null ? 0 : (transpose - selectedKey.tonic + 12) % 12;
          return {
            ...n,
            midi: n.midi + shift,
            name: noteName(n.midi + shift),
            solfa: syllable(n.midi, selectedKey),
          };
        })
      : [];
  async function save() {
    if (!result || !audio) return;
    try {
      const id = projectId || crypto.randomUUID();
      await store({
        id,
        title,
        date: Date.now(),
        result: {
          ...result,
          notes: result.notes.map((n) => ({
            ...n,
            solfa: syllable(n.midi, selectedKey || result.key),
          })),
        },
        selectedKey: selectedKey || result.key,
        transpose,
        audio,
        filename,
      });
      setProjectId(id);
      refresh();
      setNotice("Saved on this device.");
    } catch {
      setError("Could not save on this device. Check your browser storage.");
    }
  }
  function openProject(p: Project) {
    reset();
    setAudio(p.audio);
    setFilename(p.filename);
    setTitle(p.title);
    setResult(p.result);
    setSelectedKey(p.selectedKey || p.result.key);
    setTranspose(p.transpose ?? null);
    setProjectId(p.id);
    setView("workspace");
  }
  function selectNote(i: number) {
    if (!result) return;
    const n = result.notes[i];
    setActiveNote(i);
    setEditStart(n.start.toFixed(3));
    setEditEnd(n.end.toFixed(3));
    if (audioRef.current) audioRef.current.currentTime = n.start;
  }
  function applyTiming() {
    if (!result || activeNote === null) return;
    const start = Number(editStart),
      end = Number(editEnd),
      i = activeNote;
    const previous = i > 0 ? result.notes[i - 1].end : 0;
    const next =
      i + 1 < result.notes.length ? result.notes[i + 1].start : duration;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < previous - 0.001 ||
      end > next + 0.001 ||
      end - start < 0.05
    ) {
      setError(
        "Choose a note duration of at least 0.05 seconds without overlapping its neighbours or the recording bounds.",
      );
      return;
    }
    setResult({
      ...result,
      notes: result.notes.map((n, j) =>
        j === i ? { ...n, start, end, confidence: null, edited: true } : n,
      ),
    });
    setNotice("Note timing updated. Save the project to keep this edit.");
  }
  function removeNote() {
    if (!result || activeNote === null) return;
    if (result.notes.length === 1) {
      setError("Keep at least one note in the transcription.");
      return;
    }
    setResult({
      ...result,
      notes: result.notes.filter((_, j) => j !== activeNote),
    });
    setActiveNote(null);
    setNotice("Note removed. Save the project to keep this edit.");
  }
  function addNote() {
    if (!result || activeNote === null) return;
    const i = activeNote,
      currentNote = result.notes[i],
      endOfGap =
        i + 1 < result.notes.length ? result.notes[i + 1].start : duration;
    const start = currentNote.end;
    if (endOfGap - start < 0.1) {
      setError(
        "There is no gap after this note. Shorten it first to make room.",
      );
      return;
    }
    const end = Math.min(start + 0.3, endOfGap);
    const added = {
      ...currentNote,
      start,
      end,
      confidence: null,
      edited: true,
    };
    const notes = [
      ...result.notes.slice(0, i + 1),
      added,
      ...result.notes.slice(i + 1),
    ];
    setResult({ ...result, notes });
    setActiveNote(i + 1);
    setEditStart(start.toFixed(3));
    setEditEnd(end.toFixed(3));
    setNotice(
      "Note added in the following gap. Adjust its pitch and timing, then save.",
    );
  }
  function replaySection() {
    if (!audioRef.current) return;
    if (
      sectionStart < 0 ||
      sectionEnd > duration ||
      sectionEnd - sectionStart < 0.05
    ) {
      setError("Choose a valid playback section within the recording.");
      return;
    }
    playingSelection.current = true;
    audioRef.current.currentTime = sectionStart;
    audioRef.current
      .play()
      .catch(() => setError("Playback could not be started."));
  }
  function playMelody() {
    if (!displayed.length) return;
    const c = new AudioContext();
    const base = c.currentTime + 0.08;
    const origin = displayed[0].start;
    displayed.forEach((n) => {
      const osc = c.createOscillator(),
        gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = 440 * 2 ** ((n.midi - 69) / 12);
      osc.connect(gain);
      gain.connect(c.destination);
      const a = base + n.start - origin,
        b = base + n.end - origin;
      gain.gain.setValueAtTime(0.0001, a);
      gain.gain.exponentialRampToValueAtTime(0.15, a + 0.02);
      gain.gain.setValueAtTime(0.15, Math.max(a + 0.02, b - 0.03));
      gain.gain.exponentialRampToValueAtTime(0.0001, b);
      osc.start(a);
      osc.stop(b + 0.01);
    });
    setTimeout(
      () => c.close(),
      (displayed[displayed.length - 1].end - origin + 1) * 1000,
    );
  }
  function exportText() {
    const lines = [
      title,
      `Reference key: ${selectedKey?.name}${transpose !== null ? ` → ${names[transpose]} ${selectedKey?.mode}` : ""}`,
      `Timing in seconds`,
      ...displayed.map(
        (n) =>
          `${n.start.toFixed(2)}–${n.end.toFixed(2)}  ${n.name}  ${n.solfa}`,
      ),
      "",
      ...(result?.warnings || []),
    ];
    download(lines.join("\n"), `${title}.txt`, "text/plain");
  }
  function exportMidi() {
    // Format 0, 480 ticks per beat at 120 BPM: 960 ticks per second.
    const vlq = (value: number) => {
      let v = Math.max(0, Math.round(value)),
        bytes = [v & 127];
      while ((v >>= 7)) bytes.unshift((v & 127) | 128);
      return bytes;
    };
    const events: { tick: number; data: number[]; order: number }[] = [];
    displayed.forEach((n) => {
      events.push({
        tick: Math.round(n.start * 960),
        data: [0x90, Math.max(0, Math.min(127, n.midi)), 90],
        order: 1,
      });
      events.push({
        tick: Math.round(n.end * 960),
        data: [0x80, Math.max(0, Math.min(127, n.midi)), 0],
        order: 0,
      });
    });
    events.sort((a, b) => a.tick - b.tick || a.order - b.order);
    const track: number[] = [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20];
    let last = 0;
    for (const e of events) {
      track.push(...vlq(e.tick - last), ...e.data);
      last = e.tick;
    }
    track.push(0, 0xff, 0x2f, 0);
    const len = track.length;
    const bytes = new Uint8Array([
      77,
      84,
      104,
      100,
      0,
      0,
      0,
      6,
      0,
      0,
      0,
      1,
      1,
      224,
      77,
      84,
      114,
      107,
      (len >>> 24) & 255,
      (len >>> 16) & 255,
      (len >>> 8) & 255,
      len & 255,
      ...track,
    ]);
    download(bytes, `${title}.mid`, "audio/midi");
  }
  function printPDF() {
    window.print();
  }
  const keyValue = selectedKey
    ? `${selectedKey.tonic}:${selectedKey.mode}`
    : "";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <AudioLines size={20} />
          </div>
          <div>
            <strong>
              cadence<span>.</span>
            </strong>
            <small>MELODY WORKSPACE</small>
          </div>
        </div>
        <div className="side-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={view === "workspace" ? "nav active" : "nav"}
            onClick={() => setView("workspace")}
          >
            <Activity size={17} /> Analysis studio <span className="nav-dot" />
          </button>
          <button
            className={view === "recent" ? "nav active" : "nav"}
            onClick={() => {
              if (recording) stopRecording();
              refresh();
              setView("recent");
            }}
          >
            <Clock3 size={17} /> Recent projects{" "}
            <span className="nav-count">{projects.length}</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="side-note">
            <div className="side-note-icon">
              <Music2 size={16} />
            </div>
            <strong>A little more musical.</strong>
            <p>Turn the melodies in your head into something you can see.</p>
          </div>
          <div className="side-footer">
            <span className="avatar">C</span>
            <div>
              <b>Your workspace</b>
              <small>Saved on this device</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="slash">/</span>
            <b>{view === "recent" ? "Recent projects" : "Analysis studio"}</b>
          </div>
          <div className="top-right">
            <span className="secure-dot" /> LOCAL WORKSPACE{" "}
            <span className="top-divider" />
            <button
              className="help"
              title="How it works"
              onClick={() => {
                if (document.getElementById("guide"))
                  document
                    .getElementById("guide")
                    ?.scrollIntoView({ behavior: "smooth" });
                else
                  setNotice(
                    "Select a note to edit it. Change the reference key to reinterpret solfa, or transpose to shift pitches.",
                  );
              }}
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        {view === "recent" ? (
          <div className="content recent">
            <div className="eyebrow">
              <span /> YOUR LIBRARY
            </div>
            <div className="heading-row">
              <div>
                <h1>
                  Recent projects<span className="accent">.</span>
                </h1>
                <p>
                  Pick up where you left off. Projects are stored in this
                  browser.
                </p>
              </div>
              <button className="primary" onClick={reset}>
                <Plus size={16} /> New analysis
              </button>
            </div>
            {projects.length >= 2 && (
              <div className="comparison">
                <div>
                  <span className="section-kicker">MELODY COMPARISON</span>
                  <h2>Compare relative movement</h2>
                  <p>
                    Choose two saved projects. We compare the semitone steps
                    between their notes, regardless of starting pitch.
                  </p>
                </div>
                <div className="compare-controls">
                  <label>
                    First recording{" "}
                    <select
                      value={compareA}
                      onChange={(e) => setCompareA(e.target.value)}
                    >
                      <option value="">Choose a project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Second recording{" "}
                    <select
                      value={compareB}
                      onChange={(e) => setCompareB(e.target.value)}
                    >
                      <option value="">Choose a project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {compareA &&
                  compareB &&
                  (() => {
                    const a = projects.find((p) => p.id === compareA),
                      b = projects.find((p) => p.id === compareB);
                    if (!a || !b) return null;
                    const match = compareMelodies(
                      a.result.notes,
                      b.result.notes,
                    );
                    return (
                      <div className="comparison-result">
                        {match ? (
                          <>
                            <b>
                              {match.exact
                                ? "Identical interval sequence"
                                : `${match.score}% interval similarity`}
                            </b>
                            <p>
                              {match.intervalsA} vs {match.intervalsB} intervals
                              · Starting pitches differ by{" "}
                              {match.shift > 0 ? "+" : ""}
                              {match.shift} semitones. This is an edit-distance
                              comparison, not a probability; timing and rhythm
                              are not compared. Pitch-detection errors can
                              affect the result.
                            </p>
                          </>
                        ) : (
                          <p>
                            Each recording needs at least two notes for
                            comparison.
                          </p>
                        )}
                      </div>
                    );
                  })()}
              </div>
            )}
            <div className="recent-list">
              {projects.length === 0 ? (
                <div className="recent-empty">
                  <Clock3 size={25} />
                  <h3>No saved projects yet</h3>
                  <p>Analyse a melody and save it to find it here.</p>
                  <button className="text-button" onClick={reset}>
                    Start an analysis <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                projects.map((p) => (
                  <div className="project-row" key={p.id}>
                    <button
                      className="project-open"
                      onClick={() => openProject(p)}
                    >
                      <span className="project-icon">
                        <Music2 size={18} />
                      </span>
                      <span>
                        <b>{p.title}</b>
                        <small>
                          {p.result.key.name} · {p.result.notes.length} notes ·{" "}
                          {new Date(p.date).toLocaleDateString()}
                        </small>
                      </span>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete ${p.title}`}
                      onClick={async () => {
                        if (confirm("Delete this saved project?")) {
                          await removeProject(p.id);
                          refresh();
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="content">
            <div className="intro">
              <div className="eyebrow">
                <span /> YOUR MELODY WORKSPACE
              </div>
              <div className="heading-row">
                <div>
                  <h1>
                    {result
                      ? "Your melody, mapped"
                      : "Make sense of your melody"}
                    <span className="accent">.</span>
                  </h1>
                  <p>
                    {result
                      ? "Listen, inspect, and make it your own."
                      : "From a simple voice recording to notes, key and tonic solfa."}
                  </p>
                </div>
                {result && (
                  <button className="subtle-button" onClick={reset}>
                    <Plus size={16} /> New analysis
                  </button>
                )}
              </div>
            </div>
            {!result ? (
              <>
                <div className="workspace-grid">
                  <section className="capture-panel">
                    <div className="panel-head">
                      <div>
                        <div className="section-kicker">01 / GET STARTED</div>
                        <h2>Bring your melody</h2>
                        <p>Sing a few notes or choose a recording to begin.</p>
                      </div>
                      <span className="head-icon">
                        <AudioLines size={21} />
                      </span>
                    </div>
                    <div className="tabs" role="tablist">
                      <button
                        role="tab"
                        aria-selected={tab === "record"}
                        onClick={() => setTab("record")}
                        className={tab === "record" ? "tab selected" : "tab"}
                      >
                        <Mic size={16} /> Record audio
                      </button>
                      <button
                        role="tab"
                        aria-selected={tab === "upload"}
                        disabled={recording}
                        onClick={() => setTab("upload")}
                        className={tab === "upload" ? "tab selected" : "tab"}
                      >
                        <UploadCloud size={16} /> Upload a file
                      </button>
                    </div>
                    {tab === "record" ? (
                      <div className="record-zone">
                        <div
                          className={"mic-orbit " + (recording ? "live" : "")}
                        >
                          <div className="orbit-ring">
                            <button
                              className="mic-button"
                              disabled={starting}
                              aria-label={
                                recording ? "Stop recording" : "Start recording"
                              }
                              onClick={
                                recording ? stopRecording : startRecording
                              }
                            >
                              {recording ? (
                                <Square size={22} fill="currentColor" />
                              ) : (
                                <Mic size={25} />
                              )}
                            </button>
                          </div>
                        </div>
                        <h3>
                          {recording
                            ? paused
                              ? "Recording paused"
                              : "Listening to you"
                            : audio
                              ? "Recording ready"
                              : "Ready when you are"}
                        </h3>
                        <p>
                          {recording
                            ? `${time(elapsed)} · ${paused ? "Paused" : "Recording in progress"}`
                            : audio
                              ? "Preview your audio below, or record again."
                              : "Find a quiet place, then tap the microphone to sing."}
                        </p>
                        {recording ? (
                          <div className="record-controls">
                            <canvas
                              className="live-wave"
                              width={150}
                              height={30}
                              aria-label="Live microphone waveform"
                            />
                            <div
                              className="level-meter"
                              aria-label={`Microphone input level ${Math.round(level * 100)} percent`}
                            >
                              <span style={{ width: `${level * 100}%` }} />
                            </div>
                            <button
                              onClick={togglePause}
                              className="tiny-button"
                            >
                              {paused ? (
                                <Play size={13} />
                              ) : (
                                <Pause size={13} />
                              )}{" "}
                              {paused ? "Resume" : "Pause"}
                            </button>
                            <button
                              onClick={stopRecording}
                              className="tiny-button"
                            >
                              Stop
                            </button>
                          </div>
                        ) : (
                          <button
                            className="outline-button"
                            disabled={starting}
                            onClick={startRecording}
                          >
                            <Mic size={15} />{" "}
                            {starting
                              ? "Requesting microphone…"
                              : audio
                                ? "Record again"
                                : "Start recording"}
                          </button>
                        )}
                        {devices.length > 0 && !recording && (
                          <label className="device-label">
                            Input{" "}
                            <select
                              value={device}
                              onChange={(e) => setDevice(e.target.value)}
                            >
                              <option value="">Default microphone</option>
                              {devices.map((d) => (
                                <option key={d.deviceId} value={d.deviceId}>
                                  {d.label || "Microphone"}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                    ) : (
                      <div
                        className={"upload-zone " + (drag ? "drag" : "")}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDrag(true);
                        }}
                        onDragLeave={() => setDrag(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDrag(false);
                          if (e.dataTransfer.files[0])
                            accept(e.dataTransfer.files[0]);
                        }}
                      >
                        <div className="upload-icon">
                          <UploadCloud size={24} />
                        </div>
                        <h3>Drop your audio here</h3>
                        <p>Or browse files on your device.</p>
                        <input
                          ref={inputRef}
                          type="file"
                          accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.webm"
                          hidden
                          onChange={(e) => {
                            if (e.target.files?.[0]) accept(e.target.files[0]);
                            e.target.value = "";
                          }}
                        />
                        <button
                          className="outline-button"
                          onClick={() => inputRef.current?.click()}
                        >
                          Choose a file <ArrowRight size={15} />
                        </button>
                        <small>
                          WAV, MP3, M4A, FLAC or WebM · 25 MB / 60 sec max
                        </small>
                      </div>
                    )}
                    {audio && (
                      <div className="audio-loaded">
                        <div className="file-line">
                          <span className="file-icon">
                            <FileAudio size={17} />
                          </span>
                          <div>
                            <b>{filename}</b>
                            <small>
                              {(audio.size / 1024 / 1024).toFixed(2)} MB ·{" "}
                              {time(duration)}
                            </small>
                          </div>
                          <button
                            className="icon-button"
                            aria-label="Remove audio"
                            onClick={() => {
                              setAudio(null);
                              setFilename("");
                            }}
                          >
                            <X size={17} />
                          </button>
                        </div>
                        <audio
                          controls
                          src={url}
                          className="audio-native"
                          aria-label="Preview recording"
                        />
                        <div className="section-select">
                          <label>
                            <input
                              type="checkbox"
                              checked={sectionOnly}
                              onChange={(e) => setSectionOnly(e.target.checked)}
                            />{" "}
                            Analyse a section
                          </label>
                          {sectionOnly && (
                            <div className="range-inputs">
                              <label>
                                From (sec){" "}
                                <input
                                  type="number"
                                  min="0"
                                  max={duration}
                                  step="0.1"
                                  value={sectionStart}
                                  onChange={(e) =>
                                    setSectionStart(Number(e.target.value))
                                  }
                                />
                              </label>
                              <label>
                                To (sec){" "}
                                <input
                                  type="number"
                                  min="0"
                                  max={duration}
                                  step="0.1"
                                  value={sectionEnd}
                                  onChange={(e) =>
                                    setSectionEnd(Number(e.target.value))
                                  }
                                />
                              </label>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="panel-bottom">
                      <div>
                        <span className="status-indicator" />{" "}
                        {audio ? "AUDIO READY" : "AWAITING AUDIO"}
                      </div>
                      <button
                        className="primary"
                        disabled={!audio || recording || busy}
                        onClick={() => runAnalysis()}
                      >
                        {busy ? "Analysing…" : "Analyse melody"}{" "}
                        <ArrowRight size={16} />
                      </button>
                    </div>
                    {busy && (
                      <div className="progress-wrap" role="status">
                        <div>
                          <span>{status}</span>
                          <b>{progress}%</b>
                        </div>
                        <div className="progress-track">
                          <span style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    )}
                  </section>
                  <aside className="guide" id="guide">
                    <div className="guide-head">
                      <span className="guide-spark">✳</span>
                      <span>THE QUICK GUIDE</span>
                    </div>
                    <h2>
                      Good input.
                      <br />
                      <em>Great insight.</em>
                    </h2>
                    <p>
                      A clear recording helps Cadence hear the notes that
                      matter.
                    </p>
                    <div className="guide-steps">
                      <div>
                        <span>01</span>
                        <div>
                          <b>Find a quiet space</b>
                          <p>Less background noise means a clearer melody.</p>
                        </div>
                      </div>
                      <div>
                        <span>02</span>
                        <div>
                          <b>Sing one melody</b>
                          <p>One voice at a time works best for now.</p>
                        </div>
                      </div>
                      <div>
                        <span>03</span>
                        <div>
                          <b>Give it a little time</b>
                          <p>A longer phrase gives the key more context.</p>
                        </div>
                      </div>
                    </div>
                    <div className="guide-foot">
                      <Info size={15} />
                      <span>
                        Your audio is processed for analysis, not used as
                        training data.
                      </span>
                    </div>
                  </aside>
                </div>
                <div className="bottom-note">
                  <div className="bottom-note-icon">
                    <Headphones size={18} />
                  </div>
                  <div>
                    <b>Made for the moments music finds you.</b>
                    <p>
                      Capture an idea, learn a melody, or share it with your
                      choir.
                    </p>
                  </div>
                  <span>
                    LISTEN CLOSER <ArrowRight size={15} />
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="result-heading">
                  <div>
                    <span className="section-kicker">ANALYSIS RESULT</span>
                    <input
                      aria-label="Project title"
                      className="title-input"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>
                  <div className="result-actions">
                    <button className="outline-button" onClick={save}>
                      <Save size={15} /> Save project
                    </button>
                    <button className="outline-button" onClick={exportText}>
                      <ArrowDownToLine size={15} /> Export text
                    </button>
                    <button
                      className="outline-button"
                      onClick={() =>
                        download(
                          JSON.stringify(
                            {
                              ...result,
                              referenceKey: selectedKey,
                              targetTonic: transpose,
                              notes: result.notes.map((n) => ({
                                ...n,
                                solfa: syllable(
                                  n.midi,
                                  selectedKey || result.key,
                                ),
                              })),
                              displayedNotes: displayed,
                            },
                            null,
                            2,
                          ),
                          `${title}.json`,
                          "application/json",
                        )
                      }
                    >
                      JSON
                    </button>
                    <button className="outline-button" onClick={exportMidi}>
                      MIDI
                    </button>
                    <button className="outline-button" onClick={printPDF}>
                      Print / PDF
                    </button>
                  </div>
                </div>
                <div className="print-summary">
                  <b>
                    Detected: {result.key.name} · Reference: {selectedKey?.name}
                    {transpose !== null
                      ? ` · Transposed to ${names[transpose]} ${selectedKey?.mode}`
                      : ""}
                  </b>
                  <p>Time in seconds · {result.method}</p>
                  <p>{result.warnings.join(" ")}</p>
                  {displayed.map((n, i) => (
                    <span key={i}>
                      {n.start.toFixed(2)}–{n.end.toFixed(2)}s: {n.name} (
                      {n.solfa}) ·{" "}
                    </span>
                  ))}
                </div>
                <div className="result-layout">
                  <div className="result-main">
                    <section className="result-panel">
                      <div className="result-panel-head">
                        <div>
                          <span className="section-kicker">
                            01 / LISTEN BACK
                          </span>
                          <h2>Your recording</h2>
                        </div>
                        <span className="tag">ORIGINAL AUDIO</span>
                      </div>
                      <div
                        className="waveform"
                        role="button"
                        tabIndex={0}
                        aria-label="Seek in recording"
                        onClick={(e) => {
                          if (audioRef.current && duration) {
                            const r = e.currentTarget.getBoundingClientRect();
                            audioRef.current.currentTime =
                              ((e.clientX - r.left) / r.width) * duration;
                          }
                        }}
                        onKeyDown={(e) => {
                          if (audioRef.current && e.key === "ArrowRight")
                            audioRef.current.currentTime += 5;
                          if (audioRef.current && e.key === "ArrowLeft")
                            audioRef.current.currentTime -= 5;
                        }}
                      >
                        {wave.length ? (
                          wave.map((v, i) => (
                            <span
                              key={i}
                              className={
                                i / wave.length < current / duration
                                  ? "played"
                                  : ""
                              }
                              style={{ height: `${Math.max(3, v * 90)}%` }}
                            />
                          ))
                        ) : (
                          <span className="wave-placeholder">
                            Waveform unavailable
                          </span>
                        )}
                      </div>
                      <audio
                        ref={audioRef}
                        src={url}
                        onTimeUpdate={(e) => {
                          const el = e.currentTarget;
                          setCurrent(el.currentTime);
                          if (
                            playingSelection.current &&
                            el.currentTime >= sectionEnd
                          ) {
                            if (loopSection) el.currentTime = sectionStart;
                            else {
                              playingSelection.current = false;
                              el.pause();
                            }
                          }
                        }}
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        onEnded={() => setPlaying(false)}
                      />
                      <div className="playback">
                        <button
                          className="play-button"
                          aria-label={playing ? "Pause" : "Play"}
                          onClick={() => {
                            playingSelection.current = false;
                            if (playing) audioRef.current?.pause();
                            else
                              audioRef.current
                                ?.play()
                                .catch(() =>
                                  setError("Playback could not be started."),
                                );
                          }}
                        >
                          {playing ? (
                            <Pause size={16} fill="currentColor" />
                          ) : (
                            <Play size={16} fill="currentColor" />
                          )}
                        </button>
                        <span>
                          {time(current)} <i>/</i> {time(duration)}
                        </span>
                        <input
                          aria-label="Seek playback"
                          type="range"
                          min="0"
                          max={duration || 0}
                          step=".01"
                          value={Math.min(current, duration)}
                          onChange={(e) => {
                            if (audioRef.current)
                              audioRef.current.currentTime = Number(
                                e.target.value,
                              );
                          }}
                        />
                        <Volume2 size={17} />
                      </div>
                      <div className="selection-tools">
                        <div className="selection-title">
                          <span>SECTION PLAYBACK</span>
                          <span>Set a range to replay or analyse</span>
                        </div>
                        <div className="selection-fields">
                          <label>
                            Name{" "}
                            <input
                              value={sectionName}
                              maxLength={40}
                              onChange={(e) => setSectionName(e.target.value)}
                            />
                          </label>
                          <label>
                            From (s){" "}
                            <input
                              type="number"
                              min="0"
                              max={duration}
                              step="0.1"
                              value={sectionStart}
                              onChange={(e) =>
                                setSectionStart(Number(e.target.value))
                              }
                            />
                          </label>
                          <label>
                            To (s){" "}
                            <input
                              type="number"
                              min="0"
                              max={duration}
                              step="0.1"
                              value={sectionEnd}
                              onChange={(e) =>
                                setSectionEnd(Number(e.target.value))
                              }
                            />
                          </label>
                          <label className="loop-check">
                            <input
                              type="checkbox"
                              checked={loopSection}
                              onChange={(e) => setLoopSection(e.target.checked)}
                            />{" "}
                            Loop
                          </label>
                          <button
                            className="outline-button"
                            onClick={replaySection}
                          >
                            <Play size={13} /> Play section
                          </button>
                          <button
                            className="outline-button"
                            disabled={busy}
                            onClick={() => runAnalysis(true)}
                          >
                            {busy ? "Analysing…" : "Analyse section"}
                          </button>
                        </div>
                        {busy && (
                          <div className="section-progress" role="status">
                            {status} · {progress}%
                          </div>
                        )}
                      </div>
                    </section>
                    <section className="result-panel transcription">
                      <div className="result-panel-head">
                        <div>
                          <span className="section-kicker">
                            02 / THE TRANSCRIPTION
                          </span>
                          <h2>Notes & tonic solfa</h2>
                          <p>
                            Click a note to edit its pitch or timing, or add a
                            note in a gap.
                          </p>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => {
                            navigator.clipboard
                              .writeText(
                                displayed.map((n) => n.solfa).join(" "),
                              )
                              .then(() =>
                                setNotice("Solfa copied to clipboard."),
                              )
                              .catch(() =>
                                setError("Could not copy to clipboard."),
                              );
                          }}
                        >
                          <Copy size={15} /> Copy solfa
                        </button>
                      </div>
                      <div className="solfa-list">
                        {displayed.map((n, i) => (
                          <React.Fragment key={i}>
                            {i > 0 && n.start - displayed[i - 1].end > 0.2 && (
                              <div className="rest">
                                <b>—</b>
                                <span>REST</span>
                                <small>
                                  {(n.start - displayed[i - 1].end).toFixed(1)}s
                                </small>
                              </div>
                            )}
                            <button
                              className={
                                "solfa-note " +
                                (activeNote === i ? "selected" : "") +
                                (current >= n.start &&
                                current < n.end &&
                                playing
                                  ? " sounding"
                                  : "")
                              }
                              onClick={() => selectNote(i)}
                            >
                              <b>{n.solfa}</b>
                              <span>{n.name}</span>
                              <small>{(n.end - n.start).toFixed(1)}s</small>
                            </button>
                          </React.Fragment>
                        ))}
                      </div>
                      {activeNote !== null && displayed[activeNote] && (
                        <div className="note-editor">
                          <span>NOTE {activeNote + 1}</span>
                          <b>
                            {displayed[activeNote].start.toFixed(2)}–
                            {displayed[activeNote].end.toFixed(2)}s
                          </b>
                          <label>
                            Correct original pitch{" "}
                            <select
                              value={result.notes[activeNote].midi}
                              onChange={(e) =>
                                updateNote(activeNote, Number(e.target.value))
                              }
                            >
                              {Array.from({ length: 85 }, (_, i) => i + 24).map(
                                (m) => (
                                  <option value={m} key={m}>
                                    {noteName(m)}
                                  </option>
                                ),
                              )}
                            </select>
                          </label>
                          <button
                            className="icon-button"
                            aria-label="Close note editor"
                            onClick={() => setActiveNote(null)}
                          >
                            <X size={16} />
                          </button>
                          <div className="edit-timing">
                            <label>
                              Start (s){" "}
                              <input
                                type="number"
                                min="0"
                                max={duration}
                                step="0.001"
                                value={editStart}
                                onChange={(e) => setEditStart(e.target.value)}
                              />
                            </label>
                            <label>
                              End (s){" "}
                              <input
                                type="number"
                                min="0"
                                max={duration}
                                step="0.001"
                                value={editEnd}
                                onChange={(e) => setEditEnd(e.target.value)}
                              />
                            </label>
                            <button
                              className="tiny-button"
                              onClick={applyTiming}
                            >
                              Apply timing
                            </button>
                            <button className="tiny-button" onClick={addNote}>
                              Add note after
                            </button>
                            <button
                              className="tiny-button"
                              onClick={removeNote}
                            >
                              Remove note
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="transcription-foot">
                        <span>
                          <span className="legend-dot" /> MOVABLE DO ·{" "}
                          {displayed.length} NOTES
                        </span>
                        <button className="text-button" onClick={playMelody}>
                          <Play size={13} /> Play extracted melody
                        </button>
                      </div>
                    </section>
                    <section className="result-panel">
                      <div className="result-panel-head">
                        <div>
                          <span className="section-kicker">03 / PITCH MAP</span>
                          <h2>See the shape</h2>
                          <p>Note position reflects pitch and timing.</p>
                        </div>
                        <span className="tag">PIANO ROLL</span>
                      </div>
                      <div className="pitch-map">
                        {displayed.length > 0 &&
                          (() => {
                            const low =
                                Math.min(...displayed.map((n) => n.midi)) - 1,
                              high =
                                Math.max(...displayed.map((n) => n.midi)) + 1,
                              span = Math.max(4, high - low);
                            return (
                              <>
                                <div className="pitch-label high">
                                  {noteName(high)}
                                </div>
                                <div className="pitch-label low">
                                  {noteName(low)}
                                </div>
                                <div className="pitch-grid">
                                  {displayed.map((n, i) => (
                                    <button
                                      title={`${n.name}, ${n.solfa}, ${n.start.toFixed(2)} seconds`}
                                      aria-label={`Note ${i + 1}, ${n.name}`}
                                      key={i}
                                      onClick={() => selectNote(i)}
                                      style={{
                                        left: `${(n.start / duration) * 100}%`,
                                        width: `${Math.max(0.6, ((n.end - n.start) / duration) * 100)}%`,
                                        bottom: `${((n.midi - low) / span) * 85}%`,
                                      }}
                                    />
                                  ))}
                                </div>
                              </>
                            );
                          })()}
                      </div>
                      <div className="map-axis">
                        <span>0:00</span>
                        <span>{time(duration)}</span>
                      </div>
                    </section>
                  </div>
                  <aside className="analysis-side">
                    <div className="key-card">
                      <span className="section-kicker">
                        DETECTED TONAL CENTRE
                      </span>
                      <div className="key-name">
                        {result.key.name.split(" ")[0]}
                        <span>{result.key.mode}</span>
                      </div>
                      <div className="key-score">
                        <span>PROFILE MATCH</span>
                        <b>{result.key.score.toFixed(2)}</b>
                      </div>
                      <div className="score-line">
                        <span
                          style={{
                            width: `${Math.max(0, result.key.score) * 100}%`,
                          }}
                        />
                      </div>
                      <p>
                        Relative profile correlation, not a calibrated
                        probability. A melody can suggest more than one key.
                      </p>
                    </div>
                    <div className="side-section">
                      <div className="side-section-title">MELODY DETAILS</div>
                      <div className="detail">
                        <span>Detected starting note</span>
                        <b>{result.startingNote}</b>
                      </div>
                      <div className="detail">
                        <span>Detected pitch range</span>
                        <b>{result.range}</b>
                      </div>
                      <div className="detail">
                        <span>Duration</span>
                        <b>{time(result.duration)}</b>
                      </div>
                      <div className="detail">
                        <span>Pitch method</span>
                        <b>pYIN</b>
                      </div>
                    </div>
                    <div className="side-section">
                      <div className="side-section-title">REFERENCE KEY</div>
                      <p>
                        Change the tonal centre to reinterpret the solfa,
                        without changing the notes.
                      </p>
                      <label className="select-label">
                        Key and mode{" "}
                        <select
                          value={keyValue}
                          onChange={(e) => setKey(e.target.value)}
                        >
                          {["major", "minor"].map((mode) =>
                            names.map((n, i) => (
                              <option value={`${i}:${mode}`} key={n + mode}>
                                {n} {mode}
                              </option>
                            )),
                          )}
                        </select>
                      </label>
                      <div className="alternative">
                        ALTERNATIVES{" "}
                        {result.candidates.slice(1, 4).map((k) => (
                          <button
                            key={k.name}
                            onClick={() => setKey(`${k.tonic}:${k.mode}`)}
                          >
                            {k.name} <span>{k.score.toFixed(2)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="side-section">
                      <div className="side-section-title">TRANSPOSE</div>
                      <p>
                        Shift absolute pitches while keeping the solfa the same.
                      </p>
                      <label className="select-label">
                        Target tonic{" "}
                        <select
                          value={transpose === null ? "original" : transpose}
                          onChange={(e) =>
                            setTranspose(
                              e.target.value === "original"
                                ? null
                                : Number(e.target.value),
                            )
                          }
                        >
                          <option value="original">Original pitch</option>
                          {names.map((n, i) => (
                            <option key={n} value={i}>
                              {n} {selectedKey?.mode}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="side-section warning-section">
                      <div className="side-section-title">
                        <Info size={14} /> ANALYSIS NOTES
                      </div>
                      {result.warnings.map((w, i) => (
                        <p key={i}>{w}</p>
                      ))}
                      <p>
                        Chromatic syllables use di, ri, fi, si, li for raised
                        degrees; tonic-based minor uses me, le, te. Timing is
                        approximate.
                      </p>
                    </div>
                  </aside>
                </div>
              </>
            )}
            {error && (
              <div className="message error" role="alert">
                <Info size={16} />
                {error}
                <button onClick={() => setError("")} aria-label="Dismiss">
                  <X size={15} />
                </button>
              </div>
            )}
            {notice && (
              <div className="message success" role="status">
                <Check size={16} />
                {notice}
                <button onClick={() => setNotice("")} aria-label="Dismiss">
                  <X size={15} />
                </button>
              </div>
            )}
            <footer className="footer">
              <span>© CADENCE STUDIO</span>
              <span>
                MADE FOR MUSIC, NOT JUST METRICS{" "}
                <span className="footer-star">✳</span>
              </span>
            </footer>
          </div>
        )}
      </main>
    </div>
  );
}
