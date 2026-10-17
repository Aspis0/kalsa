/**
 * The one-time first-fetch notice: when it asks, what persists, what a "Not now"
 * costs the current fetch, and the fail-closed paths. The dialog and the storage
 * are injected, so every case here is the real gate over a fake dialog and a
 * fake device — and the executor cases drive the real fetch executor with a fake
 * fetchImpl, so "the network function was not called" is observed, not assumed.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  confirmFetchConsent,
  parseFetchConsent,
  FETCH_CONSENT_KEY,
} from "./firstFetchNotice";
import type { ConsentStorage } from "./oneTimeConsent";
import {
  makeFetchAllowlist,
  makeWebFetchExecutor,
  type WebFetchExecutorDeps,
} from "../agent/webFetchTool";

// Async, like the real thing: a bare jest.fn() returns undefined, which the gate
// reads as an unreadable baseline rather than as "not accepted yet".
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));

/** A storage whose reads and writes behave, or whose reads throw. */
function fakeStorage(overrides: Partial<ConsentStorage> = {}): ConsentStorage {
  return {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    ...overrides,
  };
}

/** A storage that keeps what was written, the way an answered install looks. */
function rememberingStorage(): ConsentStorage {
  let stored: string | null = null;
  return {
    getItem: jest.fn(async () => stored),
    setItem: jest.fn(async (_key, value) => {
      stored = value;
    }),
  };
}

const gate = (args: {
  storage?: ConsentStorage;
  confirm?: () => Promise<boolean>;
  signal?: AbortSignal;
}) =>
  confirmFetchConsent({
    confirm: args.confirm ?? (async () => true),
    signal: args.signal,
    storage: args.storage,
  });

/** The real executor, on one allowlisted URL, over a fake network. */
function fetchOver(
  args: {
    storage?: ConsentStorage;
    confirm?: () => Promise<boolean>;
    signal?: AbortSignal;
    deps?: Partial<WebFetchExecutorDeps>;
    consent?: WebFetchExecutorDeps["consent"];
    url?: string;
  } = {},
) {
  const url = args.url ?? "https://site.example/page";
  let networkCalls = 0;
  const allowlist = makeFetchAllowlist();
  allowlist.add(url);
  const exec = makeWebFetchExecutor("en", allowlist, {
    // Throwing is enough: what these cases observe is whether the network
    // function was reached at all, not what a live page would have said.
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error("network reached");
    },
    consent: args.consent ?? ((signal) =>
      gate({
        storage: args.storage,
        confirm: args.confirm,
        signal,
      })),
    ...args.deps,
  });
  return {
    run: () => exec("web_fetch", { url, query: "anything" }, args.signal),
    networkCalls: () => networkCalls,
  };
}

describe("parseFetchConsent", () => {
  it("reads back exactly what the gate writes", () => {
    expect(parseFetchConsent("v1")).toBe(true);
  });

  it("accepts nothing it did not write", () => {
    for (const raw of ["1", "", "v2", "v1:fetch", null, undefined, 42]) {
      expect(parseFetchConsent(raw as never)).toBe(false);
    }
  });
});

