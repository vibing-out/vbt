import { isSetId } from "@vbt/demo";
import { requireOfficialPage } from "../../../lib/page-guard";
import { homePath, OfficialShell } from "../shell";
import { Forbidden } from "../ui";
import { DemoControl } from "./demo-control";

// /official/demo[?set=<id>] — Demo control in the official tools (T-22). `demo seed` prints this link.
// The page holds no data; starting a run goes through the MFA- and role-checked route, which also checks
// the set's county. The page re-checks role and MFA like every /official page (T-09).
const ROLES = ["county", "state"] as const;

export const metadata = { title: "Demo control · VBT", robots: { index: false } };

// Per request: the session decides what renders, so this page is never prerendered.
export const dynamic = "force-dynamic";

export default async function DemoControlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const official = await requireOfficialPage(ROLES);
  if (!official) return <Forbidden />;

  const set = (await searchParams).set;
  const initialSet = typeof set === "string" && isSetId(set) ? set : "";
  return (
    <OfficialShell
      title="Demo control"
      home={homePath(official)}
      description={
        <>
          Official tools · judges&apos; 3-minute demo. Seed a fresh set with <code className="font-mono">demo seed</code> for each rehearsal.
        </>
      }
    >
      <DemoControl initialSet={initialSet} />
    </OfficialShell>
  );
}
