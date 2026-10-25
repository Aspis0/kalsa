import {
  beginBackendSwitch,
  disposeRemoteEngine,
  endBackendSwitch,
  setEngineBackendMode,
} from "../engine/engineBackend";
import { switchHostToRemoteComputer, type RemoteModelTransitionDeps } from "./remoteModelTransition";
import { makeT, en } from "../i18n";
import { subscribeModelSwitchSettled } from "./modelSwitchState";

jest.mock("../engine/engineBackend", () => ({
  beginBackendSwitch: jest.fn(),
  endBackendSwitch: jest.fn(),
  setEngineBackendMode: jest.fn(async () => undefined),
  disposeRemoteEngine: jest.fn(async () => undefined),
}));

jest.mock("./useNotice", () => ({ noticePort: { current: null } }));

const notice = jest.requireMock("./useNotice") as { noticePort: { current: jest.Mock | null } };

/** The deps every case shares; `memoryExtractRef`/`remoteErrorRef` per case. */
function transitionDeps(
  overrides: Partial<RemoteModelTransitionDeps> = {},
): RemoteModelTransitionDeps {
  return {
    engineGenerationRef: { current: 0 },
    chatGateGenRef: { current: null },
    markChatReleased: () => undefined,
    remoteActiveRef: { current: false },
    setRemoteActive: jest.fn(),
    setModelState: jest.fn(),
    setModelError: jest.fn(),
    setModelErrorKind: jest.fn(),
    setModelErrorDetail: jest.fn(),
    disposeCurrent: async () => true,
    ensureRemote: async () => true,
    memoryExtractRef: { current: null as Promise<void> | null },
    remoteErrorRef: { current: null as string | null },
    t: makeT("en"),
    ...overrides,
  };
};

describe("remote model transition commits the backend after dispose", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    notice.noticePort.current = jest.fn();
  });

  test("dispose, backend, surface, and ensure occur in that order", async () => {
    const order: string[] = [];
    const remoteActiveRef = { current: false };
    let settled = 0;
    const unsubscribe = subscribeModelSwitchSettled(() => { settled += 1; });
    switchHostToRemoteComputer(transitionDeps({
      remoteActiveRef,
      setRemoteActive: (active: boolean) => order.push(`remote:${active}`),
      setModelState: (state: string) => order.push(`state:${state}`),
      disposeCurrent: async () => {
        order.push("dispose");
        return true;
      },
      ensureRemote: async () => {
        order.push("ensure");
        return true;
      },
    }));

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
    switchHostToRemoteComputer(transitionDeps({
      setModelError: setError,
      disposeCurrent: async () => false,
      ensureRemote: ensure,
    }));

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
    switchHostToRemoteComputer(transitionDeps({
      remoteActiveRef,
      setModelError: setError,
    }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(remoteActiveRef.current).toBe(false);
    expect(setError).toHaveBeenCalledWith(en.settings.remoteBrainFailNetwork);
    expect(endBackendSwitch).toHaveBeenCalledTimes(1);
  });

  test("a pending memory extract is waited out before the dispose takes the engine", async () => {
    const order: string[] = [];
    let releaseExtract: (() => void) | undefined;
    const memoryExtractRef: { current: Promise<void> | null } = {
      current: new Promise<void>((resolve) => { releaseExtract = resolve; }),
    };
    switchHostToRemoteComputer(transitionDeps({
      memoryExtractRef,
      disposeCurrent: async () => {
        order.push("dispose");
        return true;
      },
      ensureRemote: async () => {
        order.push("ensure");
        return true;
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual([]);
    expect(memoryExtractRef.current).not.toBeNull();

    releaseExtract?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["dispose", "ensure"]);
    expect(memoryExtractRef.current).toBeNull();
  });

  test("a failed ensure speaks the published error through the one-slot notice", async () => {
    const remoteErrorRef = { current: en.settings.remoteBrainFailTimeout };
    switchHostToRemoteComputer(transitionDeps({
      remoteErrorRef,
      ensureRemote: async () => {
        remoteErrorRef.current = en.settings.remoteBrainFailTimeout;
        return false;
      },
    }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notice.noticePort.current).toHaveBeenCalledWith(en.settings.remoteBrainFailTimeout);
  });

  test("a superseded ensure stays silent — it is not a failure", async () => {
    switchHostToRemoteComputer(transitionDeps({
      ensureRemote: async () => false,
      remoteErrorRef: { current: null },
    }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notice.noticePort.current).not.toHaveBeenCalled();
  });
});
