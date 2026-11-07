import type { CSSProperties } from "react";
import { tokens } from "@vbt/ui";

export const styles = {
  main: { fontFamily: tokens.font.body, color: tokens.color.text, maxWidth: 640, margin: "0 auto", padding: "1.5rem 1rem 3rem" },
  eyebrow: { color: tokens.color.muted, fontSize: "0.85rem", margin: 0, textTransform: "uppercase", letterSpacing: "0.04em" },
  h1: { fontSize: "1.9rem", margin: "0.4rem 0 0.6rem" },
  h2: { fontSize: "1.1rem", margin: "0 0 0.75rem" },
  muted: { color: tokens.color.muted },
  form: { display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: "1.25rem 0", alignItems: "center" },
  label: { width: "100%", fontWeight: 600 },
  input: { flex: "1 1 220px", padding: "0.7rem", fontSize: "1rem", border: "1px solid #c7c7d1", borderRadius: 8, fontFamily: "ui-monospace, monospace" },
  button: { padding: "0.7rem 1.2rem", fontSize: "1rem", background: tokens.color.accent, color: "#fff", border: 0, borderRadius: 8, cursor: "pointer" },
  card: { border: "1px solid #e3e3ea", borderRadius: 12, padding: "1rem 1.1rem", margin: "1rem 0", background: "#fafafc" },
  list: { listStyle: "none", padding: 0, margin: 0 },
  code: { fontFamily: "ui-monospace, monospace", fontWeight: 700, color: tokens.color.accent, wordBreak: "break-all" },
  mono: { fontFamily: "ui-monospace, monospace", fontSize: "0.8rem", wordBreak: "break-all", color: tokens.color.muted },
  footnote: { color: tokens.color.muted, fontSize: "0.85rem", marginTop: "2rem" },
  ok: { color: "#15803d", fontWeight: 600 },
  bad: { color: "#b91c1c", fontWeight: 600 },
  warn: { color: "#b45309", fontWeight: 600 },
} satisfies Record<string, CSSProperties>;
