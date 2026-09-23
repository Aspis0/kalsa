import {
  beginBackendSwitch,
  disposeRemoteEngine,
  endBackendSwitch,
  setEngineBackendMode,
} from "../engine/engineBackend";
import { switchHostToRemoteComputer } from "./remoteModelTransition";
import { makeT, en } from "../i18n";
import { subscribeModelSwitchSettled } from "./modelSwitchState";

jest.mock("../engine/engineBackend", () => ({
  beginBackendSwitch: jest.fn(),
  endBackendSwitch: jest.fn(),
  setEngineBackendMode: jest.fn(async () => undefined),
  disposeRemoteEngine: jest.fn(async () => undefined),
}));

describe("remote model transition commits the backend after dispose", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
  });

  test("dispose, backend, surface, and ensure occur in that order", async () => {
    const order: string[] = [];
    const remoteActiveRef = { current: false };
    let settled = 0;
    const unsubscribe = subscribeModelSwitchSettled(() => { settled += 1; });
    switchHostToRemoteComputer({
      engineGenerationRef: { current: 0 },
      chatGateGenRef: { current: null },
      markChatReleased: () => undefined,
      remoteActiveRef,
      setRemoteActive: (active) => order.push(`remote:${active}`),
      setModelState: (state) => order.push(`state:${state}`),
      setModelError: () => undefined,
      setModelErrorKind: () => undefined,
      setModelErrorDetail: () => undefined,
      disposeCurrent: async () => {
        order.push("dispose");
        return true;
      },
      ensureRemote: async () => {
        order.push("ensure");
        return true;
      },
      t: makeT("en"),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["dispose", "remote:true", "state:loading", "ensure"]);
    expect(remoteActiveRef.current).toBe(true);
    expect(beginBackendSwitch).toHaveBeenCalledWith("remote");
    expect(setEngineBackendMode).toHaveBeenCalledWith("remote");
    expect(endBackendSwitch).toHaveBeenCalledTimes(1);
    expect(settled).toBe(1);
    unsubscribe();
  });

  test("a failed dispose never flips or ensures the remote backend", async () => {
    const ensure = jest.fn(async () => true);
    const setError = jest.fn();
    let settled = 0;
    const unsubscribe = subscribeModelSwitchSettled(() => { settled += 1; });
    switchHostToRemoteComputer({
      engineGenerationRef: { current: 0 },
      chatGateGenRef: { current: null },
      markChatReleased: () => undefined,
      remoteActiveRef: { current: false },
      setRemoteActive: jest.fn(),
      setModelState: jest.fn(),
      setModelError: setError,
      setModelErrorKind: jest.fn(),
      setModelErrorDetail: jest.fn(),
      disposeCurrent: async () => false,
      ensureRemote: ensure,
      t: makeT("en"),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ensure).not.toHaveBeenCalled();
    expect(setError).toHaveBeenCalledWith(en.errors.engineDisposeTimeout);
    expect(setEngineBackendMode).not.toHaveBeenCalledWith("remote");
    expect(endBackendSwitch).toHaveBeenCalledTimes(1);
    expect(settled).toBe(0);
    unsubscribe();
  });


  test("a thrown remote backend write is humanized and leaves the remote row unselected", async () => {
    const setError = jest.fn();
    const remoteActiveRef = { current: false };
    (setEngineBackendMode as jest.Mock).mockRejectedValueOnce(new Error("remote_brain_network"));
    switchHostToRemoteComputer({
      engineGenerationRef: { current: 0 },
      chatGateGenRef: { current: null },
      markChatReleased: jest.fn(),
      remoteActiveRef,
      setRemoteActive: jest.fn(),
      setModelState: jest.fn(),
      setModelError: setError,
      setModelErrorKind: jest.fn(),
      setModelErrorDetail: jest.fn(),
      disposeCurrent: async () => true,
      ensureRemote: jest.fn(async () => true),
      t: makeT("en"),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(remoteActiveRef.current).toBe(false);
    expect(setError).toHaveBeenCalledWith(en.settings.remoteBrainFailNetwork);
    expect(endBackendSwitch).toHaveBeenCalledTimes(1);
  });
});
