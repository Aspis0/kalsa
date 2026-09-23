import { REMOTE_COMPUTER_MODEL_ID } from "./remoteComputerModel";
import { CHAT_MODEL_STORAGE_KEY, decideRemoteBoot } from "./remoteBoot";
import { ENGINE_BACKEND_KEY, REMOTE_BRAIN_URL_KEY } from "./remoteSettings";

const LOCAL_ID = "qwen-local";

function applyBoot(store: Record<string, string | undefined>) {
  const urlRaw = store[REMOTE_BRAIN_URL_KEY];
  const decision = decideRemoteBoot({
    hydrationOk: true,
    hydrationStale: false,
    backend: store[ENGINE_BACKEND_KEY] === "remote" ? "remote" : "local",
    url: urlRaw ?? "",
    savedModelId: store[CHAT_MODEL_STORAGE_KEY] ?? null,
    defaultLocalModelId: LOCAL_ID,
    remoteModelId: REMOTE_COMPUTER_MODEL_ID,
  });
  if (decision.kind === "remote") {
    store[ENGINE_BACKEND_KEY] = "remote";
    store[CHAT_MODEL_STORAGE_KEY] = REMOTE_COMPUTER_MODEL_ID;
    return;
  }
  store[ENGINE_BACKEND_KEY] = "local";
  store[CHAT_MODEL_STORAGE_KEY] = decision.persistModelId;
}

describe("decideRemoteBoot", () => {
  test("a snapshot a newer hydration replaced never boots remote", () => {
    // The values in hand were read before the user cleared the address in
    // Settings: acting on them would switch the backend to remote with an empty
    // cache URL, and the phone would report a failure that never happened.
    const decision = decideRemoteBoot({
      hydrationOk: true,
      hydrationStale: true,
      backend: "remote",
      url: "http://192.168.1.50:8000",
      savedModelId: REMOTE_COMPUTER_MODEL_ID,
      defaultLocalModelId: LOCAL_ID,
      remoteModelId: REMOTE_COMPUTER_MODEL_ID,
    });
    expect(decision).toEqual({
      kind: "local",
      persistModelId: LOCAL_ID,
      reason: "stale-hydration",
    });
  });

  test("the persisted remote model id value is frozen", () => {
    // Renaming the symbol is free; changing this string orphans every install
    // that already selected the remote computer (MODEL_STORAGE_KEY holds it).
    expect(REMOTE_COMPUTER_MODEL_ID).toBe("kalsa-remote-mac");
  });

  test("two boots stay local when remote backend has no URL and remote model key", () => {
    const store: Record<string, string | undefined> = {
      [ENGINE_BACKEND_KEY]: "remote",
      [CHAT_MODEL_STORAGE_KEY]: REMOTE_COMPUTER_MODEL_ID,
    };
    applyBoot(store);
    applyBoot(store);
    expect(store[ENGINE_BACKEND_KEY]).toBe("local");
    expect(store[CHAT_MODEL_STORAGE_KEY]).toBe(LOCAL_ID);
    expect(store[CHAT_MODEL_STORAGE_KEY]).not.toBe(REMOTE_COMPUTER_MODEL_ID);
  });

  test("two boots stay local when URL is empty string and model key is remote", () => {
    const store: Record<string, string | undefined> = {
      [ENGINE_BACKEND_KEY]: "remote",
      [REMOTE_BRAIN_URL_KEY]: "",
      [CHAT_MODEL_STORAGE_KEY]: REMOTE_COMPUTER_MODEL_ID,
    };
    applyBoot(store);
    applyBoot(store);
    expect(store[ENGINE_BACKEND_KEY]).toBe("local");
    expect(store[CHAT_MODEL_STORAGE_KEY]).toBe(LOCAL_ID);
  });

  test("remote with a URL stays remote", () => {
    const store: Record<string, string | undefined> = {
      [ENGINE_BACKEND_KEY]: "remote",
      [REMOTE_BRAIN_URL_KEY]: "https://mac.example.ts.net",
      [CHAT_MODEL_STORAGE_KEY]: REMOTE_COMPUTER_MODEL_ID,
    };
    applyBoot(store);
    expect(store[ENGINE_BACKEND_KEY]).toBe("remote");
  });

  test("hydration failure ignores remote model key", () => {
    const decision = decideRemoteBoot({
      hydrationOk: false,
      hydrationStale: false,
      backend: "remote",
      url: "https://mac.example.ts.net",
      savedModelId: REMOTE_COMPUTER_MODEL_ID,
      defaultLocalModelId: LOCAL_ID,
      remoteModelId: REMOTE_COMPUTER_MODEL_ID,
    });
    expect(decision).toEqual({
      kind: "local",
      persistModelId: LOCAL_ID,
      reason: "hydration-failed",
    });
  });
});
