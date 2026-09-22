/**
 * The model bar's live view: the hook that samples the battery, reads engine
 * residency and assembles `ModelBarView` for the strip — plus the pill's
 * press. The derivations themselves live in `modelBar.ts` /
 * `modelBarPress.ts`; this is the wiring the controller did in render
 * (`AppShell.tsx:2758` hook enablement, `:6874-6911` the press).
 *
 * The press re-decides at press time from live engine reads, as the
 * controller's `onPress` did — the render-time decision only feeds the
 * disabled/inert affordance, which by construction updates with the render.
 */
import { isEmbedderHung } from "../engine/EmbeddingService";
import { getActiveModelId, isEngineReady } from "../engine/LlamaService";
import { useBatteryEta } from "../hooks/useBatteryEta";
import { useLocale } from "../i18n";
import type { ModelBarView } from "../ui/shell/ModelBar";
import { buildBatteryLines, modelBarStatus, modelErrorHint, progressPercent } from "./modelBar";
import { decideModelPress } from "./modelBarPress";
import type { useHostEngine } from "./useHostEngine";

type ModelHost = ReturnType<typeof useHostEngine>["modelHost"];

export function useModelBar(modelHost: ModelHost): {
  view: ModelBarView;
  onPress: () => void;
} {
  const { t } = useLocale();
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
      t,
    }),
    percent,
    error: modelHost.modelError,
    hint: modelErrorHint({
      modelState: modelHost.modelState,
      modelError: modelHost.modelError,
      modelErrorDetail: modelHost.modelErrorDetail,
      t,
    }),
    battery: buildBatteryLines(batteryEta, modelHost.modelState, t),
  };

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

  return { view, onPress };
}
