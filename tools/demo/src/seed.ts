// demo seed: one fresh demo set of 5 ballots in its own precinct and county, cast through the simulator's
// export and the official file upload, with a receipt and a paper ballot record for each (T-07).
//
// Writes to the database only by insert: the precinct and machine rows (service_role) and the upload.
// Nothing here updates or deletes. A set can never be reset, so each rehearsal seeds a new one.
//
// Receipts are named by tracking code and paper ballot records by a random id, written in shuffled order,
// so the files don't pair a receipt with its choices (as T-07 does). Labels A to E appear only on the
// presenter's cover sheet (index.md), never on a receipt.

import { publicLabel } from "@vbt/domain";
import { LABELS, type Label, labelBallots, SET_SIZE } from "./labels.ts";
import type { ApiPort, FileSink, ReceiptsPort, RegistryWriter, SimulatorPort } from "./ports.ts";
import {
  demoCountyId,
  demoCountyName,
  demoMachineId,
  demoPrecinctId,
  demoPrecinctName,
  newSetId,
  type RandomBytes,
} from "./set-id.ts";

/** The production tracker; each receipt's QR code opens `<this>/track/<code>` (ticket AC 2). */
export const TRACKER_BASE_URL = "https://www.ballottrack.org";

export const DEMO_ELECTION_NAME = "General Election";

/** The URL a receipt's QR code opens. */
export function trackerUrl(trackingCode: string, baseUrl = TRACKER_BASE_URL): string {
  return `${baseUrl.replace(/\/+$/, "")}/track/${encodeURIComponent(trackingCode)}`;
}

/** The Demo control page for a set. */
export function controlUrl(setId: string, appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/official/demo?set=${encodeURIComponent(setId)}`;
}

export interface SeedDeps {
  readonly api: ApiPort;
  readonly simulator: SimulatorPort;
  readonly receipts: ReceiptsPort;
  readonly registry: RegistryWriter;
  readonly sink: FileSink;
  readonly random?: RandomBytes;
  /** Where the official tools run (the Demo control link); defaults to the production site. */
  readonly appBaseUrl?: string;
}

export interface SeededBallot {
  readonly label: Label;
  readonly trackingCode: string;
  readonly url: string;
  readonly receiptFile: string;
}

export interface SeedResult {
  readonly setId: string;
  readonly precinctId: string;
  readonly countyId: string;
  readonly controlUrl: string;
  readonly ballots: readonly SeededBallot[];
  readonly files: readonly string[];
}

function shuffled<T>(items: readonly T[], random: RandomBytes): T[] {
  const out = [...items];
  const bytes = random(out.length);
  for (let i = out.length - 1; i > 0; i--) {
    const j = (bytes[i] ?? 0) % (i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Seeds one set. Refuses before writing anything when the simulator or receipts aren't wired. */
export async function seedSet(deps: SeedDeps): Promise<SeedResult> {
  const { api, simulator, receipts, registry, sink } = deps;
  if (!simulator.available) throw new Error("the simulator adapter is not wired yet (T-06 follow-up); nothing was written");
  if (!receipts.available) throw new Error("the receipts adapter is not wired yet (T-07 follow-up); nothing was written");
  const random = deps.random ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  const appBaseUrl = deps.appBaseUrl ?? TRACKER_BASE_URL;

  const setId = newSetId(random);
  const precinctId = demoPrecinctId(setId);
  const countyId = demoCountyId(setId);
  const machineId = demoMachineId(setId);
  const precinctName = demoPrecinctName(setId);
  const countyName = demoCountyName(setId);

  const machine = await simulator.machine(machineId);
  await registry.insertPrecinct({ id: precinctId, county_id: countyId, name: precinctName });
  await registry.insertMachine({
    id: machineId,
    precinct_id: precinctId,
    vendor: machine.vendor,
    model: machine.model,
    public_key: machine.publicKey,
  });

  const cast = await simulator.castExport({ setId, precinctId, countyId, machineId, count: SET_SIZE });
  await api.uploadEventsFile(cast.file);

  const rows = await api.readSet(precinctId);
  if (rows.length !== SET_SIZE || rows.some((r) => r.status !== "CAST")) {
    throw new Error(`set ${setId}: expected ${SET_SIZE} ballots Cast and sealed, found ${rows.length}`);
  }
  for (const row of rows) {
    const view = await api.readTrack(row.trackingCode);
    if (view.status !== "CAST") throw new Error(`set ${setId}: the tracker shows ${publicLabel(view.status)}, not Cast and sealed`);
  }

  const codes = labelBallots(rows.map((r) => r.trackingCode));
  const byCode = new Map(rows.map((r) => [r.trackingCode, r]));
  const written: string[] = [];
  // Each set's printables go in their own directory, <setId>/.
  const write = async (path: string, contents: string | Uint8Array) => {
    await sink.write(`${setId}/${path}`, contents);
    written.push(`${setId}/${path}`);
  };

  const ballots: SeededBallot[] = [];
  for (const label of LABELS) {
    const trackingCode = codes[label];
    const url = trackerUrl(trackingCode);
    const receiptFile = `receipts/${trackingCode}.pdf`;
    const pdf = await receipts.receipt({
      trackingCode,
      url,
      baseUrl: TRACKER_BASE_URL,
      precinctId,
      precinctName,
      countyName,
      electionName: DEMO_ELECTION_NAME,
      electionDate: byCode.get(trackingCode)!.castDate,
      castDate: byCode.get(trackingCode)!.castDate,
    });
    await write(receiptFile, pdf);
    ballots.push({ label, trackingCode, url, receiptFile });
  }

  const castDate = rows[0]!.castDate;
  for (const paper of shuffled(cast.ballots, random)) {
    const pdf = await receipts.paperBallot({
      machineId: paper.machineId,
      precinctId,
      precinctName,
      ballotStyle: paper.ballotStyle,
      castDate,
      countyName,
      electionName: DEMO_ELECTION_NAME,
      choices: paper.choices,
    });
    await write(`paper-ballots/${hex(random(8))}.pdf`, pdf);
  }

  const control = controlUrl(setId, appBaseUrl);
  await write("index.md", coverSheet(setId, precinctName, control, ballots));
  return { setId, precinctId, countyId, controlUrl: control, ballots, files: written };
}

/** The presenter's cover sheet: which receipt is A to E. Dates and labels only; no time, no choices. */
export function coverSheet(setId: string, precinctName: string, control: string, ballots: readonly SeededBallot[]): string {
  const rows = ballots.map((b) => `| ${b.label} | \`${b.trackingCode}\` | ${b.url} | ${b.receiptFile} |`);
  return [
    `# Judges' demo set ${setId}`,
    "",
    `Precinct: ${precinctName}. All five ballots show **Cast and sealed**.`,
    "",
    `Start the run from Demo control: ${control}`,
    `Or from the CLI: \`demo run --set ${setId}\``,
    "",
    "| Ballot | Tracking code | Tracker | Receipt |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    // Offsets in seconds from Start, never clock times (no time of day on anything printed).
    "Timeline, seconds after Start: 20 spoil D · 45 precinct tally (E challenged by a machine fault) ·",
    "90 election-night report · 120 reject E · 160 certify. A set runs once; seed a fresh set for each rehearsal.",
    "",
  ].join("\n");
}
