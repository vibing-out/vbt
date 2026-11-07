// GET /api/record/{scope}/{stage}: a published stage record (locked-interfaces § API boundaries).
// Anyone; no auth; read-only. {scope} is the record's scope_id. See ../../record.ts.
import { handleRecordRequest, postgrestRecordSource } from "../../record";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ scope: string; stage: string }> },
): Promise<Response> {
  const { scope, stage } = await context.params;
  return handleRecordRequest(scope, stage, postgrestRecordSource());
}
