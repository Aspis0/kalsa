/**
 * On-disk snapshot of the prewarmed static-prefix KV.
 *
 * The static prefix (system prompt + tool schemas + locale render) is
 * identical for every conversation and changes only when its inputs change —
 * yet every idle unload / thermal gate kills the native context and the next
 * turn recomputes it (~40 s of prefill on the S23, three times in 30 minutes
 * on 2026-09-17). saveSession/loadSession move the quantized KV verbatim
 * (~12.6 MB for 1832 tokens, single-digit ms).
 *
 * The file lives in the regular session pool under a RESERVED conversation id
 * (sessionStem(modelId, RESERVED, prefixHash)) so it cannot collide with a
 * chat's .kvs and inherits the same meta validation, sanitising, sidecar
 * sweeping and LRU eviction as every other pooled file.
 *
 * Truth discipline: whether the native cache actually holds the prefix comes
 * from loadSession's tokens_loaded — never from a JS flag.
 */

import * as FileSystem from "expo-file-system/legacy";

import { STATIC_PREFIX_CONVERSATION_ID, sessionStem } from "./sessionKey";
import {
  type SessionMeta,
  SESSION_FORMAT_VERSION,
  deleteSessionArtifacts,
  ensureSessionsDir,
  hasEnoughDiskForSession,
  promoteSessionBak,
  readSessionMeta,
  sessionFilePath,
  sessionFileExists,
  sessionLoadHasTokens,
  sessionMetaMismatchField,
  sessionNativeSaveCoversNPast,
  writeSessionMeta,
} from "./sessionPersistence";
import {
  discardStaleConversationSessions,
  keepOnlyStaticPrefixSnapshot,
  touchSessionUse,
} from "./sessionPool";

/** Everything the snapshot's validity depends on. */
export type StaticPrefixIdentity = {
  modelId: string;
  modelFileId: string;
  engineBuild: string;
  nCtx: number;
  cacheTypeK: string;
  cacheTypeV: string;
  prefixHash: string;
  mtpNMax?: number;
  specType?: string;
  engineKnob?: string;
};

/** Native context surfaces used here (structural; no llama.rn import). */
export type StaticPrefixSnapshotSaveCtx = {
  saveSession(path: string): Promise<unknown>;
};
export type StaticPrefixSnapshotRestoreCtx = {
  loadSession(path: string): Promise<unknown>;
};

export function staticPrefixStem(
  modelId: string,
  prefixHash: string,
): string | null {
  return sessionStem(modelId, STATIC_PREFIX_CONVERSATION_ID, prefixHash);
}

/**
 * What a snapshot for this identity must claim. historyHash AND promptEnvHash
 * both carry the prefix hash: any input change (system text, tools, locale)
 * fails the exact-match meta check and the file is deleted, never reused.
 */
export function expectedStaticPrefixMeta(
  identity: StaticPrefixIdentity,
): SessionMeta {
  const meta: SessionMeta = {
    formatVersion: SESSION_FORMAT_VERSION,
    modelFileId: identity.modelFileId,
    engineBuild: identity.engineBuild,
    nCtx: identity.nCtx,
    cacheTypeK: identity.cacheTypeK,
    cacheTypeV: identity.cacheTypeV,
    historyHash: identity.prefixHash,
    promptEnvHash: identity.prefixHash,
    conversationId: STATIC_PREFIX_CONVERSATION_ID,
  };
  if (identity.mtpNMax !== undefined) meta.mtpNMax = identity.mtpNMax;
  if (identity.specType !== undefined) meta.specType = identity.specType;
  if (identity.engineKnob !== undefined) meta.engineKnob = identity.engineKnob;
  return meta;
}

export type StaticPrefixSnapshotOutcome =
  | {
      ok: true;
      stem: string;
      tokensLoaded: number;
      /** Size of the file just written, for the disk calibration. Save only. */
      fileBytes?: number;
    }
  | { ok: false; stem: string | null; reason: string; deleted?: boolean };

