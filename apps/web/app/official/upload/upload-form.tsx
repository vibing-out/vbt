"use client";

import { type FormEvent, useState } from "react";

// Upload one exported file (T-09) to POST /api/events (T-05), which records its SHA-256 and the ballots
// in it. T-05 ingests encrypted ballot records; the other kinds are refused until the cross-checks (T-10)
// accept them.
const KINDS = [
  { kind: "ballot_record", label: "Encrypted ballot record (simulator export)", scope: "precinct" },
  { kind: "machine_log", label: "Machine event log (precinct)", scope: "precinct" },
  { kind: "precinct_totals", label: "Precinct totals (precinct)", scope: "precinct" },
  { kind: "county_totals", label: "Election-night totals (county)", scope: "county" },
  { kind: "certified_totals", label: "Certified totals (county)", scope: "county" },
] as const;

export function UploadForm({ defaultScopeId }: { defaultScopeId: string }) {
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = KINDS.find((k) => k.kind === form.get("kind")) ?? KINDS[0];
    const scopeId = String(form.get("scope_id") ?? "").trim();
    form.delete("scope_id");
    const response = await fetch(`/api/events?${kind.scope}=${encodeURIComponent(scopeId)}`, { method: "POST", body: form });
    const body = (await response.json()) as { file_id?: string; event_ids?: string[]; error?: string };
    setMessage(
      response.ok
        ? `Recorded file ${body.file_id}: ${body.event_ids?.length ?? 0} ballot events.`
        : `Not recorded (${response.status}): ${body.error ?? "refused"}`,
    );
  }

  return (
    <form onSubmit={submit} data-testid="upload-form">
      <p>
        <label>
          Kind{" "}
          <select name="kind">
            {KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Precinct or county id <input name="scope_id" defaultValue={defaultScopeId} required />
        </label>
      </p>
      <p>
        <label>
          File <input type="file" name="file" accept="application/json,.json" required />
        </label>
      </p>
      <button type="submit">Upload</button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
