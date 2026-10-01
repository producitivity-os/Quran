import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bookmark, ChevronLeft, ChevronRight, History, Mic } from "@productivity-os/shared-ui/components/sf-symbols";
import {
  ApplicationSidebar,
  ApplicationSidebarContent,
  ApplicationSidebarItem,
  ApplicationSidebarLayout,
  ApplicationSidebarNav,
  ApplicationSidebarSection,
} from "@productivity-os/shared-ui/components/application-sidebar";
import { QURAN_SURAHS } from "../../data/quran-data";
import { HistoryPanel } from "../history/HistoryPanel";
import { RecitationSession } from "../recitation/RecitationSession";
import type { QuranPage, QuranProgress, Recording, RecordingTarget, VerseRef } from "../shared/types";
import { MushafPage } from "./MushafPage";
import { loadQuranPage, pageForVerse } from "./page-data";
import { RangeDialog } from "./RangeDialog";

function targetFromRecording(recording: Recording): RecordingTarget {
  return {
    origin: "standalone",
    workflowId: recording.workflowId ?? "",
    nodeId: recording.nodeId ?? "",
    captureSessionId: recording.sessionId,
    recordingId: recording.id,
    replaceStartMs: 0,
    surahNumber: recording.surahNumber,
    surahName: recording.surahName,
    ayahStart: recording.ayahStart,
    endSurahNumber: recording.endSurahNumber,
    endSurahName: recording.endSurahName,
    ayahEnd: recording.ayahEnd,
  };
}

export function ReaderWorkspace() {
  const [progress, setProgress] = React.useState<QuranProgress>({ reading: null, recitation: null });
  const [pageNumber, setPageNumber] = React.useState(1);
  const [page, setPage] = React.useState<QuranPage | null>(null);
  const [rangeOpen, setRangeOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [recordings, setRecordings] = React.useState<Recording[]>([]);
  const [session, setSession] = React.useState<RecordingTarget | null>(null);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    const [nextProgress, nextRecordings] = await Promise.all([
      invoke<QuranProgress>("get_quran_progress").catch(() => ({ reading: null, recitation: null })),
      invoke<Recording[]>("list_recordings").catch(() => []),
    ]);
    setProgress(nextProgress); setRecordings(nextRecordings);
    return nextProgress;
  }, []);

  React.useEffect(() => {
    void refresh().then((next) => {
      void (next.reading ? pageForVerse(next.reading) : Promise.resolve(1)).then((initial) => {
        setPageNumber(initial); setLoading(false);
      });
    });
  }, [refresh]);
  React.useEffect(() => { if (!loading) void loadQuranPage(pageNumber).then(setPage); }, [loading, pageNumber]);

  if (session) return <RecitationSession target={session} onExit={() => { setSession(null); void refresh(); }} />;
  const first = page?.verses[0];
  const last = page?.verses.at(-1);
  const readingKey = progress.reading ? `${progress.reading.surahNumber}:${progress.reading.ayahNumber}` : null;
  const recitationKey = progress.recitation ? `${progress.recitation.surahNumber}:${progress.recitation.ayahNumber}` : null;
  const openRange = () => setRangeOpen(true);

  return <ApplicationSidebarLayout className="reader-workspace" accentColor="#865af6">
    <ApplicationSidebar>
      <ApplicationSidebarNav aria-label="Page navigation">
        <ApplicationSidebarItem
          icon={<ChevronLeft />}
          label="Previous page"
          disabled={pageNumber <= 1}
          onClick={() => setPageNumber((value) => value - 1)}
        />
        <ApplicationSidebarItem
          label={`Page ${pageNumber}`}
          badge="604"
          disabled
        />
        <ApplicationSidebarItem
          icon={<ChevronRight />}
          label="Next page"
          disabled={pageNumber >= 604}
          onClick={() => setPageNumber((value) => value + 1)}
        />
      </ApplicationSidebarNav>
      <ApplicationSidebarSection label="Reader">
        <ApplicationSidebarItem icon={<History />} label="History" onClick={() => setHistoryOpen(true)} />
        <ApplicationSidebarItem icon={<Mic />} label="Record" onClick={openRange} />
        <ApplicationSidebarItem icon={<Bookmark />} label="Bookmark" disabled />
      </ApplicationSidebarSection>
    </ApplicationSidebar>
    <ApplicationSidebarContent className="reader-workspace-content">
      <section className="reader-stage">
      {page ? <MushafPage page={page} readingVerseKey={readingKey} recitationVerseKey={recitationKey} onVerseClick={(surahNumber, ayahNumber) => {
        void invoke("save_reading_position", { input: { surahNumber, ayahNumber } }).then(() => setProgress((value) => ({ ...value, reading: { surahNumber, ayahNumber, updatedAt: Date.now() } })));
      }} /> : <div className="page-loading">Preparing the Mushaf page…</div>}
      </section>
    </ApplicationSidebarContent>
    {rangeOpen && first && last && <RangeDialog start={{ surahNumber: first.surahNumber, ayahNumber: first.ayahNumber }} end={{ surahNumber: last.surahNumber, ayahNumber: last.ayahNumber }} onCancel={() => setRangeOpen(false)} onConfirm={(start: VerseRef, end: VerseRef) => {
      const startSurahName = QURAN_SURAHS[start.surahNumber - 1]?.transliteration ?? `Surah ${start.surahNumber}`;
      const endSurahName = QURAN_SURAHS[end.surahNumber - 1]?.transliteration ?? `Surah ${end.surahNumber}`;
      void invoke<RecordingTarget>("start_standalone_recitation", { range: { start, end }, startSurahName, endSurahName }).then((target) => { setRangeOpen(false); setSession(target); });
    }} />}
    {historyOpen && <HistoryPanel recordings={recordings} onClose={() => setHistoryOpen(false)} onOpen={(recording) => { setHistoryOpen(false); setSession(targetFromRecording(recording)); }} onDelete={(id) => { void invoke("delete_recording", { id }).then(refresh); }} />}
    <div className="quran-attribution">Quran Foundation QCF V2 · Quran text fallback © Tanzil Project, CC BY 3.0</div>
  </ApplicationSidebarLayout>;
}
