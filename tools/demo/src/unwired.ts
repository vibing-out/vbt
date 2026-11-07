// Placeholders for the real simulator (T-06, origin/epic/4) and receipts (T-07, epic/5) adapters. Both
// report available: false, so the route, seed and CLI refuse up front, before any write, instead of failing
// part-way through a set (which could never be reset). A follow-up ticket wires the real adapters once
// those epics merge into main.

import type { ReceiptsPort, SimulatorPort } from "./ports.ts";

const notWired = (what: string) => async (): Promise<never> => {
  throw new Error(`the ${what} adapter is not wired yet (follow-up once it merges into main)`);
};

export function unwiredSimulator(): SimulatorPort {
  const fail = notWired("simulator");
  return { available: false, machine: fail, castExport: fail, spoilExport: fail, mismatchExport: fail, precinctCloseExport: fail };
}

export function unwiredReceipts(): ReceiptsPort {
  const fail = notWired("receipts");
  return { available: false, receipt: fail, paperBallot: fail };
}

/** The simulator and receipts adapters the CLI and the @demo spec use. The follow-up wires them here. */
export function demoAdapters(): { simulator: SimulatorPort; receipts: ReceiptsPort } {
  return { simulator: unwiredSimulator(), receipts: unwiredReceipts() };
}
