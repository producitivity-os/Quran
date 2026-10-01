import * as React from "react";
import { X } from "@productivity-os/shared-ui/components/sf-symbols";
import { QURAN_SURAHS } from "../../data/quran-data";
import type { VerseRef } from "../shared/types";

export function RangeDialog({ start, end, onCancel, onConfirm }: { start: VerseRef; end: VerseRef; onCancel: () => void; onConfirm: (start: VerseRef, end: VerseRef) => void }) {
  const [from, setFrom] = React.useState(start);
  const [to, setTo] = React.useState(end);
  const valid = (from.surahNumber < to.surahNumber || from.surahNumber === to.surahNumber && from.ayahNumber <= to.ayahNumber)
    && from.ayahNumber <= (QURAN_SURAHS[from.surahNumber - 1]?.ayahCount ?? 0)
    && to.ayahNumber <= (QURAN_SURAHS[to.surahNumber - 1]?.ayahCount ?? 0);
  return <div className="dialog-backdrop" role="presentation">
    <section className="range-dialog" role="dialog" aria-modal="true" aria-labelledby="range-title">
      <header><div><small>New recitation</small><h2 id="range-title">Choose the ayah range</h2></div><button className="icon-button" onClick={onCancel}><X /></button></header>
      <div className="range-grid">
        <fieldset><legend>Start ayah</legend><label>Surah<select value={from.surahNumber} onChange={(event) => setFrom({ surahNumber: Number(event.currentTarget.value), ayahNumber: 1 })}>{QURAN_SURAHS.map((surah) => <option key={surah.number} value={surah.number}>{surah.number}. {surah.transliteration}</option>)}</select></label><label>Ayah<input type="number" min={1} max={QURAN_SURAHS[from.surahNumber - 1]?.ayahCount} value={from.ayahNumber} onChange={(event) => setFrom({ ...from, ayahNumber: Number(event.currentTarget.value) })} /></label></fieldset>
        <fieldset><legend>End ayah</legend><label>Surah<select value={to.surahNumber} onChange={(event) => setTo({ surahNumber: Number(event.currentTarget.value), ayahNumber: QURAN_SURAHS[Number(event.currentTarget.value) - 1]?.ayahCount ?? 1 })}>{QURAN_SURAHS.map((surah) => <option key={surah.number} value={surah.number}>{surah.number}. {surah.transliteration}</option>)}</select></label><label>Ayah<input type="number" min={1} max={QURAN_SURAHS[to.surahNumber - 1]?.ayahCount} value={to.ayahNumber} onChange={(event) => setTo({ ...to, ayahNumber: Number(event.currentTarget.value) })} /></label></fieldset>
      </div>
      {!valid && <p className="range-error">The end must follow the start and both ayahs must exist.</p>}
      <footer><button onClick={onCancel}>Cancel</button><button className="primary" disabled={!valid} onClick={() => onConfirm(from, to)}>Prepare recitation</button></footer>
    </section>
  </div>;
}
