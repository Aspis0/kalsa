/**
 * Row plan for the Model sheet of the Where-it-responds section: local
 * mode lists this phone's models as the choices; computer mode lists no
 * phone model at all — one row saying what the computer runs, straight
 * from the door probe, or why it cannot say.
 */

import { humanRemoteBrainError } from "../engine/remote/remoteBrainErrors";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import type { AttachSheetRowData } from "../ui/shell/AttachSheet";

export type ComputerModelProbe =
  | { state: "checking" }
  | { state: "unreachable"; message: string }
  | { state: "ok"; modelId: string | null };

/** The verdict shape testRemoteConnection hands back. */
export type ComputerModelResult = {
  ok: boolean;
  modelId?: string | null;
  models?: string[];
  error?: string;
};

type Translate = Parameters<typeof humanRemoteBrainError>[1];

export type PhoneModelOption = {
  id: string;
  label: string;
  detail: string;
  disabled?: boolean;
};

export type ModelSheetLabels = {
  computerName: string;
  checking: string;
  unknownModel: string;
};

/** The probe's verdict in the row's words: an error is human copy, never a code. */
export function computerProbeFromResult(result: ComputerModelResult, t: Translate): ComputerModelProbe {
  if (!result.ok) {
    return { state: "unreachable", message: humanRemoteBrainError(result.error, t) };
  }
  const modelId = result.modelId || result.models?.[0] || null;
  return { state: "ok", modelId };
}

export type ModelSheetParams = {
  remoteActive: boolean;
  phoneOptions: readonly PhoneModelOption[];
  currentModelId: string;
  probe: ComputerModelProbe;
  labels: ModelSheetLabels;
  onSelectPhone: (id: string) => void;
  onSelectComputer: () => void;
};

/**
 * In computer mode the phone's models are not choices — hiding them is
 * the point, so this never returns a selectable phone row beside the
 * computer's.
 */
export function modelSheetRows(params: ModelSheetParams): AttachSheetRowData[] {
  if (!params.remoteActive) {
    return params.phoneOptions.map((option) => ({
      testID: `settings.sheet.model.${option.id}`,
      label: `${option.label} · ${option.detail}`,
      role: "radio" as const,
      selected: option.id === params.currentModelId,
      disabled: option.disabled === true,
      onPress: () => params.onSelectPhone(option.id),
    }));
  }
  const probe = params.probe;
  const label =
    probe.state === "checking"
      ? params.labels.checking
      : probe.state === "unreachable"
        ? probe.message
        : probe.modelId !== null
          ? `${params.labels.computerName} · ${probe.modelId}`
          : params.labels.unknownModel;
  return [
    {
      testID: "settings.sheet.model.computer",
      label,
      role: "radio",
      selected: params.currentModelId === REMOTE_COMPUTER_MODEL_ID,
      // No served model known: the row informs, it does not offer a choice.
      disabled: probe.state !== "ok" || probe.modelId === null,
      onPress: params.onSelectComputer,
    },
  ];
}
