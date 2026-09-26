import * as React from "react";
import type { Recording } from "../shared/types";

export function useSegmentedPlayback(recording: Recording | null) {
  const [playing, setPlaying] = React.useState(false);
  const [positionMs, setPositionMs] = React.useState(0);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const frameRef = React.useRef(0);
  const playRef = React.useRef<(position: number) => Promise<void>>(async () => undefined);

  const stop = React.useCallback((clear = false) => {
    cancelAnimationFrame(frameRef.current);
    const audio = audioRef.current;
    audio?.pause();
    if (clear && audio) {
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    }
    setPlaying(false);
  }, []);

  const play = React.useCallback(async (requestedPosition = positionMs) => {
    if (!recording) return;
    stop(true);
    const position = Math.max(0, Math.min(recording.durationMs, requestedPosition));
    const index = recording.segments.findIndex((segment) => position >= segment.startMs && position < segment.startMs + segment.durationMs);
    const segment = recording.segments[index];
    if (!segment) { setPositionMs(recording.durationMs); return; }
    const audio = new Audio(`quran-media://localhost/${encodeURIComponent(segment.mediaId)}/content`);
    audioRef.current = audio;
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA) await new Promise<void>((resolve, reject) => {
      audio.addEventListener("loadedmetadata", () => resolve(), { once: true });
      audio.addEventListener("error", () => reject(new Error("Recording could not be loaded")), { once: true });
    });
    audio.currentTime = (segment.sourceStartMs + position - segment.startMs) / 1000;
    await audio.play();
    setPlaying(true);
    const update = () => {
      if (audioRef.current !== audio) return;
      const elapsed = Math.max(0, audio.currentTime * 1000 - segment.sourceStartMs);
      const next = Math.min(segment.startMs + segment.durationMs, segment.startMs + elapsed);
      setPositionMs(next);
      if (elapsed + 15 >= segment.durationMs || audio.ended) {
        const following = recording.segments[index + 1];
        if (following) void playRef.current(following.startMs);
        else { stop(true); setPositionMs(recording.durationMs); }
      } else frameRef.current = requestAnimationFrame(update);
    };
    frameRef.current = requestAnimationFrame(update);
  }, [positionMs, recording, stop]);
  playRef.current = play;

  const seek = React.useCallback((position: number) => {
    const next = Math.max(0, Math.min(recording?.durationMs ?? 0, position));
    const resume = playing;
    stop(true);
    setPositionMs(next);
    if (resume) void play(next);
  }, [play, playing, recording?.durationMs, stop]);

  React.useEffect(() => () => stop(true), [stop]);
  return { playing, positionMs, setPositionMs, play, stop, seek };
}
