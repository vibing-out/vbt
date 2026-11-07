import { demoCountyId, isSetId } from "@vbt/demo";
import { requireOfficialPage } from "../../../lib/page-guard";
import { Forbidden } from "../ui";
import { DemoControl } from "./demo-control";

// /official/demo[?set=<id>] — Demo control in the official tools (T-22). `demo seed` prints this link.
// The page holds no data; starting a run goes through the MFA- and role-checked route. Like every official
// page (T-09), it re-checks the session first, with the run route's rule: a state official, or a county
// official scoped to the set's own county.

export const metadata = { title: "Demo control · VBT", robots: { index: false } };

// Per request: the session decides what renders, so this page is never prerendered.
export const dynamic = "force-dynamic";

const ROLES = ["state", "county"] as const;

export default async function DemoControlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const set = (await searchParams).set;
  const initialSet = typeof set === "string" && isSetId(set) ? set : "";
  const official = await requireOfficialPage(ROLES, initialSet ? { scope: "county", id: demoCountyId(initialSet) } : undefined);
  if (!official) return <Forbidden />;

  return <DemoControl initialSet={initialSet} />;
}
