import { createRemoteModelHostActions } from "./remoteModelHostActions";
import { switchHostToRemoteComputer } from "./remoteModelTransition";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";

jest.mock("./remoteModelTransition", () => ({ switchHostToRemoteComputer: jest.fn() }));
jest.mock("./useModelDownload", () => ({ downloadInFlightRef: { current: false } }));
jest.mock("./modelSwitchState", () => ({ modelSwitchInFlightRef: { current: false } }));
jest.mock("../engine/regenState", () => ({
  regenInFlightRef: { current: false },
  sendClaimRef: { current: false },
}));
jest.mock("../documents/docOpGate", () => ({ isDeleteActive: jest.fn(() => false) }));
jest.mock("./useNotice", () => ({ noticePort: { current: null } }));
const makePorts = (overrides: Record<string, unknown> = {}) => ({
  t: (key: string) => key,
  engineGenerationRef: { current: 0 },
  chatGateGenRef: { current: null },
  markChatReleased: jest.fn(),
  remoteActiveRef: { current: false },
  setRemoteActive: jest.fn(),
  modelStateRef: { current: "ready" as const },
  streamInFlightRef: { current: false },
  memoryExtractRef: { current: null as Promise<void> | null },
  remoteErrorRef: { current: null as string | null },
  setModelState: jest.fn(),
  setModelError: jest.fn(),
  setModelErrorKind: jest.fn(),
  setModelErrorDetail: jest.fn(),
  disposeCurrent: jest.fn(async () => true),
  ensureRemote: jest.fn(async () => true),
  selectLocalModel: jest.fn(),
  ...overrides,
});

describe("the settings remote row uses the live host refusal route", () => {
  const regen = jest.requireMock("../engine/regenState") as {
    regenInFlightRef: { current: boolean };
    sendClaimRef: { current: boolean };
  };
  const deletion = jest.requireMock("../documents/docOpGate") as { isDeleteActive: jest.Mock };
  const download = jest.requireMock("./useModelDownload") as { downloadInFlightRef: { current: boolean } };
  const notice = jest.requireMock("./useNotice") as { noticePort: { current: jest.Mock | null } };

  beforeEach(() => {
    jest.clearAllMocks();
    regen.regenInFlightRef.current = false;
    regen.sendClaimRef.current = false;
    deletion.isDeleteActive.mockReturnValue(false);
    download.downloadInFlightRef.current = false;
    notice.noticePort.current = jest.fn();
  });

  test.each(["stream", "regeneration", "document deletion"] as const)(
    "a %s refuses the actual settings route before transition dispatch",
    (busyKind) => {
      const state = makePorts();
      if (busyKind === "stream") state.streamInFlightRef.current = true;
      if (busyKind === "regeneration") regen.regenInFlightRef.current = true;
      if (busyKind === "document deletion") deletion.isDeleteActive.mockReturnValue(true);
      const actions = createRemoteModelHostActions(state as never);

      expect(actions.routeModelById(REMOTE_COMPUTER_MODEL_ID)).toBe(true);
      expect(switchHostToRemoteComputer).not.toHaveBeenCalled();
      expect(notice.noticePort.current).toHaveBeenCalledWith(
        busyKind === "document deletion"
          ? "settings.whereSwitchDocumentsBusy"
          : "settings.whereSwitchTurnBusy",
      );
    },
  );

  test("loading and a model switch are inert, while an idle remote row dispatches once", () => {
    const modelSwitch = jest.requireMock("./modelSwitchState") as { modelSwitchInFlightRef: { current: boolean } };
    modelSwitch.modelSwitchInFlightRef.current = true;
    const busyState = makePorts();
    const actions = createRemoteModelHostActions(busyState as never);
    actions.routeModelById(REMOTE_COMPUTER_MODEL_ID);
    expect(switchHostToRemoteComputer).not.toHaveBeenCalled();
    expect(notice.noticePort.current).toHaveBeenCalledWith("settings.whereSwitchBusy");

    modelSwitch.modelSwitchInFlightRef.current = false;
    const download = jest.requireMock("./useModelDownload") as { downloadInFlightRef: { current: boolean } };
    download.downloadInFlightRef.current = true;
    const downloading = createRemoteModelHostActions(makePorts() as never);
    downloading.routeModelById(REMOTE_COMPUTER_MODEL_ID);
    expect(switchHostToRemoteComputer).not.toHaveBeenCalled();
    download.downloadInFlightRef.current = false;

    const loading = createRemoteModelHostActions(makePorts({ modelStateRef: { current: "loading" } }) as never);
    loading.routeModelById(REMOTE_COMPUTER_MODEL_ID);
    expect(switchHostToRemoteComputer).not.toHaveBeenCalled();

    const idle = createRemoteModelHostActions(makePorts() as never);
    expect(idle.routeModelById("qwen-small")).toBe(false);
    idle.routeModelById(REMOTE_COMPUTER_MODEL_ID);
    expect(switchHostToRemoteComputer).toHaveBeenCalledTimes(1);
  });

  test("the location choice dispatches through the host remote and local selectors", () => {
    const remote = createRemoteModelHostActions(makePorts() as never);
    expect(remote.selectLocation("remote", "lfm-local")).toBe(true);
    expect(switchHostToRemoteComputer).toHaveBeenCalledTimes(1);

    const localPorts = makePorts({
      remoteActiveRef: { current: true },
      modelStateRef: { current: "error" },
    });
    const local = createRemoteModelHostActions(localPorts as never);
    expect(local.selectLocation("local", "lfm-local")).toBe(true);
    expect(localPorts.selectLocalModel).toHaveBeenCalledWith("lfm-local");
    expect(switchHostToRemoteComputer).toHaveBeenCalledTimes(1);
  });

  test.each(["stream", "regeneration", "document deletion"] as const)(
    "a local return refused during %s shows a notice and does not dispatch",
    (busyKind) => {
      const state = makePorts({ remoteActiveRef: { current: true } });
      if (busyKind === "stream") state.streamInFlightRef.current = true;
      if (busyKind === "regeneration") regen.regenInFlightRef.current = true;
      if (busyKind === "document deletion") deletion.isDeleteActive.mockReturnValue(true);
      const actions = createRemoteModelHostActions(state as never);

      expect(actions.selectLocation("local", "lfm-local")).toBe(false);
      expect(notice.noticePort.current).toHaveBeenCalledWith(
        busyKind === "document deletion"
          ? "settings.whereSwitchDocumentsBusy"
          : "settings.whereSwitchTurnBusy",
      );
      expect(state.selectLocalModel).not.toHaveBeenCalled();
    },
  );
});

