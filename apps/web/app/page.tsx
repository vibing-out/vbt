import { tokens } from "@vbt/ui";
import { countContextEntries } from "../lib/context-log";
import { getDemoFlags, type DemoFlags } from "../lib/demo-flags";
import { readGreeting } from "../lib/product-db";
import { placeholderStatus } from "../lib/status";

// The demo-feature flags (flags.ts), each shown by its live value so a Flags Explorer toggle is visible.
const demoFeatures: { key: string; label: string; flag: keyof DemoFlags }[] = [
  { key: "mismatch-view", label: "Mismatch view", flag: "mismatchView" },
  { key: "challenge-discard-flow", label: "Challenge and discard flow", flag: "challengeDiscardFlow" },
  { key: "state-level-status", label: "State-level status", flag: "stateLevelStatus" },
];

export default async function Home() {
  const [demoFlags, greeting, contextCount] = await Promise.all([getDemoFlags(), readGreeting(), countContextEntries()]);
  return (
    <main
      data-testid="home"
      style={{ fontFamily: tokens.font.body, color: tokens.color.text, padding: tokens.space.lg }}
    >
      <h1 style={{ color: tokens.color.accent }}>VBT</h1>
      <p data-testid="greeting">{greeting ?? "Greeting unavailable"}</p>
      <p>{placeholderStatus()}</p>
      <section data-testid="demo-features" aria-label="Demo features" style={{ marginBlock: tokens.space.md }}>
        <h2>Demo features</h2>
        {demoFeatures.map(({ key, label, flag }) => (
          <p key={key} data-testid={`flag-${key}`}>
            {`${label}: ${demoFlags[flag] ? "on" : "off"}`}
          </p>
        ))}
      </section>
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
