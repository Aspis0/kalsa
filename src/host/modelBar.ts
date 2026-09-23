/**
 * What the model bar SAYS — the derivations the controller computes in
 * render (`AppShell.tsx:6720-6788` progress %, error hint, status label; and
 * `:2793-2830` the advisory battery lines) plus this host's two additions:
 * the retry control's name on a failure row (`retryLabel`) and the pill's
 * where-line while a hard refusal stands (`pillWhereLabel`). Pure: state and
 * catalogue in, label + tone out, so the tones can map onto this shell's
 * palette in `ModelBar.tsx` and the tests can drive every branch without a
 * device.
 *
 * The status kind comes from the engine's own `decideEngineBarKind`
 * (`src/engine/engineLiveness.ts:163`) — called, not copied — because the
 * ready/reload split (resident vs downloaded-but-unloaded) is the load
 * lifecycle's truth, not the UI's.
 */
import type { ModelPipelineState } from "../app/AppShell";
import { decideEngineBarKind } from "../engine/engineLiveness";
import { formatBytes, type ModelInfo } from "../engine/ModelRegistry";
import type { BatteryEtaUiState } from "../hooks/useBatteryEta";
import { type TranslateFn, type TranslationKey } from "../i18n";
import type { ModelBarTone } from "../ui/shell/ModelBar";

/**
 * `retryLabel` is present exactly on the rows whose sentence PROMISES a tap:
 * the bar draws that row as the control (48 dp, `ModelBar.tsx`), and the
 * label is the control's accessible name — a name, not the sentence.
 */
export type ModelBarStatus = {
  label: string;
  tone: ModelBarTone;
  retryLabel?: string;
};

/** `AppShell.tsx:6720`. */
export function progressPercent(progress: number | null): number {
  return progress === null ? 0 : Math.round(progress * 100);
}

/**
 * `AppShell.tsx:6725-6745`: extra guidance for connectivity-shaped failures,
 * plus the raw untranslated error when it differs from the friendly message.
 * Null unless the state is a failure.
 */
export function modelErrorHint(args: {
  modelState: ModelPipelineState;
  modelError: string | null;
  modelErrorDetail: string | null;
  t: TranslateFn;
}): string | null {
  const { modelState, modelError, modelErrorDetail, t } = args;
  if (modelState !== "error") return null;
  const isConnectivity =
    !!modelError &&
    (modelError === t("errors.connectionLost") ||
      modelError === t("errors.networkUnreachable"));
  // Detail is always "Name: message"; strip that prefix before comparing so a
  // zero-value duplicate of the friendly text is not shown as a "hint".
  const detailBody = modelErrorDetail
    ? modelErrorDetail.replace(/^(?:[A-Za-z]+Error?|Error):\s*/, "")
    : null;
  const raw =
    modelErrorDetail && detailBody !== modelError ? modelErrorDetail : null;
  if (isConnectivity) {
    const keepOpen = t("download.keepOpenHint");
    // Raw first so the ellipsis keeps the diagnostic, not the hint.
    return raw ? `${raw} — ${keepOpen}` : keepOpen;
  }
  return raw;
}

/**
 * `AppShell.tsx:6746-6788`. The error branch carries the hung guard the
 * controller shipped (Round 8 FIX 2): a hung embedder cannot be retried, so
 * the bar says restart instead of lying "tap to retry".
 */
