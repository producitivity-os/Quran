import rawUthmaniText from "./quran-uthmani.txt?raw";
import rawSurahs from "./surahs.json";

export type Surah = {
  number: number;
  nameArabic: string;
  nameEnglish: string;
  transliteration: string;
  ayahCount: number;
  revelationType: string;
  ayahs: readonly string[];
};

type RawSurah = {
  number: number;
  name_arabic: string;
  name_english: string;
  name_transliteration: string;
  ayah_count: number;
  revelation_type: string;
};

const ayahLines = rawUthmaniText
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));

let offset = 0;
export const QURAN_SURAHS: readonly Surah[] = (rawSurahs as RawSurah[]).map((surah) => {
  const ayahs = ayahLines.slice(offset, offset + surah.ayah_count);
  offset += surah.ayah_count;
  return {
    number: surah.number,
    nameArabic: surah.name_arabic,
    nameEnglish: surah.name_english,
    transliteration: surah.name_transliteration,
    ayahCount: surah.ayah_count,
    revelationType: surah.revelation_type,
    ayahs,
  };
});

if (offset !== ayahLines.length || QURAN_SURAHS.length !== 114) {
  throw new Error("The bundled Tanzil Quran text does not match its Surah metadata.");
}

export function quranSearch(query: string): Array<{ surah: Surah; ayahNumber: number; text: string }> {
  const normalized = normalizeSearchText(query);
  if (!normalized) return [];
  const results: Array<{ surah: Surah; ayahNumber: number; text: string }> = [];
  for (const surah of QURAN_SURAHS) {
    for (let index = 0; index < surah.ayahs.length; index += 1) {
      const text = surah.ayahs[index];
      if (normalizeSearchText(text).includes(normalized)) {
        results.push({ surah, ayahNumber: index + 1, text });
        if (results.length === 100) return results;
      }
    }
  }
  return results;
}

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/ٱ/g, "ا");
}
