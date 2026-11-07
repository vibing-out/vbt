import { flag } from "flags/next";
import { vercelAdapter } from "@flags-sdk/vercel";

// Demo-feature flags (T-13). Each one defaults on: when the Vercel adapter has no SDK key, can't reach
// Vercel, or has no value, the flag evaluates to `true`, so the demo paths are visible by default. Flags
// Explorer (Vercel Toolbar) overrides them per browser through the encrypted `vercel-flag-overrides` cookie,
// so toggling one changes the UI on the next request without a redeploy.
const onOff = [
  { value: false, label: "Off" },
  { value: true, label: "On" },
];

export const mismatchView = flag<boolean>({
  key: "mismatch-view",
  description: "The mismatch view: where a machine record differs from its scanned paper ballot.",
  adapter: vercelAdapter(),
  defaultValue: true,
  options: onOff,
});

export const challengeDiscardFlow = flag<boolean>({
  key: "challenge-discard-flow",
  description: "The challenge and discard flows for a ballot.",
  adapter: vercelAdapter(),
  defaultValue: true,
  options: onOff,
});

export const stateLevelStatus = flag<boolean>({
  key: "state-level-status",
  description:
    "The statewide public roll-up of county stage records and check results, shown by date only.",
  adapter: vercelAdapter(),
  defaultValue: true,
  options: onOff,
});