export function modelBarStatus(args: {
  modelState: ModelPipelineState;
  jsReady: boolean;
  activeMatches: boolean;
  hung: boolean;
  errorKind: "download" | "engine" | null;
  percent: number;
  model: ModelInfo;
  remoteActive?: boolean;
  t: TranslateFn;
}): ModelBarStatus {
  const { modelState, jsReady, activeMatches, hung, errorKind, percent, model, remoteActive = false, t } = args;
  const kind = decideEngineBarKind({ modelState, jsReady, activeMatches });
  switch (kind) {
    case "checking":
      return { label: t("download.checking"), tone: "muted" };
    case "missing":
      return {
        // The controller's own expression (`App:6761`): main bundle + mmproj.
        label: t("download.missing", {
          size: formatBytes(model.sizeBytes + (model.mmproj?.sizeBytes ?? 0)),
        }),
        tone: "accent",
      };
    case "downloading":
      return { label: t("download.downloading", { percent }), tone: "accent" };
    case "loading":
      return { label: t("download.loading"), tone: "muted" };
    case "error":
      return {
        label: hung
          ? t("embedding.restartHint")
          : errorKind === "engine"
            ? t("download.loadFailedRetry")
            : t("download.failedRetry"),
        tone: "bad",
        // Hung has no tap to name (recovery is a restart), so the control
        // name appears exactly while `decideModelPress` would answer a tap.
        ...(hung ? null : { retryLabel: t("shell.action.retry") }),
      };
    case "ready":
      return {
        label: t(remoteActive ? "download.readyRemote" : "download.readyLocal"),
        tone: "good",
      };
    case "reload":
      return { label: t("chat.lazyReload"), tone: "accent" };
  }
}

/**
 * The pill's where-line as a STATUS claim: `shell.where.thisPhone` is only
 * true while this model can run here, so the host's own hard RAM/tier
 * refusal swaps it for a line that is true in the failure state. The bar's
 * error row still carries the reason below. String comparison on the two
 * refusal sentences is the idiom `modelErrorHint` uses for connectivity —
 * no structured gate reason reaches the UI.
 */
export function pillWhereLabel(args: {
  modelState: ModelPipelineState;
  modelError: string | null;
  t: TranslateFn;
}): TranslationKey {
  const { modelState, modelError, t } = args;
  const refusedHere =
    modelState === "error" &&
    (modelError === t("models.blockedRam") || modelError === t("models.blockedTier"));
  return refusedHere ? "shell.where.notRunning" : "shell.where.thisPhone";
}

/** `AppShell.tsx:2765-2777`: whole hours, half-hour fractions, sub-hour band. */
function formatEtaHours(t: TranslateFn, hours: number | undefined): string {
  if (hours === undefined) return "";
  if (hours < 1) return t("chat.batteryLessThanHour");
  const whole = Math.floor(hours);
  const frac = Math.round((hours - whole) * 2) / 2;
  return frac >= 0.5 ? `${whole} h 30 min` : `${whole} h`;
}

/** `AppShell.tsx:2781-2791`: one human phrase for the [low, high] band. */
function formatEtaBand(
  t: TranslateFn,
  low: number | undefined,
  high: number | undefined,
): string {
  const lo = formatEtaHours(t, low);
  const hi = formatEtaHours(t, high);
  if (lo === hi) return `~${lo}`;
  if (low !== undefined && low < 1) return `~${hi}`;
  return `~${lo}–${hi}`;
}

/**
 * `AppShell.tsx:2793-2830`: the advisory battery line. Empty unless a model
 * is ready, the native API answered and charge is at most 50 %. Advisory
 * only — nothing here ever blocks send or load.
 */
export function buildBatteryLines(
  eta: BatteryEtaUiState,
  modelState: ModelPipelineState,
  t: TranslateFn,
): Array<{ text: string; tone: ModelBarTone }> {
  const pct = eta.batteryPercent;
  if (!eta.apiAvailable || pct === null || pct > 50 || modelState !== "ready") {
    return [];
  }
  const kind = eta.kind;
  // F1: the explicit charging flag wins, so a plugged-in device never
  // renders the "keep generating" unknown copy.
  const charging = eta.charging === true;
  const isLow = pct <= 20;
  const tone: ModelBarTone =
    charging || kind !== "eta" || !isLow ? "muted" : "bad";
  const text = charging
    ? t("chat.batteryCharging")
    : kind === "eta"
      ? t("chat.batteryEstimate", { time: formatEtaBand(t, eta.lowHours, eta.highHours) })
      : kind === "measuring"
        ? t("chat.batteryMeasuring")
        : t("chat.batteryUnknown");
  const lines = [{ text, tone }];
  if (isLow && kind === "eta") {
    lines.push({ text: t("chat.batteryLowWarning"), tone: "bad" });
  }
  return lines;
}
