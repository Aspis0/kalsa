/**
 * The llama.cpp native log tail and its console mirror (KALSA_NATIVE lines).
 *
 * The mirror is level-gated: WARN/ERROR always mirror, because a native
 * LM_GGML_ABORT does not throw — it kills the process, and the line ggml
 * prints immediately before aborting is usually the whole diagnosis. That is
 * not hypothetical: on 2026-08-23 the engine aborted in load_all_data on the
 * Jelly and the reason was unrecoverable from the corpse. INFO mirrors only
 * when kalsa.bench.nativelog is on: measured on the S23 (2026-09-27) the
 * load phase alone crossed ~1,570 then ~1,990 INFO lines to JS in seconds
 * (1,102 in the peak second), each one a JSI invokeAsync + console.log +
 * logcat write — the launch-stutter driver. The in-memory tail keeps EVERY
 * level either way (rethrowWithNativeTail needs it), and the fork also prints
 * ggml aborts natively (ggml_abort_log_callback → RNLlama tag + tombstone),
 * so the on-device record survives even a filtered mirror.
 */
import {
  addNativeLogListener,
  toggleNativeLog,
} from "llama.rn";
import { getBenchNativeLogMirror } from "../bench/benchConfig";

export const NATIVE_LOG_CAP = 50;
const nativeLogTail: string[] = [];
const nativeLogEpochTail: Array<{ epoch: number; line: string }> = [];
let nativeLogEpoch = 0;
let nativeLogSetupDone = false;
/** Read once at capture setup from kalsa.bench.nativelog (restart to apply). */
let nativeLogMirrorAll = false;

/**
 * The mirror gate. WARN/ERROR always pass; everything else (the binding maps
 * DEBUG onto the "info" string too) only with the bench pref.
 */
export function shouldMirrorNativeLog(level: string, mirrorAll: boolean): boolean {
  if (level === "warn" || level === "error") return true;
  return mirrorAll;
}

export function beginNativeLogEpoch(): number {
  nativeLogEpoch += 1;
  return nativeLogEpoch;
}

export function nativeLogForEpoch(epoch: number): string {
  return nativeLogEpochTail
    .filter((entry) => entry.epoch === epoch)
    .map((entry) => entry.line)
    .join("\n");
}

export async function ensureNativeLogCapture(): Promise<void> {
  if (nativeLogSetupDone) return;
  try {
    nativeLogMirrorAll = await getBenchNativeLogMirror();
    await toggleNativeLog(true);
    addNativeLogListener((level, text) => {
      const line = `${level} ${text}`;
      nativeLogTail.push(line);
      nativeLogEpochTail.push({ epoch: nativeLogEpoch, line });
      if (nativeLogTail.length > NATIVE_LOG_CAP) {
        nativeLogTail.splice(0, nativeLogTail.length - NATIVE_LOG_CAP);
      }
      if (nativeLogEpochTail.length > NATIVE_LOG_CAP) {
        nativeLogEpochTail.splice(0, nativeLogEpochTail.length - NATIVE_LOG_CAP);
      }
      // Mirror WARN/ERROR to the console AS THEY ARRIVE, do not only buffer:
      // the tail is read by rethrowWithNativeTail, which needs a caught error
      // to exist — and the abort line above has no error to attach to.
      if (shouldMirrorNativeLog(level, nativeLogMirrorAll)) {
        console.log(`KALSA_NATIVE ${level} ${text}`);
      }
    });
    // LAST, and that placement is the whole point. This flag used to be set
    // BEFORE the try: if toggleNativeLog threw, the listener was never added,
    // the catch swallowed it, and every later call short-circuited on a flag
    // that promised a capture nobody had installed. The tail then stayed empty
    // for the life of the process, so rethrowWithNativeTail enriched failures
    // with nothing and the UI showed a bare "unable to initialize context".
    //
    // Cost of that, measured on 2026-08-19: llama printed
    // "V cache quantization requires flash_attn" — the exact cause of a failing
    // bench arm — and it never reached JS. The afternoon went to a wrong
    // diagnosis (blamed GPU offload, then the low-memory killer) that one
    // captured line would have ended. Setting it here means a failed setup is
    // retried on the next init instead of being latched forever.
    nativeLogSetupDone = true;
  } catch {
    // Logging must never break engine init — but it must not claim success
    // either, so the flag above stays unset and the next init tries again.
  }
}

/** Last few diagnostic native-log lines for UI / Error.message enrichment. */
export function nativeLogSummary(): string {
  const diagnosticRe = /error|fail|fallback|invalid|unable|unsupported|missing|magic|version/i;
  const matched = nativeLogTail.filter((line) => diagnosticRe.test(line));
  const slice = (matched.length > 0 ? matched : nativeLogTail).slice(-3);
  const joined = slice.join(" | ");
  return Array.from(joined).slice(0, 300).join("");
}

export function logNativeTailOnFailure(): void {
  console.log("[engine-init-native-tail]", nativeLogTail.join("\n"));
}

/** Engine dispose clears the tail: the next load starts its own record. */
export function clearNativeLogTail(): void {
  nativeLogTail.length = 0;
  nativeLogEpochTail.length = 0;
}

/** Test seam: the setup latch and the tails are process state. */
export function resetNativeLogTailForTests(): void {
  nativeLogSetupDone = false;
  nativeLogMirrorAll = false;
  nativeLogEpoch = 0;
  nativeLogTail.length = 0;
  nativeLogEpochTail.length = 0;
}
