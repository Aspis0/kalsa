import { readFileSync } from "fs";
import { join } from "path";
import { REMOTE_COMPUTER_MODEL, REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import { createTurnEnsure } from "./turnEnsureDispatch";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");
const HOST_DEPS = read("hostDeps.ts");
const HOST_ENGINE = read("useHostEngine.ts");
const MODEL_HOST = read("useModelHost.ts");
const TURN = read("engineTurn.ts");

describe("send-time model ensure uses the host's backend dispatcher", () => {
  test("a remote turn reaches remote ensure and never the local loader", async () => {
    const localEnsure = jest.fn(async () => true);
    const remoteEnsure = jest.fn(async () => true);
    const ensureRef = {
      current: (model: { id: string }) =>
        model.id === REMOTE_COMPUTER_MODEL_ID ? remoteEnsure() : localEnsure(),
    };

    await createTurnEnsure(ensureRef)(REMOTE_COMPUTER_MODEL);

    expect(remoteEnsure).toHaveBeenCalledTimes(1);
    expect(localEnsure).not.toHaveBeenCalled();
    // The behavioral probe is tied to the exact ref the model host routes and
    // the turn consumes; returning to the local loader breaks this same test.
    expect(HOST_DEPS).toContain("ensureEngineForModel: createTurnEnsure(input.ensureEngineForModelRef)");
    expect(HOST_ENGINE).toContain("ensureEngineForModelRef: modelHost.scanRefs.ensureEngineForModelRef");
    expect(MODEL_HOST).toContain("model.id === REMOTE_COMPUTER_MODEL_ID");
    expect(TURN).toContain("if (!(await ensureEngineForModel(currentModel)))");
  });
});
