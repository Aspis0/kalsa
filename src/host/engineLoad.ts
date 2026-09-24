/**
 * The load gate's evaluation, its refusal report and the once-only fallback
 * picker — plus this host's copy of the marker store. `evaluateLoadGate`
 * takes no deps: the original captured none either — every input is a
 * module service.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MODEL_REGISTRY, getDefaultModel, type ModelInfo } from "../engine/ModelRegistry";
import { isModelBundleDownloaded } from "../engine/ModelDownloader";
import {
  gateModelLoad,
  loadGateFitModel,
  refusalMessageKey,
  smallerModelExists,
  type LoadGateVerdict,
  type LoadRefusal,
} from "../engine/loadGate";
import {
  hasOtherDownloadedModel,
  pickFallbackModel,
  readLastGoodModelId,
  readLoadMarker,
  type LoadMarkerStore,
} from "../engine/loadMarker";
import { readUserContextSize } from "../engine/contextSizePref";
import { readKvCacheChoice } from "../engine/kvCachePref";
import { getBenchNCtx, getBenchNoRepack, getEngineOverride } from "../bench/benchConfig";
import {
  disposeEngine,
  getActiveModelId,
  getEngineLostModelId,
  isEngineReady,
  type EngineTurnOptions,
} from "../engine/LlamaService";
import { nativeOpBusy, runNativeOpBounded } from "../engine/llamaContextGate";
import { getAvailableMemoryBytesUncached } from "../engine/monitor";
import { getCachedDeviceProfile } from "../engine/deviceProfile";
import type { DeviceBandwidthCalibration } from "../engine/deviceThroughput";
import type { ConversationsState } from "../conversations/ConversationsStore";
import type { ModelPipelineState } from "./hostPipelineState";
import type { Locale, TranslateFn } from "../i18n";
import { MODEL_SWITCH_DISPOSE_TIMEOUT_MS } from "./engineGateHelpers";

/** Injected store for load markers + last-good bookkeeping (boot-loop defence). */
export const loadMarkerStore: LoadMarkerStore = AsyncStorage;

/**
 * Every field the load path (ensure, gate report, fallback, switch) reads as
 * host state. One object, threaded: the old component spread these across four
 * dependency arrays and two refs.
 */
export interface EngineLoadDeps {
  t: TranslateFn;
  locale: Locale;
  thermalHardGateRef: { current: boolean };
  engineGenerationRef: { current: number };
  modelIndexRef: { current: number };
  chatGateGenRef: { current: number | null };
  loadFallbackTargetRef: { current: string | null };
  modelStateRef: { current: ModelPipelineState };
  streamInFlightRef: { current: boolean };
  ensureEngineForModelRef: { current: (model: ModelInfo) => Promise<boolean> };
  setModelState: (state: ModelPipelineState) => void;
  setModelError: (message: string | null) => void;
  setModelErrorKind: (kind: "download" | "engine" | null) => void;
  setModelErrorDetail: (detail: string | null) => void;
  setModelIndex: (index: number) => void;
  chatEngineCtxRef: { current: number };
  setChatEngineCtx: (ctx: number) => void;
  deviceBandwidth: DeviceBandwidthCalibration;
  agentOptions: EngineTurnOptions;
  agentOptionsRef: { current: EngineTurnOptions };
  conversationsRef: { current: ConversationsState };
}

export async function evaluateLoadGate(model: ModelInfo): Promise<LoadGateVerdict> {
    // The gate must charge what the load will really do: the context the
    // budget resolves (bench ?? user ?? catalog, downgraded if it must be)
    // and KV at the chosen cache profile. loadGateFitModel is that
    // resolution, shared with gateForModel so the two gates cannot disagree.
    const [profile, kvCache, benchNCtx, userNCtx, benchNoRepack, engineOverride] =
      await Promise.all([
        getCachedDeviceProfile(),
        readKvCacheChoice(),
        getBenchNCtx(),
        readUserContextSize(model.contextLength),
        getBenchNoRepack(),
        getEngineOverride(),
      ]);
    return gateModelLoad({
      model: loadGateFitModel({
        model,
        profile,
        requestedContextTokens: benchNCtx ?? userNCtx ?? undefined,
        kvCache,
        benchNoRepack,
        benchUseMmap: engineOverride?.useMmap,
      }),
      markerPresent: await readLoadMarker(loadMarkerStore, model.id).catch(() => false),
      residentModelId: isEngineReady() ? (getActiveModelId() ?? null) : null,
      lostModelId: getEngineLostModelId(),
      benchNoRepack,
      disposeResident: async () => {
        const result = await runNativeOpBounded(
          () => disposeEngine(),
          MODEL_SWITCH_DISPOSE_TIMEOUT_MS,
        );
        if (!result.ok) {
          console.warn(
            `[kalsa] load-gate dispose timed out after ${MODEL_SWITCH_DISPOSE_TIMEOUT_MS}ms (nativeOpBusy=${nativeOpBusy()}); refusing load with the previous model still resident`,
          );
        }
        return result.ok;
      },
      getAvailableBytes: async () => {
        try {
          return await getAvailableMemoryBytesUncached();
        } catch {
          return null;
        }
      },
    });
}

