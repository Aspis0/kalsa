import { readFileSync } from "fs";
import { join } from "path";
import { runLocalEnsureGate } from "./localEnsureGate";

const ENSURE = readFileSync(join(__dirname, "engineEnsure.ts"), "utf8");

describe("local ensure during a remote-to-local selection window", () => {
  test("does not start a local load while the engine facade is still remote", async () => {
    const localLoad = jest.fn(async () => true);

    await expect(runLocalEnsureGate(true, localLoad)).resolves.toBe(false);
    expect(localLoad).not.toHaveBeenCalled();

    await expect(runLocalEnsureGate(false, localLoad)).resolves.toBe(true);
    expect(localLoad).toHaveBeenCalledTimes(1);
    expect(ENSURE).toContain(
      "runLocalEnsureGate(isRemoteEngineBackend(), () => ensureLocalEngineForModel(deps, model))",
    );
  });
});
