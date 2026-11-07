// /record: the public election record (T-08b). Lists every published stage record by county and
// stage, read from the public surface on each request.
import { groupByCounty } from "../../lib/record/group";
import { listPublishedRecords } from "../../lib/record/read";
import { TrackerShell } from "../track/shell";
import { type RecordListState, RecordListView } from "./record-list";

export const metadata = { title: "Published records · VBT" };
export const dynamic = "force-dynamic";

export default async function RecordPage(): Promise<React.JSX.Element> {
  let state: RecordListState;
  try {
    // No database configured reads as nothing published yet.
    state = { kind: "ready", counties: groupByCounty((await listPublishedRecords()) ?? []) };
  } catch {
    state = { kind: "unavailable" };
  }
  return (
    <TrackerShell>
      <RecordListView state={state} />
    </TrackerShell>
  );
}
