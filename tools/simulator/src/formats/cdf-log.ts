// VotingWorks-shaped CDF election event log: ElectionEventLog > Device > Event.

import { DEVICE_TYPE, DEVICE_VERSION, timeAt } from "../fixture.ts";
import type { CdfEvent, CdfLogFile, SimulatedBallot } from "../types.ts";

export const EVENT_IDS = {
  pollsOpened: "polls-opened",
  voteCast: "vote-cast",
  exportComplete: "export-cast-vote-record-complete",
  pollsClosed: "polls-closed",
} as const;

/** Global monotonic clock shared by every machine, in seconds after EPOCH. */
export interface Clock {
  tick(): string;
}

export function createClock(startSeconds = 0): Clock {
  let s = startSeconds;
  return { tick: () => timeAt(s++) };
}

/**
 * Build one machine's log. `ballots` must be that machine's ballots in cast
 * order; ballots in `omit` get no `vote-cast` event (C1 fault).
 */
export function buildMachineLog(
  machineId: string,
  ballots: readonly SimulatedBallot[],
  omit: ReadonlySet<string>,
  clock: Clock,
  generatedTime: string,
): CdfLogFile {
  const events: Array<Omit<CdfEvent, "Sequence">> = [];

  events.push({
    Id: EVENT_IDS.pollsOpened,
    Type: "user-action",
    Disposition: "success",
    TimeStamp: clock.tick(),
    UserId: "poll_worker",
    Description: "Polls opened.",
  });

  for (const ballot of ballots) {
    if (omit.has(ballot.ballotId)) continue;
    events.push({
      Id: EVENT_IDS.voteCast,
      Type: "device-event",
      Disposition: "success",
      TimeStamp: clock.tick(),
      UserId: "machine",
      Description: "Ballot cast.",
      Details: JSON.stringify({ ballotId: ballot.ballotId }),
    });
  }

  events.push({
    Id: EVENT_IDS.exportComplete,
    Type: "user-action",
    Disposition: "success",
    TimeStamp: clock.tick(),
    UserId: "poll_worker",
    Description: "Cast vote record export complete.",
  });

  events.push({
    Id: EVENT_IDS.pollsClosed,
    Type: "user-action",
    Disposition: "success",
    TimeStamp: clock.tick(),
    UserId: "poll_worker",
    Description: "Polls closed.",
  });

  return {
    ElectionEventLog: {
      GeneratedTime: generatedTime,
      Device: [
        {
          Type: DEVICE_TYPE,
          Id: machineId,
          Version: DEVICE_VERSION,
          Event: events.map((e, i) => withSequence(e, i)),
        },
      ],
    },
  };
}

function withSequence(e: Omit<CdfEvent, "Sequence">, sequence: number): CdfEvent {
  // Fixed key order: Id, Type, Disposition, Sequence, TimeStamp, then optional fields.
  return {
    Id: e.Id,
    ...(e.Type !== undefined ? { Type: e.Type } : {}),
    Disposition: e.Disposition,
    Sequence: sequence,
    TimeStamp: e.TimeStamp,
    ...(e.UserId !== undefined ? { UserId: e.UserId } : {}),
    ...(e.Description !== undefined ? { Description: e.Description } : {}),
    ...(e.Details !== undefined ? { Details: e.Details } : {}),
  };
}

/** Ballot ids named by successful `vote-cast` events in a log. */
export function castBallotIds(log: CdfLogFile): string[] {
  const ids: string[] = [];
  for (const device of log.ElectionEventLog.Device) {
    for (const e of device.Event) {
      if (e.Id !== EVENT_IDS.voteCast || e.Disposition !== "success" || e.Details === undefined) continue;
      const parsed = JSON.parse(e.Details) as { ballotId?: unknown };
      if (typeof parsed.ballotId === "string") ids.push(parsed.ballotId);
    }
  }
  return ids;
}