export async function reportLoadRefusal(
  deps: EngineLoadDeps,
  model: ModelInfo,
  verdict: LoadRefusal,
  source: string,
): Promise<void> {
  const {
    t,
    modelStateRef,
    setModelState,
    setModelError,
    setModelErrorKind,
    setModelErrorDetail,
  } = deps;
      let otherModelAvailable = false;
      let smallerExists = false;
      if (verdict.refusedBy === "marker") {
        const downloadedIds: string[] = [];
        const otherSizes: number[] = [];
        for (const candidate of MODEL_REGISTRY) {
          if (candidate.id === model.id) continue;
          otherSizes.push(candidate.sizeBytes);
          try {
            if (await isModelBundleDownloaded(candidate)) {
              downloadedIds.push(candidate.id);
            }
          } catch {
            // Probe failure → candidate not counted.
          }
        }
        otherModelAvailable = hasOtherDownloadedModel(downloadedIds, model.id);
        smallerExists = smallerModelExists(otherSizes, model.sizeBytes);
      }
      // eslint-disable-next-line no-console
      console.log(
        `KALSA_LOAD ${JSON.stringify({
          phase: "fitGate",
          modelId: model.id,
          refusedBy: verdict.refusedBy,
          reasonKey: verdict.reasonKey,
          disposedResident: verdict.disposedResident,
          source,
        })}`,
      );
      setModelState("error");
      modelStateRef.current = "error";
      setModelErrorKind("engine");
      setModelError(t(refusalMessageKey(verdict, otherModelAvailable, smallerExists)));
      setModelErrorDetail(null);
}

/** The refusal fallback: one hop to the last good load, else the default. */
export async function runLoadFallback(
  deps: EngineLoadDeps,
  model: ModelInfo,
): Promise<void> {
  const {
    ensureEngineForModelRef,
    loadFallbackTargetRef,
    modelIndexRef,
    setModelIndex,
    setModelState,
  } = deps;
        if (loadFallbackTargetRef.current !== model.id) {
          const lastGoodId = await readLastGoodModelId(loadMarkerStore).catch(() => null);
          const fallbackId = await pickFallbackModel({
            refusedId: model.id,
            lastGoodId,
            defaultId: getDefaultModel().id,
            isMarked: (id) => readLoadMarker(loadMarkerStore, id).catch(() => false),
          });
          const fallbackIndex = fallbackId
            ? MODEL_REGISTRY.findIndex((m) => m.id === fallbackId)
            : -1;
          if (fallbackIndex >= 0 && fallbackIndex !== modelIndexRef.current) {
            loadFallbackTargetRef.current = fallbackId;
            setModelState("checking");
            // Keep stillCurrent() correct before re-render (same as selectModel):
            // the direct ensure below awaits, and modelIndexRef lags the render.
            modelIndexRef.current = fallbackIndex;
            setModelIndex(fallbackIndex);
            // Load the fallback directly: the [modelIndex] kick is one-shot
            // per modelId@generation (claimEagerKick), so a fallback that
            // already kicked this process would otherwise never load. A
            // duplicate kick ensure is refused by the chat-gate backstop.
            const fallbackModel = MODEL_REGISTRY[fallbackIndex];
            void (async () => {
              try {
                if (await isModelBundleDownloaded(fallbackModel)) {
                  void ensureEngineForModelRef.current(fallbackModel);
                } else if (modelIndexRef.current === fallbackIndex) {
                  setModelState("missing");
                }
              } catch {
                // Bundle probe failure: keep the refusal message visible and
                // let the model bar retry path take over.
                setModelState("error");
              }
            })();
          }
        }
}
