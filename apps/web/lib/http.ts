import type { Outcome } from "./official-batches";
import { MAX_FILES } from "./ingest/index";

// Request and response helpers shared by the official API routes (T-09).

export function respond(outcome: Outcome): Response {
  return Response.json(outcome.body, { status: outcome.status, headers: { "cache-control": "no-store" } });
}

export const badRequest = (error: string): Response => respond({ status: 400, body: { error } });

/** Vercel's function request body cap. */
const MAX_BODY_BYTES = Math.floor(4.5 * 1024 * 1024);

export interface UploadForm {
  fields: Map<string, string>;
  files: Array<{ field: string; bytes: Uint8Array }>;
}

/** Reads a multipart/form-data body; null when it is not one, is too large or has too many files. */
export async function readUploadForm(request: Request): Promise<UploadForm | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!(request.headers.get("content-type") ?? "").startsWith("multipart/form-data") || length > MAX_BODY_BYTES) return null;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  const fields = new Map<string, string>();
  const files: UploadForm["files"] = [];
  for (const [field, value] of form) {
    if (typeof value === "string") fields.set(field, value);
    else files.push({ field, bytes: new Uint8Array(await value.arrayBuffer()) });
    if (files.length > MAX_FILES) return null;
  }
  return { fields, files };
}
