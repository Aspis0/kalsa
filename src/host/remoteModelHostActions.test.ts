import { createRemoteModelHostActions } from "./remoteModelHostActions";
import { switchHostToRemoteComputer } from "./remoteModelTransition";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import { Alert } from "react-native";

jest.mock("./remoteModelTransition", () => ({ switchHostToRemoteComputer: jest.fn() }));
jest.mock("./useModelDownload", () => ({ downloadInFlightRef: { current: false } }));
jest.mock("./modelSwitchState", () => ({ modelSwitchInFlightRef: { current: false } }));
jest.mock("../engine/regenState", () => ({ regenInFlightRef: { current: false } }));
jest.mock("../documents/docOpGate", () => ({ isDeleteActive: jest.fn(() => false) }));
jest.mock("react-native", () => ({ Alert: { alert: jest.fn() } }));

const makePorts = (overrides: Record<string, unknown> = {}) => ({
  t: (key: string) => key,
  engineGenerationRef: { current: 0 },
  chatGateGenRef: { current: null },
  markChatReleased: jest.fn(),
  remoteActiveRef: { current: false },
  setRemoteActive: jest.fn(),
  modelStateRef: { current: "ready" as const },
  streamInFlightRef: { current: false },
  setModelState: jest.fn(),
  setModelError: jest.fn(),
  setModelErrorKind: jest.fn(),
  setModelErrorDetail: jest.fn(),
  disposeCurrent: jest.fn(async () => true),
  ensureRemote: jest.fn(async () => true),
  ...overrides,
});

describe("the settings remote row uses the live host refusal route", () => {
  const regen = jest.requireMock("../engine/regenState") as { regenInFlightRef: { current: boolean } };
  const deletion = jest.requireMock("../documents/docOpGate") as { isDeleteActive: jest.Mock };
  const download = jest.requireMock("./useModelDownload") as { downloadInFlightRef: { current: boolean } };

  beforeEach(() => {
    jest.clearAllMocks();
    regen.regenInFlightRef.current = false;
    deletion.isDeleteActive.mockReturnValue(false);
    download.downloadInFlightRef.current = false;
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
      if (busyKind === "document deletion") {
        expect(Alert.alert).toHaveBeenCalledWith(
          "settings.switchWhileRebuildingTitle",
          "settings.switchWhileRebuildingBody",
        );
      }
    },
  );

  test("loading and a model switch are inert, while an idle remote row dispatches once", () => {
    const modelSwitch = jest.requireMock("./modelSwitchState") as { modelSwitchInFlightRef: { current: boolean } };
    modelSwitch.modelSwitchInFlightRef.current = true;
    const actions = createRemoteModelHostActions(makePorts() as never);
    actions.routeModelById(REMOTE_COMPUTER_MODEL_ID);
    expect(switchHostToRemoteComputer).not.toHaveBeenCalled();

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
});
