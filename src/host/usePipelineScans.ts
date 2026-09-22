/**
 * The boot-time scans: which model starts (boot-loop defence), the one-shot
 * eager-load kick, the unmount disposal, and the voice/embedding presence
 * scans. Adaptations (reported): the notice-timer and download-abort cleanups
 * left with the systems they belong to, and `bumpEmbedJobGeneration` left
 * with the embed pipeline.
 */
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MODEL_REGISTRY, getDefaultModel, type ModelInfo } from "../engine/ModelRegistry";
import { isModelBundleDownloaded } from "../engine/ModelDownloader";
import { detectOrphansAtBoot } from "../engine/ModelDownloader.orphanMigration";
import {
  pickStartModel,
  readLastGoodModelId,
  readLoadMarker,
} from "../engine/loadMarker";
import { disposeEngine, getActiveModelId } from "../engine/LlamaService";
import { isWhisperModelDownloaded, releaseWhisper } from "../voice/WhisperService";
import { isTtsEnabled, setTtsEnabled } from "../voice/TtsService";
import {
  getEmbeddingModelStatus,
  releaseEmbedder,
} from "../engine/EmbeddingService";
import { markChatReleased, runNativeOp } from "../engine/llamaContextGate";
import { EAGER_ENGINE_INIT, claimEagerKick } from "../engine/ttftFlags";
import type {
  EmbeddingPipelineState,
  ModelPipelineState,
  VoicePipelineState,
} from "../app/AppShell";
import type { TranslateFn } from "../i18n";
import { loadMarkerStore } from "./engineLoad";
import { MODEL_STORAGE_KEY } from "./modelSwitch";

export interface ScanRefs {
  modelIndexRef: { current: number };
  loadFallbackTargetRef: { current: string | null };
  embedderDownloadedRef: { current: boolean };
  engineGenerationRef: { current: number };
  chatGateGenRef: { current: number | null };
  ensureEngineForModelRef: { current: (model: ModelInfo) => Promise<boolean> };
}

export interface ScanSetters {
  setModelIndex: (index: number) => void;
  setModelState: (state: ModelPipelineState) => void;
  setModelError: (message: string | null) => void;
  setModelErrorKind: (kind: "download" | "engine" | null) => void;
  setModelErrorDetail: (detail: string | null) => void;
}

export interface PipelineScanResult {
  voiceState: VoicePipelineState;
  ttsEnabled: boolean;
  setTtsEnabled: (enabled: boolean) => void;
  embeddingState: EmbeddingPipelineState;
}

