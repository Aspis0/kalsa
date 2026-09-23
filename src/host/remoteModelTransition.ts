import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  beginBackendSwitch,
  endBackendSwitch,
  setEngineBackendMode,
} from "../engine/engineBackend";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import {
  MODEL_STORAGE_KEY,
  modelSwitchInFlightRef,
  notifyModelSwitchSettled,
} from "./modelSwitchState";
import { hostEngineErrorText } from "./remoteEngineError";
import type { TranslateFn } from "../i18n";

export interface RemoteModelTransitionDeps {
  engineGenerationRef: { current: number };
  chatGateGenRef: { current: number | null };
  markChatReleased: (generation: number) => void;
  remoteActiveRef: { current: boolean };
  setRemoteActive: (active: boolean) => void;
  setModelState: (state: "loading" | "error") => void;
  setModelError: (message: string | null) => void;
  setModelErrorKind: (kind: "engine" | null) => void;
  setModelErrorDetail: (detail: string | null) => void;
  disposeCurrent: () => Promise<boolean>;
  ensureRemote: () => Promise<boolean>;
  t: TranslateFn;
}

/** Runs the accepted remote flip only after the current engine disposed. */
export function switchHostToRemoteComputer(deps: RemoteModelTransitionDeps): void {
  if (modelSwitchInFlightRef.current) return;
  modelSwitchInFlightRef.current = true;
  deps.engineGenerationRef.current += 1;
  const releasedGen = deps.chatGateGenRef.current;
  deps.chatGateGenRef.current = null;
  beginBackendSwitch("remote");
  void (async () => {
    let disposed = false;
    try {
      if (!(await deps.disposeCurrent())) {
        deps.setModelState("error");
        deps.setModelErrorKind("engine");
        deps.setModelError(deps.t("errors.engineDisposeTimeout"));
        deps.setModelErrorDetail(null);
        return;
      }
      disposed = true;
      await setEngineBackendMode("remote");
      deps.remoteActiveRef.current = true;
      deps.setRemoteActive(true);
      AsyncStorage.setItem(MODEL_STORAGE_KEY, REMOTE_COMPUTER_MODEL_ID).catch(() => undefined);
      deps.setModelState("loading");
      await deps.ensureRemote();
    } catch (error) {
      deps.remoteActiveRef.current = false;
      deps.setRemoteActive(false);
      deps.setModelState("error");
      deps.setModelErrorKind("engine");
      const raw = error instanceof Error ? error.message : String(error);
      deps.setModelError(hostEngineErrorText(raw, true, deps.t));
      deps.setModelErrorDetail(null);
    } finally {
      if (releasedGen !== null) deps.markChatReleased(releasedGen);
      modelSwitchInFlightRef.current = false;
      endBackendSwitch();
      if (disposed) notifyModelSwitchSettled();
    }
  })();
}
