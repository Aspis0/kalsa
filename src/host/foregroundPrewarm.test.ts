import type { AppStateStatus } from "react-native";
import type { EngineTool } from "../engine/LlamaService";
import type { ModelInfo } from "../engine/ModelRegistry";
import { subscribeForegroundPrewarm, type ForegroundPrewarmSnapshot } from "./foregroundPrewarm";

function harness(snapshot: ForegroundPrewarmSnapshot) {
  let listener: ((state: AppStateStatus) => void) | undefined;
  const queue = jest.fn(async (_locale: string, _tools?: EngineTool[]) => undefined);
  const logSkip = jest.fn();
  const remove = jest.fn();
  const stop = subscribeForegroundPrewarm({
    subscribe: (callback) => {
      listener = callback;
      return { remove };
    },
    read: () => snapshot,
    queue,
    logSkip,
  });
  return {
    fire: (state: AppStateStatus) => listener?.(state),
    queue,
    logSkip,
    remove,
    stop,
  };
}

const model = { id: "local-model" } as ModelInfo;

describe("foreground static-prefix prewarm", () => {
  test("only an active event queues the matching local model with current inputs", () => {
    const tools: EngineTool[] = [{
      type: "function",
      function: { name: "web_search", description: "Search", parameters: {} },
    }];
    const h = harness({
      thermalBlocked: false,
      remote: false,
      model,
      locale: "it",
      tools,
      engineReady: true,
      activeModelId: model.id,
    });

    h.fire("background");
    expect(h.queue).not.toHaveBeenCalled();
    h.fire("active");
    expect(h.queue).toHaveBeenCalledTimes(1);
    expect(h.queue).toHaveBeenCalledWith("it", tools);
    expect(h.logSkip).not.toHaveBeenCalled();
    h.stop();
    expect(h.remove).toHaveBeenCalledTimes(1);
  });

  test("thermal gate and remote mode never submit a local prewarm", () => {
    const thermal = harness({
      thermalBlocked: true,
      remote: false,
      model,
      locale: "en",
      engineReady: true,
      activeModelId: model.id,
    });
    thermal.fire("active");
    expect(thermal.logSkip).toHaveBeenCalledWith("thermal_gate");
    expect(thermal.queue).not.toHaveBeenCalled();

    const remote = harness({
      thermalBlocked: false,
      remote: true,
      model,
      locale: "en",
      engineReady: true,
      activeModelId: model.id,
    });
    remote.fire("active");
    expect(remote.queue).not.toHaveBeenCalled();
    expect(remote.logSkip).not.toHaveBeenCalled();
  });

  test.each([
    [null, false, null, "no_model"],
    [model, false, null, "not_ready"],
    [model, true, "another-model", "model_changed"],
  ] as const)("does not prewarm when the active model is unavailable or changed", (currentModel, ready, activeId, reason) => {
    const h = harness({
      thermalBlocked: false,
      remote: false,
      model: currentModel,
      locale: "en",
      engineReady: ready,
      activeModelId: activeId,
    });
    h.fire("active");
    expect(h.queue).not.toHaveBeenCalled();
    expect(h.logSkip).toHaveBeenCalledWith(reason);
  });
});
