/**
 * The engine load path — `ensureEngineForModel`, lifted from the old
 * controller. The thermal/generation preamble and the catch stay here; the
 * gate/fallback/init middle is `performEngineLoad` (`engineEnsureLoad.ts`),
 * because 446 lines cannot live under the 350 rule. The single ref assignment
 * belongs to the host root, which rebinds it every render as the old
 * component did.
 *
 * Dropped with a report (set-only or unmountable here): `bumpEmbedJobGeneration`
 * (no background embed pipeline), `setMemoryBannerKey` (no reader — PARITY D2
 * row 18), `setProcessUnloadedReason` (its hook is not mounted in this root).
 */
import { getPlatformThermalHardGate } from "../engine/platformThermalStatus";
import { MODEL_REGISTRY, type ModelInfo } from "../engine/ModelRegistry";
import { isModelBundleDownloaded } from "../engine/ModelDownloader";
import { readUserContextSize } from "../engine/contextSizePref";
import { readKvCacheChoice } from "../engine/kvCachePref";
import { getBenchNCtx, getBenchNoRepack, getEngineOverride } from "../bench/benchConfig";
import {
  isEngineReady,
  getActiveModelId,
  queueStaticPrefixPrewarm,
} from "../engine/LlamaService";
import { getCachedDeviceProfile, getFreeDiskBytes } from "../engine/deviceProfile";
import { setCoResidencyContext, isChatModel2BClass, tryAcquireChat, getState as getLlamaContextGateState } from "../engine/llamaContextGate";
import { gateForModel, gateReasonMessage, profileWithFreshMemory, releaseEmbedderBounded, rawErrorDetail } from "./engineGateHelpers";
import { isEngineLostRecovery } from "../engine/LlamaService";
import { friendlyNetworkError } from "../engine/ModelDownloader";
import { writeLastGoodModelId } from "../engine/loadMarker";
import { markChatReleased } from "../engine/llamaContextGate";
import { isEmbedderHung } from "../engine/EmbeddingService";
import { loadMarkerStore } from "./engineLoad";
import { performEngineLoad } from "./engineEnsureLoad";
import type { EngineLoadDeps } from "./engineLoad";

