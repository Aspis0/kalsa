import * as FileSystem from "expo-file-system/legacy";
import {
  estimateSessionBytes, ensureSessionsDir,
  getSessionConversationId, historyHash,
  isSameSessionSave, markSessionDivergesAtLastExchange,
  rememberSuccessfulSessionSave, resolveSessionDiskTokens,
  sessionDiskGate, sessionFileExists,
  sessionFilePath, sessionNativeSaveCoversNPast,
  shouldSaveSession, SESSION_FORMAT_VERSION,
  warnUnexpectedSessionFailure, writeSessionMeta,
  type SessionHistoryFact, type SessionMeta, type SessionSaveFingerprint,
} from "./sessionPersistence";
import { decideSessionDiskSpace } from "./sessionDiskSpaceDecision";
import {
  deleteLegacyModelSession, evictSessionPool,
  evictSessionPoolForSpace, readSessionPoolBudgetBytes,
  touchSessionUse
} from "./sessionPool";
import { BAKE_FORMAT_B_USER_PREFIX } from "./ttftFlags";
import { recordSessionDiskSample } from "./sessionDiskCalibration";
import { saveSessionDiskCalibration } from "./sessionDiskCalibrationStore";
import { registrySessionBytesPerToken } from "./sessionDiskFallback";
import {
  activeSessionStem, logGovernorSessionSkip,
  noteChatNPast, sessionDiskGateInput,
  sessionErrorReason
} from "./chatKvSessionShared";
import type { ChatKvSessionState } from "./chatKvSessionState";

/**
 * Write the active model KV + meta to disk; the gates and the write order are LlamaService's, moved verbatim.
 * `historyHashValue` may be a thunk (see `SessionHistoryFact`): the job resolves
 * it HERE, after the sync gates and the prefix early-return, so a caller that
 * must enqueue in its own tick never pays the read + hash on the UI path.
 */
let kvPrefixUnavailableLoggedKey: string | null = null;

/**
 * Persist native KV + meta for the active model. Serialized via withEngineJob
 * so it never races a completion. Never throws; returns false on skip/failure.
 *
 * Write is atomic-ish: native save goes to `<path>.tmp`, then moveAsync over the
 * real file; meta is written only after a successful rename. On ANY failure only
 * the tmp is deleted — the previous good `.kvs` + meta stay intact.
 * An identical stem/history/token save is acknowledged without another native write.
 */