describe("the pre-await send claim and the running extract hold the switch too", () => {
  const regen = jest.requireMock("../engine/regenState") as {
    sendClaimRef: { current: boolean };
  };
  const notice = jest.requireMock("./useNotice") as { noticePort: { current: jest.Mock | null } };
  const deletion = jest.requireMock("../documents/docOpGate") as { isDeleteActive: jest.Mock };

  beforeEach(() => {
    notice.noticePort.current = jest.fn();
    regen.sendClaimRef.current = false;
    deletion.isDeleteActive.mockReturnValue(false);
  });

  test("a held send claim refuses both routes with the turn notice", () => {
    regen.sendClaimRef.current = true;
    const state = makePorts();
    const actions = createRemoteModelHostActions(state as never);

    actions.routeModelById(REMOTE_COMPUTER_MODEL_ID);
    expect(switchHostToRemoteComputer).not.toHaveBeenCalled();
    expect(notice.noticePort.current).toHaveBeenCalledWith("settings.whereSwitchTurnBusy");
    expect(actions.selectLocation("remote", "lfm-local")).toBe(false);
    expect(switchHostToRemoteComputer).not.toHaveBeenCalled();
    expect(actions.locationSwitchBlocked()).toBe(true);
  });

  test("a running memory extract refuses with the model-operation notice", () => {
    const state = makePorts({ memoryExtractRef: { current: Promise.resolve() } });
    const actions = createRemoteModelHostActions(state as never);

    expect(actions.selectLocation("remote", "lfm-local")).toBe(false);
    expect(switchHostToRemoteComputer).not.toHaveBeenCalled();
    expect(notice.noticePort.current).toHaveBeenCalledWith("settings.whereSwitchBusy");
    expect(actions.locationSwitchBlocked()).toBe(true);
  });

  test("the pill's blocked flag is the same verdict the press gets, idle included", () => {
    const idle = createRemoteModelHostActions(makePorts() as never);
    expect(idle.locationSwitchBlocked()).toBe(false);

    const state = makePorts();
    const actions = createRemoteModelHostActions(state as never);
    state.streamInFlightRef.current = true;
    expect(actions.locationSwitchBlocked()).toBe(true);
    expect(actions.selectLocation("remote", "lfm-local")).toBe(false);
  });
});
