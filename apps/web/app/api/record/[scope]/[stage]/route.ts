// GET /api/record/{scope}/{stage}: a published stage record (locked-interfaces § API boundaries).
// STUB (T-08b) until T-05a (#148) lands the real route; see lib/record/read.ts.
import { handleRecordRequest } from "../../../../../lib/record/handler";
import { readPublishedRecord } from "../../../../../lib/record/read";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ scope: string; stage: string }> }): Promise<Response> {
  const { scope, stage } = await context.params;
  return handleRecordRequest(scope, stage, { read: (scopeId, s) => readPublishedRecord(scopeId, s) });
}
