/**
 * The load attempt itself: gate verdict → refusal + fallback → final RAM
 * gate → co-residency release → guarded native init → ready. Lifted from
 * `ensureEngineForModel` (`AppShell.tsx:4193-4417`), which keeps its own
 * thermal/generation preamble and its catch.
 *
 * Adaptations (reported): `acquiredChatGen` becomes a holder object shared
 * with the catch in `ensureEngineForModel` (the old code shared a `let`
 * through one closure); the 38-line refusal fallback is one call to
 * `runLoadFallback`; `modelIs2B` / `totalMemKnown` / the init-time choices
 * cross the seam through `initInputs`. The background-embed bump the old
 * comment carried went with the embed pipeline this host does not mount.
 */
import type { ModelInfo } from "../engine/ModelRegistry";
import { getCachedDeviceProfile } from "../engine/deviceProfile";
import { modelLocalPath } from "../engine/ModelDownloader";
import { readUserContextSize } from "../engine/contextSizePref";
import { readKvCacheChoice } from "../engine/kvCachePref";
import {
  getBenchNCtx,
  getBlockFormat,
  getEngineOverride,
  getSpeculativeOverride,
} from "../bench/benchConfig";
import {
  initEngine,
  type EngineTurnOptions,
} from "../engine/LlamaService";
import { computeSessionPromptEnvHash } from "../engine/sessionPromptEnv";
import { getBootHistoryHash } from "../engine/sessionPersistence";
import {
  allowsCoResidency,
  isChatModel4BClass,
  markChatReady,
  markChatReleased,
  nativeOpBusy,
  setCoResidencyContext,
  runNativeOpBounded,
  CO_RESIDENCY_MIN_MEMORY_BYTES,
} from "../engine/llamaContextGate";
import { resolveContextProfile } from "../engine/contextProfile";
import { guardedLoad } from "../engine/loadMarker";
import {
  EMBEDDER_RELEASE_TIMEOUT_MS,
  isEmbedderHung,
  markEmbedderHung,
} from "../engine/EmbeddingService";
import { releaseEmbedderBounded, warnIfNativePatchesInactive } from "./engineGateHelpers";
import {
  evaluateLoadGate,
  loadMarkerStore,
  reportLoadRefusal as reportLoadRefusalFn,
  runLoadFallback,
  type EngineLoadDeps,
} from "./engineLoad";

/** The values `ensureEngineForModel` resolves once per load attempt and the
 *  attempt reads synchronously through its own phase. */
interface InitInputs {
  kvCache: Awaited<ReturnType<typeof readKvCacheChoice>>;
  benchNCtx: Awaited<ReturnType<typeof getBenchNCtx>>;
  userNCtx: Awaited<ReturnType<typeof readUserContextSize>>;
  engineOverride: Awaited<ReturnType<typeof getEngineOverride>>;
  modelIs2B: boolean;
  totalMemKnown: number;
}

