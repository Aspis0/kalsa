import { REMOTE_MAC_MODEL_ID } from "./remote/remoteMacModel";
import {
  captureEnsureIntent,
  ensureIntentStale,
} from "./ensureIntent";

describe("ensureIntent", () => {
  test("stale remote ensure cannot commit after a local selection", () => {
    const captured = captureEnsureIntent(0, REMOTE_MAC_MODEL_ID);
    expect(captured.remote).toBe(true);
    const afterLocalSelect = {
      generation: 1,
      modelId: "qwen-local",
      remote: false,
    };
    expect(ensureIntentStale(captured, afterLocalSelect)).toBe(true);
  });

  test("same generation/model/backend is current", () => {
    const captured = captureEnsureIntent(3, "qwen-local");
    expect(
      ensureIntentStale(captured, {
        generation: 3,
        modelId: "qwen-local",
        remote: false,
      }),
    ).toBe(false);
  });

  test("backend flip without matching request is stale", () => {
    const captured = captureEnsureIntent(1, REMOTE_MAC_MODEL_ID);
    expect(
      ensureIntentStale(captured, {
        generation: 1,
        modelId: REMOTE_MAC_MODEL_ID,
        remote: false,
      }),
    ).toBe(true);
  });

  test("model id change at same generation is stale", () => {
    const captured = captureEnsureIntent(2, "a");
    expect(
      ensureIntentStale(captured, { generation: 2, modelId: "b", remote: false }),
    ).toBe(true);
  });
});
