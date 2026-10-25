import * as FileSystem from "expo-file-system/legacy";
import type { LlamaContext } from "llama.rn";
import {
  buildKvDiagPayload, ensureSessionsDir,
  GOVERNOR_SESSION_REASON, hasEnoughDiskForSession,
  sessionLoadHasTokens
} from "./sessionPersistence";
import {
  logGovernorSessionSkip, noteChatNPast,
  sessionDiskGateInput
} from "./chatKvSessionShared";
import type { ChatKvSessionState } from "./chatKvSessionState";

/** Snapshot and restore a raw .kvs around memory extract; it trusts its caller for the meta. */
/** Native path for saveSession (llama.rn does not strip file:// on save). */
function nativeSessionPath(uri: string): string {
  return uri.replace(/^file:\/\//, "");
}

export async function snapshotNativeSession(
  state: ChatKvSessionState,
  engine: LlamaContext,
  destPath: string,
): Promise<boolean> {
  if (state.activeGovernorActive && engine === state.context) {
    logGovernorSessionSkip();
    return false;
  }
  try {
    if (!(await hasEnoughDiskForSession(await sessionDiskGateInput(state)))) return false;
    await ensureSessionsDir();
    try {
      await FileSystem.deleteAsync(destPath, { idempotent: true });
    } catch {
      // overwrite
    }
    // NOT bounded yet, and the reason is narrower than it first looked. The
    // duration IS measured: every KALSA_SESSION save payload carries `ms`.
    // Across the captured runs, 196 successful saves — 77 of them S23 — give a
    // median of 47 ms and a worst case of 1022 ms at 6636 tokens; loads are
    // 41 ms median, 135 ms worst. So a 15 s aux bound would sit ~15x above the
    // slowest save ever recorded, which is the margin this codebase requires of
    // a backstop.
    //
    // What is missing is the SLOW device: not one of those samples is from the
    // Jelly, and a session write is disk I/O, where a Jelly is furthest from an
    // S23. Bounding on S23 numbers alone would set the ceiling from the fast
    // half of the lab. One Jelly save closes this — read `ms` off any
    // KALSA_SESSION save line — and then the bound goes in with both devices
    // behind it.
    await engine.saveSession(nativeSessionPath(destPath));
    return true;
  } catch {
    return false;
  }
}

export async function restoreNativeSession(
  state: ChatKvSessionState,
  engine: LlamaContext,
  srcPath: string,
): Promise<boolean> {
  const t0 = Date.now();
  let tokensLoaded: unknown;
  const log = (ok: boolean, extra?: Record<string, number | boolean | string>) => {
    try {
      console.log(
        `KALSA_SESSION ${JSON.stringify({
          op: "load",
          source: "memory_extract_restore",
          ms: Date.now() - t0,
          ok,
          tokensOnDisk: buildKvDiagPayload({ ok, tokensLoaded }).tokens_on_disk,
          ...extra,
        })}`,
      );
    } catch {
      // telemetry must never throw
    }
  };
  if (state.activeGovernorActive && engine === state.context) {
    log(false, { reason: GOVERNOR_SESSION_REASON });
    return false;
  }
  try {
    // Unbounded for the same reason as the save above: disk I/O, never timed.
    const result = await engine.loadSession(srcPath);
    tokensLoaded = result?.tokens_loaded;
    const ok = sessionLoadHasTokens(result);
    if (ok) noteChatNPast(state, result?.tokens_loaded);
    log(ok, {
      tokens: typeof result?.tokens_loaded === "number" ? result.tokens_loaded : 0,
    });
    return ok;
  } catch {
    log(false, { reason: "load_error" });
    return false;
  }
}