describe("confirmFetchConsent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("asks on the first fetch of an install and remembers the answer", async () => {
    const confirm = jest.fn(async () => true);
    const storage = rememberingStorage();
    await expect(gate({ storage, confirm })).resolves.toBe("allow");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(FETCH_CONSENT_KEY, "v1");

    // The second fetch runs without the notice coming back.
    await expect(gate({ storage, confirm })).resolves.toBe("allow");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("opens the page on Not now? No — and asks again next time", async () => {
    const storage = fakeStorage();
    const confirm = jest.fn(async () => false);
    await expect(gate({ storage, confirm })).resolves.toBe("deny");
    expect(storage.setItem).not.toHaveBeenCalled();

    await expect(gate({ storage, confirm })).resolves.toBe("deny");
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("fails closed, and silently, when the stored answer cannot be read", async () => {
    const confirm = jest.fn(async () => true);
    const storage = fakeStorage({
      getItem: jest.fn(async () => {
        throw new Error("storage offline");
      }),
    });
    await expect(gate({ storage, confirm })).resolves.toBe("unavailable");
    expect(confirm).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("asks again when the stored value is one it did not write", async () => {
    const confirm = jest.fn(async () => true);
    const storage = fakeStorage({ getItem: jest.fn(async () => "1") });
    await expect(gate({ storage, confirm })).resolves.toBe("allow");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("fetches anyway when consent is given but the write fails", async () => {
    const storage = fakeStorage({
      setItem: jest.fn(async () => {
        throw new Error("disk full");
      }),
    });
    await expect(gate({ storage })).resolves.toBe("allow");
  });

  it("fails closed when the dialog cannot be shown", async () => {
    const storage = fakeStorage();
    await expect(
      gate({
        storage,
        confirm: async () => {
          throw new Error("no alert in headless");
        },
      }),
    ).resolves.toBe("unavailable");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("fails closed the same way when the dialog throws before returning", async () => {
    // A host with no dialog to show can fail synchronously; that must not
    // reject the gate, because a rejected gate is not a verdict.
    const storage = fakeStorage();
    await expect(
      gate({
        storage,
        confirm: (): Promise<boolean> => {
          throw new Error("no alert in headless");
        },
      }),
    ).resolves.toBe("unavailable");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("gives up on a storage call that never settles", async () => {
    jest.useFakeTimers();
    try {
      const storage = fakeStorage({
        getItem: jest.fn(() => new Promise<string>(() => undefined)),
      });
      const asking = gate({ storage });
      await jest.advanceTimersByTimeAsync(5_000);
      await expect(asking).resolves.toBe("unavailable");
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("a cancelled turn never opens a page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("never opens a dialog for a turn cancelled before it asks", async () => {
    const abort = new AbortController();
    abort.abort();
    const confirm = jest.fn(async () => true);
    const storage = fakeStorage();
    await expect(gate({ storage, confirm, signal: abort.signal })).resolves.toBe("deny");
    expect(confirm).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("resolves at once when the turn is cancelled with the dialog open", async () => {
    const abort = new AbortController();
    let tap!: (answer: boolean) => void;
    const dialog = new Promise<boolean>((resolve) => {
      tap = resolve;
    });
    const storage = fakeStorage();
    const asking = gate({ storage, confirm: () => dialog, signal: abort.signal });
    abort.abort();
    // The prompt cannot be dismissed programmatically, so the promise settles on
    // the cancellation and the queue moves on.
    await expect(asking).resolves.toBe("deny");
    expect(storage.setItem).not.toHaveBeenCalled();

    // A late tap on the stale Alert is discarded: it is a turn that is over.
    tap(true);
    await Promise.resolve();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe("the fetch executor asks before the network call", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("never calls the network function when the answer is no", async () => {
    const f = fetchOver({ storage: fakeStorage(), confirm: async () => false });
    const out = await f.run();
    expect(f.networkCalls()).toBe(0);
    expect(out.text).toContain("the user chose not to open web pages this time");
  });

  it("never calls the network function when the stored answer cannot be read", async () => {
    const f = fetchOver({
      storage: fakeStorage({
        getItem: jest.fn(async () => {
          throw new Error("storage offline");
        }),
      }),
    });
    const out = await f.run();
    expect(f.networkCalls()).toBe(0);
    expect(out.text).toContain("the web-page permission could not be read");
  });

  it("never calls the network function when the turn is cancelled", async () => {
    const abort = new AbortController();
    const f = fetchOver({
      storage: fakeStorage(),
      confirm: () =>
        new Promise<boolean>(() => {
          abort.abort();
        }),
      signal: abort.signal,
    });
    await f.run();
    expect(f.networkCalls()).toBe(0);
  });

  it("calls it once when the user opens", async () => {
    const f = fetchOver({ storage: fakeStorage() });
    await f.run();
    expect(f.networkCalls()).toBe(1);
  });

  it("refuses instead of fetching when no gate is wired in", async () => {
    // The executor's deps require a consent gate; a caller that cannot ask
    // (a plain JS caller) must open nothing rather than everything.
    const url = "https://site.example/page";
    const allowlist = makeFetchAllowlist();
    allowlist.add(url);
    let networkCalls = 0;
    const exec = makeWebFetchExecutor("en", allowlist, {
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("network reached");
      },
      consent: undefined as never,
    });
    const out = await exec("web_fetch", { url, query: "anything" });
    expect(networkCalls).toBe(0);
    expect(out.text).toContain("the web-page permission could not be read");
  });

  it("asks about nothing for a URL the allow-list refuses anyway", async () => {
    const confirm = jest.fn(async () => false);
    const url = "https://not-allowed.example/page";
    let networkCalls = 0;
    const exec = makeWebFetchExecutor("en", makeFetchAllowlist(), {
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("network reached");
      },
      consent: async () => {
        confirm();
        return "deny" as const;
      },
    });
    const out = await exec("web_fetch", { url, query: "anything" });
    expect(confirm).not.toHaveBeenCalled();
    expect(networkCalls).toBe(0);
    expect(out.text).not.toContain("web pages");
  });
});

describe("the default storage is AsyncStorage", () => {
  it("reads and writes the consent key there", async () => {
    const getItem = AsyncStorage.getItem as unknown as jest.Mock;
    const setItem = AsyncStorage.setItem as unknown as jest.Mock;
    getItem.mockResolvedValueOnce(null);
    setItem.mockResolvedValueOnce(undefined);
    await expect(gate({ confirm: async () => true })).resolves.toBe("allow");
    expect(getItem).toHaveBeenCalledWith(FETCH_CONSENT_KEY);
    expect(setItem).toHaveBeenCalledWith(FETCH_CONSENT_KEY, "v1");

    getItem.mockResolvedValueOnce("v1");
    const confirm = jest.fn(async () => true);
    await expect(gate({ confirm })).resolves.toBe("allow");
    expect(confirm).not.toHaveBeenCalled();
  });
});