/**
 * Restore the snapshot into `ctx`. Never throws. Any refusal deletes the
 * file that caused it (stale meta, missing meta, tokens_loaded: 0) so a dead
 * snapshot cannot survive to be refused again.
 */
export async function restoreStaticPrefixSnapshot(
  ctx: StaticPrefixSnapshotRestoreCtx,
  identity: StaticPrefixIdentity,
  /**
   * Re-asked immediately before the native load. Everything this function
   * awaits first — a stat, a .bak promotion that moves the same 12.6 MB file,
   * a .tmp delete, a meta read — can outlive the context it was called for,
   * and loadSession is the point of no return: it replaces the native KV.
   * Guarding only at the call site narrows that window; this closes it.
   */
  mustStop: () => boolean,
): Promise<StaticPrefixSnapshotOutcome> {
  const stem = staticPrefixStem(identity.modelId, identity.prefixHash);
  if (!stem) return { ok: false, stem: null, reason: "no_session_key" };
  try {
    // A kill between bak-rename and move leaves only the .bak (the previous
    // good file) — promote it before loading, exactly like the pool does.
    if (!(await sessionFileExists(stem))) {
      const recovered = await promoteSessionBak(stem);
      if (!recovered) return { ok: false, stem, reason: "no_file" };
    }
    // A kill during a native write leaves a 12.6 MB `.tmp` that nothing on
    // this path would ever sweep: sweepStaleSidecars only runs from a save,
    // and the snapshot's save may not run again for a long time.
    try {
      await FileSystem.deleteAsync(`${sessionFilePath(stem)}.tmp`, {
        idempotent: true,
      });
    } catch {
      // best-effort: an orphan costs disk, never correctness
    }
    const stored = await readSessionMeta(stem);
    if (!stored) {
      await deleteSessionArtifacts(stem);
      return { ok: false, stem, reason: "no_meta", deleted: true };
    }
    const mismatch = sessionMetaMismatchField(
      stored,
      expectedStaticPrefixMeta(identity),
    );
    if (mismatch !== null) {
      await deleteSessionArtifacts(stem);
      return {
        ok: false,
        stem,
        reason: `meta_mismatch:${mismatch}`,
        deleted: true,
      };
    }
    // llama.rn 0.12.8: loadSession takes the URI form (it strips file://
    // itself); saveSession does not — that asymmetry is handled at save.
    if (mustStop()) return { ok: false, stem, reason: "aborted" };
    const result = await ctx.loadSession(sessionFilePath(stem));
    const tokensLoaded =
      typeof (result as { tokens_loaded?: unknown })?.tokens_loaded === "number"
        ? (result as { tokens_loaded: number }).tokens_loaded
        : 0;
    if (!sessionLoadHasTokens({ tokens_loaded: tokensLoaded })) {
      await deleteSessionArtifacts(stem);
      return { ok: false, stem, reason: "tokens_loaded:0", deleted: true };
    }
    await touchSessionUse(stem);
    return { ok: true, stem, tokensLoaded };
  } catch {
    // Native error: the caller must bring the context to a known state
    // (native clear) before any completion prefills over it.
    return { ok: false, stem, reason: "load_error" };
  }
}

export type StaticPrefixSnapshotSaveInput = {
  ctx: StaticPrefixSnapshotSaveCtx;
  identity: StaticPrefixIdentity;
  /** Native token count of the KV being snapshotted (prewarm tokens_cached). */
  prefixTokens: number;
  /** Measured session bytes/token for this model (calibration), if known. */
  bytesPerToken: number | null;
};

/**
 * Snapshot the KV left by a successful static-prefix prewarm. Same
 * atomicity shape as saveEngineSession: native write to `<file>.tmp`
 * (path stripped — saveSession does NOT strip file:// itself), bak-rename
 * over the previous good file, meta written only after the rename. Never
 * throws; a failed save leaves the previous snapshot (if any) intact.
 */
