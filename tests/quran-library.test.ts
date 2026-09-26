import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("bundles the complete official Uthmani Quran text and Surah index", () => {
  const surahs = JSON.parse(source("../src/data/surahs.json")) as Array<{ ayah_count: number }>;
  const ayahs = source("../src/data/quran-uthmani.txt")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  assert.equal(surahs.length, 114);
  assert.equal(surahs.reduce((count, surah) => count + surah.ayah_count, 0), 6_236);
  assert.equal(ayahs.length, 6_236);
  assert.match(source("../src/data/TANZIL-LICENSE.md"), /Creative Commons Attribution 3\.0/);
});

test("routes standalone reading and focused workflow recitation", () => {
  const app = source("../src/App.tsx");
  const reader = source("../src/features/reader/ReaderWorkspace.tsx");
  const recitation = source("../src/features/recitation/RecitationSession.tsx");
  const playback = source("../src/features/recitation/useSegmentedPlayback.ts");
  const pageData = source("../src/features/reader/page-data.ts");
  const nativeApp = source("../src-tauri/src/lib.rs");
  const config = JSON.parse(source("../src-tauri/tauri.conf.json")) as { productName: string; identifier: string };

  assert.match(app, /ReaderWorkspace/);
  assert.match(app, /WorkflowSession/);
  assert.match(reader, /save_reading_position/);
  assert.match(reader, /list_recordings/);
  assert.match(reader, /start_standalone_recitation/);
  assert.match(pageData, /get_quran_page/);
  assert.match(pageData, /bundled-fallback/);
  assert.match(playback, /recording\.segments\.findIndex/);
  assert.match(playback, /segment\.sourceStartMs/);
  assert.match(recitation, /getByteTimeDomainData/);
  assert.match(recitation, /waveformPeaks: compactWaveformPeaks/);
  assert.match(recitation, /save_recitation_review/);
  assert.match(nativeApp, /replace_quran_recording_range/);
  assert.match(nativeApp, /register_asynchronous_uri_scheme_protocol\(\s*"quran-media"/);
  assert.equal(config.productName, "Quran");
  assert.equal(config.identifier, "com.productivity-os.quran");
});
