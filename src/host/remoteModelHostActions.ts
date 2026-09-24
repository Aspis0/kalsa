import { isDeleteActive } from "../documents/docOpGate";
import { regenInFlightRef } from "../engine/regenState";
import { downloadInFlightRef } from "./useModelDownload";
import { modelSwitchInFlightRef } from "./modelSwitchState";
import { trySelectRemoteComputer } from "./remoteModelSelection";
import { switchHostToRemoteComputer } from "./remoteModelTransition";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import type { ModelPipelineState } from "./hostPipelineState";
import type { TranslateFn, TranslationKey } from "../i18n";
import { noticePort } from "./useNotice";

export interface RemoteModelHostActionPorts {
  t: TranslateFn;
  engineGenerationRef: { current: number };
  chatGateGenRef: { current: number | null };
  markChatReleased: (generation: number) => void;
  remoteActiveRef: { current: boolean };
  setRemoteActive: (active: boolean) => void;
  modelStateRef: { current: ModelPipelineState };
  streamInFlightRef: { current: boolean };
  setModelState: (state: "loading" | "error") => void;
  setModelError: (message: string | null) => void;
  setModelErrorKind: (kind: "engine" | null) => void;
  setModelErrorDetail: (detail: string | null) => void;
  disposeCurrent: () => Promise<boolean>;
  ensureRemote: () => Promise<boolean>;
  selectLocalModel: (modelId: string) => void;
}

/** Keep the settings row's remote route and its live refusal state together. */
export function createRemoteModelHostActions(ports: RemoteModelHostActionPorts) {
  const refusalInput = () => ({
    downloadBusy: downloadInFlightRef.current,
    switchBusy: modelSwitchInFlightRef.current,
    modelState: ports.modelStateRef.current,
    streaming: ports.streamInFlightRef.current,
    regenerating: regenInFlightRef.current,
    semanticRebuildBusy: false,
    documentDeleteBusy: isDeleteActive(),
  });
  const announceRefusal = (reason: "busy" | "turn-active" | "documents-busy") => {
    const key: TranslationKey = reason === "busy"
      ? "settings.whereSwitchBusy"
      : reason === "turn-active"
        ? "settings.whereSwitchTurnBusy"
        : "settings.whereSwitchDocumentsBusy";
    noticePort.current?.(ports.t(key));
  };
  const selectRemoteComputer = () => {
    if (ports.remoteActiveRef.current) return true;
    return trySelectRemoteComputer(refusalInput(), announceRefusal, () =>
      switchHostToRemoteComputer({
        engineGenerationRef: ports.engineGenerationRef,
        chatGateGenRef: ports.chatGateGenRef,
        markChatReleased: ports.markChatReleased,
        remoteActiveRef: ports.remoteActiveRef,
        setRemoteActive: ports.setRemoteActive,
        setModelState: ports.setModelState,
        setModelError: ports.setModelError,
        setModelErrorKind: ports.setModelErrorKind,
        setModelErrorDetail: ports.setModelErrorDetail,
        disposeCurrent: ports.disposeCurrent,
        ensureRemote: ports.ensureRemote,
        t: ports.t,
      }),
    );
  };

  const selectLocalModel = (modelId: string) => {
    if (!ports.remoteActiveRef.current) return true;
    return trySelectRemoteComputer(refusalInput(), announceRefusal, () =>
      ports.selectLocalModel(modelId),
    );
  };

  const selectLocation = (location: "local" | "remote", localModelId: string) =>
    location === "remote" ? selectRemoteComputer() : selectLocalModel(localModelId);

  const routeModelById = (modelId: string): boolean => {
    if (modelId === REMOTE_COMPUTER_MODEL_ID) {
      selectRemoteComputer();
      return true;
    }
    if (!ports.remoteActiveRef.current) return false;
    selectLocalModel(modelId);
    return true;
  };

  return { selectRemoteComputer, selectLocalModel, selectLocation, routeModelById };
}
