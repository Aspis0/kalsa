/**
 * The model host: selection state, the device-bandwidth recorder, the
 * context-size reads, the bound load path, and the download acquisition
 * (`useModelDownload`) — stateful half lifted from the old controller,
 * with the load deps assembled once so `ensureEngineForModel`,
 * the boot kick and the switchers all read the same values the old component
 * captured in three dependency arrays. The switchers and
 * `userReloadModel` are the lifted ones from `modelSwitch`.
 */
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { MODEL_REGISTRY, getDefaultModel, type ModelInfo } from "../engine/ModelRegistry";
import {
  disposeEngine,
  disposeRemoteEngine,
  getActiveEngineNCtx,
  getActiveModelId,
  isEngineReady,
  isRemoteEngineBackend,
  type EngineTurnOptions,
} from "../engine/engineBackend";
import { REMOTE_COMPUTER_MODEL, REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import { markChatReleased, runNativeOpBounded } from "../engine/llamaContextGate";
import { resolveContextProfile } from "../engine/contextProfile";
import {
  mergeDeviceBandwidthCalibrations,
  recordDeviceBandwidthSample,
  type DecodeMeasurement,
  type DeviceBandwidthCalibration,
} from "../engine/deviceThroughput";
import {
  loadDeviceBandwidthCalibration,
  saveDeviceBandwidthCalibration,
} from "../engine/deviceThroughputStore";
import { getBenchNCtx } from "../bench/benchConfig";
import { readUserContextSize } from "../engine/contextSizePref";
import type { ConversationsState } from "../conversations/ConversationsStore";
import type { ModelPipelineState } from "../app/AppShell";
import type { Locale, TranslateFn } from "../i18n";
import { ensureEngineForModel } from "./engineEnsure";
import { useModelDownload } from "./useModelDownload";
import { loadMarkerStore, type EngineLoadDeps } from "./engineLoad";
import { clearLoadMarker } from "../engine/loadMarker";
import {
  createModelSwitchers,
  type ModelSwitchDeps,
} from "./modelSwitch";
import { downloadInFlightRef } from "./useModelDownload";
import { usePipelineScans, type PipelineScanResult } from "./usePipelineScans";
import { ensureRemoteHostModel } from "./remoteHostEnsure";
import { createRemoteModelHostActions } from "./remoteModelHostActions";
import { getRemoteContextSize } from "../engine/remote/remoteSettings";
import { MODEL_SWITCH_DISPOSE_TIMEOUT_MS } from "./engineGateHelpers";

export interface ModelHostParams {
  t: TranslateFn;
  locale: Locale;
  thermalHardGated: boolean;
  thermalHardGateRef: { current: boolean };
  streamInFlightRef: { current: boolean };
  conversationsRef: { current: ConversationsState };
  agentOptions: EngineTurnOptions;
  agentOptionsRef: { current: EngineTurnOptions };
  memoryExtractRef: { current: Promise<void> | null };
  embedderDownloadedRef: { current: boolean };
  chatEngineCtxRef: { current: number };
}

export function useModelHost(params: ModelHostParams) {
  const { t, locale, thermalHardGated, thermalHardGateRef, streamInFlightRef, conversationsRef, agentOptions, agentOptionsRef, memoryExtractRef, embedderDownloadedRef, chatEngineCtxRef } = params;

  const [modelIndex, setModelIndex] = useState(() =>
    Math.max(0, MODEL_REGISTRY.findIndex((m) => m.id === getDefaultModel().id)),
  );
  const [remoteActive, setRemoteActive] = useState(false);
  const remoteErrorRef = useRef<string | null>(null);
  const remoteActiveRef = useRef(false);
  remoteActiveRef.current = remoteActive;
  const [modelState, setModelState] = useState<ModelPipelineState>("checking");
  const currentModel = remoteActive ? REMOTE_COMPUTER_MODEL : MODEL_REGISTRY[modelIndex];
  const modelStateRef = useRef<ModelPipelineState>("checking");
  // Keep modelStateRef in lockstep for sync residency checks (reads without
  // waiting for a re-render). Assigned on every render below.
  modelStateRef.current = modelState;
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelErrorDetail, setModelErrorDetail] = useState<string | null>(null);
  /** Discriminates download vs engine-init failures when modelState === "error". */
  const [modelErrorKind, setModelErrorKind] = useState<"download" | "engine" | null>(null);
  const modelIndexRef = useRef(modelIndex);
  modelIndexRef.current = modelIndex;
  /** Fallback target already chosen by the load gate — one hop, never a loop. */
  const loadFallbackTargetRef = useRef<string | null>(null);
  const engineGenerationRef = useRef(0);
  /**
   * Ownership token from tryAcquireChat (null when chat slot not held).
   * markChatReady / markChatReleased must pass this gen so a stale load
   * cannot idle a newer owner's gate.
   */
  const chatGateGenRef = useRef<number | null>(null);
  /** Latest bound ensure — the boot kick reads this so its effect stays []. */
  const ensureEngineForModelRef = useRef<(model: ModelInfo) => Promise<boolean>>(
    async () => false,
  );

  const [deviceBandwidth, setDeviceBandwidth] = useState<DeviceBandwidthCalibration>({});
  const deviceBandwidthRef = useRef<DeviceBandwidthCalibration>(deviceBandwidth);
  deviceBandwidthRef.current = deviceBandwidth;
  useEffect(() => {
    let mounted = true;
    void loadDeviceBandwidthCalibration().then((loaded) => {
      if (!mounted) return;
      const merged = mergeDeviceBandwidthCalibrations(
        deviceBandwidthRef.current,
        loaded,
      );
      deviceBandwidthRef.current = merged;
      setDeviceBandwidth(merged);
    });
    return () => {
      mounted = false;
    };
  }, []);
  const recordDecodeSample = useCallback(
    (model: ModelInfo, sample: DecodeMeasurement) => {
      const next = recordDeviceBandwidthSample(
        deviceBandwidthRef.current,
        model,
        sample,
      );
      if (next === deviceBandwidthRef.current) return;
      deviceBandwidthRef.current = next;
      setDeviceBandwidth(next);
      void saveDeviceBandwidthCalibration(next);
    },
    [],
  );
  // Pre-init estimate: catalog n_ctx (+ optional high-RAM hybrid upgrade).
  // After initEngine succeeds we overwrite both state and ref with the
  // reported effectiveNCtx (memory clamp may shrink); the document tool and
  // the long-chat UI share that resolved value — see chatEngineCtxRef.
  const [benchNCtxOverride, setBenchNCtxOverride] = useState<number | null>(null);
  // Settings' context-size choice, read on mount so the pre-init estimate uses
  // it; the load paths read it themselves (they must never decide from a
  // render-time value). Bench wins when both are set: it is the harness arm.
  const [userContextSize, setUserContextSize] = useState<number | null>(null);
  // Read bench nctx override on mount; applies to all three resolveContextProfile
  // call sites so the engine reload key never disagrees mid-conversation.
  // The context-size choice is clamped to the ACTIVE model's own maximum here,
  // so a size stored for another model cannot reach init — and re-read on a
  // model switch, because what is on offer depends on that model. Latest-wins
  // is safe: the load path rereads storage itself, so a stale preview could
  // only show the wrong size until this runs again.
  const refreshContextSize = useCallback(async () => {
    try {
      setBenchNCtxOverride(await getBenchNCtx());
    } catch {
      setBenchNCtxOverride(null);
    }
    try {
      setUserContextSize(await readUserContextSize(currentModel.contextLength));
    } catch {
      setUserContextSize(null);
    }
  }, [currentModel.contextLength]);
  useEffect(() => {
    void refreshContextSize();
  }, [refreshContextSize]);
  const catalogEngineCtx = useMemo(
    () =>
      remoteActive
        ? getRemoteContextSize()
        : resolveContextProfile({
            hybrid: currentModel.hybrid,
            kvCache: currentModel.kvCache,
            catalogCtx: currentModel.engineCtx,
            explicitNCtx: benchNCtxOverride ?? userContextSize ?? undefined,
          }).nCtx,
    [currentModel, remoteActive, benchNCtxOverride, userContextSize],
  );
  const [chatEngineCtx, setChatEngineCtx] = useState<number>(catalogEngineCtx);
  // Keep state in sync when the selected model changes (pre-init estimate).
  // Do not clobber a live effective value while the same model stays ready.
  useEffect(() => {
    if (isEngineReady() && getActiveModelId() === currentModel.id) {
      const live = getActiveEngineNCtx();
      if (live > 0) {
        setChatEngineCtx(live);
        chatEngineCtxRef.current = live;
        return;
      }
    }
    setChatEngineCtx(catalogEngineCtx);
    chatEngineCtxRef.current = catalogEngineCtx;
  }, [catalogEngineCtx, currentModel.id]);
  const loadDeps: EngineLoadDeps = {
    t,
    locale,
    thermalHardGateRef,
    engineGenerationRef,
    modelIndexRef,
    chatGateGenRef,
    loadFallbackTargetRef,
    modelStateRef,
    streamInFlightRef,
    ensureEngineForModelRef,
    setModelState,
    setModelError,
    setModelErrorKind,
    setModelErrorDetail,
    setModelIndex,
    chatEngineCtxRef,
    setChatEngineCtx,
    deviceBandwidth,
    agentOptions,
    agentOptionsRef,
    conversationsRef,
  };
  ensureEngineForModelRef.current = (model: ModelInfo) =>
    model.id === REMOTE_COMPUTER_MODEL_ID
      ? ensureRemoteHostModel({
          locale,
          t,
          generationRef: engineGenerationRef,
          modelStateRef,
          setModelState: (state) => {
            modelStateRef.current = state;
            setModelState(state);
          },
          setModelError,
          setModelErrorKind,
          setModelErrorDetail,
          setChatEngineCtx,
          chatEngineCtxRef,
          remoteErrorRef,
        })
      : ensureEngineForModel(loadDeps, model);
  const remoteActions = createRemoteModelHostActions({
    t,
    engineGenerationRef,
    chatGateGenRef,
    markChatReleased,
    remoteActiveRef,
    setRemoteActive,
    modelStateRef,
    streamInFlightRef,
    setModelState: (state) => {
      modelStateRef.current = state;
      setModelState(state);
    },
    setModelError,
    setModelErrorKind,
    setModelErrorDetail,
    disposeCurrent: async () => {
      try {
        if (isRemoteEngineBackend()) {
          await disposeRemoteEngine();
          return true;
        }
        if (!isEngineReady()) return true;
        return (
          await runNativeOpBounded(
            () => disposeEngine(),
            MODEL_SWITCH_DISPOSE_TIMEOUT_MS,
          )
        ).ok;
      } catch {
        return false;
      }
    },
    ensureRemote: () => ensureEngineForModelRef.current(REMOTE_COMPUTER_MODEL),
  });
  const switchers = createModelSwitchers({
    ...loadDeps,
    memoryExtractRef,
    remoteActiveRef,
    setRemoteActive,
    routeModelById: remoteActions.routeModelById,
  } satisfies ModelSwitchDeps);

  // The download acquisition (`AppShell.tsx:4657-5154`): transfer state,
  // the settings-presence map and the confirmed start — dependencies read
  // straight from the load deps this hook already owns.
  const modelDownload = useModelDownload({
    t,
    locale,
    thermalHardGated,
    thermalHardGateRef,
    engineGenerationRef,
    modelIndexRef,
    modelStateRef,
    ensureEngineForModelRef,
    deviceBandwidth,
    setModelState,
    setModelError,
    setModelErrorKind,
    setModelErrorDetail,
  });

  /**
   * Explicit user reload (model-bar chip / Settings retry). The recovery from
   * a marker refusal is a HUMAN act: the tap clears this model's death marker
   * and retries once — the app never clears or retries on its own, so no
   * launch ever hammers the killer again. The clear is AWAITED: the ensure
   * below must never read the marker before the removal lands — a lost race
   * would make the tap a silent no-op.
   */
  const userReloadModel = (model: ModelInfo) => {
    void (async () => {
      await clearLoadMarker(loadMarkerStore, model.id).catch(() => undefined);
      void ensureEngineForModelRef.current(model);
    })();
  };

  const scanRefs = { modelIndexRef, loadFallbackTargetRef, embedderDownloadedRef, engineGenerationRef, chatGateGenRef, ensureEngineForModelRef, remoteActiveRef };
  const scanSetters = { setModelIndex, setModelState, setModelError, setModelErrorKind, setModelErrorDetail, setRemoteActive };
  const scans: PipelineScanResult = usePipelineScans({
    t,
    currentModel,
    remoteActive,
    refs: scanRefs,
    setters: scanSetters,
  });

  return {
    modelIndex,
    remoteActive,
    remoteActiveRef,
    remoteErrorRef,
    currentModel,
    modelState,
    modelError,
    modelErrorDetail,
    modelErrorKind,
    chatEngineCtx,
    chatEngineCtxRef,
    deviceBandwidth,
    recordDecodeSample,
    loadDeps,
    loadFallbackTargetRef,
    scanRefs,
    scanSetters,
    scans,
    ...switchers,
    ...modelDownload,
    userReloadModel,
    refreshContextSize,
  };
}