export async function performEngineLoad(
  deps: EngineLoadDeps,
  model: ModelInfo,
  chatGen: number,
  stillCurrent: () => boolean,
  initInputs: InitInputs,
  acquiredChatGen: { value: number | null },
): Promise<boolean> {
  const {
    t,
    locale,
    agentOptions,
    conversationsRef,
    deviceBandwidth,
    thermalHardGateRef,
    modelStateRef,
    chatGateGenRef,
    chatEngineCtxRef,
    setChatEngineCtx,
    setModelState,
    setModelError,
    setModelErrorKind,
    setModelErrorDetail,
  } = deps;
  const { kvCache, benchNCtx, userNCtx, engineOverride, modelIs2B, totalMemKnown } = initInputs;
  const reportLoadRefusal = (m: ModelInfo, v: Parameters<typeof reportLoadRefusalFn>[2], s: string) =>
    reportLoadRefusalFn(deps, m, v, s);
      const gateVerdict = await evaluateLoadGate(model);
      if (!gateVerdict.allow) {
        // Refusal releases THIS gen before reporting/falling back — the
        // fallback's own ensure needs the free slot. acquiredChatGen is nulled
        // so the catch below cannot release it twice.
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        acquiredChatGen.value = null;
        await reportLoadRefusal(model, gateVerdict, "ensure");
        // Fallback once: last good load, else the default — never the model
        // that just failed, never a marked one (a fallback passes the same
        // marker check as the primary), never a second hop. Null → the
        // refusal message above stands alone; nothing loads.
        await runLoadFallback(deps, model);
        return false;
      }

      setModelState("loading");
      modelStateRef.current = "loading";
      setModelError(null);
      setModelErrorDetail(null);
      setModelErrorKind(null);

      // Prefer RAM already known from the hard-gate probe; re-fetch only if missing.
      let totalMem = totalMemKnown;
      if (totalMem <= 0) {
        try {
          const profile = await getCachedDeviceProfile();
          totalMem = profile.totalMemoryBytes ?? 0;
        } catch {
          totalMem = 0;
        }
        if (!stillCurrent()) {
          markChatReleased(chatGen);
          if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
          return false;
        }
      }
      setCoResidencyContext({
        totalMemoryBytes: totalMem,
        chatModelIs2B: modelIs2B,
      });

      // §5 co-residency: release embedder before chat init ONLY when
      // (totalMemoryBytes ≤ 6e9) OR (chat model is 4B-class).
      // FIX 2 / round 7 BLOCK: on timeout, refuse chat init (hung holds barrier).
      const mustReleaseEmbed =
        totalMem <= 0 ||
        totalMem <= CO_RESIDENCY_MIN_MEMORY_BYTES ||
        isChatModel4BClass(model.id) ||
        !allowsCoResidency();
      if (mustReleaseEmbed) {
        const midRelease = await releaseEmbedderBounded();
        if (midRelease === "timeout") {
          markChatReleased(chatGen);
          if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(t("embedding.busy"));
          setModelErrorDetail(null);
          return false;
        }
      }
      if (!stillCurrent()) {
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        return false;
      }

      const mmprojPath = model.mmproj ? modelLocalPath(model, model.mmproj.file) : null;
      // Resolve once here (V4.2 §Fase 0.5): catalog n_ctx (no silent downgrade)
      // + optional high-RAM upgrade for hybrids + catalog-authoritative KV.
      // initEngine does not re-resolve — pass nCtx and cache types explicitly.
      // Bench nctx still outranks the Settings choice.
      const profile = resolveContextProfile({
        hybrid: model.hybrid,
        kvCache: kvCache ?? model.kvCache,
        catalogCtx: model.engineCtx,
        explicitNCtx: benchNCtx ?? userNCtx ?? undefined,
      });
      const speculativeOverride = await getSpeculativeOverride();
      // Boot-captured HISTORY_KEY hash: conversation start, not mid-send (lazy
      // engine init would otherwise hash after the user turn is already persisted).
      const sessionHistoryHash = await getBootHistoryHash();
      // Tool names + blockFormat must match streamAssistantTurn (F6).
      // Facts on the user tail must not enter this hash or a new fact
      // cold-starts the entire KV prefix (MEMORY_FACTS_ON_USER_TAIL).
      const blockFormat = await getBlockFormat();
      const sessionPromptEnvHash = await computeSessionPromptEnvHash({
        locale,
        tools: agentOptions.tools,
        executeTool: agentOptions.executeTool,
        blockFormat,
      });
      if (!stillCurrent()) {
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        return false;
      }
      // Round 9: atomic check-and-submit (runNativeOpBounded). Emptiness check
      // and enqueue run in one synchronous block under the JS event loop — never
      // observe free then separately submit (race that could append behind a
      // newly-hung foreign op). Timeout refuses WITHOUT enqueueing.
      // Re-check hung + stillCurrent first (cheap; no enqueue risk).
      if (isEmbedderHung()) {
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        setModelState("error");
        setModelErrorKind("engine");
        setModelError(t("embedding.busy"));
        setModelErrorDetail(null);
        return false;
      }
      if (!stillCurrent()) {
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        return false;
      }
      if (thermalHardGateRef.current) {
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        return false;
      }
      // Death marker lifecycle (guardedLoad): written before the native init
      // starts, cleared the moment this code observes ANY outcome. A marker
      // that reaches the next launch means the process died mid-load and
      // never reached its own error handler — every survived failure clears.
      const boundedInit = await guardedLoad(loadMarkerStore, model.id, () =>
        runNativeOpBounded(
          () =>
            initEngine(modelLocalPath(model, model.file), model.id, {
              mmprojPath,
              nCtx: profile.nCtx,
              cacheTypeK: profile.cacheTypeK,
              cacheTypeV: profile.cacheTypeV,
              kvUnified: model.kvUnified,
              mtpNMax: model.mtp?.nMax,
              mtpDefaultOn: model.mtp?.defaultEnabled === true,
              speculativeOverride,
              engineOverride,
              sessionRestore: {
                historyHash: sessionHistoryHash,
                promptEnvHash: sessionPromptEnvHash,
                conversationId: conversationsRef.current.activeId || undefined,
              },
              locale,
            }),
          EMBEDDER_RELEASE_TIMEOUT_MS,
        ),
      );
      if (!boundedInit.ok) {
        markEmbedderHung();
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        setModelState("error");
        setModelErrorKind("engine");
        setModelError(t("embedding.busy"));
        setModelErrorDetail(null);
        console.warn(
          `[kalsa] runNativeOpBounded timed out after ${EMBEDDER_RELEASE_TIMEOUT_MS}ms (nativeOpBusy=${nativeOpBusy()}); chat init blocked — restart to recover`,
        );
        return false;
      }
      const initResult = boundedInit.value;
      if (!stillCurrent()) {
        // Stale app generation after success: release THIS chatGen only so a
        // newer load's gate is not idled (FIX 1 ownership token).
        markChatReleased(chatGen);
        if (chatGateGenRef.current === chatGen) chatGateGenRef.current = null;
        return false;
      }
      // Propagate effective n_ctx (post memory-clamp) so document strategy and
      // long-chat UI budget match the loaded engine — not the pre-clamp catalog.
      // Single source: engine init → chatEngineCtxRef / chatEngineCtx state →
      // getCtxTokens + AiChatPage engineCtx prop.
      const effective = initResult.effectiveNCtx;
      chatEngineCtxRef.current = effective;
      setChatEngineCtx(effective);
      warnIfNativePatchesInactive(initResult.systemInfo);
      setModelState("ready");
      modelStateRef.current = "ready";
      // FIX B / FIX 1: chat context resident — only if we still own this gen.
      markChatReady(chatGen);
      // The gen is consumed: the catch below must never release a READY gen —
      // that would drive the gate chat_ready → idle with the native context
      // alive. Nothing between here and return is known to throw today, so
      // this closes the shape; it does not fix a witnessed crash.
      acquiredChatGen.value = null;
  return true;
}
