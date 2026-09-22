/**
 * Acquiring a model: the confirm dialog and the transfer, lifted from
 * `AppShell.tsx:4657-5154` (442 lines). What happens AFTER the bytes land is
 * the one structural adaptation: the controller inlined a ~250-line
 * download→init path (its `:4769-5105`), and this host already owns that
 * path as one function — so the hook verifies the bundle, marks it
 * downloaded, flips to `loading` and hands off to `ensureEngineForModel`,
 * the same load every other site uses (`engineEnsure.ts`: hung guard,
 * RAM/disk gates, chat acquisition, death marker, refusal fallback).
 *
 * Reported differences (each deliberate):
 * - the load-refusal fallback hop (`runLoadFallback`) runs here, where the
 *   controller's inline path refused without falling back — a consequence of
 *   using the shared load path, visible only when a fresh download's load is
 *   refused;
 * - the engine-phase failure notification is gone: `ensure` owns its catch
 *   and its boolean cannot distinguish a refusal (no notification in the
 *   controller) from a throw (one); the failure is visible on the bar and in
 *   Settings either way. Download-phase failures still notify, as before;
 * - `downloadedById` is marked at bundle completeness instead of the
 *   controller's two load refusals plus ready (`App:4914, 4933, 5046`) —
 *   same truth, one write, and the settings-open scan re-derives it.
 *
 * Held in this slice, with its reason: the voice and embedding downloads
 * (`AppShell.tsx:5155-5312`) — the voice pipeline does not exist in this
 * build, so wiring its downloader would be a control for a feature that
 * cannot run; their Settings buttons keep serving `shell.notice.voiceDownload`
 * / `shell.notice.embeddingDownload`.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import { bumpForegroundIdleRef } from "../app/foregroundIdleDispose";
import type { ModelPipelineState } from "../app/AppShell";
import { getCachedDeviceProfile, getFreeDiskBytes } from "../engine/deviceProfile";
import type { DeviceBandwidthCalibration } from "../engine/deviceThroughput";
import {
  downloadModelBundle,
  friendlyNetworkError,
  isModelBundleDownloaded,
} from "../engine/ModelDownloader";
import { MODEL_REGISTRY, formatBytes, type ModelInfo } from "../engine/ModelRegistry";
import { getPlatformThermalHardGate } from "../engine/platformThermalStatus";
import type { Locale, TranslateFn } from "../i18n";
import { createDownloadNotifications, type DownloadNotifications } from "./downloadNotifications";
import { gateForModel, gateReasonMessage, rawErrorDetail } from "./engineGateHelpers";
import { noticePort } from "./useNotice";

/** MIUI/aggressive Android power management freezes a backgrounded app and
 *  kills the transfer socket; the whole download runs keep-awake (App:457). */
const DOWNLOAD_KEEP_AWAKE_TAG = "model-download";

/** Synchronous single-flight guards, module-level so the switch guard
 *  (`modelSwitch.ts`) and the idle governor (`foregroundIdle.ts`) can read
 *  them — the `modelSwitchInFlightRef` idiom, from the controller's
 *  component refs at `App:2992-2994`. */
export const downloadInFlightRef = { current: false };
export const confirmDownloadLockRef = { current: false };

export interface ModelDownloadDeps {
  t: TranslateFn;
  locale: Locale;
  thermalHardGated: boolean;
  thermalHardGateRef: { current: boolean };
  engineGenerationRef: { current: number };
  modelIndexRef: { current: number };
  modelStateRef: { current: ModelPipelineState };
  ensureEngineForModelRef: { current: (model: ModelInfo) => Promise<boolean> };
  deviceBandwidth: DeviceBandwidthCalibration;
  setModelState: (state: ModelPipelineState) => void;
  setModelError: (message: string | null) => void;
  setModelErrorKind: (kind: "download" | "engine" | null) => void;
  setModelErrorDetail: (detail: string | null) => void;
}

