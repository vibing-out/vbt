import "server-only";
import { challengeDiscardFlow, mismatchView, stateLevelStatus } from "../flags";

export type DemoFlags = { mismatchView: boolean; challengeDiscardFlow: boolean; stateLevelStatus: boolean };

// The live value of each demo-feature flag for this request. A Flags Explorer override (the encrypted
// `vercel-flag-overrides` cookie) wins over the Vercel value; each flag falls back to `true` on its own.
export async function getDemoFlags(): Promise<DemoFlags> {
  const [mismatch, challengeDiscard, stateLevel] = await Promise.all([
    mismatchView(),
    challengeDiscardFlow(),
    stateLevelStatus(),
  ]);
  return { mismatchView: mismatch, challengeDiscardFlow: challengeDiscard, stateLevelStatus: stateLevel };
}