export async function saveStaticPrefixSnapshot(
  input: StaticPrefixSnapshotSaveInput,
): Promise<StaticPrefixSnapshotOutcome> {
  const { ctx, identity, prefixTokens, bytesPerToken } = input;
  const stem = staticPrefixStem(identity.modelId, identity.prefixHash);
  if (!stem) return { ok: false, stem: null, reason: "no_session_key" };
  let tmpPath = "";
  try {
    if (
      !(await hasEnoughDiskForSession({
        nPast: prefixTokens,
        nCtx: identity.nCtx,
        bytesPerToken,
      }))
    ) {
      return { ok: false, stem, reason: "disk" };
    }
    await ensureSessionsDir();
    const path = sessionFilePath(stem);
    tmpPath = `${path}.tmp`;
    // Drop any stale tmp from a previous interrupted save.
    try {
      await FileSystem.deleteAsync(tmpPath, { idempotent: true });
    } catch {
      // ignore
    }
    const tokens = await ctx.saveSession(tmpPath.replace(/^file:\/\//, ""));
    if (!sessionNativeSaveCoversNPast(tokens, prefixTokens)) {
      try {
        await FileSystem.deleteAsync(tmpPath, { idempotent: true });
      } catch {
        // ignore
      }
      return { ok: false, stem, reason: "native_shorter_than_prefix" };
    }
    // Keep the previous good file until the new bytes are complete: move over
    // a bak so a kill between delete and move cannot lose both.
    const bakPath = `${path}.bak`;
    try {
      await FileSystem.deleteAsync(bakPath, { idempotent: true });
    } catch {
      // ignore
    }
    let hadPrevious = false;
    try {
      const prev = await FileSystem.getInfoAsync(path);
      hadPrevious = !!prev.exists;
      if (hadPrevious) await FileSystem.moveAsync({ from: path, to: bakPath });
    } catch {
      // ignore — treat as no previous file
    }
    try {
      await FileSystem.moveAsync({ from: tmpPath, to: path });
    } catch (moveError) {
      if (hadPrevious) {
        try {
          await FileSystem.moveAsync({ from: bakPath, to: path });
        } catch {
          // ignore — worst case one recomputed prefill
        }
      }
      throw moveError;
    }
    if (!(await writeSessionMeta(stem, expectedStaticPrefixMeta(identity)))) {
      try {
        await FileSystem.deleteAsync(path, { idempotent: true });
      } catch {
        // ignore
      }
      if (hadPrevious) {
        try {
          await FileSystem.moveAsync({ from: bakPath, to: path });
        } catch {
          // ignore
        }
      }
      return { ok: false, stem, reason: "meta_write" };
    }
    try {
      await FileSystem.deleteAsync(bakPath, { idempotent: true });
    } catch {
      // ignore
    }
    await touchSessionUse(stem);
    // Exactly one file per prefix identity: same model + reserved conv with a
    // different env hash (old system prompt / tools / locale) is dead weight.
    await discardStaleConversationSessions(
      identity.modelId,
      STATIC_PREFIX_CONVERSATION_ID,
      identity.prefixHash,
    );
    // And exactly one across models. This is the snapshot's whole size bound:
    // pickEvictionStems deliberately does not charge it to the conversation
    // budget, because a shared 12.6 MB file and the user's chats were evicting
    // each other at the picker's minimum.
    await keepOnlyStaticPrefixSnapshot(stem);
    // Report what actually survived, not what we intended to write: a caller
    // that logs ok:true for a file no longer on disk mis-attributes the next
    // cold prefill. Same re-check the chat path does after eviction.
    if (!(await sessionFileExists(stem))) {
      return { ok: false, stem, reason: "gone_after_write" };
    }
    let fileBytes: number | undefined;
    try {
      const info = await FileSystem.getInfoAsync(path);
      const size = (info as { size?: number }).size;
      if (typeof size === "number" && Number.isFinite(size) && size > 0) {
        fileBytes = size;
      }
    } catch {
      // The snapshot is valid whether or not we can measure it.
    }
    return { ok: true, stem, tokensLoaded: prefixTokens, fileBytes };
  } catch {
    if (tmpPath) {
      try {
        await FileSystem.deleteAsync(tmpPath, { idempotent: true });
      } catch {
        // ignore
      }
    }
    return { ok: false, stem, reason: "save_error" };
  }
}
