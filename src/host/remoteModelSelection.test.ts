import { readFileSync } from "fs";
import { join } from "path";
import { trySelectRemoteComputer } from "./remoteModelSelection";

const HOST = readFileSync(join(__dirname, "remoteModelHostActions.ts"), "utf8");
const READY = {
  downloadBusy: false,
  switchBusy: false,
  modelState: "ready" as const,
  streaming: false,
  regenerating: false,
  semanticRebuildBusy: false,
  documentDeleteBusy: false,
};

describe("remote selection respects the main-shell refusals", () => {
  test.each([
    ["download", { downloadBusy: true }, "busy"],
    ["switch", { switchBusy: true }, "busy"],
    ["download state", { modelState: "downloading" }, "busy"],
    ["stream", { streaming: true }, "turn-active"],
    ["regenerate", { regenerating: true }, "turn-active"],
    ["delete", { documentDeleteBusy: true }, "documents-busy"],
    ["rebuild", { semanticRebuildBusy: true }, "documents-busy"],
  ] as const)("a %s in flight never dispatches a remote switch", (_name, override, refusal) => {
    const dispatch = jest.fn();
    const onRefusal = jest.fn();
    const accepted = trySelectRemoteComputer({ ...READY, ...override }, onRefusal, dispatch);

    expect(accepted).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    if (refusal === "busy") expect(onRefusal).not.toHaveBeenCalled();
    else expect(onRefusal).toHaveBeenCalledWith(refusal);
    expect(HOST).toContain("trySelectRemoteComputer(");
  });

  test("a loading/download operation is inert, and an idle row dispatches once", () => {
    const dispatch = jest.fn();
    const onRefusal = jest.fn();

    expect(
      trySelectRemoteComputer({ ...READY, modelState: "loading" }, onRefusal, dispatch),
    ).toBe(false);
    expect(trySelectRemoteComputer(READY, onRefusal, dispatch)).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
