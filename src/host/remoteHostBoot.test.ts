import {
  pickHostBootModel,
  planRemoteHostBoot,
} from "./remoteHostBoot";
import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import { MODEL_REGISTRY, getDefaultModel } from "../engine/ModelRegistry";
import { readFileSync } from "fs";
import { join } from "path";

const BOOT_HOOK = readFileSync(join(__dirname, "usePipelineScans.ts"), "utf8");

const localSnapshot = {
  backend: "local" as const,
  url: "https://computer.example",
  hydrationOk: true,
};

function plan(overrides: Partial<Parameters<typeof planRemoteHostBoot>[0]> = {}) {
  return planRemoteHostBoot({
    snapshot: localSnapshot,
    hydrationStale: false,
    savedModelId: "qwen-small",
    defaultLocalModelId: "qwen-default",
    remoteModelId: REMOTE_COMPUTER_MODEL_ID,
    modelSwitchInFlight: false,
    semanticRebuildBusy: false,
    documentDeleteBusy: false,
    ...overrides,
  });
}

describe("host boot preserves the remote boot contract", () => {
  test("a busy remote boot restores a valid local model until the remote flip can happen", async () => {
    const pick = jest.fn(async (id: string) => id);
    const defaultLocalModelId = getDefaultModel().id;
    const decision = plan({
      snapshot: { ...localSnapshot, backend: "remote" },
      savedModelId: REMOTE_COMPUTER_MODEL_ID,
      defaultLocalModelId,
      documentDeleteBusy: true,
    });

    expect(decision.kind).toBe("deferred-remote");
    if (decision.kind !== "deferred-remote") throw new Error("expected deferred remote boot");
    expect(decision.restoreModelId).toBe(defaultLocalModelId);
    expect(MODEL_REGISTRY.some((model) => model.id === decision.restoreModelId)).toBe(true);
    expect(await pickHostBootModel(decision, pick)).toBe(defaultLocalModelId);
    expect(pick).toHaveBeenCalledWith(defaultLocalModelId);
    expect(BOOT_HOOK).toContain("planRemoteHostBoot(");
    expect(BOOT_HOOK).toContain("pickHostBootModel(plan");
    expect(BOOT_HOOK).toContain('if (plan.kind === "remote") {');
    expect(BOOT_HOOK).toContain('if (plan.kind === "local") {');
    expect(BOOT_HOOK).toContain("documentDeleteBusy: isDeleteActive()");
  });

  test("a local decision still restores its saved model while a rebuild is busy", async () => {
    const pick = jest.fn(async (id: string) => id);
    const decision = plan({ semanticRebuildBusy: true });

    expect(decision.kind).toBe("local");
    expect(await pickHostBootModel(decision, pick)).toBe("qwen-small");
    expect(pick).toHaveBeenCalledWith("qwen-small");
  });

  test("a selected remote backend with no address demotes and persists only its remote id", () => {
    const decision = plan({
      snapshot: { ...localSnapshot, backend: "remote", url: "" },
      savedModelId: REMOTE_COMPUTER_MODEL_ID,
    });

    expect(decision).toMatchObject({
      kind: "local",
      restoreModelId: "qwen-default",
      persistRemoteDemotion: true,
    });
  });

  test("a tap that owns selection prevents boot from deciding over it", async () => {
    const pick = jest.fn(async (id: string) => id);
    const decision = plan({ modelSwitchInFlight: true });

    expect(await pickHostBootModel(decision, pick)).toBeNull();
    expect(pick).not.toHaveBeenCalled();
  });
});
