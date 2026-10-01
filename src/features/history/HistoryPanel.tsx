import { Headphones, Play, Trash2, X } from "@productivity-os/shared-ui/components/sf-symbols";
import type { Recording } from "../shared/types";

function duration(value: number) {
  const seconds = Math.floor(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function HistoryPanel({ recordings, onOpen, onDelete, onClose }: { recordings: Recording[]; onOpen: (recording: Recording) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const ordered = [...recordings].sort((a, b) => Number(a.status === "completed") - Number(b.status === "completed") || b.updatedAt - a.updatedAt);
  return <aside className="history-panel">
    <header><div><small>Library</small><h2>Recitation history</h2></div><button className="icon-button" onClick={onClose} aria-label="Close history"><X /></button></header>
    <div className="history-list">
      {ordered.map((recording) => <article key={recording.id}>
        <Headphones />
        <button className="history-summary" onClick={() => onOpen(recording)}>
          <strong>{recording.surahName} {recording.ayahStart}{recording.endSurahNumber === recording.surahNumber ? `–${recording.ayahEnd}` : ` – ${recording.endSurahName} ${recording.ayahEnd}`}</strong>
          <span>{new Date(recording.updatedAt).toLocaleString()} · {duration(recording.durationMs)}</span>
          <small>{recording.status} · {recording.mistakes.length} mistake{recording.mistakes.length === 1 ? "" : "s"}</small>
        </button>
        <button className="icon-button" onClick={() => onOpen(recording)} aria-label="Open recording"><Play /></button>
        <button className="icon-button destructive" onClick={() => onDelete(recording.id)} aria-label="Delete recording"><Trash2 /></button>
      </article>)}
      {ordered.length === 0 && <div className="history-empty"><Headphones /><p>Your checked recitations and unfinished drafts will appear here.</p></div>}
    </div>
  </aside>;
}
