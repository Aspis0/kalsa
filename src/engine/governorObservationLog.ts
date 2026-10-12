/**
 * The Stage 0 observation file (learning-governor DESIGN.md 3.2): one JSON
 * line per completion under the app's private documents directory, read back
 * with `adb shell run-as com.kalsa.app cat files/governor/observations.jsonl`
 * on the debuggable APK. Nothing else reads it, and nothing awaits a write —
 * callers fire-and-forget `appendObservation`.
 */
import * as FileSystem from "expo-file-system/legacy";
import type { GovernorObservationRow } from "./governorObservation";

const OBSERVATIONS_DIR = `${FileSystem.documentDirectory ?? ""}governor/`;
const OBSERVATIONS_FILE = `${OBSERVATIONS_DIR}observations.jsonl`;
const OBSERVATIONS_ROTATED = `${OBSERVATIONS_DIR}observations.1.jsonl`;
// At most 8 MB live on the phone: the live file never grows past 4 MB
// because rotation fires before an incoming batch would push it over.
const ROTATE_BYTES = 4 * 1024 * 1024;
// Coordinator note 3: at most 32 rows may sit QUEUED; the one batch already
// handed to the writer can hold another 32, so the module holds at most 64
// rows (a stalled FS promise freezes the in-flight batch, not the cap).
const QUEUE_CAP = 32;

export const OBSERVATION_LOG_PATH = OBSERVATIONS_FILE;

let queue: GovernorObservationRow[] = [];
let droppedPending = 0;
let draining = false;
let idle: Promise<void> = Promise.resolve();
let failureLogged = false;

/** Fire-and-forget append. One drain loop (not a chain link per append)
 *  drains the queue, so memory stays bounded by the cap even if an FS
 *  promise stalls forever. */
export function appendObservation(row: GovernorObservationRow): void {
  queue.push(row);
  if (queue.length > QUEUE_CAP) {
    queue.shift();
    droppedPending += 1;
  }
  if (!draining) {
    draining = true;
    // A microtask, not this call: every append of one synchronous burst
    // (a completion's row) lands in the same batch.
    idle = Promise.resolve().then(drainLoop);
  }
}

/** Test seam: resolves when every append queued so far has been written (or
 *  failed). Nothing in the app awaits this. */
export function flushObservationWrites(): Promise<void> {
  return idle;
}

async function drainLoop(): Promise<void> {
  try {
    while (queue.length > 0) {
      const batch = queue;
      queue = [];
      // The dropped count is taken when the batch forms, so it reports the
      // rows lost before this batch's first row was queued — drops arriving
      // while the batch writes belong to the next written row. On failure
      // the taken count comes back plus the batch itself, all lost.
      const dropped = droppedPending;
      droppedPending = 0;
      try {
        await writeBatch(batch, dropped);
      } catch (error: unknown) {
        droppedPending += dropped + batch.length;
        if (!failureLogged) {
          failureLogged = true;
          console.log(
            "governorObservationLog: append failed, its queued rows are lost",
            error instanceof Error ? error.message : "",
          );
        }
      }
    }
  } finally {
    draining = false;
  }
}

// The rotate cap is a byte count and .length counts UTF-16 code units, so a
// row with any non-ASCII id would under-count (JSON.stringify leaves such
// characters unescaped).
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      // One astral character (4 bytes): skip its low surrogate half.
      i += 1;
      bytes += 4;
      continue;
    }
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
  }
  return bytes;
}

async function writeBatch(rows: GovernorObservationRow[], dropped: number): Promise<void> {
  await FileSystem.makeDirectoryAsync(OBSERVATIONS_DIR, { intermediates: true });
  const payload = `${rows
    .map((row, index) =>
      JSON.stringify(index === 0 && dropped > 0 ? { ...row, dropped } : row),
    )
    .join("\n")}\n`;
  const info = await FileSystem.getInfoAsync(OBSERVATIONS_FILE);
  const existing = info.exists && !info.isDirectory ? info.size : 0;
  if (existing > 0 && existing + utf8Bytes(payload) > ROTATE_BYTES) {
    // moveAsync replaces the previous generation: at most two files live.
    await FileSystem.moveAsync({ from: OBSERVATIONS_FILE, to: OBSERVATIONS_ROTATED });
  }
  await FileSystem.writeAsStringAsync(OBSERVATIONS_FILE, payload, { append: true });
}