export async function persistChatKvSession(
  state: ChatKvSessionState,
  modelId: string,
  historyHashValue: string | (() => Promise<SessionHistoryFact>),
  historyMessageCount?: number,
): Promise<boolean> {
  if (state.activeGovernorActive) {
    logGovernorSessionSkip();
    return false;
  }
  // Capture identity NOW: the FIFO serializes work but not conversation id.
  // bindActiveConversation can run while this job is queued; resolving the
  // stem inside the job would write chat A's KV under chat B's filename.
  const conversationId = getSessionConversationId();
  const promptEnvHash = state.lastPromptEnvHash;
  // FIX 4: lifecycle lock for the full save (disk I/O + native saveSession) so
  // a concurrent dispose/model-switch cannot null active* fields or release the
  // context mid-save. Outer lifecycle, inner engine-job (never reverse — that
  // deadlocks with disposeEngineLocked waiting on engineJobChain).
  return state.withLifecycleLock(() =>
  state.withEngineJob(async () => {
    const t0 = Date.now();
    let usedTokens = resolveSessionDiskTokens({
      nPast: state.lastChatNPast,
      nCtx: state.activeEngineCtx,
    });
    let bytesPerToken: number | null = null;
    let estimatedBytes = usedTokens == null ? 0 : estimateSessionBytes(usedTokens);
    // a stable, unsalted 32-bit djb2 of the stem: not invertible in practice from
    // the hash alone, but a deterministic fingerprint — anyone holding a candidate
    // stem can confirm a match, and the same conversation links across logs
    // needed to pair a turn's save with the load after restart
    let logStemHash: string | null = null;
    const log = (
      ok: boolean,
      extra?: Record<string, number | boolean | string>,
      op = "save",
    ) => {
      try {
        console.log(
          `KALSA_SESSION ${JSON.stringify({
            op,
            ms: Date.now() - t0,
            ok,
            estimatedBytes,
            usedTokens: usedTokens ?? -1,
            ...extra,
            ...(logStemHash ? { stemHash: logStemHash } : {}),
          })}`,
        );
      } catch {
        // telemetry must never throw
      }
    };
    let tmpPath = "";
    try {
      // Sync gates only — early return BEFORE any tmp/backup manipulation so a
      // refused save leaves the previous good .kvs + meta intact. The marked
      // tool-prefix path above also avoids all native overwrite operations.
      const ctx = state.context;
      const gate = shouldSaveSession({
        hasContext: Boolean(ctx && state.activeModelId === modelId),
        disposing: state.disposing,
        kvHoldsChatSession: state.kvHoldsChatSession,
        kvReproducible: state.kvReproState.reproducible,
        kvDivergesAtLastExchange: state.kvReproState.divergesAtLastExchange,
        kvPoisoned: state.isContextPoisoned(),
      });
      if (!gate.save) {
        log(false, { reason: gate.reason ?? "no_context" });
        return false;
      }
      // gate.save implies hasContext; re-check for TS narrow + defensive.
      if (!ctx) {
        log(false, { reason: "no_context" });
        return false;
      }
      const stem = activeSessionStem(state, modelId, conversationId, promptEnvHash);
      if (!stem) {
        log(false, { reason: "no_session_key" });
        return false;
      }
      logStemHash = historyHash(stem);
      // The job can start long after the caller queued it, and the lifecycle
      // gate sits in FRONT of the engine chain while a send takes no such gate
      // (streamAssistantTurn goes straight to withEngineJob). So a completion
      // in the new chat can prime the engine for THAT chat while this save
      // waits for the gate — and then this job would write the new chat's KV
      // under this save's stem with this save's history hash. The next open of
      // this chat would match the hash and serve the wrong context. The held KV
      // names the conversation it holds — `holdChatSession` (LlamaService) is
      // the only way to take a hold, so a held KV with NO owner is a state we
      // refuse on rather than guess at. Refuse, and keep the previous good
      // .kvs. Legitimate saves are untouched: the gate above already requires a
      // held KV, and every hold names its conversation.
      if (state.kvHoldsChatSession && state.lastAssembleConvId !== conversationId) {
        log(false, { reason: "kv_moved_on" });
        return false;
      }
      if (!state.activeModelFileId || !state.activeEngineBuild) {
        log(false, { reason: "session_identity_unavailable" });
        return false;
      }
      if (gate.preservePrefix) {
        // Never save the live KV after tools: on LFM2.5/hybrid, the next
        // prompt cannot use partial seq_rm and a restored full-tool KV has no
        // guaranteed checkpoint at the pre-divergence boundary. Keep the
        // previous good prefix instead; its exact native state is resumable.
        const marked = await markSessionDivergesAtLastExchange(stem);
        if (!marked) {
          const logKey = conversationId ?? stem;
          if (kvPrefixUnavailableLoggedKey !== logKey) {
            kvPrefixUnavailableLoggedKey = logKey;
            log(false, { reason: "kv_prefix_unavailable" }, "mark_prefix");
          }
          return false;
        }
        log(true, { reason: "last_exchange_prefix" }, "mark_prefix");
        return true;
      }
      const diskInput = await sessionDiskGateInput(state, modelId);
      const diskCalibration = diskInput.calibration;
      bytesPerToken = diskInput.bytesPerToken;
      usedTokens = resolveSessionDiskTokens(diskInput);
      estimatedBytes =
        usedTokens == null ? 0 : estimateSessionBytes(usedTokens, bytesPerToken ?? undefined);
      // A deferred history is read HERE, not in the caller's tick: the job is
      // already on the FIFO, so the read costs no UI frame, and everything
      // below (fingerprint, meta, log) reads the resolved pair.
      const resolved =
        typeof historyHashValue === "string"
          ? { historyHash: historyHashValue, historyMessageCount }
          : await historyHashValue();
      const savedHistoryHash = resolved.historyHash;
      const savedHistoryCount = resolved.historyMessageCount;
      const saveFingerprint: SessionSaveFingerprint = {
        stem,
        historyHash: savedHistoryHash,
        usedTokens,
        engineBuild: state.activeEngineBuild ?? "",
        conversationId: conversationId ?? "",
      };
      if (
        state.chatKvDiskCurrent &&
        isSameSessionSave(state.lastSuccessfulSessionSave, saveFingerprint)
      ) {
        log(true, { reason: "unchanged" });
        return true;
      }
      const diskDecision = await decideSessionDiskSpace(
        { stem, diskInput },
        { gate: sessionDiskGate, evict: evictSessionPoolForSpace },
      );
      if (!diskDecision.proceed) {
        log(false, diskDecision.log);
        return false;
      }
      const path = sessionFilePath(stem);
      tmpPath = `${path}.tmp`;
      await ensureSessionsDir();
      // Drop any stale tmp from a previous interrupted save.
      try {
        await FileSystem.deleteAsync(tmpPath, { idempotent: true });
      } catch {
        // ignore
      }
      // llama.rn asymmetry (0.12.8): loadSession strips the file:// URI prefix
      // (src/index.ts:645) but saveSession does NOT (:649-655) — the native
      // fopen gets "file:///..." and fails instantly (e2e run 31271420320:
      // save error in 5ms, restore MISS no_meta). Strip it ourselves for the
      // native call only; expo-file-system ops keep the URI form.
      const tokens = await ctx.saveSession(tmpPath.replace(/^file:\/\//, ""));
      if (!sessionNativeSaveCoversNPast(tokens, state.lastChatNPast)) {
        log(false, {
          reason: "native_shorter_than_npast",
          tokens: typeof tokens === "number" ? tokens : -1,
        });
        try {
          await FileSystem.deleteAsync(tmpPath, { idempotent: true });
        } catch {
          // keep previous .kvs
        }
        return false;
      }
      // Replace real file only after a complete tmp write. moveAsync fails if
      // dest exists, and a plain delete-then-move leaves a loss window (kill
      // between the two loses the previous good file — re-verify finding 2).
      // Backup-rename instead: dest → .bak, tmp → dest, drop .bak; on failure
      // restore .bak so the last good restore point always survives.
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
        // Restore the previous good file before propagating to the outer catch.
        if (hadPrevious) {
          try {
            await FileSystem.moveAsync({ from: bakPath, to: path });
          } catch {
            // ignore — worst case cold start
          }
        }
        throw moveError;
      }
      const meta: SessionMeta = {
        formatVersion: SESSION_FORMAT_VERSION,
        modelFileId: state.activeModelFileId,
        engineBuild: state.activeEngineBuild,
        nCtx: state.activeEngineCtx,
        cacheTypeK: state.activeCacheTypeK ?? "",
        cacheTypeV: state.activeCacheTypeV ?? "",
        historyHash: savedHistoryHash,
        savedAt: Date.now(),
      };
      if (
        typeof savedHistoryCount === "number" &&
        Number.isInteger(savedHistoryCount) &&
        savedHistoryCount >= 0 &&
        Number.isFinite(savedHistoryCount)
      ) {
        meta.historyMessageCount = savedHistoryCount;
      }
      if (promptEnvHash !== undefined) meta.promptEnvHash = promptEnvHash;
      if (state.activeMtpNMax !== undefined) meta.mtpNMax = state.activeMtpNMax;
      if (state.activeSpecType !== undefined) meta.specType = state.activeSpecType;
      if (state.activeEngineKnob !== undefined) meta.engineKnob = state.activeEngineKnob;
      if (conversationId) meta.conversationId = conversationId;
      if (BAKE_FORMAT_B_USER_PREFIX && state.bakedUserTails.length > 0) {
        meta.bakedUserTails = state.bakedUserTails;
      }
      // Omit when unknown: a fabricated 0 would hand the next restore a false
      // "KV starts at the full transcript" fact. Missing reads as unknown and
      // the held+unknown send reconciles (clears) first.
      if (state.lastAssembleBoundary !== undefined) {
        meta.assembleBoundary = state.lastAssembleBoundary;
      }
      // Meta after rename, before dropping .bak: a failed meta write must not
      // report success, and the .kvs without meta must not stay (F4).
      if (!(await writeSessionMeta(stem, meta))) {
        try {
          await FileSystem.deleteAsync(path, { idempotent: true });
        } catch {
          // ignore
        }
        if (hadPrevious) {
          try {
            await FileSystem.moveAsync({ from: bakPath, to: path });
          } catch {
            // ignore — worst case cold start
          }
        }
        log(false, { reason: "meta_write" });
        return false;
      }
      try {
        const fileInfo = await FileSystem.getInfoAsync(path);
        const nextCalibration = recordSessionDiskSample(diskCalibration, {
          ok: true,
          modelId,
          fileBytes:
            "size" in fileInfo && typeof fileInfo.size === "number"
              ? fileInfo.size
              : undefined,
          usedTokens: tokens,
          knownBytesPerToken: registrySessionBytesPerToken(
            modelId,
            state.activeCacheTypeK,
            state.activeCacheTypeV,
          ),
          cacheTypeK: state.activeCacheTypeK,
          cacheTypeV: state.activeCacheTypeV,
        });
        if (nextCalibration !== diskCalibration) {
          await saveSessionDiskCalibration(nextCalibration);
        }
      } catch {
        // Calibration is best-effort; the successful session remains valid.
      }
      try {
        await FileSystem.deleteAsync(bakPath, { idempotent: true });
      } catch {
        // ignore
      }
      await touchSessionUse(stem);
      const budgetBytes = await readSessionPoolBudgetBytes();
      await evictSessionPool(stem, budgetBytes);
      await deleteLegacyModelSession(modelId);
      if (!(await sessionFileExists(stem))) {
        log(false, { reason: "evicted" });
        return false;
      }
      state.chatKvDiskCurrent = true;
      noteChatNPast(state, tokens);
      const successfulUsedTokens =
        resolveSessionDiskTokens({ nPast: state.lastChatNPast, nCtx: state.activeEngineCtx }) ??
        saveFingerprint.usedTokens;
      state.lastSuccessfulSessionSave = rememberSuccessfulSessionSave(
        state.lastSuccessfulSessionSave,
        { ...saveFingerprint, usedTokens: successfulUsedTokens },
        true,
      );
      log(true, {
        tokens: typeof tokens === "number" ? tokens : 0,
        hash: savedHistoryHash,
        ...(meta.historyMessageCount !== undefined
          ? { messageCount: meta.historyMessageCount }
          : {}),
      });
      return true;
    } catch (error) {
      const reason = sessionErrorReason(error);
      // kv_inconsistent et al. are the protocol's own refusals (the .kvs is
      // kept on purpose); only an unexpected class warns, once per process.
      warnUnexpectedSessionFailure("[saveEngineSession]", reason);
      // Failed save: delete ONLY the tmp. Leave previous .kvs + meta intact.
      if (tmpPath) {
        try {
          await FileSystem.deleteAsync(tmpPath, { idempotent: true });
        } catch {
          // ignore
        }
      }
      log(false, { reason });
      return false;
    }
  }),
  );
}
