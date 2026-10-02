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

type ConsoleMethodName = "log" | "info" | "warn" | "error";
type ConsoleFn = (...args: unknown[]) => void;
type ErrorHandler = (error: unknown, isFatal?: boolean) => unknown;

type ErrorUtils = {
  getGlobalHandler?: () => ErrorHandler | undefined;
  setGlobalHandler?: (handler: ErrorHandler | undefined) => void;
  reportFatalError?: (error: unknown) => void;
};

const CONSOLE_METHODS: readonly ConsoleMethodName[] = ["log", "info", "warn", "error"];

/**
 * Install state lives on the wrapped functions themselves, never in module
 * state: Fast Refresh re-evaluates this module while the live console and
 * ErrorUtils still carry the previous install, and module state resets — so
 * a module-level flag would let a re-evaluated module wrap twice and capture
 * every line twice.
 */
interface InstallMark {
  __kalsaLogReportInstall?: { original: unknown };
}

function markInstall<T>(wrapper: T, original: unknown): T {
  (wrapper as unknown as InstallMark).__kalsaLogReportInstall = { original };
  return wrapper;
}

/** `{original}` when fn is one of our wrappers (original may be undefined), else null. */
function markedOriginal(fn: unknown): { original: unknown } | null {
  if (typeof fn !== "function") return null;
  return (fn as unknown as InstallMark).__kalsaLogReportInstall ?? null;
}

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

function wrapConsoleMethod(name: ConsoleMethodName): void {
  const bound = console[name].bind(console);
  const wrapped: ConsoleFn = (...args: unknown[]) => {
    try {
      captureConsoleLine(args);
    } catch {
      // capture must never break the caller's console call
    }
    bound(...args);
  };
  console[name] = markInstall(wrapped, console[name]);
}

/** Install our handler unless one of ours is already installed; in both cases
 *  return the restore that puts back the TRUE previous handler (possibly
 *  undefined), for the uninstall. */
function installJsErrorHandler(): (() => void) | null {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtils }).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return null;
  const current = errorUtils.getGlobalHandler?.();
  const ours = markedOriginal(current);
  if (ours) {
    const previous = ours.original as ErrorHandler | undefined;
    return () => errorUtils.setGlobalHandler?.(previous);
  }
  const previous = current;
  errorUtils.setGlobalHandler(
    markInstall((error: unknown, isFatal?: boolean) => {
      try {
        const line = finalizeLine(formatJsErrorLine(error));
        if (line !== null) appendLine(line);
      } catch {
        // the record must never replace the crash itself
      }
      if (previous !== undefined) return previous(error, isFatal);
      // No previous handler: a fatal error must still reach the native crash
      // reporter instead of dying silently in our capture.
      if (isFatal === true) errorUtils.reportFatalError?.(error);
      return undefined;
    }, previous),
  );
  return () => errorUtils.setGlobalHandler?.(previous);
}

/** Install the collector; returns an uninstall for tests. A second install —
 *  same module or a re-evaluated one — wraps nothing new, and its uninstall
 *  still restores the very first originals. */
export function installLogReportCollector(): () => void {
  const restoreConsole: Array<() => void> = [];
  for (const name of CONSOLE_METHODS) {
    const current: unknown = console[name];
    const ours = markedOriginal(current);
    const original = (ours ? ours.original : current) as ConsoleFn;
    restoreConsole.push(() => {
      console[name] = original;
    });
    if (!ours) wrapConsoleMethod(name);
  }
  const restoreHandler = installJsErrorHandler();
  return () => {
    for (const restore of restoreConsole) restore();
    restoreHandler?.();
  };
}

/** The report text for the sender: newest 4 MiB, cut at a line boundary. */
export function readLogReportText(): string {
  return readReportText();
}
