// chain: one tracking code's event history links up. This checks linkage only:
// the first event is CAST with a null prev_hash, each prev_hash equals the
// previous event's hash, and each status change starts where the last one
// ended. It does not recompute event hashes: @vbt/crypto exports no event-hash
// function, and the verifier implements no hashing itself (follow-up: add an
// `eventHash` export to packages/crypto and to the crypto adapter, then report
// "event <i> hash does not match its contents").

import type { PublishedTrack } from "../record.ts";
import { type Check, outcome } from "../report.ts";

export function checkChain(code: string, track: PublishedTrack): Check[] {
  const failures: string[] = [];
  const [first, ...rest] = track.events;
  if (!first || first.event_type !== "CAST" || first.prev_hash !== null) {
    failures.push("first event is not CAST with a null prev_hash");
  }
  let status = first?.to_status ?? null;
  rest.forEach((e, j) => {
    const n = j + 2;
    const prev = track.events[j];
    if (e.prev_hash !== prev?.hash) failures.push(`event ${n} prev_hash does not match the previous event`);
    if (e.to_status !== null) {
      if (e.from_status !== status) failures.push(`event ${n} from_status does not match the previous event's to_status`);
      status = e.to_status;
    }
  });
  return outcome("chain", code, null, failures);
}
