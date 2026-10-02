/**
 * The accepted-line store: an in-memory ring snapshot plus one app-private
 * log file under the document directory, rotated so it never exceeds 4 MiB.
 * expo-file-system 57's File.write is SYNCHRONOUS, so appends from concurrent
 * console calls are serialized by the JS thread itself — one write per call,
 * no interleaving, no lost writes. Every failure is swallowed: logging must
 * never throw into a console call.
 */
import { File, Paths } from "expo-file-system";
import { trimNewestLinesToByteCap } from "./bytes";

export const MAX_REPORT_BYTES = 4 * 1024 * 1024;
const ROTATE_KEEP_BYTES = MAX_REPORT_BYTES / 2;
const RING_MAX_LINES = 400;
const LOG_NAME = "kalsa-report.log";
const TEMP_NAME = "kalsa-report.tmp";

const ring: string[] = [];
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

export function appendLine(line: string): void {
  ring.push(line);
  if (ring.length > RING_MAX_LINES) ring.shift();
  try {
    const file = openLogFile(LOG_NAME);
    file.write(`${line}\n`, { append: true });
    if (file.size > MAX_REPORT_BYTES) rotate(file);
  } catch {
    // A full disk or a missing directory costs log lines, never app failures.
  }
}

/**
 * The current report text: the file's newest 4 MiB at a line boundary, or the
 * in-memory ring when the file cannot be read. The sender consumes this.
 */
export function readReportText(): string {
  try {
    const file = fileForTests
      ? fileForTests(`file:///docs/${LOG_NAME}`)
      : new File(Paths.document, LOG_NAME);
    if (file.exists) return trimNewestLinesToByteCap(file.textSync(), MAX_REPORT_BYTES);
  } catch {
    // fall through to the ring
  }
  return ring.length > 0 ? `${ring.join("\n")}\n` : "";
}
