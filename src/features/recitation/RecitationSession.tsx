import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Check, Mic, Pause, Play, RotateCcw, Square, X } from "@productivity-os/shared-ui/components/sf-symbols";
import { compactWaveformPeaks, recordingStorageMimeType } from "../../recording";
import { loadQuranPage, pageForVerse, rangeVerseKeys } from "../reader/page-data";
import { MushafPage } from "../reader/MushafPage";
import type { AyahBoundary, MistakeRange, QuranPage, Recording, RecordingTarget, VerseRef } from "../shared/types";
import { Waveform } from "./Waveform";
import { useSegmentedPlayback } from "./useSegmentedPlayback";

type Mode = "idle" | "recording" | "saving" | "ready" | "checking" | "completed" | "error";

function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function recordingPeaks(recording: Recording | null): number[] {
  return recording?.segments.flatMap((segment) => segment.waveformPeaks) ?? [];
}

export function RecitationSession({ target, onExit }: { target: RecordingTarget; onExit?: () => void }) {
  const startRef = React.useMemo<VerseRef>(() => ({ surahNumber: target.surahNumber, ayahNumber: target.ayahStart }), [target]);
  const endRef = React.useMemo<VerseRef>(() => ({ surahNumber: target.endSurahNumber, ayahNumber: target.ayahEnd }), [target]);
  const selectedKeys = React.useMemo(() => rangeVerseKeys(startRef, endRef), [endRef, startRef]);
  const selectedSet = React.useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const [pages, setPages] = React.useState<QuranPage[]>([]);
  const [pageIndex, setPageIndex] = React.useState(0);
  const [recording, setRecording] = React.useState<Recording | null>(null);
  const [mode, setMode] = React.useState<Mode>("idle");
  const [error, setError] = React.useState("");
  const [elapsed, setElapsed] = React.useState(0);
  const [livePeaks, setLivePeaks] = React.useState<number[]>([]);
  const [boundaries, setBoundaries] = React.useState<AyahBoundary[]>([]);
  const [mistakes, setMistakes] = React.useState<MistakeRange[]>([]);
  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const contextRef = React.useRef<AudioContext | null>(null);
  const appendQueueRef = React.useRef(Promise.resolve());
  const startedAtRef = React.useRef(0);
  const peakRef = React.useRef<number[]>([]);
  const frameRef = React.useRef(0);
  const markerSaveRef = React.useRef<number | undefined>(undefined);
  const closingRef = React.useRef(false);
  const playback = useSegmentedPlayback(recording);

  const refreshRecording = React.useCallback(async () => {
    const recordings = await invoke<Recording[]>("list_recordings");
    const value = recordings.find((item) => item.id === target.recordingId) ?? null;
    setRecording(value);
    if (value) {
      setBoundaries(value.boundaries);
      setMistakes(value.mistakes);
      setMode(value.status === "completed" ? "completed" : value.status === "checking" ? "checking" : value.durationMs > 0 ? "ready" : "idle");
    }
    return value;
  }, [target.recordingId]);

  React.useEffect(() => { void refreshRecording(); }, [refreshRecording]);
  React.useEffect(() => {
    void Promise.all([pageForVerse(startRef), pageForVerse(endRef)]).then(([first, last]) =>
      Promise.all(Array.from({ length: Math.max(1, last - first + 1) }, (_, index) => loadQuranPage(first + index))),
    ).then(setPages);
  }, [endRef, startRef]);

  React.useEffect(() => {
    if (!pages.length) return;
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-verse="${selectedKeys[0]}"]`)?.scrollIntoView({ block: "center" }));
  }, [pages, selectedKeys]);

  const persistReview = React.useCallback(async (status: Recording["status"], nextBoundaries = boundaries, nextMistakes = mistakes) => {
    const saved = await invoke<Recording>("save_recitation_review", {
      input: { recordingId: target.recordingId, status, boundaries: nextBoundaries, mistakes: nextMistakes },
    });
    setRecording(saved); setBoundaries(saved.boundaries); setMistakes(saved.mistakes);
    return saved;
  }, [boundaries, mistakes, target.recordingId]);

  const stopStream = React.useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
  }, []);

  const finishTake = React.useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return recording;
    setMode("saving");
    const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
    recorder.stop();
    await stopped;
    stopStream();
    await appendQueueRef.current;
    try {
      const saved = await invoke<Recording>("finish_recording", {
        captureSessionId: target.captureSessionId,
        durationMs: Date.now() - startedAtRef.current,
        waveformPeaks: compactWaveformPeaks(peakRef.current),
      });
      setRecording(saved); setLivePeaks([]); setMode("ready"); playback.setPositionMs(Math.min(playback.positionMs, saved.durationMs));
      return saved;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason)); setMode("error"); return null;
    }
  }, [playback, recording, stopStream, target.captureSessionId]);

  const startTake = React.useCallback(async () => {
    playback.stop(true);
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      const recordingTarget = { ...target, replaceStartMs: recording ? playback.positionMs : target.replaceStartMs };
      await invoke("begin_recording", { target: recordingTarget, mimeType: recordingStorageMimeType(recorder.mimeType || mimeType || "audio/webm") });
      appendQueueRef.current = Promise.resolve(); peakRef.current = []; setLivePeaks([]);
      recorder.addEventListener("dataavailable", (event) => {
        if (!event.data.size) return;
        appendQueueRef.current = appendQueueRef.current.then(async () => invoke("append_recording_chunk", {
          captureSessionId: target.captureSessionId,
          bytes: Array.from(new Uint8Array(await event.data.arrayBuffer())),
        }));
      });
      recorder.start(500); startedAtRef.current = Date.now(); setElapsed(0); setMode("recording");
      const context = new AudioContext(); contextRef.current = context;
      const analyser = context.createAnalyser(); analyser.fftSize = 512; context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let lastPeakAt = 0;
      const update = () => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0; for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
        const now = Date.now(); setElapsed(now - startedAtRef.current);
        if (now - lastPeakAt >= 45) { peakRef.current.push(peak); setLivePeaks((items) => [...items.slice(-255), peak]); lastPeakAt = now; }
        frameRef.current = requestAnimationFrame(update);
      };
      frameRef.current = requestAnimationFrame(update);
    } catch (reason) {
      stopStream(); setError(reason instanceof Error ? reason.message : String(reason)); setMode("error");
    }
  }, [playback, recording, stopStream, target]);

  const close = React.useCallback(async () => {
    if (closingRef.current) return;
    if (target.origin === "standalone" && mode !== "completed") {
      const save = window.confirm("Save this unfinished recitation as a draft? Select Cancel for discard options.");
      if (!save) {
        const discard = window.confirm("Discard this recitation? Select Cancel to remain in the app.");
        if (!discard) return;
        closingRef.current = true;
        if (mode === "recording") await invoke("discard_recording", { captureSessionId: target.captureSessionId }).catch(() => undefined);
        await invoke("delete_recording", { id: target.recordingId }).catch(() => undefined);
        if (onExit) onExit(); else await getCurrentWindow().close();
        return;
      }
    }
    closingRef.current = true;
    const current = mode === "recording" ? await finishTake() : recording;
    if (current && mode !== "completed") await persistReview("paused").catch(() => undefined);
    if (!current && target.origin === "workflow") await invoke("pause_capture_activity", { captureSessionId: target.captureSessionId }).catch(() => undefined);
    if (onExit) { onExit(); closingRef.current = false; }
    else await getCurrentWindow().close();
  }, [finishTake, mode, onExit, persistReview, recording, target.origin]);

  React.useEffect(() => {
    if (onExit) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      if (closingRef.current) return;
      event.preventDefault(); void close();
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [close, onExit]);

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const targetElement = event.target as HTMLElement | null;
      if (targetElement?.matches("input, select, textarea, button")) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (mode === "recording") void finishTake();
        else if ((mode === "ready" || mode === "checking") && recording) playback.playing ? playback.stop() : void playback.play(playback.positionMs >= recording.durationMs ? 0 : playback.positionMs);
      }
      if (mode === "checking" && event.key.toLocaleLowerCase() === "v" && boundaries.length < selectedKeys.length) {
        event.preventDefault();
        const next = [...boundaries, { verseKey: selectedKeys[boundaries.length]!, sequence: boundaries.length, startMs: playback.positionMs }];
        setBoundaries(next); void persistReview("checking", next, mistakes);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [boundaries, finishTake, mistakes, mode, persistReview, playback, recording, selectedKeys]);

  React.useEffect(() => () => { stopStream(); window.clearTimeout(markerSaveRef.current); }, [stopStream]);
  const activeVerse = React.useMemo(() => {
    if (!boundaries.length) return null;
    return [...boundaries].reverse().find((boundary) => boundary.startMs <= playback.positionMs)?.verseKey ?? null;
  }, [boundaries, playback.positionMs]);
  const peaks = mode === "recording" ? livePeaks : recordingPeaks(recording);
  const duration = mode === "recording" ? elapsed : recording?.durationMs ?? 0;

  return <main className={`recitation-session ${target.origin === "workflow" ? "workflow-session" : "standalone-session"}`}>
    <header className="recitation-header" data-tauri-drag-region>
      <div><small>{target.origin === "workflow" ? "Workflow recitation" : "Recitation"}</small><h1>{target.surahName} {target.ayahStart}{target.endSurahNumber === target.surahNumber ? `–${target.ayahEnd}` : ` – ${target.endSurahName} ${target.ayahEnd}`}</h1></div>
      <button type="button" className="icon-button" aria-label="Close recitation" onClick={() => void close()}><X /></button>
    </header>
    <section className="recitation-pages">
      {pages[pageIndex] && <MushafPage
        page={pages[pageIndex]}
        concealed={mode === "recording" || mode === "saving"}
        selectedVerseKeys={selectedSet}
        activeVerseKey={activeVerse}
        mistakes={mistakes}
        onSelection={mode === "checking" ? (selection) => {
          const next = [...mistakes, { ...selection, id: crypto.randomUUID(), createdAt: Date.now() }];
          setMistakes(next); void persistReview("checking", boundaries, next);
        } : undefined}
        onMistakeClick={mode === "checking" ? (id) => {
          const next = mistakes.filter((mistake) => mistake.id !== id); setMistakes(next); void persistReview("checking", boundaries, next);
        } : undefined}
      />}
      {pages.length > 1 && <nav className="page-tabs">{pages.map((page, index) => <button className={index === pageIndex ? "active" : ""} key={page.pageNumber} onClick={() => setPageIndex(index)}>Page {page.pageNumber}</button>)}</nav>}
    </section>
    <section className="recitation-controls">
      <Waveform peaks={peaks} durationMs={duration} positionMs={mode === "recording" ? duration : playback.positionMs} boundaries={boundaries} disabled={mode === "recording" || !recording} onSeek={playback.seek} onBoundaryMove={mode === "checking" ? (sequence, startMs) => {
        const next = boundaries.map((boundary) => boundary.sequence === sequence ? { ...boundary, startMs } : boundary).sort((a, b) => a.startMs - b.startMs).map((boundary, sequence) => ({ ...boundary, sequence }));
        setBoundaries(next);
        window.clearTimeout(markerSaveRef.current);
        markerSaveRef.current = window.setTimeout(() => { void persistReview("checking", next, mistakes); }, 250);
      } : undefined} />
      <div className="recording-meta"><span>{formatTime(mode === "recording" ? elapsed : playback.positionMs)} / {formatTime(duration)}</span><span>{mode === "checking" ? `${boundaries.length}/${selectedKeys.length} ayahs marked · ${mistakes.length} mistakes` : mode}</span></div>
      {error && <p className="recitation-error" role="alert">{error}</p>}
      <div className="recitation-toolbar">
        <button type="button" className="toolbar-action" disabled={!recording || mode === "recording"} onClick={() => playback.playing ? playback.stop() : void playback.play(playback.positionMs)}>{playback.playing ? <Pause /> : <Play />}<span>{playback.playing ? "Pause" : "Play"}</span></button>
        <button type="button" className={`record-button ${mode === "recording" ? "is-recording" : ""}`} aria-label={mode === "recording" ? "Pause recording" : "Record"} disabled={mode === "saving"} onClick={() => mode === "recording" ? void finishTake() : void startTake()}>{mode === "recording" ? <Square /> : <Mic />}</button>
        {mode === "checking" ? <button type="button" className="toolbar-action" disabled={boundaries.length === 0} onClick={() => { const next = boundaries.slice(0, -1); setBoundaries(next); void persistReview("checking", next, mistakes); }}><RotateCcw /><span>Undo mark</span></button> : <button type="button" className="toolbar-action" disabled={!recording || mode === "recording" || mode === "saving"} onClick={() => { setMode("checking"); void persistReview("checking"); }}><Check /><span>Check</span></button>}
      </div>
      {mode === "checking" && <button type="button" className="finish-checking" disabled={boundaries.length !== selectedKeys.length} onClick={() => void persistReview("completed").then(() => setMode("completed"))}><Check /> Finish checking</button>}
      {mode === "completed" && <div className="completion-message"><Check /> Recitation checked and saved</div>}
      {mode === "checking" && <p className="keyboard-help"><kbd>Space</kbd> plays or pauses · <kbd>V</kbd> marks the next ayah · drag markers to refine timing · select words to mark a mistake</p>}
    </section>
  </main>;
}
