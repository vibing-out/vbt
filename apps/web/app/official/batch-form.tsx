"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

// One-action batch with confirmation (T-09): the official picks the cross-check files, confirms the
// number of ballots, and one POST /api/batches moves them all and publishes the stage record. The count
// is sent as expected_count; if it changed on the server, the request is refused (409) and nothing moves.

export interface BatchFormProps {
  scope: "precinct" | "county";
  scopeId: string;
  from: string;
  to: string;
  action: string;
  count: number;
  files: ReadonlyArray<{ kind: string; label: string; multiple?: boolean }>;
}

export function BatchForm({ scope, scopeId, from, to, action, count, files }: BatchFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const confirmed = window.confirm(
      `${action}: move all ${count} ballots in ${scopeId} from ${from} to ${to} and publish a signed stage record?`,
    );
    if (!confirmed) return;
    const form = new FormData(event.currentTarget);
    form.set("to_status", to);
    form.set("expected_count", String(count));
    setBusy(true);
    try {
      const response = await fetch(`/api/batches?${scope}=${encodeURIComponent(scopeId)}`, { method: "POST", body: form });
      const body = (await response.json()) as { error?: string; count?: number; challenged?: number; stage_record_id?: string | null };
      if (response.ok) {
        setMessage(
          `Done: ${body.count} ballots moved to ${to}${body.challenged ? `, ${body.challenged} challenged by a cross-check` : ""}.` +
            (body.stage_record_id ? ` Stage record ${body.stage_record_id} published.` : ""),
        );
        router.refresh();
      } else {
        setMessage(`Not done (${response.status}): ${body.error ?? "refused"}`);
      }
    } catch {
      setMessage("Not done: the request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} data-testid={`batch-${to}`}>
      <fieldset disabled={busy || count === 0}>
        <legend>{action}</legend>
        <p>
          {count} ballots are at {from}.
        </p>
        {files.map((file) => (
          <p key={file.kind}>
            <label>
              {file.label}{" "}
              <input type="file" name={file.kind} accept="application/json,.json" multiple={file.multiple} required />
            </label>
          </p>
        ))}
        <button type="submit">{action}</button>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
