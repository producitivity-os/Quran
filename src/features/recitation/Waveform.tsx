import * as React from "react";
import type { AyahBoundary } from "../shared/types";

type Props = {
  peaks: readonly number[];
  durationMs: number;
  positionMs: number;
  boundaries?: readonly AyahBoundary[];
  disabled?: boolean;
  onSeek: (positionMs: number) => void;
  onBoundaryMove?: (sequence: number, positionMs: number) => void;
};

export function Waveform({ peaks, durationMs, positionMs, boundaries = [], disabled, onSeek, onBoundaryMove }: Props) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [draggedBoundary, setDraggedBoundary] = React.useState<number | null>(null);
  const displayPeaks = peaks.length ? peaks : Array.from({ length: 96 }, (_, index) => 0.08 + Math.sin(index * 0.62) ** 2 * 0.08);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const bounds = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, bounds.width, bounds.height);
    const middle = bounds.height / 2;
    const width = Math.max(1, bounds.width / displayPeaks.length);
    const played = durationMs > 0 ? positionMs / durationMs : 0;
    displayPeaks.forEach((peak, index) => {
      const height = Math.max(3, Math.min(1, peak) * (bounds.height - 12));
      context.fillStyle = index / displayPeaks.length <= played ? "#7c4dff" : "rgba(135, 140, 155, .35)";
      context.beginPath();
      context.roundRect(index * width + 1, middle - height / 2, Math.max(1.5, width - 2), height, 3);
      context.fill();
    });
    boundaries.forEach((boundary) => {
      const x = durationMs > 0 ? boundary.startMs / durationMs * bounds.width : 0;
      context.strokeStyle = "#f7b955";
      context.lineWidth = 2;
      context.beginPath(); context.moveTo(x, 4); context.lineTo(x, bounds.height - 4); context.stroke();
      context.fillStyle = "#f7b955"; context.beginPath(); context.arc(x, 6, 4, 0, Math.PI * 2); context.fill();
    });
  }, [boundaries, displayPeaks, durationMs, positionMs]);

  const positionForEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(durationMs, (event.clientX - bounds.left) / Math.max(1, bounds.width) * durationMs));
  };
  const nearestBoundary = (position: number) => boundaries.find((boundary) => Math.abs(boundary.startMs - position) <= Math.max(350, durationMs * 0.02));

  return <canvas
    ref={canvasRef}
    className="recitation-waveform"
    aria-label="Recording waveform"
    role="slider"
    aria-valuemin={0}
    aria-valuemax={durationMs}
    aria-valuenow={positionMs}
    tabIndex={disabled ? -1 : 0}
    onPointerDown={(event) => {
      if (disabled) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const position = positionForEvent(event);
      const boundary = onBoundaryMove ? nearestBoundary(position) : undefined;
      setDraggedBoundary(boundary?.sequence ?? null);
      if (boundary) onBoundaryMove?.(boundary.sequence, position); else onSeek(position);
    }}
    onPointerMove={(event) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId) || disabled) return;
      const position = positionForEvent(event);
      if (draggedBoundary !== null) onBoundaryMove?.(draggedBoundary, position); else onSeek(position);
    }}
    onPointerUp={() => setDraggedBoundary(null)}
    onPointerCancel={() => setDraggedBoundary(null)}
    onKeyDown={(event) => {
      if (disabled) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        onSeek(positionMs + (event.key === "ArrowLeft" ? -1000 : 1000));
      }
    }}
  />;
}
