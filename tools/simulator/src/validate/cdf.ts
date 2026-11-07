// Structural validator for a VotingWorks-shaped CDF election event log.
// Returns a list of problems; empty means valid.

const DEVICE_TYPES = new Set(["scan-single", "bmd", "ems", "scan-batch"]);
const DISPOSITIONS = new Set(["success", "failure", "na", "other"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isIso = (v: unknown): boolean => typeof v === "string" && !Number.isNaN(Date.parse(v)) && v.includes("T");

export function validateCdfLog(file: unknown): string[] {
  const errors: string[] = [];
  if (!isObj(file) || !isObj(file.ElectionEventLog)) return ["root must be { ElectionEventLog: {...} }"];
  const log = file.ElectionEventLog;
  if (!isIso(log.GeneratedTime)) errors.push("ElectionEventLog.GeneratedTime must be an ISO-8601 time");
  if (!Array.isArray(log.Device) || log.Device.length === 0) {
    errors.push("ElectionEventLog.Device must be a non-empty array");
    return errors;
  }
  log.Device.forEach((device: unknown, d) => {
    const at = `Device[${d}]`;
    if (!isObj(device)) return void errors.push(`${at} must be an object`);
    if (typeof device.Type !== "string" || !DEVICE_TYPES.has(device.Type)) errors.push(`${at}.Type is not a device type`);
    if (typeof device.Id !== "string" || device.Id === "") errors.push(`${at}.Id must be a non-empty string`);
    if (typeof device.Version !== "string" || device.Version === "") errors.push(`${at}.Version must be a non-empty string`);
    if (!Array.isArray(device.Event)) return void errors.push(`${at}.Event must be an array`);
    device.Event.forEach((event: unknown, i) => {
      const e = `${at}.Event[${i}]`;
      if (!isObj(event)) return void errors.push(`${e} must be an object`);
      if (typeof event.Id !== "string" || event.Id === "") errors.push(`${e}.Id must be a non-empty string`);
      if (typeof event.Disposition !== "string" || !DISPOSITIONS.has(event.Disposition)) {
        errors.push(`${e}.Disposition is not a disposition`);
      }
      if (event.Sequence !== i) errors.push(`${e}.Sequence must be ${i} (0-based, contiguous)`);
      if (!isIso(event.TimeStamp)) errors.push(`${e}.TimeStamp must be an ISO-8601 time`);
      if (event.Details !== undefined && typeof event.Details !== "string") errors.push(`${e}.Details must be a string`);
    });
  });
  return errors;
}
