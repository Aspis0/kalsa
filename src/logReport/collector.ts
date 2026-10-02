/**
 * The console and global-error hooks feeding the report store. Installed once
 * at the app entry: wraps console.log/info/warn/error WITHOUT changing what
 * they print, chains the previous global error handler, and persists every
 * line that passes the schema and the final safety pass. One read function
 * for the step-2 sender.
 */
import { finalizeLine } from "./normalize";
import { appendLine, readReportText } from "./logStore";
import { formatRecord } from "./schema";
import { formatJsErrorLine } from "./jsErrorLine";

type ErrorHandler = (error: unknown, isFatal?: boolean) => unknown;

function captureConsoleLine(args: unknown[]): void {
  const first = args[0];
  if (typeof first !== "string" || !first.startsWith("KALSA_")) return;
  const split = first.indexOf(" ");
  const tag = split === -1 ? first : first.slice(0, split);
  const payloadParts: string[] = [];
  if (split !== -1) payloadParts.push(first.slice(split + 1));
  // Two-arg sites log the tag and the JSON as separate arguments
  // (e.g. pairingFailLog.ts:27, LlamaService.ts:857).
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg === "string") payloadParts.push(arg);
  }
  if (payloadParts.length === 0) return;
  let payload: unknown;
  try {
    payload = JSON.parse(payloadParts.join(" "));
  } catch {
    return;
  }
  const record = formatRecord(tag, payload);
  if (record === null) return;
  const line = finalizeLine(record);
  if (line !== null) appendLine(line);
}

function wrapConsoleMethod(name: "log" | "info" | "warn" | "error"): void {
  const original = console[name].bind(console);
  console[name] = (...args: unknown[]) => {
    try {
      captureConsoleLine(args);
    } catch {
      // capture must never break the caller's console call
    }
    original(...args);
  };
}

function installJsErrorHandler(): void {
  const errorUtils = (globalThis as { ErrorUtils?: {
    getGlobalHandler?: () => ErrorHandler | undefined;
    setGlobalHandler?: (handler: ErrorHandler) => void;
  } }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;
  const previous = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    try {
      const line = finalizeLine(formatJsErrorLine(error));
      if (line !== null) appendLine(line);
    } catch {
      // the record must never replace the crash itself
    }
    return previous?.(error, isFatal);
  });
}

let installed = false;

/** Install the collector once; returns an uninstall for tests. */
export function installLogReportCollector(): () => void {
  if (installed) return () => undefined;
  installed = true;
  const originals = (["log", "info", "warn", "error"] as const).map((name) => ({
    name,
    original: console[name],
  }));
  for (const name of ["log", "info", "warn", "error"] as const) wrapConsoleMethod(name);
  installJsErrorHandler();
  return () => {
    if (!installed) return;
    installed = false;
    for (const { name, original } of originals) console[name] = original;
  };
}

/** The report text for the sender: newest 4 MiB, cut at a line boundary. */
export function readLogReportText(): string {
  return readReportText();
}
