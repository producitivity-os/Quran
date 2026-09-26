import { invoke } from "@tauri-apps/api/core";
import { QURAN_SURAHS } from "../../data/quran-data";
import type { PageVerse, QuranPage, VerseRef } from "../shared/types";

const TOTAL_AYAHS = QURAN_SURAHS.reduce((sum, surah) => sum + surah.ayahCount, 0);

function globalAyahIndex(reference: VerseRef): number {
  let index = reference.ayahNumber - 1;
  for (let surah = 0; surah < reference.surahNumber - 1; surah += 1) index += QURAN_SURAHS[surah]?.ayahCount ?? 0;
  return Math.max(0, Math.min(TOTAL_AYAHS - 1, index));
}

export function fallbackPageForVerse(reference: VerseRef): number {
  return Math.max(1, Math.min(604, Math.floor(globalAyahIndex(reference) / TOTAL_AYAHS * 604) + 1));
}

export function fallbackPage(pageNumber: number): QuranPage {
  const start = Math.floor((pageNumber - 1) * TOTAL_AYAHS / 604);
  const end = Math.max(start + 1, Math.floor(pageNumber * TOTAL_AYAHS / 604));
  const verses: PageVerse[] = [];
  let global = 0;
  for (const surah of QURAN_SURAHS) {
    for (let index = 0; index < surah.ayahs.length; index += 1, global += 1) {
      if (global < start || global >= end) continue;
      const ayahNumber = index + 1;
      const verseKey = `${surah.number}:${ayahNumber}`;
      verses.push({
        id: global + 1,
        verseKey,
        surahNumber: surah.number,
        ayahNumber,
        words: [{
          id: global + 1,
          verseKey,
          position: 1,
          lineNumber: verses.length + 1,
          pageNumber,
          charType: "word",
          codeV2: "",
          textQpcHafs: surah.ayahs[index] ?? "",
        }],
      });
    }
  }
  return {
    mushafId: 1,
    pageNumber,
    verses,
    cachedAt: Date.now(),
    stale: false,
    environment: "bundled-fallback",
  };
}

export async function loadQuranPage(pageNumber: number): Promise<QuranPage> {
  try {
    const page = await invoke<QuranPage>("get_quran_page", { pageNumber });
    return page.verses.length ? page : fallbackPage(pageNumber);
  } catch {
    return fallbackPage(pageNumber);
  }
}

export async function pageForVerse(reference: VerseRef): Promise<number> {
  try {
    return await invoke<number>("get_quran_verse_page", { reference });
  } catch {
    return fallbackPageForVerse(reference);
  }
}

export function rangeVerseKeys(start: VerseRef, end: VerseRef): string[] {
  const keys: string[] = [];
  for (let surahNumber = start.surahNumber; surahNumber <= end.surahNumber; surahNumber += 1) {
    const surah = QURAN_SURAHS[surahNumber - 1];
    if (!surah) break;
    const first = surahNumber === start.surahNumber ? start.ayahNumber : 1;
    const last = surahNumber === end.surahNumber ? end.ayahNumber : surah.ayahCount;
    for (let ayah = first; ayah <= last; ayah += 1) keys.push(`${surahNumber}:${ayah}`);
  }
  return keys;
}