export function useModelDownload(deps: ModelDownloadDeps) {
  const {
    t, locale, thermalHardGated, thermalHardGateRef,
    engineGenerationRef, modelIndexRef, modelStateRef,
    ensureEngineForModelRef, deviceBandwidth,
    setModelState, setModelError, setModelErrorKind, setModelErrorDetail,
  } = deps;

  const [download, setDownload] = useState<{
    bytesReceived: number;
    bytesTotal: number;
    progress: number;
  } | null>(null);
  /** Presence map the controller kept at `App:3527`, same writes, same
   *  readers: the three live marks here, the settings-open scan in
   *  `HostOverlays` (there is NO boot-time rescan in either app). */
  const [downloadedById, setDownloadedById] = useState<Record<string, boolean>>({});
  const markDownloaded = (id: string) =>
    setDownloadedById((prev) => ({ ...prev, [id]: true }));
  const applyDownloadedScan = (map: Record<string, boolean>) =>
    setDownloadedById(map);

  const downloadAbortRef = useRef<AbortController | null>(null);

  // One notifications instance for the component's life: its throttle and
  // permission cache are the controller's refs (`App:2655-2656`), and the
  // stable trampoline keeps them alive across locale changes.
  const tRef = useRef(t);
  tRef.current = t;
  const stableT: TranslateFn = (key, params) => tRef.current(key, params);
  const notifications: DownloadNotifications = useMemo(
    () => createDownloadNotifications(stableT),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // `AppShell.tsx:3684-3694`: at the gate's rising edge the transfer dies
  // and the spinner never survives the overlay (downloading → missing). The
  // edge's generation bump and loading → ready reset belong to the full
  // thermal-edge effect this host does not mount (D2 row 10) — reported.
  useEffect(() => {
    if (!thermalHardGated) return;
    downloadAbortRef.current?.abort();
    if (modelStateRef.current === "downloading") {
      modelStateRef.current = "missing";
      setModelState("missing");
    }
  }, [thermalHardGated]);

  // `AppShell.tsx:3776-3777`: unmount aborts the transfer; the generation
  // bump and dispose around it are `usePipelineScans`' unmount cleanup.
  useEffect(
    () => () => {
      downloadAbortRef.current?.abort();
      downloadAbortRef.current = null;
    },
    [],
  );

  async function startDownload(modelId: string): Promise<void> {
    if (thermalHardGateRef.current) return;
    try {
      if (await getPlatformThermalHardGate()) {
        thermalHardGateRef.current = true;
        return;
      }
    } catch {
      // The platform reader is fail-open; an unavailable API never blocks.
    }
    const model = MODEL_REGISTRY.find((m) => m.id === modelId);
    if (!model) return;

    // Synchronous generation capture + download lock BEFORE any await so a
    // model switch during the free-disk probe cannot start a multi-GB
    // transfer for a deselected model (`App:4667-4670`).
    const generation = engineGenerationRef.current;
    if (downloadInFlightRef.current || modelStateRef.current === "downloading") {
      return;
    }
    downloadInFlightRef.current = true;
    bumpForegroundIdleRef.current();

    const expectedModelId = model.id;
    const stillCurrent = () =>
      generation === engineGenerationRef.current &&
      MODEL_REGISTRY[modelIndexRef.current]?.id === expectedModelId;

    // Re-check the stable download gate immediately before the transfer:
    // tier and disk only — volatile RAM is priced by the load gate, when
    // the memory is actually used.
    let downloadGate: ReturnType<typeof gateForModel> | undefined;
    try {
      const [deviceProfile, free] = await Promise.all([
        getCachedDeviceProfile(),
        getFreeDiskBytes(),
      ]);
      if (generation !== engineGenerationRef.current) {
        downloadInFlightRef.current = false;
        return;
      }
      const gate = gateForModel(model, deviceProfile, free, false, undefined, deviceBandwidth);
      if (!gate.allowed) {
        Alert.alert(t("download.title"), gateReasonMessage(gate.reason, t));
        downloadInFlightRef.current = false;
        return;
      }
      downloadGate = gate;
    } catch {
      // Probe failure → proceed without a verdict, as the load path does.
    }

    if (generation !== engineGenerationRef.current) {
      downloadInFlightRef.current = false;
      return;
    }
    if (thermalHardGateRef.current) {
      downloadInFlightRef.current = false;
      return;
    }

    const controller = new AbortController();
    downloadAbortRef.current = controller;
    setModelState("downloading");
    setModelError(null);
    setModelErrorDetail(null);
    setModelErrorKind(null);
    const bundleTotal = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
    setDownload({ bytesReceived: 0, bytesTotal: bundleTotal, progress: 0 });

    await activateKeepAwakeAsync(DOWNLOAD_KEEP_AWAKE_TAG).catch(() => undefined);
    await notifications.begin();
    void notifications.showProgress(model.name, 0);

    // Which phase failed, so the catch can say download vs engine (the
    // controller's `errorPhase`, `App:4736`).
    let errorPhase: "download" | "engine" = "download";
    try {
      const outcome = await downloadModelBundle(model, {
        onBundleProgress: (progress) => {
          if (!stillCurrent()) return;
          setDownload({
            bytesReceived: Math.round(progress.overall * bundleTotal),
            bytesTotal: bundleTotal,
            progress: progress.overall,
          });
          // The 2 s window is enforced inside `showProgress` (the
          // controller throttled at this call site, `App:4737-4742`).
          void notifications.showProgress(
            model.name,
            Math.round(progress.overall * 100),
          );
        },
        signal: controller.signal,
        locale,
        gate: downloadGate,
      });
      if (!stillCurrent() || thermalHardGateRef.current) return;
      if (outcome.model.status === "aborted" || outcome.mmproj?.status === "aborted") {
        setModelState("missing");
        return;
      }
      if (!(await isModelBundleDownloaded(model))) {
        if (!stillCurrent()) return;
        setModelState("error");
        setModelErrorKind("download");
        setModelError(t("download.incomplete"));
        return;
      }
      if (!stillCurrent() || thermalHardGateRef.current) return;
      markDownloaded(model.id);
      errorPhase = "engine";
      setModelState("loading");
      const loaded = await ensureEngineForModelRef.current(model);
      if (loaded) {
        noticePort.current?.(
          t("download.readyNotice", { name: model.name }),
        );
        void notifications.notify(
          t("notify.channelName"),
          t("download.notifyReady", { name: model.name }),
        );
      }
    } catch (error) {
      if (!stillCurrent()) return;
      if (controller.signal.aborted) {
        setModelState("missing");
        return;
      }
      setModelState("error");
      modelStateRef.current = "error";
      setModelErrorKind(errorPhase);
      setModelErrorDetail(rawErrorDetail(error));
      const friendly = friendlyNetworkError(error, locale, errorPhase).message;
      setModelError(friendly);
      void notifications.notify(
        t("notify.channelName"),
        t("download.notifyFailed", { error: friendly }),
      );
    } finally {
      downloadInFlightRef.current = false;
      downloadAbortRef.current = null;
      await deactivateKeepAwake(DOWNLOAD_KEEP_AWAKE_TAG).catch(() => undefined);
      await notifications.dismiss();
    }
  }

  /** Explicit confirmation before any transfer — never automatic, always
   *  bound to a modelId (controller `confirmDownload`, `App:5097-5150`). */
  function confirmDownload(modelId: string): void {
    const model = MODEL_REGISTRY.find((m) => m.id === modelId);
    if (!model) return;
    // Synchronous double-tap guard before any await (probes + Alert).
    if (downloadInFlightRef.current || confirmDownloadLockRef.current) return;
    confirmDownloadLockRef.current = true;
    void (async () => {
      try {
        const [deviceProfile, free] = await Promise.all([
          getCachedDeviceProfile(),
          getFreeDiskBytes(),
        ]);
        const gate = gateForModel(
          model,
          deviceProfile,
          free,
          false,
          undefined, // disk-only gate: RAM axis unused
          deviceBandwidth,
        );
        if (!gate.allowed) {
          confirmDownloadLockRef.current = false;
          Alert.alert(t("download.title"), gateReasonMessage(gate.reason, t));
          return;
        }
      } catch {
        // Probe failure → fall through to the normal confirm dialog.
      }
      const total = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
      Alert.alert(
        t("download.title"),
        t("download.confirmBody", { name: model.name, size: formatBytes(total) }),
        [
          {
            text: t("common.cancel"),
            style: "cancel",
            onPress: () => {
              confirmDownloadLockRef.current = false;
            },
          },
          {
            text: t("common.download"),
            onPress: () => {
              confirmDownloadLockRef.current = false;
              void startDownload(modelId);
            },
          },
        ],
      );
    })();
  }

  return {
    download,
    downloadedById,
    markDownloaded,
    applyDownloadedScan,
    confirmDownload,
  };
}
