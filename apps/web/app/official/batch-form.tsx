"use client";

import { useRouter } from "next/navigation";
import { Button } from "@vbt/ui/components/button";
import { Card, CardDescription, CardHeader } from "@vbt/ui/components/card";
import { type FormEvent, useState } from "react";
import { Message, type Note } from "./shell";

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
  const [note, setNote] = useState<Note>(null);
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
        setNote({
          text:
            `Done: ${body.ballot_count} ballots moved to ${to}.` +
            (body.stage_record?.id ? ` Stage record ${body.stage_record.id} published.` : ""),
          ok: true,
        });
        router.refresh();
      } else {
        setNote({ text: `Not done (${response.status}): ${body.error ?? "refused"}`, ok: false });
      }
    } catch {
      setNote({ text: "Not done: the request failed.", ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card mode="admin">
      <form onSubmit={submit} data-testid={`batch-${to}`} className="flex flex-col gap-4">
        <fieldset disabled={busy || count === 0} className="flex flex-col gap-4 disabled:opacity-60">
          <legend className="text-heading text-ink">{action}</legend>
          <CardHeader>
            <CardDescription mode="admin">
              <span className="tabular-nums">{count}</span> ballots are at {from}. One action moves them all to {to} and
              publishes a signed stage record.
            </CardDescription>
          </CardHeader>
          <div>
            <Button type="submit" mode="admin">
              {action}
            </Button>
          </div>
        </fieldset>
        <Message note={note} />
      </form>
    </Card>
  );
}
