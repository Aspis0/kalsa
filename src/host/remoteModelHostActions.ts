import { Alert } from "react-native";
import { isDeleteActive } from "../documents/docOpGate";
import { regenInFlightRef } from "../engine/regenState";
import { downloadInFlightRef } from "./useModelDownload";
import { modelSwitchInFlightRef } from "./modelSwitchState";
import { trySelectRemoteComputer } from "./remoteModelSelection";
import { switchHostToRemoteComputer } from "./remoteModelTransition";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import type { ModelPipelineState } from "./hostPipelineState";
import type { TranslateFn } from "../i18n";

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
}

/** Keep the settings row's remote route and its live refusal state together. */
export function createRemoteModelHostActions(ports: RemoteModelHostActionPorts) {
  const selectRemoteComputer = () =>
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
    });

  const routeModelById = (modelId: string): boolean => {
    if (modelId !== REMOTE_COMPUTER_MODEL_ID) return false;
    trySelectRemoteComputer(
      {
        downloadBusy: downloadInFlightRef.current,
        switchBusy: modelSwitchInFlightRef.current,
        modelState: ports.modelStateRef.current,
        streaming: ports.streamInFlightRef.current,
        regenerating: regenInFlightRef.current,
        semanticRebuildBusy: false,
        documentDeleteBusy: isDeleteActive(),
      },
      (reason) => {
        if (reason === "turn-active") {
          Alert.alert(ports.t("settings.switchWhileStreamingTitle"), ports.t("settings.switchWhileStreamingBody"));
        } else if (reason === "documents-busy") {
          Alert.alert(ports.t("settings.switchWhileRebuildingTitle"), ports.t("settings.switchWhileRebuildingBody"));
        }
      },
      selectRemoteComputer,
    );
    return true;
  };

  return { selectRemoteComputer, routeModelById };
}
