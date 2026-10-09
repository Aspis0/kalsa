/**
 * Downloads one desktop log from the report Worker's R2 bucket with wrangler.
 * The logRef day is the client's clock but the object day is the Worker's
 * receive day, so the neighbouring UTC days are tried after the logged one.
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(execFile);
const DAY_MS = 86_400_000;
const GET_TIMEOUT_MS = 120_000;

function shiftDay(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Wrangler exits non-zero for a missing key and for an auth failure alike, so
 * either one moves the lookup on to the next day.
 */
export async function fetchLog(ref, dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const [day, id] = ref.split("/");
  const tried = [];
  for (const delta of [0, -1, 1]) {
    const candidate = shiftDay(day, delta);
    tried.push(candidate);
    const file = path.join(dir, `${candidate}_${id}.log`);
    try {
      await execAsync(
        "npx",
        ["wrangler", "r2", "object", "get", `kalsa-reports/${candidate}/${id}.log`, "--remote", "--file", file],
        { timeout: GET_TIMEOUT_MS },
      );
      return { key: `${candidate}/${id}.log`, file };
    } catch {}
  }
  return { missing: true, tried };
}
