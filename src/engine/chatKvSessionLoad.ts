import {
  buildKvDiagPayload, computeHistoryHashFromMessages,
  deleteSessionArtifacts, getSessionConversationId,
  historyHash, promoteSessionBak,
  readBootMessages, readSessionMeta,
  sessionAssembleBoundary, sessionFileExists,
  sessionFilePath, sessionHistoryPrefixAccepts,
  sessionLoadHasTokens, sessionMetaMismatchField,
  SESSION_FORMAT_VERSION, shouldDeleteSessionArtifactsOnLoadFailure,
  warnUnexpectedSessionFailure, type SessionMeta,
} from "./sessionPersistence";
import {
  legacySessionStem, sessionStem,
} from "./sessionKey";
import {
  discardStaleConversationSessions, touchSessionUse,
} from "./sessionPool";
import { historyWindowReproducesKv } from "./modelEmittedText";
import { BAKE_FORMAT_B_USER_PREFIX } from "./ttftFlags";
import { parseBakedUserTails } from "./memoryFactsTail";
import {
  noteChatNPast, sessionErrorReason,
} from "./chatKvSessionShared";
import type { ChatKvSessionState } from "./chatKvSessionState";

/** Read a .kvs back into a live engine: the init restore and the chat-switch restore share these gates. */
/**
 * Attempt to restore native KV. Called from initEngine (lock held) and from
 * restoreChatKvSession on conversation switch. Never throws.
 */
