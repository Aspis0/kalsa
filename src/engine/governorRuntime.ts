import AsyncStorage from "@react-native-async-storage/async-storage";

export const GOVERNOR_ENABLED_KEY = "kalsa.governor.enabled";

type RetryArgs<P, R> = {
  enabled: boolean;
  governorParams: P;
  cpuParams: P;
  init: (params: P) => Promise<R>;
  nativeLog: () => string;
  nativeLogStart?: () => string;
  log?: (line: string) => void;
};

export async function readGovernorEnabled(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(GOVERNOR_ENABLED_KEY);
    return value === "1" || value?.toLowerCase() === "true";
  } catch {
    return false;
  }
}

/** Persists the flag; returns whether the write landed. Never throws — failures are logged. */
export async function writeGovernorEnabled(enabled: boolean): Promise<boolean> {
  try {
    await AsyncStorage.setItem(GOVERNOR_ENABLED_KEY, enabled ? "1" : "0");
    return true;
  } catch (error) {
    console.warn(`Failed to persist ${GOVERNOR_ENABLED_KEY}`, error);
    return false;
  }
}

export function isGovernorFallback(
  error: unknown,
  nativeLog: string,
  nativeLogAtLoadStart = "",
): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const newNativeLog = nativeLogDelta(nativeLogAtLoadStart, nativeLog);
  return /KALSA_GOVERNOR_FALLBACK|governor.*(fail|reject|invalid)|Governor mode does not support/i.test(
    `${message}\n${newNativeLog}`,
  );
}

/**
 * Prefix of the JSI completion rejection thrown when the native governor
 * decode fails (RNLlamaJSI.cpp: "Governor decode failed: " + failure reason).
 */
const GOVERNOR_DECODE_FAILED_PREFIX = "Governor decode failed: ";
/** Length cap for the reason suffix — it lands in logcat, one line. */
const GOVERNOR_REASON_MAX_LEN = 120;
/** Everything outside this class is stripped: no free text into logcat. */
const GOVERNOR_REASON_UNSAFE = /[^A-Za-z0-9 _.,:+=\/-]/g;

/**
 * The failure reason after the prefix, or null for any other error. The
 * suffix is sanitized (safe charset, length cap) before it can be logged.
 */
export function governorRuntimeFallbackReason(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message.startsWith(GOVERNOR_DECODE_FAILED_PREFIX)) return null;
  return message
    .slice(GOVERNOR_DECODE_FAILED_PREFIX.length)
    .trim()
    .replace(GOVERNOR_REASON_UNSAFE, "")
    .slice(0, GOVERNOR_REASON_MAX_LEN);
}

/**
 * May this failed turn trigger the one runtime governor fallback allowed per
 * loaded model? Local turns only (a Brain turn has no governor context), never
 * after an abort — the user stopped the turn — and never a second time for
 * the model load that already fell back.
 */
export function shouldRuntimeGovernorFallback(args: {
  error: unknown;
  isLocalTurn: boolean;
  aborted: boolean;
  fallbackUsedForModel: boolean;
}): boolean {
  if (!args.isLocalTurn || args.aborted || args.fallbackUsedForModel) {
    return false;
  }
  return governorRuntimeFallbackReason(args.error) !== null;
}

/**
 * May the turn driver still retry after the runtime governor reload? Refuses
 * once the signal aborted (re-checked right before the reload starts), once
 * a newer chat turn became current, and once the loaded model is no longer
 * the one that failed — a stale retry must stop quietly, without an error
 * bubble.
 */
export function mayRetryRuntimeGovernorFallback(args: {
  signalAborted: boolean;
  turnStillCurrent: boolean;
  modelStillLoaded: boolean;
}): boolean {
  return !args.signalAborted && args.turnStillCurrent && args.modelStillLoaded;
}

function nativeLogDelta(start: string, current: string): string {
  if (!start) return current;
  if (start === current) return "";
  const startLines = start.split("\n");
  const currentLines = current.split("\n");
  for (let index = 0; index <= currentLines.length - startLines.length; index += 1) {
    if (startLines.every((line, offset) => currentLines[index + offset] === line)) {
      return currentLines.slice(index + startLines.length).join("\n");
    }
  }
  return "";
}

export async function initWithGovernorFallback<P, R>(
  args: RetryArgs<P, R>,
): Promise<{ value: R; retried: boolean; fallbackReason?: string }> {
  if (!args.enabled) {
    return { value: await args.init(args.cpuParams), retried: false };
  }
  const nativeLogAtLoadStart = args.nativeLogStart?.() ?? "";
  try {
    return { value: await args.init(args.governorParams), retried: false };
  } catch (error) {
    if (!isGovernorFallback(error, args.nativeLog(), nativeLogAtLoadStart)) throw error;
    const message = error instanceof Error ? error.message : String(error ?? "");
    try {
      const value = await args.init(args.cpuParams);
      (args.log ?? console.log)("KALSA_GOVERNOR_FALLBACK_RETRY {ok:true}");
      return { value, retried: true, fallbackReason: message };
    } catch (retryError) {
      (args.log ?? console.log)("KALSA_GOVERNOR_FALLBACK_RETRY {ok:false}");
      throw retryError;
    }
  }
}
