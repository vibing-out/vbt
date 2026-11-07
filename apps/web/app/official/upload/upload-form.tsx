"use client";

import { Button } from "@vbt/ui/components/button";
import { Input, inputVariants } from "@vbt/ui/components/input";
import { Label } from "@vbt/ui/components/label";
import { type FormEvent, useState } from "react";
import { Message, type Note } from "../shell";

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
  const [note, setNote] = useState<Note>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = KINDS.find((k) => k.kind === form.get("kind")) ?? KINDS[0];
    const scopeId = String(form.get("scope_id") ?? "").trim();
    form.delete("scope_id");
    const response = await fetch(`/api/events?${kind.scope}=${encodeURIComponent(scopeId)}`, { method: "POST", body: form });
    const body = (await response.json()) as { file_id?: string; event_ids?: string[]; error?: string };
    setNote(
      response.ok
        ? { text: `Recorded file ${body.file_id}: ${body.event_ids?.length ?? 0} ballot events.`, ok: true }
        : { text: `Not recorded (${response.status}): ${body.error ?? "refused"}`, ok: false },
    );
  }

  const field = inputVariants({ mode: "admin" });
  return (
    <form onSubmit={submit} data-testid="upload-form" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="upload-kind">Kind</Label>
        <select id="upload-kind" name="kind" className={field}>
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </div>
      <Input id="upload-scope" name="scope_id" label="Precinct or county id" mode="admin" defaultValue={defaultScopeId} required />
      <div className="flex flex-col gap-2">
        <Label htmlFor="upload-file">File</Label>
        <input id="upload-file" type="file" name="file" accept="application/json,.json" required className={field} />
      </div>
      <div>
        <Button type="submit" mode="admin">
          Upload
        </Button>
      </div>
      <Message note={note} />
    </form>
  );
}
