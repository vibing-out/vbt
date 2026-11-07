import { isSetId } from "@vbt/demo";
import { DemoControl } from "./demo-control";

// /official/demo[?set=<id>] — Demo control in the official tools (T-22). `demo seed` prints this link.
// The page holds no data; starting a run goes through the MFA- and role-checked route.

export const metadata = { title: "Demo control · VBT", robots: { index: false } };

export default async function DemoControlPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const set = (await searchParams).set;
  const initialSet = typeof set === "string" && isSetId(set) ? set : "";
  return <DemoControl initialSet={initialSet} />;
}
