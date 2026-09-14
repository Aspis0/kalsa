import { REMOTE_COMPUTER_MODEL_ID } from "./remote/remoteComputerModel";
import {
  captureEnsureIntent,
  ensureIntentKey,
  ensureIntentStale,
  ensureOutcome,
  InFlightEnsures,
  type EnsureIntent,
} from "./ensureIntent";

/** The remote settings an attempt reads; the caller passes them in. */
const SERVER_A = { url: "https://mac-a.example.ts.net", serverModelId: "ornith" };
const SERVER_B = { url: "https://mac-b.example.ts.net", serverModelId: "ornith" };

function remoteIntent(
  generation: number,
  configuration = SERVER_A,
): EnsureIntent {
  return captureEnsureIntent(generation, REMOTE_COMPUTER_MODEL_ID, configuration);
}

describe("ensureIntent", () => {
  test("stale remote ensure cannot commit after a local selection", () => {
    const captured = captureEnsureIntent(0, REMOTE_COMPUTER_MODEL_ID, SERVER_A);
    expect(captured.remote).toBe(true);
    const afterLocalSelect = {
      generation: 1,
      modelId: "qwen-local",
      remote: false,
      remoteConfig: null,
    };
    expect(ensureIntentStale(captured, afterLocalSelect)).toBe(true);
  });

  test("same generation/model/backend is current", () => {
    const captured = captureEnsureIntent(3, "qwen-local", SERVER_A);
    expect(
      ensureIntentStale(captured, {
        generation: 3,
        modelId: "qwen-local",
        remote: false,
        remoteConfig: null,
      }),
    ).toBe(false);
  });

  test("backend flip without matching request is stale", () => {
    const captured = captureEnsureIntent(1, REMOTE_COMPUTER_MODEL_ID, SERVER_A);
    expect(
      ensureIntentStale(captured, {
        generation: 1,
        modelId: REMOTE_COMPUTER_MODEL_ID,
        remote: false,
        remoteConfig: null,
      }),
    ).toBe(true);
  });

  test("model id change at same generation is stale", () => {
    const captured = captureEnsureIntent(2, "a", SERVER_A);
    expect(
      ensureIntentStale(captured, {
        generation: 2,
        modelId: "b",
        remote: false,
        remoteConfig: null,
      }),
    ).toBe(true);
  });
});

describe("ensureOutcome", () => {
  const captured = captureEnsureIntent(4, "qwen-local", SERVER_A);
  const sameIntent = {
    generation: 4,
    modelId: "qwen-local",
    remote: false,
    remoteConfig: null,
  };
  const movedOn = {
    generation: 5,
    modelId: "qwen-local",
    remote: false,
    remoteConfig: null,
  };

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
    expect(ensureIntentKey(remoteIntent(2))).toBe(
      `2:remote:kalsa-remote-mac:${SERVER_A.url}|${SERVER_A.serverModelId}`,
    );
    expect(ensureIntentKey(captureEnsureIntent(2, "qwen-local", SERVER_A))).toBe(
      "2:local:qwen-local:",
    );
    expect(ensureIntentKey(captureEnsureIntent(3, "qwen-local", SERVER_A))).not.toBe(
      ensureIntentKey(captureEnsureIntent(2, "qwen-local", SERVER_A)),
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
    const first = ensures.run("4:remote:x", start, 1000, "failed");
    const second = ensures.run("4:remote:x", start, 1000, "failed");
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
    void ensures.run("4:remote:x", start, 1000, "failed");
    void ensures.run("5:remote:x", start, 1000, "failed");
    expect(started).toBe(2);
  });

  test("a settled attempt is not shared again", async () => {
    const ensures = new InFlightEnsures<string>();
    let started = 0;
    const start = () => {
      started += 1;
      return Promise.resolve("ready");
    };
    await ensures.run("4:remote:x", start, 1000, "failed");
    await ensures.run("4:remote:x", start, 1000, "failed");
    expect(started).toBe(2);
  });

  test("a rejected attempt is not shared again either", async () => {
    const ensures = new InFlightEnsures<string>();
    let started = 0;
    const start = () => {
      started += 1;
      return Promise.reject(new Error("init failed"));
    };
    await expect(ensures.run("4:remote:x", start, 1000, "failed")).rejects.toThrow("init failed");
    await expect(ensures.run("4:remote:x", start, 1000, "failed")).rejects.toThrow("init failed");
    expect(started).toBe(2);
  });
});

describe("the configuration an attempt reads is part of its identity", () => {
  test("a different address is a different attempt, at the same generation", () => {
    const a = remoteIntent(7, SERVER_A);
    const b = remoteIntent(7, SERVER_B);
    expect(ensureIntentKey(a)).not.toBe(ensureIntentKey(b));
    expect(ensureIntentStale(a, b)).toBe(true);
  });

  test("a different server model is a different attempt too", () => {
    const a = remoteIntent(7, SERVER_A);
    const renamed = remoteIntent(7, { ...SERVER_A, serverModelId: "other" });
    expect(ensureIntentKey(a)).not.toBe(ensureIntentKey(renamed));
    expect(ensureIntentStale(a, renamed)).toBe(true);
  });

  test("an unchanged configuration stays the same attempt", () => {
    const a = remoteIntent(7, SERVER_A);
    const b = remoteIntent(7, { ...SERVER_A });
    expect(ensureIntentKey(a)).toBe(ensureIntentKey(b));
    expect(ensureIntentStale(a, b)).toBe(false);
  });

  test("a local intent carries no remote configuration, so an address edit cannot stale it", () => {
    const local = captureEnsureIntent(7, "qwen-local", SERVER_A);
    expect(local.remoteConfig).toBeNull();
    expect(ensureIntentStale(local, captureEnsureIntent(7, "qwen-local", SERVER_B))).toBe(
      false,
    );
  });
});

describe("an attempt that never settles", () => {
  test("is abandoned at its deadline and a later caller starts again", async () => {
    const ensures = new InFlightEnsures<string>();
    let started = 0;
    const start = () => {
      started += 1;
      // Never settles: a storage read with no deadline of its own.
      return new Promise<string>(() => undefined);
    };

    const first = await ensures.run("7:remote:x:", start, 20, "failed");
    expect(first).toBe("failed");
    expect(started).toBe(1);

    // Before the deadline released the entry this second call would have been
    // handed the first promise and waited forever.
    const second = await ensures.run("7:remote:x:", start, 20, "failed");
    expect(second).toBe("failed");
    expect(started).toBe(2);
  });

  test("a rejection travels through instead of becoming the abandon value", async () => {
    const ensures = new InFlightEnsures<string>();
    const failure = new Error("superseded");
    await expect(
      ensures.run("k", () => Promise.reject(failure), 1000, "failed"),
    ).rejects.toThrow("superseded");
  });

  test("a settled attempt still is not shared again", async () => {
    const ensures = new InFlightEnsures<string>();
    let started = 0;
    const start = () => {
      started += 1;
      return Promise.resolve("ready");
    };
    await ensures.run("k", start, 1000, "failed");
    await ensures.run("k", start, 1000, "failed");
    expect(started).toBe(2);
  });
});
