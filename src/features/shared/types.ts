export type QuranRecordingOrigin = "workflow" | "standalone";
export type QuranRecordingStatus = "draft" | "recording" | "paused" | "ready" | "checking" | "completed" | "cancelled" | "failed";

export type VerseRef = { surahNumber: number; ayahNumber: number };
export type VerseRange = { start: VerseRef; end: VerseRef };

export type RecordingTarget = {
  origin: QuranRecordingOrigin;
  workflowId: string;
  nodeId: string;
  captureSessionId: string;
  recordingId: string;
  replaceStartMs: number | null;
  surahNumber: number;
  surahName: string;
  ayahStart: number;
  endSurahNumber: number;
  endSurahName: string;
  ayahEnd: number;
};

export type PageWord = {
  id: number;
  verseKey: string;
  position: number;
  lineNumber: number;
  pageNumber: number;
  charType: string;
  codeV2: string;
  textQpcHafs: string;
};

export type PageVerse = {
  id: number;
  verseKey: string;
  surahNumber: number;
  ayahNumber: number;
  words: PageWord[];
};

export type QuranPage = {
  mushafId: number;
  pageNumber: number;
  verses: PageVerse[];
  cachedAt: number;
  stale: boolean;
  environment: string;
};

export type RecordingSegment = {
  id: string;
  mediaId: string;
  sequence: number;
  startMs: number;
  sourceStartMs: number;
  durationMs: number;
  waveformPeaks: number[];
};

export type AyahBoundary = { verseKey: string; sequence: number; startMs: number };
export type MistakeRange = {
  id: string;
  startVerseKey: string;
  startWordPosition: number;
  endVerseKey: string;
  endWordPosition: number;
  textSnapshot: string;
  createdAt: number;
};

export type Recording = {
  id: string;
  sessionId: string;
  origin: QuranRecordingOrigin;
  status: QuranRecordingStatus;
  workflowId: string | null;
  nodeId: string | null;
  surahNumber: number;
  surahName: string;
  ayahStart: number;
  endSurahNumber: number;
  endSurahName: string;
  ayahEnd: number;
  durationMs: number;
  createdAt: number;
  updatedAt: number;
  segments: RecordingSegment[];
  boundaries: AyahBoundary[];
  mistakes: MistakeRange[];
};

export type QuranProgress = {
  reading: { surahNumber: number; ayahNumber: number; updatedAt: number } | null;
  recitation: { surahNumber: number; ayahNumber: number; recordingId: string; updatedAt: number } | null;
};
