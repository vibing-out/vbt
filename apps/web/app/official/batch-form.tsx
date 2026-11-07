"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

// One-action batch with confirmation (T-09): the official confirms the number of ballots, and one
// POST /api/batches (T-05) moves them all and publishes the signed stage record.

export interface BatchFormProps {
  scope: "precinct" | "county";
  scopeId: string;
  from: string;
  to: string;
  action: string;
  count: number;
}

export function BatchForm({ scope, scopeId, from, to, action, count }: BatchFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const confirmed = window.confirm(
      `${action}: move all ${count} ballots in ${scopeId} from ${from} to ${to} and publish a signed stage record?`,
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      // POST /api/batches (T-05) takes one JSON transition and publishes the signed stage record.
      const response = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, scope_id: scopeId, from_status: from, to_status: to }),
      });
      const body = (await response.json()) as { error?: string; ballot_count?: number; stage_record?: { id?: string } };
      if (response.ok) {
        setMessage(
          `Done: ${body.ballot_count} ballots moved to ${to}.` +
            (body.stage_record?.id ? ` Stage record ${body.stage_record.id} published.` : ""),
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
        <button type="submit">{action}</button>
      </fieldset>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
