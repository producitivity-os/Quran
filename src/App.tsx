import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen } from "@productivity-os/shared-ui/components/sf-symbols";
import { ReaderWorkspace } from "./features/reader/ReaderWorkspace";
import type { RecordingTarget } from "./features/shared/types";
import { WorkflowSession } from "./features/workflow-session/WorkflowSession";

export function App() {
  const [target, setTarget] = React.useState<RecordingTarget | null | undefined>(undefined);
  React.useEffect(() => {
    const captureRequestId = new URLSearchParams(window.location.search).get("captureRequestId");
    void invoke<RecordingTarget | null>(
      captureRequestId ? "get_capture_request" : "initial_target",
      captureRequestId ? { id: captureRequestId } : undefined,
    ).then(setTarget).catch(() => setTarget(null));
  }, []);
  if (target === undefined) return <main className="quran-boot"><BookOpen /></main>;
  return target ? <WorkflowSession target={target} /> : <ReaderWorkspace />;
}
