"use client";

import type { RunLine } from "@vbt/demo";
import { useEffect, useReducer, useRef, useState } from "react";
import { DemoControlView } from "./demo-control-view";
import { canStart, initialView, reduce, splitLines } from "./run-view";

// Demo control (T-22): starts one run through POST /api/official/demo/runs and follows its NDJSON stream.
// The page serves no data of its own; the route checks the official's role and MFA on every start, and
// the session cookies go with the same-origin request.

export function DemoControl({ initialSet }: { initialSet: string }) {
  const [view, dispatch] = useReducer(reduce, initialView);
  const [setId, setSetId] = useState(initialSet);
  const [now, setNow] = useState(() => Date.now());
  // Set synchronously on the first press, so a double click can't send two requests before re-render.
  const pressed = useRef(false);

  useEffect(() => {
    if (view.phase !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [view.phase]);

  async function start() {
    if (pressed.current || !canStart(view, setId)) return;
    pressed.current = true;
    const id = setId.trim();
    dispatch({ type: "start", setId: id });
    try {
      const response = await fetch(`/api/official/demo/runs?set=${encodeURIComponent(id)}`, { method: "POST", credentials: "same-origin" });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
        const message = body.message ?? (response.status === 403 ? "Sign in as a state official, or this set's county official, with MFA." : body.error ?? `HTTP ${response.status}`);
        dispatch({ type: "refused", status: response.status, message });
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const { lines, rest } = splitLines(buffer + value);
        buffer = rest;
        for (const line of lines) {
          setNow(Date.now());
          dispatch({ type: "line", line: JSON.parse(line) as RunLine, now: Date.now() });
        }
      }
    } catch {
      dispatch({ type: "error", message: "The connection to the run was lost. The run continues on the server; watch the trackers." });
    }
  }

  return <DemoControlView view={view} setId={setId} now={now} onSetId={setSetId} onStart={() => void start()} />;
}
