import { tokens } from "@vbt/ui";
import { pipelineSmoke } from "../flags";
import { countContextEntries } from "../lib/context-log";
import { readGreeting } from "../lib/product-db";
import { placeholderStatus } from "../lib/status";

export default async function Home() {
  const [smoke, greeting, contextCount] = await Promise.all([pipelineSmoke(), readGreeting(), countContextEntries()]);
  return (
    <main
      data-testid="home"
      style={{ fontFamily: tokens.font.body, color: tokens.color.text, padding: tokens.space.lg }}
    >
      <h1 style={{ color: tokens.color.accent }}>VBT</h1>
      <p data-testid="greeting">{greeting ?? "Greeting unavailable"}</p>
      <p>{placeholderStatus()}</p>
      <p data-testid="flag-pipeline-smoke">pipeline-smoke flag: {smoke ? "on" : "off"}</p>
      <section data-testid="context-log" aria-label="Context log" style={{ color: tokens.color.muted }}>
        {contextCount === null
          ? "Context log: unavailable"
          : contextCount === 0
            ? "Context log: no entries"
            : `Context log: ${contextCount} recent ${contextCount === 1 ? "entry" : "entries"}`}
      </section>
    </main>
  );
}