export function usePipelineScans(params: {
  t: TranslateFn;
  currentModel: ModelInfo;
  refs: ScanRefs;
  setters: ScanSetters;
}): PipelineScanResult {
  const { t, currentModel, refs, setters } = params;
  const { modelIndexRef, loadFallbackTargetRef, embedderDownloadedRef, engineGenerationRef, chatGateGenRef, ensureEngineForModelRef } = refs;
  const {
    setModelIndex,
    setModelState,
    setModelError,
    setModelErrorKind,
    setModelErrorDetail,
  } = setters;

  const [voiceState, setVoiceState] = useState<VoicePipelineState>("checking");
  const [ttsEnabled, setTtsEnabledState] = useState(true);
  const [embeddingState, setEmbeddingState] =
    useState<EmbeddingPipelineState>("checking");
  const handleToggleTts = (next: boolean) => {
    setTtsEnabledState(next);
    void setTtsEnabled(next).catch(() => undefined);
  };

  // Restore the last model the app used (the persisted selection), not
  // always the registry default. Boot-loop defence: a persisted selection
  // carrying a death marker never starts; pickStartModel starts on the last
  // good model, else the registry default.
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const saved = await AsyncStorage.getItem(MODEL_STORAGE_KEY);
        if (!mounted || !saved) return;
        const lastGoodId = await readLastGoodModelId(loadMarkerStore).catch(() => null);
        if (!mounted) return;
        const startId = await pickStartModel({
          savedId: saved,
          lastGoodId,
          defaultId: getDefaultModel().id,
          isMarked: (id) => readLoadMarker(loadMarkerStore, id).catch(() => false),
        });
        if (!mounted) return;
        // Every candidate is marked: start where the selection points and let
        // the load gate refuse it with the message — no load, no silent flip.
        if (startId === null) return;
        const startIndex = MODEL_REGISTRY.findIndex((model) => model.id === startId);
        if (startIndex < 0 || startIndex === modelIndexRef.current) return;
        if (startId !== saved) {
          loadFallbackTargetRef.current = startId;
          setModelState("error");
          setModelErrorKind("engine");
          setModelError(t("model.loadSetAside"));
          setModelErrorDetail(null);
        }
        // Keep stillCurrent() of any in-flight boot kick correct before re-render.
        modelIndexRef.current = startIndex;
        setModelIndex(startIndex);
      } catch {
        // Preference read failure → keep the default boot model.
      }
    })();
    // Detect orphaned model folders left by a catalog prune (no UI delete
    // path). Detect-ONLY: never deletes at boot; a one-time "Delete / Keep"
    // notice surfaces in Settings. Fire-and-forget — never blocks UI.
    void detectOrphansAtBoot(getActiveModelId()).catch(() => undefined);
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    return () => {
      engineGenerationRef.current += 1; // bumps invalidate every async in flight
      // Capture THIS load's gen SYNCHRONOUSLY at invalidation time.
      // Never read chatGateGenRef.current inside the dispose callback — a newer
      // load may have acquired a higher gen by then, and releasing it would
      // idle the wrong owner.
      const releasedGen = chatGateGenRef.current;
      chatGateGenRef.current = null;
      // Full chat disposal lifecycle through the native-op barrier so a chat
      // release cannot overlap an in-flight embed op. Sequential: disposeEngine
      // (wrapped) THEN releaseEmbedder — do NOT nest, that deadlocks the FIFO.
      void (async () => {
        try {
          await runNativeOp(() => disposeEngine());
        } catch {
          // ignore — unmount best-effort
        } finally {
          // Unmount dispose frees only the gen captured above.
          if (releasedGen !== null) markChatReleased(releasedGen);
        }
        // Sequential after dispose settles — releaseEmbedder owns its own barrier entry.
        try {
          await releaseEmbedder();
        } catch {
          // releaseEmbedder already absorbs; defense for fire-and-forget.
        }
      })();
      void releaseWhisper();
    };
  }, []);

  // Initial voice model + TTS preference scan.
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [ok, tts] = await Promise.all([
          isWhisperModelDownloaded(),
          isTtsEnabled(),
        ]);
        if (!mounted) return;
        setVoiceState(ok ? "ready" : "missing");
        setTtsEnabledState(tts);
      } catch {
        if (mounted) setVoiceState("missing");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  // Initial embedding-model presence scan (optional hybrid retrieval).
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const status = await getEmbeddingModelStatus();
        if (!mounted) return;
        const ready = status === "downloaded";
        embedderDownloadedRef.current = ready;
        setEmbeddingState(ready ? "ready" : "missing");
      } catch {
        if (mounted) {
          embedderDownloadedRef.current = false;
          setEmbeddingState("missing");
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);
  // Initial check: is the current model bundle already on disk?
  // This kick is one-shot per process+generation (claimEagerKick). Effect deps
  // stay [currentModel] only — ensureEngineForModel is read from a ref, not
  // listed, so a new bound function never re-fires the kick.
  useEffect(() => {
    let mounted = true;
    const checkedIndex = modelIndexRef.current;
    void (async () => {
      try {
        const model = MODEL_REGISTRY[checkedIndex];
        const ok = await isModelBundleDownloaded(model);
        // The selected model may have changed in the meantime (the preference load).
        if (mounted && modelIndexRef.current === checkedIndex) {
          setModelState(ok ? "ready" : "missing");
          if (ok && EAGER_ENGINE_INIT && model) {
            const generation = engineGenerationRef.current;
            if (claimEagerKick(model.id, generation)) {
              // eslint-disable-next-line no-console
              console.log(
                "engine.eagerInit",
                JSON.stringify({ modelId: model.id, generation }),
              );
              void ensureEngineForModelRef.current(model);
            }
          }
        }
      } catch {
        if (mounted && modelIndexRef.current === checkedIndex) setModelState("missing");
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentModel]);
  return {
    voiceState,
    ttsEnabled,
    setTtsEnabled: handleToggleTts,
    embeddingState,
  };
}
