import { REMOTE_COMPUTER_MODEL_ID } from "./remote/remoteComputerModel";
import {
  captureEnsureIntent,
  ensureIntentKey,
  ensureIntentStale,
  ensureOutcome,
  InFlightEnsures,
} from "./ensureIntent";

describe("ensureIntent", () => {
  test("stale remote ensure cannot commit after a local selection", () => {
    const captured = captureEnsureIntent(0, REMOTE_COMPUTER_MODEL_ID);
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
    const captured = captureEnsureIntent(1, REMOTE_COMPUTER_MODEL_ID);
    expect(
      ensureIntentStale(captured, {
        generation: 1,
        modelId: REMOTE_COMPUTER_MODEL_ID,
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

describe("ensureOutcome", () => {
  const captured = captureEnsureIntent(4, "qwen-local");
  const sameIntent = { generation: 4, modelId: "qwen-local", remote: false };
  const movedOn = { generation: 5, modelId: "qwen-local", remote: false };

  test("a ready attempt is ready no matter what happened meanwhile", () => {
    expect(ensureOutcome({ ready: true, captured, live: movedOn })).toBe("ready");
  });

  test("not ready while the intent is still current is a failure", () => {
    expect(ensureOutcome({ ready: false, captured, live: sameIntent })).toBe(
      "failed",
    );
  });

  test("not ready after the intent moved on is superseded, not a failure", () => {
    // The whole point: a losing attempt must not be reported as an error in the
    // conversation, and must not be mistaken for success either.
    expect(ensureOutcome({ ready: false, captured, live: movedOn })).toBe(
      "superseded",
    );
  });
});

describe("ensureIntentKey", () => {
  test("identifies generation, backend and model", () => {
    expect(ensureIntentKey(captureEnsureIntent(2, REMOTE_COMPUTER_MODEL_ID))).toBe(
      "2:remote:kalsa-remote-mac",
    );
    expect(ensureIntentKey(captureEnsureIntent(2, "qwen-local"))).toBe(
      "2:local:qwen-local",
    );
    expect(ensureIntentKey(captureEnsureIntent(3, "qwen-local"))).not.toBe(
      ensureIntentKey(captureEnsureIntent(2, "qwen-local")),
    );
  });
});

describe("InFlightEnsures", () => {
  test("a second request for the same intent joins the first attempt", async () => {
    const ensures = new InFlightEnsures<string>();
    let started = 0;
    let release: (value: string) => void = () => undefined;
    const start = () => {
      started += 1;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    };
    const first = ensures.run("4:remote:x", start);
    const second = ensures.run("4:remote:x", start);
    expect(started).toBe(1);
    expect(second).toBe(first);
    release("ready");
    expect(await first).toBe("ready");
    expect(await second).toBe("ready");
  });

  test("a different intent starts its own attempt", () => {
    const ensures = new InFlightEnsures<string>();
    let started = 0;
    const start = () => {
      started += 1;
      return Promise.resolve("ready");
    };
    void ensures.run("4:remote:x", start);
    void ensures.run("5:remote:x", start);
    expect(started).toBe(2);
  });

  test("a settled attempt is not shared again", async () => {
    const ensures = new InFlightEnsures<string>();
    let started = 0;
    const start = () => {
      started += 1;
      return Promise.resolve("ready");
    };
    await ensures.run("4:remote:x", start);
    await ensures.run("4:remote:x", start);
    expect(started).toBe(2);
  });

  test("a rejected attempt is not shared again either", async () => {
    const ensures = new InFlightEnsures<string>();
    let started = 0;
    const start = () => {
      started += 1;
      return Promise.reject(new Error("init failed"));
    };
    await expect(ensures.run("4:remote:x", start)).rejects.toThrow("init failed");
    await expect(ensures.run("4:remote:x", start)).rejects.toThrow("init failed");
    expect(started).toBe(2);
  });
});
