import type { RecordingTarget } from "../shared/types";
import { RecitationSession } from "../recitation/RecitationSession";

export function WorkflowSession({ target }: { target: RecordingTarget }) {
  return <RecitationSession target={target} />;
}
