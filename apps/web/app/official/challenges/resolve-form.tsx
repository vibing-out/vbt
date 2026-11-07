"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

// Resolve one challenge (T-09): accept (back to the status held before) or reject (DISCARDED; reason
// required, and shown to the voter).
export function ResolveForm({ ballotId }: { ballotId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const decision = submitter?.value ?? "accepted";
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
    if (decision === "rejected" && reason.trim() === "") {
      setMessage("A reason is required to reject.");
      return;
    }
    const response = await fetch(`/api/challenges/${encodeURIComponent(ballotId)}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, reason }),
    });
    const body = (await response.json()) as { status?: string; error?: string };
    setMessage(response.ok ? `Now ${body.status}.` : `Not done (${response.status}): ${body.error ?? "refused"}`);
    if (response.ok) router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <label>
        Reason (shown to the voter; required to reject) <input name="reason" maxLength={500} />
      </label>{" "}
      <button type="submit" name="decision" value="accepted">
        Accept
      </button>{" "}
      <button type="submit" name="decision" value="rejected">
        Reject
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