export async function loadChatKvSession(
  state: ChatKvSessionState,
  modelId: string,
  expected: {
    historyHash: string;
    promptEnvHash?: string;
    modelFileId: string;
    engineBuild: string;
    nCtx: number;
    cacheTypeK: string;
    cacheTypeV: string;
    mtpNMax?: number;
    specType?: string;
    engineKnob?: string;
    conversationId?: string;
  },
): Promise<boolean> {
  const t0 = Date.now();
  let loadOk = false;
  const heldChatKvAtEntry = state.kvHoldsChatSession;
  let tokensLoaded: unknown;
  let logStemHash: string | null = null;
  const log = (ok: boolean, extra?: Record<string, number | boolean | string>) => {
    try {
      console.log(
        `KALSA_SESSION ${JSON.stringify({
          op: "load",
          ms: Date.now() - t0,
          ok,
          tokensOnDisk: buildKvDiagPayload({ ok, tokensLoaded }).tokens_on_disk,
          ...extra,
          ...(logStemHash ? { stemHash: logStemHash } : {}),
        })}`,
      );
    } catch {
      // telemetry must never throw
    }
  };
  let loadStem: string | null = null;
  const emitKvDiag = () => {
    try {
      console.log(
        "KALSA_KVDIAG",
        JSON.stringify(
          buildKvDiagPayload({ ok: loadOk, tokensLoaded }),
        ),
      );
    } catch {
      // never throw
    }
  };
  try {
    if (!state.context) {
      log(false, { reason: "no_context" });
      return false;
    }
    const convId = expected.conversationId ?? getSessionConversationId();
    const envHash = expected.promptEnvHash ?? state.lastPromptEnvHash;
    const stem = convId && envHash ? sessionStem(modelId, convId, envHash) : null;
    if (!stem) {
      log(false, { reason: "no_session_key" });
      return false;
    }
    logStemHash = historyHash(stem);
    const staleDropped = convId
      ? await discardStaleConversationSessions(modelId, convId, envHash ?? "")
      : 0;
    loadStem = stem;
    if (!(await sessionFileExists(stem))) {
      const recovered = await promoteSessionBak(stem);
      if (!recovered) {
        const orphanMeta = await readSessionMeta(stem);
        if (orphanMeta) await deleteSessionArtifacts(stem);
        if (staleDropped > 0) {
          log(false, { reason: "meta_mismatch:promptEnvHash" });
          return false;
        }
        const legacy = legacySessionStem(modelId);
        const legacyFile = legacy ? await sessionFileExists(legacy) : false;
        const legacyMeta = legacyFile && legacy ? await readSessionMeta(legacy) : null;
        const expectedConv =
          typeof convId === "string" && convId.length > 0 ? convId : "";
        const legacyConv =
          legacyMeta &&
          typeof legacyMeta.conversationId === "string" &&
          legacyMeta.conversationId.length > 0
            ? legacyMeta.conversationId
            : "";
        // Wrong-conversation legacy must stay on disk — deleting it would drop
        // the only pre-pool restore point when switching chats after upgrade.
        if (!legacy || !legacyFile || !legacyMeta || legacyConv !== expectedConv) {
          log(false, { reason: "no_file" });
          return false;
        }
        loadStem = legacy;
        logStemHash = historyHash(legacy);
      }
    }
    const stored = await readSessionMeta(loadStem);
    if (!stored) {
      log(false, { reason: "no_meta" });
      return false;
    }
    if (!(await sessionFileExists(loadStem))) {
      await deleteSessionArtifacts(loadStem);
      log(false, { reason: "no_file" });
      return false;
    }
    // Non-history fields only: force historyHash equal on both sides so
    // sessionMetaMismatchField does not double-check history (prefix check below).
    const historySentinel = "__prefix_history_skip__";
    const storedForConfig: SessionMeta = {
      ...stored,
      historyHash: historySentinel,
    };
    const expectedMeta: SessionMeta = {
      formatVersion: SESSION_FORMAT_VERSION,
      modelFileId: expected.modelFileId,
      engineBuild: expected.engineBuild,
      nCtx: expected.nCtx,
      cacheTypeK: expected.cacheTypeK,
      cacheTypeV: expected.cacheTypeV,
      historyHash: historySentinel,
    };
    if (expected.promptEnvHash !== undefined) {
      expectedMeta.promptEnvHash = expected.promptEnvHash;
    }
    if (expected.mtpNMax !== undefined) expectedMeta.mtpNMax = expected.mtpNMax;
    if (expected.specType !== undefined) expectedMeta.specType = expected.specType;
    if (expected.engineKnob !== undefined) expectedMeta.engineKnob = expected.engineKnob;
    if (expected.conversationId) expectedMeta.conversationId = expected.conversationId;
    const mismatchField = sessionMetaMismatchField(storedForConfig, expectedMeta);
    if (mismatchField !== null) {
      state.bakedUserTails = [];
      state.bakeUnprefixedHealed = false;
      await deleteSessionArtifacts(loadStem);
      // Field name only (enum-like) — attributable cold starts: historyHash =
      // save missed/raced; promptEnvHash = locale (or legacy facts-in-system)
      // changed (semantically correct cold); nCtx/KV = config change.
      log(false, {
        reason: `meta_mismatch:${mismatchField}`,
      });
      return false;
    }
    // Prefix-aware history: saved hash may be a strict prefix of boot messages
    // (new user turn already persisted before ensureEngine restore).
    const bootMessages = await readBootMessages();
    const historyCheck = sessionHistoryPrefixAccepts(stored, bootMessages);
    if (!historyCheck.accept) {
      await deleteSessionArtifacts(loadStem);
      const bootHash = computeHistoryHashFromMessages(bootMessages);
      log(false, {
        reason: `meta_mismatch:${historyCheck.reason}`,
        ...(historyCheck.reason === "historyHash"
          ? { metaHash: stored.historyHash, bootHash }
          : {}),
      });
      return false;
    }
    // Byte-identity gate: refuse when the prefix cannot re-render the KV
    // (legacy assistant without modelEmittedText, interrupted without capture).
    const prefixCount =
      typeof stored.historyMessageCount === "number"
        ? stored.historyMessageCount
        : bootMessages.length;
    const reproCheck = historyWindowReproducesKv(
      bootMessages.slice(0, Math.max(0, prefixCount)),
    );
    if (!reproCheck.accept) {
      if (shouldDeleteSessionArtifactsOnLoadFailure(reproCheck.reason)) {
        await deleteSessionArtifacts(loadStem);
      }
      log(false, { reason: `meta_mismatch:${reproCheck.reason}` });
      return false;
    }
    // llama.rn 0.12.8: loadSession strips file://; saveSession does not.
    // Pass the URI form here — do not strip.
    const result = await state.context.loadSession(sessionFilePath(loadStem));
    tokensLoaded = result?.tokens_loaded;
    if (!sessionLoadHasTokens(result)) {
      state.bakedUserTails = [];
      state.bakeUnprefixedHealed = false;
      await state.dropHoldAfterOptionalNativeClear(state.context);
      await deleteSessionArtifacts(loadStem);
      log(false, { reason: "tokens_loaded:0" });
      return false;
    }
    state.kvHoldsChatSession = true;
    state.chatKvDiskCurrent = true;
    noteChatNPast(state, result?.tokens_loaded);
    // Missing meta.assembleBoundary reads as unknown (not 0): the restored KV
    // is held with no start fact, so the next send reconciles before assembly.
    state.lastAssembleBoundary = sessionAssembleBoundary(stored);
    state.lastAssembleConvId = convId ?? "";
    // A factual restore supersedes any in-memory reconcile attempt.
    state.attemptedAssembleStart = undefined;
    state.attemptedAssembleConvId = undefined;
    // Keep lastPromptEnvHash aligned with the restored KV for a later save.
    state.lastPromptEnvHash =
      stored.promptEnvHash ?? expected.promptEnvHash ?? state.lastPromptEnvHash;
    state.bakedUserTails = BAKE_FORMAT_B_USER_PREFIX
      ? parseBakedUserTails(stored.bakedUserTails)
      : [];
    state.bakeUnprefixedHealed = true;
    loadOk = true;
    await touchSessionUse(stem);
    if (loadStem !== stem) await touchSessionUse(loadStem);
    log(true, {
      tokens: typeof result?.tokens_loaded === "number" ? result.tokens_loaded : 0,
    });
    return true;
  } catch (error) {
    const reason = sessionErrorReason(error);
    // Same rule as the save: the expected refusal classes stay on the
    // structured line, an unexpected class warns once per process.
    warnUnexpectedSessionFailure("[tryLoadEngineSession]", reason);
    state.bakedUserTails = [];
    state.bakeUnprefixedHealed = false;
    await state.dropHoldAfterOptionalNativeClear(state.context);
    if (shouldDeleteSessionArtifactsOnLoadFailure(reason) && loadStem) {
      await deleteSessionArtifacts(loadStem);
    }
    log(false, { reason });
    return false;
  } finally {
    if (!loadOk) {
      state.bakeUnprefixedHealed = false;
      if (heldChatKvAtEntry) {
        await state.dropHoldAfterOptionalNativeClear(state.context);
      }
    }
    emitKvDiag();
  }
}

/**
 * Load the active conversation's session into a live engine (chat switch).
 * Same gates as init restore. Never throws.
 */
export async function restoreChatKvSession(
  state: ChatKvSessionState,
  modelId: string,
): Promise<boolean> {
  if (!modelId) return false;
  return state.withLifecycleLock(() =>
    state.withEngineJob(async () => {
      if (!state.context || state.activeModelId !== modelId) return false;
      state.lastCompletionPromptEnvHash = undefined;
      state.lastCompletionPromptEnvInputs = undefined;
      return loadChatKvSession(state, modelId, {
        historyHash: "",
        promptEnvHash: state.lastPromptEnvHash,
        modelFileId: state.activeModelFileId ?? "",
        engineBuild: state.activeEngineBuild ?? "",
        nCtx: state.activeEngineCtx,
        cacheTypeK: state.activeCacheTypeK ?? "",
        cacheTypeV: state.activeCacheTypeV ?? "",
        mtpNMax: state.activeMtpNMax,
        specType: state.activeSpecType,
        engineKnob: state.activeEngineKnob,
        conversationId: getSessionConversationId(),
      });
    }),
  );
}
