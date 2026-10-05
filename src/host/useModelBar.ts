/**
 * The model bar's live view: the hook that samples the battery, reads engine
 * residency and assembles `ModelBarView` for the strip — plus the pill's
 * press and its where-choices. The derivations themselves live in
 * `modelBar.ts` / `modelBarPress.ts` / `modelBarChoices.ts`; this is the
 * wiring the controller did in render (`AppShell.tsx:2758` hook enablement,
 * `:6874-6911` the press).
 *
 * The press re-decides at press time from live engine reads, as the
 * controller's `onPress` did — the render-time decision only feeds the
 * disabled/inert affordance, which by construction updates with the render.
 */
import { isEmbedderHung } from "../engine/EmbeddingService";
import { getActiveModelId, isEngineReady } from "../engine/engineBackend";
import { MODEL_REGISTRY } from "../engine/ModelRegistry";
import { useBatteryEta } from "../hooks/useBatteryEta";
import { useLocale } from "../i18n";
import type { AttachSheetRowData } from "../ui/shell/AttachSheet";
import type { ModelBarView } from "../ui/shell/ModelBar";
import { buildBatteryLines, modelBarStatus, modelErrorHint, progressPercent } from "./modelBar";
import { modelBarChoices } from "./modelBarChoices";
import { decideModelPress } from "./modelBarPress";
import type { useHostEngine } from "./useHostEngine";
import { useUsablePairing } from "./useUsablePairing";

type ModelHost = ReturnType<typeof useHostEngine>["modelHost"];

export function useModelBar(modelHost: ModelHost, sending: boolean): {
  view: ModelBarView;
  onPress: () => void;
  /** The sheet's where-rows; empty when only one place can answer and the
   *  pill must not look like a picker (`modelBarChoices.ts`). */
  locationRows: readonly AttachSheetRowData[];
} {
  const { t } = useLocale();
  const usablePairing = useUsablePairing();
  const currentModel = modelHost.currentModel;
  const jsReady = isEngineReady();
  const activeMatches = getActiveModelId() === currentModel.id;
  const resident = jsReady && activeMatches;
  const hung = isEmbedderHung();

  // `AppShell.tsx:2758-2764`: sampling runs only while THIS model is loaded
  // and ready — a drain slope is meaningless otherwise.
  const batteryEta = useBatteryEta({
    enabled: modelHost.modelState === "ready" && resident,
    modelId: currentModel.id,
  });

  const percent =
    modelHost.modelState === "downloading"
      ? progressPercent(modelHost.download?.progress ?? null)
      : null;
  const decision = decideModelPress({
    modelState: modelHost.modelState,
    errorKind: modelHost.modelErrorKind,
    resident,
    hung,
  });
  const view: ModelBarView = {
    control: decision.control,
    status: modelBarStatus({
      modelState: modelHost.modelState,
      jsReady,
      activeMatches,
      hung,
      errorKind: modelHost.modelErrorKind,
      percent: percent ?? 0,
      model: currentModel,
      remoteActive: modelHost.remoteActive,
      t,
    }),
    percent,
    error: modelHost.modelError,
    hint: modelErrorHint({
      modelState: modelHost.modelState,
      modelError: modelHost.modelError,
      modelErrorDetail: modelHost.modelErrorDetail,
      remoteActive: modelHost.remoteActive,
      t,
    }),
    battery: buildBatteryLines(batteryEta, modelHost.modelState, t),
  };

  // The chooser's switch is `modelHost.selectLocation` — the same function
  // the Settings "Where it responds" rows call (`HostFurniture.tsx`).
  const locationRows = modelBarChoices({
    usablePairing,
    remoteActive: modelHost.remoteActive,
    sending,
    // The local registry entry, not `currentModel`: in computer mode that
    // one is the remote placeholder, and this row names the phone's model.
    localModelName: MODEL_REGISTRY[modelHost.modelIndex].name,
    labels: { phone: t("shell.where.thisPhone"), computer: t("shell.where.pillComputer") },
    selectLocation: modelHost.selectLocation,
  });

  const onPress = () => {
    const live = decideModelPress({
      modelState: modelHost.modelState,
      errorKind: modelHost.modelErrorKind,
      resident: isEngineReady() && getActiveModelId() === currentModel.id,
      hung: isEmbedderHung(),
    });
    if (live.action === "download") modelHost.confirmDownload(currentModel.id);
    else if (live.action === "reload") modelHost.userReloadModel(currentModel);
  };

  return { view, onPress, locationRows };
}
