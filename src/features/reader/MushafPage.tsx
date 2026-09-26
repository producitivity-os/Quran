import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MistakeRange, QuranPage } from "../shared/types";

const bundledAssets = import.meta.glob("../../assets/*", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
const ayahMarkerUrl = bundledAssets["../../assets/ayah-marker.png"] ?? null;

type Props = {
  page: QuranPage;
  concealed?: boolean;
  selectedVerseKeys?: ReadonlySet<string>;
  activeVerseKey?: string | null;
  readingVerseKey?: string | null;
  recitationVerseKey?: string | null;
  mistakes?: readonly MistakeRange[];
  onVerseClick?: (surahNumber: number, ayahNumber: number) => void;
  onSelection?: (mistake: Omit<MistakeRange, "id" | "createdAt">) => void;
  onMistakeClick?: (id: string) => void;
};

function containsWord(mistake: MistakeRange, verseKey: string, position: number): boolean {
  const ordinal = (key: string, word: number) => {
    const [surah, ayah] = key.split(":").map(Number);
    return (surah ?? 0) * 1_000_000 + (ayah ?? 0) * 1_000 + word;
  };
  const value = ordinal(verseKey, position);
  const first = ordinal(mistake.startVerseKey, mistake.startWordPosition);
  const last = ordinal(mistake.endVerseKey, mistake.endWordPosition);
  return value >= Math.min(first, last) && value <= Math.max(first, last);
}

export function MushafPage({ page, concealed = false, selectedVerseKeys, activeVerseKey, readingVerseKey, recitationVerseKey, mistakes = [], onVerseClick, onSelection, onMistakeClick }: Props) {
  const [fontFamily, setFontFamily] = React.useState<string | null>(null);
  React.useEffect(() => {
    let active = true;
    if (page.environment === "bundled-fallback") { setFontFamily(null); return; }
    const family = `QCF_Page_${page.pageNumber}`;
    if (document.fonts.check(`16px "${family}"`)) { setFontFamily(family); return; }
    void invoke<string>("ensure_quran_font", { pageNumber: page.pageNumber })
      .then(async (url) => {
        const font = new FontFace(family, `url("${url}") format("woff2")`);
        await font.load(); document.fonts.add(font); if (active) setFontFamily(family);
      })
      .catch(() => { if (active) setFontFamily(null); });
    return () => { active = false; };
  }, [page.environment, page.pageNumber]);
  const handleSelection = () => {
    if (!onSelection) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const start = (range.startContainer.parentElement?.closest("[data-word]") ?? range.startContainer.parentElement) as HTMLElement | null;
    const end = (range.endContainer.parentElement?.closest("[data-word]") ?? range.endContainer.parentElement) as HTMLElement | null;
    if (!start?.dataset.verse || !end?.dataset.verse) return;
    onSelection({
      startVerseKey: start.dataset.verse,
      startWordPosition: Number(start.dataset.word ?? 1),
      endVerseKey: end.dataset.verse,
      endWordPosition: Number(end.dataset.word ?? 1),
      textSnapshot: selection.toString().trim(),
    });
    selection.removeAllRanges();
  };

  const lineNumbers = [...new Set(page.verses.flatMap((verse) => verse.words.map((word) => word.lineNumber || 1)))];
  return <article className={`mushaf-page ${concealed ? "is-concealed" : ""}`} style={{ "--qcf-font": fontFamily ? `"${fontFamily}"` : undefined } as React.CSSProperties} lang="ar" dir="rtl" translate="no" onMouseUp={handleSelection}>
    <div className="mushaf-page-number">{page.pageNumber}</div>
    <div className="mushaf-lines">
      {lineNumbers.map((lineNumber) => <div className="mushaf-line" key={lineNumber}>
        {page.verses.flatMap((verse) => verse.words.filter((word) => (word.lineNumber || 1) === lineNumber).map((word) => {
          const mistake = mistakes.find((item) => containsWord(item, verse.verseKey, word.position));
          const marker = word.charType.toLocaleLowerCase().includes("end");
          const displayText = marker ? "" : fontFamily && word.codeV2 ? word.codeV2 : word.textQpcHafs;
          return <React.Fragment key={`${verse.verseKey}:${word.position}:${word.id}`}>
            <span
              className={[
                "mushaf-word",
                selectedVerseKeys?.has(verse.verseKey) ? "is-selected" : "",
                activeVerseKey === verse.verseKey ? "is-active" : "",
                mistake ? "is-mistake" : "",
              ].join(" ")}
              data-word={word.position}
              data-verse={verse.verseKey}
              onClick={() => mistake ? onMistakeClick?.(mistake.id) : onVerseClick?.(verse.surahNumber, verse.ayahNumber)}
            >{concealed && !marker ? <span aria-hidden="true">{displayText}</span> : displayText}</span>
            {marker && <span className="ayah-marker" aria-label={`Ayah ${verse.ayahNumber}`}>{ayahMarkerUrl ? <img src={ayahMarkerUrl} alt="" /> : <i>۝</i>}<b>{verse.ayahNumber}</b></span>}
          </React.Fragment>;
        }))}
        {!page.verses.some((verse) => verse.words.some((word) => (word.lineNumber || 1) === lineNumber && word.charType.toLocaleLowerCase().includes("end"))) && (() => {
          const last = [...page.verses].reverse().find((verse) => verse.words.some((word) => (word.lineNumber || 1) === lineNumber));
          return last ? <span className="ayah-marker" aria-label={`Ayah ${last.ayahNumber}`}>{ayahMarkerUrl ? <img src={ayahMarkerUrl} alt="" /> : <i>۝</i>}<b>{last.ayahNumber}</b></span> : null;
        })()}
      </div>)}
    </div>
    <div className="mushaf-position-markers" dir="ltr">
      {readingVerseKey && <span className="reading-marker">Read · {readingVerseKey}</span>}
      {recitationVerseKey && <span className="recitation-marker">Recited · {recitationVerseKey}</span>}
      {page.environment === "bundled-fallback" && <span className="fallback-label">Bundled Tanzil fallback · non-canonical layout</span>}
      {page.stale && <span className="fallback-label">Offline cached page</span>}
    </div>
  </article>;
}
