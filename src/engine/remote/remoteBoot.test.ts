import { REMOTE_MAC_MODEL_ID } from "./remoteMacModel";
import { CHAT_MODEL_STORAGE_KEY, decideRemoteBoot } from "./remoteBoot";
import { ENGINE_BACKEND_KEY, REMOTE_BRAIN_URL_KEY } from "./remoteSettings";

const LOCAL_ID = "qwen-local";

function applyBoot(store: Record<string, string | undefined>) {
  const urlRaw = store[REMOTE_BRAIN_URL_KEY];
  const decision = decideRemoteBoot({
    hydrationOk: true,
    backend: store[ENGINE_BACKEND_KEY] === "remote" ? "remote" : "local",
    url: urlRaw ?? "",
    savedModelId: store[CHAT_MODEL_STORAGE_KEY] ?? null,
    defaultLocalModelId: LOCAL_ID,
    remoteModelId: REMOTE_MAC_MODEL_ID,
  });
  if (decision.kind === "remote") {
    store[ENGINE_BACKEND_KEY] = "remote";
    store[CHAT_MODEL_STORAGE_KEY] = REMOTE_MAC_MODEL_ID;
    return;
  }
  store[ENGINE_BACKEND_KEY] = "local";
  store[CHAT_MODEL_STORAGE_KEY] = decision.persistModelId;
}

describe("decideRemoteBoot", () => {
  test("two boots stay local when remote backend has no URL and remote model key", () => {
    const store: Record<string, string | undefined> = {
      [ENGINE_BACKEND_KEY]: "remote",
      [CHAT_MODEL_STORAGE_KEY]: REMOTE_MAC_MODEL_ID,
    };
    applyBoot(store);
    applyBoot(store);
    expect(store[ENGINE_BACKEND_KEY]).toBe("local");
    expect(store[CHAT_MODEL_STORAGE_KEY]).toBe(LOCAL_ID);
    expect(store[CHAT_MODEL_STORAGE_KEY]).not.toBe(REMOTE_MAC_MODEL_ID);
  });

  test("two boots stay local when URL is empty string and model key is remote", () => {
    const store: Record<string, string | undefined> = {
      [ENGINE_BACKEND_KEY]: "remote",
      [REMOTE_BRAIN_URL_KEY]: "",
      [CHAT_MODEL_STORAGE_KEY]: REMOTE_MAC_MODEL_ID,
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
      [CHAT_MODEL_STORAGE_KEY]: REMOTE_MAC_MODEL_ID,
    };
    applyBoot(store);
    expect(store[ENGINE_BACKEND_KEY]).toBe("remote");
  });

  test("hydration failure ignores remote model key", () => {
    const decision = decideRemoteBoot({
      hydrationOk: false,
      backend: "remote",
      url: "https://mac.example.ts.net",
      savedModelId: REMOTE_MAC_MODEL_ID,
      defaultLocalModelId: LOCAL_ID,
      remoteModelId: REMOTE_MAC_MODEL_ID,
    });
    expect(decision).toEqual({
      kind: "local",
      persistModelId: LOCAL_ID,
      reason: "hydration-failed",
    });
  });
});
