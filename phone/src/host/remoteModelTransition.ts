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
import { waitForMemoryExtract } from "./memoryExtractWait";
import { noticePort } from "./useNotice";
import { cancelPendingEagerKick } from "./eagerKickDelay";
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
  /** The turn-end extract the dispose must not race (`memoryExtractWait.ts`). */
  memoryExtractRef: { current: Promise<void> | null };
  /** The human text of the last failed remote ensure, null when none. */
  remoteErrorRef: { current: string | null };
  t: TranslateFn;
}

/**
 * Runs the accepted remote flip only after the current engine disposed. Every
 * failed exit says so through the one-slot notice: the pill's sheet is already
 * closed by then, and the model bar's error line lives inside that sheet, so a
 * silent failure would leave the strip claiming the computer answers.
 */
export function switchHostToRemoteComputer(deps: RemoteModelTransitionDeps): void {
  if (modelSwitchInFlightRef.current) return;
  modelSwitchInFlightRef.current = true;
  deps.engineGenerationRef.current += 1;
  // A pending bench-delayed eager kick belongs to the pre-switch generation;
  // firing it inside the dispose→remote window would reload the local engine.
  cancelPendingEagerKick("model_switch");
  const releasedGen = deps.chatGateGenRef.current;
  deps.chatGateGenRef.current = null;
  beginBackendSwitch("remote");
  void (async () => {
    let disposed = false;
    try {
      // The extract owns the engine the dispose is about to take; wait it out
      // exactly as the local model switch does.
      await waitForMemoryExtract(deps.memoryExtractRef);
      if (!(await deps.disposeCurrent())) {
        const message = deps.t("errors.engineDisposeTimeout");
        deps.setModelState("error");
        deps.setModelErrorKind("engine");
        deps.setModelError(message);
        deps.setModelErrorDetail(null);
        noticePort.current?.(message);
        return;
      }
      disposed = true;
      await setEngineBackendMode("remote");
      deps.remoteActiveRef.current = true;
      deps.setRemoteActive(true);
      AsyncStorage.setItem(MODEL_STORAGE_KEY, REMOTE_COMPUTER_MODEL_ID).catch(() => undefined);
      deps.setModelState("loading");
      if (!(await deps.ensureRemote())) {
        // An init failure publishes its human text on `remoteErrorRef`; a
        // superseded ensure leaves it null and must stay silent.
        if (deps.remoteErrorRef.current !== null) {
          noticePort.current?.(deps.remoteErrorRef.current);
        }
      }
    } catch (error) {
      deps.remoteActiveRef.current = false;
      deps.setRemoteActive(false);
      deps.setModelState("error");
      deps.setModelErrorKind("engine");
      const raw = error instanceof Error ? error.message : String(error);
      const message = hostEngineErrorText(raw, true, deps.t);
      deps.setModelError(message);
      deps.setModelErrorDetail(null);
      noticePort.current?.(message);
    } finally {
      if (releasedGen !== null) deps.markChatReleased(releasedGen);
      modelSwitchInFlightRef.current = false;
      endBackendSwitch();
      if (disposed) notifyModelSwitchSettled();
    }
  })();
}