export async function ensureEngineForModel(
  deps: EngineLoadDeps,
  model: ModelInfo,
): Promise<boolean> {
  const {
    t,
    locale,
    thermalHardGateRef,
    engineGenerationRef,
    modelIndexRef,
    chatGateGenRef,
    modelStateRef,
    agentOptionsRef,
    deviceBandwidth,
    setModelState,
    setModelError,
    setModelErrorKind,
    setModelErrorDetail,
  } = deps;
    // C3 — refuse every model load while the OS is at platform CRITICAL. The
    // ref closes the event-to-render race; the query covers a transition that
    // arrived before the listener was attached.
    if (thermalHardGateRef.current) return false;
    try {
      if (await getPlatformThermalHardGate()) {
        thermalHardGateRef.current = true;
        return false;
      }
    } catch {
      // The platform reader is fail-open; an unavailable API never blocks.
    }
    if (thermalHardGateRef.current) return false;
    // Capture generation + expected model BEFORE any await (race with selectModel).
    const generation = engineGenerationRef.current;
    const expectedModelId = model.id;
    const stillCurrent = () =>
      generation === engineGenerationRef.current &&
      MODEL_REGISTRY[modelIndexRef.current]?.id === expectedModelId;

    if (isEngineReady() && getActiveModelId() === model.id) {
      queueStaticPrefixPrewarm(locale, agentOptionsRef.current.tools);
      return true;
    }
    // If the embedder is hung, refuse immediately — never reach
    // acquire/submit. markEmbedderHung clears the lifecycle gate to idle, so a
    // retry could re-acquire chat, skip release (hung short-circuit), and
    // enqueue initEngine forever behind the hung native op. Recovery =
    // process restart; repeated retries are no-ops (no FIFO growth).
    if (isEmbedderHung()) {
      setModelState("error");
      setModelErrorKind("engine");
      setModelError(t("embedding.busy"));
      setModelErrorDetail(null);
      return false;
    }
    // Both init-time choices are read once per load attempt, so the RAM gate,
    // the resolved profile and the engine init below cannot disagree — and the
    // bench override is read here too: the gate must charge what init will.
    const userNCtx = await readUserContextSize(model.contextLength);
    const kvCache = await readKvCacheChoice();
    const benchNCtx = await getBenchNCtx();
    // bench:engine belongs to the load mode the gate prices; reused below by initEngine.
    const engineOverride = await getEngineOverride();
    // Ownership token acquired by THIS ensure call (null until tryAcquireChat).
    // Catch must only release this gen — never a previous owner's.
    const acquiredChatGen: { value: number | null } = { value: null };
    // Disk probe can throw on rare FS errors — keep it inside try so bar/Settings
    // void-retry sites never produce an unhandled rejection.
    try {
      if (!(await isModelBundleDownloaded(model))) return false;
      if (!stillCurrent()) return false;
      if (thermalHardGateRef.current) return false;

      // Hard RAM gate before initEngine. Never force-evict the currently active
      // model (if this model is already active and ready we returned above).
      // Also seed llamaContextGate co-residency inputs while we have the profile
      // (sync tryAcquireChat below must not await for RAM).
      let totalMemKnown = 0;
      try {
        const [profile, free] = await Promise.all([
          // "tap to retry" must re-sample memory: the profile cache holds one
          // sample for the process (deviceProfile.ts `cachedProfilePromise`),
          // so without this the retry re-runs the verdict against the same
          // number. Same uncached MemAvailable the load gate's fit probe uses.
          getCachedDeviceProfile().then(profileWithFreshMemory),
          getFreeDiskBytes(),
        ]);
        if (!stillCurrent()) return false;
        totalMemKnown = profile.totalMemoryBytes ?? 0;
        setCoResidencyContext({
          totalMemoryBytes: totalMemKnown,
          chatModelIs2B: isChatModel2BClass(model.id),
        });
        // Gate on the load mode initEngine will really use, not on a fixed one.
        const gate = gateForModel(
          model,
          profile,
          free,
          true,
          await getBenchNoRepack(),
          deviceBandwidth,
          kvCache,
          benchNCtx ?? userNCtx ?? undefined,
          engineOverride?.useMmap,
        );
        // Refuse load for blocked_ram / blocked_tier (disk is a download-time
        // gate). Active-model exception: already handled by the early ready
        // return; kept explicit for safety.
        if (
          !gate.allowed &&
          (gate.reason === "blocked_ram" || gate.reason === "blocked_tier") &&
          getActiveModelId() !== model.id
        ) {
          // Lost-engine recovery: leftover MemAvailable is the P0 trap.
          // Reload is what brings the bytes back; do not hard-block on RAM.
          if (
            gate.reason === "blocked_ram" &&
            isEngineLostRecovery(model.id)
          ) {
            // fall through — scoped to the model that was marked lost
          } else {
            setModelState("error");
            setModelErrorKind("engine");
            setModelError(gateReasonMessage(gate.reason, t));
            setModelErrorDetail(null);
            return false;
          }
        }
      } catch {
        // Probe failure → fall through to existing load path (no hard block).
        // Still seed model class so 4B cannot co-reside even if RAM unknown.
        setCoResidencyContext({ chatModelIs2B: isChatModel2BClass(model.id) });
      }

      // Shared llamaContextGate: tryAcquireChat SYNCHRONOUSLY before the first
      // await of the init flow (closes the loading window). The stale-
      // release guard: ownership token (chatGen) — a stale markChatReleased
      // cannot idle a newer load; embedder release is bounded, and runs only
      // when co-residency is NOT allowed (≤6 GB OR 4B chat model).

      // Synchronous co-residency seed: model id + any RAM already known above.
      const modelIs2B = isChatModel2BClass(model.id);
      setCoResidencyContext({ chatModelIs2B: modelIs2B });

      // Synchronous chat-loading claim — MUST precede any further await so the
      // embedder cannot initLlama concurrently during the loading window.
      // Returns a generation token; null when refused (embed_active without
      // co-res, or already chat_loading/chat_ready — double-load backstop).
      let chatGen = tryAcquireChat();
      if (chatGen === null) {
        // Already loading/ready: refuse double-load rather than steal ownership
        // (gate is the backstop).
        const gateState = getLlamaContextGateState();
        if (gateState === "chat_loading" || gateState === "chat_ready") {
          return false;
        }
        // Embedder holds the native slot and co-residency is off — bounded
        // release then re-claim. On timeout, mark hung and refuse chat init
        // (never clear the native-op chain / never force handoff — a hung op
        // holds the barrier until process restart).
        const releaseOutcome = await releaseEmbedderBounded();
        if (!stillCurrent()) {
          return false;
        }
        if (releaseOutcome === "timeout") {
          // Embedder hung, native op still sole owner of the barrier: surface
          // the busy state; recovery = process restart.
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(t("embedding.busy"));
          setModelErrorDetail(null);
          return false;
        }
        chatGen = tryAcquireChat();
        if (chatGen === null) {
          // Still blocked — refuse chat load rather than race the embedder.
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(t("errors.engineInitFailed"));
          setModelErrorDetail(null);
          return false;
        }
      }
      acquiredChatGen.value = chatGen;
      chatGateGenRef.current = chatGen;

      // Boot-loop defence gate — run AFTER acquisition, deliberately. The
      // single-owner invariant does the work: a duplicate ensure is refused by
      // tryAcquireChat before it can read the marker, so the marker keeps one
      // meaning — a load from a PREVIOUS process that never finished. Read
      // before acquisition, a duplicate could see this process's own in-flight
      // marker, report a false death, and re-route a load that was succeeding.
      // The fit evaluation is the send path's own (decidePreSendFit, via
      // gateModelLoad), on the LOAD path; a resident model different from the
      // target is disposed first (bounded) so the gate never refuses on memory
      // held by the model it is about to replace; same model → no dispose.
      //
      // Accepted cost of this order: the co-residency seed above is a
      // PRECONDITION of tryAcquireChat — it decides whether the acquire is
      // allowed at all — so it cannot move after the gate, and the gate cannot
      // move before the acquisition without reintroducing the self-read of the
      // in-flight marker.
      if (
        !(await performEngineLoad(
          deps,
          model,
          chatGen,
          stillCurrent,
          { kvCache, benchNCtx, userNCtx, engineOverride, modelIs2B, totalMemKnown },
          acquiredChatGen,
        ))
      ) {
        return false;
      }
      // End-based clear too: two concurrent ensures (double-tap in the probe
      // window) where the first fails and the second succeeds must not leave
      // "Ready" coexisting with a stale red banner.
      setModelError(null);
      setModelErrorDetail(null);
      setModelErrorKind(null);
      // Load succeeded: this model becomes the boot fallback (last good load).
      // The death marker is already gone — guardedLoad cleared it on settle.
      await writeLastGoodModelId(loadMarkerStore, model.id).catch(() => undefined);
      queueStaticPrefixPrewarm(locale, agentOptionsRef.current.tools);
      return true;
    } catch (error) {
      // Init failure → release only the gen THIS call acquired.
      if (acquiredChatGen.value !== null) {
        markChatReleased(acquiredChatGen.value);
        if (chatGateGenRef.current === acquiredChatGen.value) chatGateGenRef.current = null;
      }
      if (!stillCurrent()) return false;
      setModelState("error");
      modelStateRef.current = "error";
      setModelErrorKind("engine");
      setModelError(friendlyNetworkError(error, locale, "engine").message);
      setModelErrorDetail(rawErrorDetail(error));
      return false;
    }
}
