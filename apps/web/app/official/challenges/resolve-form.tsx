"use client";

import { useRouter } from "next/navigation";
import { Button } from "@vbt/ui/components/button";
import { Input } from "@vbt/ui/components/input";
import { type FormEvent, useState } from "react";
import { Message, type Note } from "../shell";

// Resolve one challenge (T-09): accept (back to the status held before) or reject (DISCARDED; reason
// required, and shown to the voter).
export function ResolveForm({ ballotId }: { ballotId: string }) {
  const router = useRouter();
  const [note, setNote] = useState<Note>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value ?? "accepted";
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    if (decision === "rejected" && reason.trim() === "") {
      setNote({ text: "A reason is required to reject.", ok: false });
      return;
    }
    const response = await fetch(`/api/challenges/${encodeURIComponent(ballotId)}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, reason }),
    });
    const body = (await response.json()) as { status?: string; error?: string };
    setNote(response.ok ? { text: `Now ${body.status}.`, ok: true } : { text: `Not done (${response.status}): ${body.error ?? "refused"}`, ok: false });
    if (response.ok) router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <Input id={`reason-${ballotId}`} name="reason" label="Reason (shown to the voter; required to reject)" mode="admin" maxLength={500} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="accepted" mode="admin" variant="secondary">
          Accept
        </Button>
        <Button type="submit" name="decision" value="rejected" mode="admin">
          Reject
        </Button>
      </div>
      <Message note={note} />
    </form>
  );
}
