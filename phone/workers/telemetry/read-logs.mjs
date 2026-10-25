/**
 * Downloads one desktop log from the report Worker's R2 bucket with wrangler.
 * The logRef day is the client's clock but the object day is the Worker's
 * receive day, so the neighbouring UTC days are tried after the logged one.
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

// Same string as V2.patterns.logRef in contract-v2.ts. This CLI is plain .mjs and
// cannot load that TypeScript file; a test keeps the two equal.
export const LOG_REF_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}/[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$";
const LOG_REF = new RegExp(LOG_REF_PATTERN);

const execAsync = promisify(execFile);
const DAY_MS = 86_400_000;
const GET_TIMEOUT_MS = 120_000;

/** The ref is stored data: it is checked before any path or key is built from it. */
function parseLogRef(ref) {
  if (typeof ref !== "string" || !LOG_REF.test(ref)) return null;
  const [day, id] = ref.split("/");
  const time = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) return null;
  return { day, id };
}

function shiftDay(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Wrangler exits non-zero for a missing key and for an auth failure alike, so
 * either one moves the lookup on to the next day.
 */
export async function fetchLog(ref, dir) {
  const parsed = parseLogRef(ref);
  if (parsed === null) return { invalid: true };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tried = [];
  for (const delta of [0, -1, 1]) {
    const candidate = shiftDay(parsed.day, delta);
    tried.push(candidate);
    const file = path.join(dir, `${candidate}_${parsed.id}.log`);
    try {
      await execAsync(
        "npx",
        ["wrangler", "r2", "object", "get", `kalsa-reports/${candidate}/${parsed.id}.log`, "--remote", "--file", file],
        { timeout: GET_TIMEOUT_MS },
      );
      return { key: `${candidate}/${parsed.id}.log`, file };
    } catch {}
  }
  return { missing: true, tried };
}
