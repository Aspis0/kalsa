/**
 * The accepted-line store: an in-memory ring snapshot plus one app-private
 * log file under the document directory, rotated so it never exceeds 4 MiB.
 * expo-file-system 57's File.write is SYNCHRONOUS, so writes from concurrent
 * console calls are serialized by the JS thread itself — no interleaving, no
 * lost writes.
 *
 * The lines are BUFFERED, not written one by one: a `KALSA_` line used to cost
 * a synchronous write on the caller's thread, inside whatever console call
 * happened to fire during a send or a scroll. They are drained on a microtask
 * instead — after the current turn, so a burst costs ONE write, in order. A
 * report flushes what is buffered first, so what it carries is what the store
 * holds rather than whatever happened to reach the file. Every failure is
 * swallowed: logging must never throw into a console call.
 */
import { File, Paths } from "expo-file-system";
import { trimNewestLinesToByteCap } from "./bytes";

export const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const ROTATE_KEEP_BYTES = MAX_REPORT_BYTES / 2;
const RING_MAX_LINES = 400;
/** Buffered lines kept after a failed write: bounded, or a permanently full
 *  disk would turn the buffer into a queue that grows all session. */
const PENDING_MAX_LINES = 400;
const LOG_NAME = "kalsa-report.log";
const TEMP_NAME = "kalsa-report.tmp";

const ring: string[] = [];
/** Lines accepted but not yet on disk, in the order they were logged. */
let pending: string[] = [];
let drainScheduled = false;
let fileForTests: ((uri: string) => File) | null = null;

/** Test seam: build the log File from a uri instead of Paths.document. */
export function setFileFactoryForTests(factory: ((uri: string) => File) | null): void {
  fileForTests = factory;
}

function openLogFile(name: string): File {
  const file = fileForTests
    ? fileForTests(`file:///docs/${name}`)
    : new File(Paths.document, name);
  if (!file.exists) file.create();
  return file;
}

function rotate(file: File): void {
  const kept = trimNewestLinesToByteCap(file.textSync(), ROTATE_KEEP_BYTES);
  // Write-then-replace: a failed rotate write must never have deleted the log
  // first. moveSync over the live file is the only destructive step, and it
  // runs only once the kept text is already on disk.
  const temp = openLogFile(TEMP_NAME);
  temp.write(kept);
  temp.moveSync(file, { overwrite: true });
}

function drainPending(): void {
  drainScheduled = false;
  if (pending.length === 0) return;
  // One write for the whole burst, newlines in between: the file's line
  // structure is exactly what per-line appends produced.
  const batch = pending;
  pending = [];
  try {
    const file = openLogFile(LOG_NAME);
    file.write(`${batch.join("\n")}\n`, { append: true });
    try {
      if (file.size > MAX_REPORT_BYTES) rotate(file);
    } catch {
      // The batch IS on disk: requeuing it here would write every line twice
      // on the next drain. A failed rotate costs the 4 MiB ceiling until the
      // next write tries again, never a line.
    }
  } catch {
    // The append itself failed (a full disk, a missing directory): put the
    // batch back, oldest out, so a transient failure does not delete it. The
    // next appendLine, or the next report, drains it again.
    pending = [...batch, ...pending].slice(-PENDING_MAX_LINES);
  }
}

function scheduleDrain(): void {
  if (drainScheduled) return;
  drainScheduled = true;
  try {
    // A microtask, not a timer: the lines land before the next frame and
    // before any report could be asked for on another turn, and the process
    // has no timer bookkeeping to keep alive.
    queueMicrotask(drainPending);
  } catch {
    // No microtask queue (or it is full): pay the write here rather than lose
    // the lines, which is what this module did before it buffered at all.
    drainScheduled = false;
    drainPending();
  }
}

export function appendLine(line: string): void {
  ring.push(line);
  if (ring.length > RING_MAX_LINES) ring.shift();
  pending.push(line);
  scheduleDrain();
}

/**
 * The current report text: everything the store holds, trimmed to the newest
 * 4 MiB at a line boundary — or the in-memory ring when the file cannot be
 * read. The sender consumes this.
 *
 * The buffered lines are flushed first, HERE rather than on the microtask: a
 * report is asked for by a person about to send a log, and it must carry every
 * line the store accepted, not the ones that happened to reach the file before
 * the read. The cap is applied to the text this returns, not to the file alone,
 * so the 4 MiB ceiling is a property of the report, not of the flush order.
 */
export function readReportText(): string {
  drainPending();
  // Still buffered means the write above failed: those lines are in no file,
  // so they go in front of the cap rather than being dropped from the report.
  const unflushed = pending.length > 0 ? `${pending.join("\n")}\n` : "";
  try {
    const file = fileForTests
      ? fileForTests(`file:///docs/${LOG_NAME}`)
      : new File(Paths.document, LOG_NAME);
    if (file.exists) {
      return trimNewestLinesToByteCap(`${file.textSync()}${unflushed}`, MAX_REPORT_BYTES);
    }
  } catch {
    // fall through to the ring
  }
  return ring.length > 0 ? `${ring.join("\n")}\n` : "";
}

/**
 * Write the buffered lines now. The drain is a microtask, so a process killed
 * moments after the last log line loses it; the app's background transition is
 * the last point where the JS thread is still ours to write on.
 */
export function flushLogLines(): void {
  drainPending();
}