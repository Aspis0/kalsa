/**
 * The stale stored model id against what the desk serves: exactly one
 * served id is authoritative (adopt + persist, whatever the id looks
 * like); several served ids keep today's membership error.
 */

jest.mock("@react-native-async-storage/async-storage", () => {
  const store: Record<string, string | null> = {};
  return {
    getItem: async (key: string) => store[key] ?? null,
    setItem: async (key: string, value: string) => {
      store[key] = value;
    },
    __reset: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
});
jest.mock("./remoteSecret", () => ({ getRemoteBrainToken: jest.fn(async () => "token") }));
jest.mock("../../pairing/pairingCredentialStore", () => ({ getPairingCredential: jest.fn() }));

import { getPairingCredential } from "../../pairing/pairingCredentialStore";
import {
  REMOTE_BRAIN_MODEL_KEY,
  getRemoteServerModelId,
  setRemoteBrainUrl,
  setRemoteServerModelId,
} from "./remoteSettings";
import { initRemoteEngine, testRemoteConnection } from "./RemoteEngine";

const STALE = "philipjohnbasile-ornith-ai-ornith-1.5-35b-a3b-v2-mtplx";
/** The desk's single id today: a full path on the desk user's machine. */
const ONE_SERVED = ["/Users/somebody/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf"];

const hadFetch = "fetch" in globalThis;
const originalFetch = (globalThis as { fetch: typeof fetch }).fetch;
let log: jest.SpyInstance;

function serveModels(ids: string[]): void {
  (globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/props")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => "{}",
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: ids.map((id) => ({ id })) }),
      text: async () => "",
    } as Response;
  }) as typeof fetch;
}

describe("the stored id against the served list", () => {
  beforeEach(async () => {
    const asyncStorage = jest.requireMock("@react-native-async-storage/async-storage") as {
      __reset: () => void;
    };
    asyncStorage.__reset();
    (getPairingCredential as jest.Mock).mockResolvedValue({
      credential: "ab".repeat(32),
      doorUrl: "https://desktop.example",
      node: null,
      pairedVia: null,
    });
    await setRemoteBrainUrl("https://desktop.example");
    await setRemoteServerModelId(STALE);
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (hadFetch) {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  });

  test("a stale id with exactly one served id is adopted and persisted", async () => {
    serveModels(ONE_SERVED);

    const probe = await testRemoteConnection();

    expect(probe).toMatchObject({ ok: true, modelId: ONE_SERVED[0] });
    expect(getRemoteServerModelId()).toBe(ONE_SERVED[0]);
    const asyncStorage = jest.requireMock("@react-native-async-storage/async-storage") as {
      getItem: (key: string) => Promise<string | null>;
    };
    await expect(asyncStorage.getItem(REMOTE_BRAIN_MODEL_KEY)).resolves.toBe(ONE_SERVED[0]);
  });

  test("a stale id with two served ids keeps today's error", async () => {
    serveModels(["/a/one.gguf", "/a/two.gguf"]);

    const probe = await testRemoteConnection();

    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("remote_brain_model_missing");
    // Nothing was adopted: the stored id and its cache entry stay put.
    expect(getRemoteServerModelId()).toBe(STALE);
    const asyncStorage = jest.requireMock("@react-native-async-storage/async-storage") as {
      getItem: (key: string) => Promise<string | null>;
    };
    await expect(asyncStorage.getItem(REMOTE_BRAIN_MODEL_KEY)).resolves.toBe(STALE);
  });

  test("the same served id twice counts as one — the single-id adoption survives", async () => {
    serveModels([ONE_SERVED[0], ONE_SERVED[0]]);

    const probe = await testRemoteConnection();

    expect(probe).toMatchObject({ ok: true, modelId: ONE_SERVED[0] });
    expect(probe.models).toEqual([ONE_SERVED[0]]);
  });

  test("a served id with padding is trimmed before it is adopted", async () => {
    serveModels([`  ${ONE_SERVED[0]}  `]);

    const probe = await testRemoteConnection();

    expect(probe).toMatchObject({ ok: true, modelId: ONE_SERVED[0] });
    expect(getRemoteServerModelId()).toBe(ONE_SERVED[0]);
  });

  test("the init log line carries no served or stored model id", async () => {
    serveModels([ONE_SERVED[0]]);

    await initRemoteEngine("", "kalsa-remote", { locale: "en" });

    const initLines = log.mock.calls.filter((call) => call[0] === "remote.brain.init");
    expect(initLines).toHaveLength(1);
    const payload = String(initLines[0][1]);
    expect(payload).not.toContain(ONE_SERVED[0]);
    expect(payload).not.toContain(STALE);
    expect(JSON.parse(payload)).not.toHaveProperty("serverModelId");
  });
});
