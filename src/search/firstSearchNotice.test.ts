/**
 * The one-time per-provider search notice: when it asks, what persists, what a
 * "Not now" costs the current search, and the fail-closed paths. The dialog is
 * injected, so every case here is the real gate against a fake storage and a
 * fake answer.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  confirmSearchProvider,
  parseSearchConsent,
  providerDisplayName,
  searchConsentRefusalText,
  SEARCH_CONSENT_KEY,
  type SearchConsentStorage,
} from "./firstSearchNotice";
import type { SearchProviderId } from "./registry";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));
// registry.ts pulls the provider factory chain in, which reaches the secure
// store through secretStore.ts. The notice never touches a key.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const getItem = AsyncStorage.getItem as unknown as jest.Mock;
const setItem = AsyncStorage.setItem as unknown as jest.Mock;

/** A storage whose reads and writes behave, or whose reads throw. */
function fakeStorage(overrides: Partial<SearchConsentStorage> = {}): SearchConsentStorage {
  return {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    ...overrides,
  };
}

/** A storage holding one already-accepted list, the way an answered install looks. */
function consented(...ids: SearchProviderId[]): SearchConsentStorage {
  const value = `v1:${ids.join(",")}`;
  return {
    getItem: jest.fn(async () => value),
    setItem: jest.fn(async () => undefined),
  };
}

const gate = (args: {
  storage?: SearchConsentStorage;
  confirm?: (name: string) => Promise<boolean>;
  providerId?: SearchProviderId;
}) =>
  confirmSearchProvider({
    locale: "en",
    providerId: args.providerId ?? "brave",
    confirm: args.confirm ?? (async () => true),
    storage: args.storage,
  });

describe("providerDisplayName", () => {
  it("names every registered provider", () => {
    expect(providerDisplayName("exa-mcp")).toBe("Exa");
    expect(providerDisplayName("exa")).toBe("Exa");
    expect(providerDisplayName("brave")).toBe("Brave");
    expect(providerDisplayName("tavily")).toBe("Tavily");
  });

  it("has no name for a provider it does not know", () => {
    expect(providerDisplayName(null)).toBeNull();
    expect(providerDisplayName(undefined)).toBeNull();
    expect(providerDisplayName("nope" as never)).toBeNull();
  });
});

describe("parseSearchConsent", () => {
  it("reads back exactly what the gate writes", () => {
    expect(parseSearchConsent("v1:brave")).toEqual(["brave"]);
    expect(parseSearchConsent("v1:brave,exa-mcp")).toEqual(["brave", "exa-mcp"]);
  });

  it("accepts nothing it did not write", () => {
    // The old install-wide "1", a truncated write, a bare provider id and a
    // tampered value are all values this module never wrote.
    for (const raw of ["1", "", "brave", "v1", "v1:", "v2:brave", null, undefined, 42]) {
      expect(parseSearchConsent(raw as never)).toEqual([]);
    }
  });

  it("drops an id that is not a registered provider", () => {
    expect(parseSearchConsent("v1:brave,mystery,exa-mcp")).toEqual(["brave", "exa-mcp"]);
  });
});

describe("confirmSearchProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("asks on the first search of an install", async () => {
    const confirm = jest.fn(async () => true);
    const storage = fakeStorage();
    await expect(gate({ storage, confirm })).resolves.toBe("allow");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("Brave");
  });

  it("persists the provider it asked about, not a blanket yes", async () => {
    const storage = fakeStorage();
    await gate({ storage });
    expect(storage.setItem).toHaveBeenCalledWith(SEARCH_CONSENT_KEY, "v1:brave");
  });

  it('does not ask again for a provider already on the "1" list', async () => {
    const confirm = jest.fn(async () => true);
    await expect(gate({ storage: consented("brave"), confirm })).resolves.toBe("allow");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks for a DIFFERENT provider the install has not accepted", async () => {
    // The Brave user has not agreed to send queries to Exa, even though both
    // brands read "Exa"-alike in the copy.
    const confirm = jest.fn(async () => true);
    const storage = consented("brave");
    await expect(gate({ storage, confirm, providerId: "exa-mcp" })).resolves.toBe("allow");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(SEARCH_CONSENT_KEY, "v1:brave,exa-mcp");
  });

  it("asks again when the stored value is one it did not write", async () => {
    const confirm = jest.fn(async () => true);
    const storage = fakeStorage({ getItem: jest.fn(async () => "1") });
    await expect(gate({ storage, confirm })).resolves.toBe("allow");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("skips the search on Not now and asks again next time", async () => {
    const storage = fakeStorage();
    const confirm = jest.fn(async () => false);
    await expect(gate({ storage, confirm })).resolves.toBe("deny");
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(searchConsentRefusalText("deny", "en")).toContain("The search did not run");

    await expect(gate({ storage, confirm })).resolves.toBe("deny");
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("shows one notice for two concurrent searches to the same provider", async () => {
    let release = () => {};
    const opened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const confirm = jest.fn(async () => {
      await opened;
      return true;
    });

    const both = Promise.all([
      gate({ storage: fakeStorage(), confirm }),
      gate({ storage: fakeStorage(), confirm }),
    ]);
    release();
    await expect(both).resolves.toEqual(["allow", "allow"]);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("never shows two dialogs at once for two unanswered providers", async () => {
    let open = 0;
    let peak = 0;
    const confirm = jest.fn(async () => {
      open += 1;
      peak = Math.max(peak, open);
      await new Promise((resolve) => setTimeout(resolve, 5));
      open -= 1;
      return true;
    });
    const both = Promise.all([
      gate({ storage: fakeStorage(), confirm, providerId: "brave" }),
      gate({ storage: fakeStorage(), confirm, providerId: "tavily" }),
    ]);
    await expect(both).resolves.toEqual(["allow", "allow"]);
    // Both providers are asked — they are different recipients — but one after
    // the other, because the platform gives no promise about two Alerts at once.
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
  });

  it("answers each provider's own dialog, not the other's", async () => {
    const confirm = jest.fn(async (name: string) => name === "Brave");
    const both = await Promise.all([
      gate({ storage: fakeStorage(), confirm, providerId: "brave" }),
      gate({ storage: fakeStorage(), confirm, providerId: "tavily" }),
    ]);
    expect(both).toEqual(["allow", "deny"]);
  });

  it("fails closed when the stored consent cannot be read", async () => {
    const confirm = jest.fn(async () => true);
    const storage = fakeStorage({
      getItem: jest.fn(async () => {
        throw new Error("storage offline");
      }),
    });
    await expect(gate({ storage, confirm })).resolves.toBe("unavailable");
    expect(confirm).not.toHaveBeenCalled();
    expect(searchConsentRefusalText("unavailable", "it")).toContain("La ricerca non è partita");
  });

  it("fails closed when the provider has no name to show", async () => {
    const confirm = jest.fn(async () => true);
    await expect(
      gate({ storage: fakeStorage(), confirm, providerId: "mystery" as never }),
    ).resolves.toBe("unavailable");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("fails closed when the dialog cannot be shown", async () => {
    const storage = fakeStorage();
    const confirm = jest.fn(async () => {
      throw new Error("no alert in headless");
    });
    await expect(gate({ storage, confirm })).resolves.toBe("unavailable");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("runs the search when consent is given but the write fails", async () => {
    const storage = fakeStorage({
      setItem: jest.fn(async () => {
        throw new Error("disk full");
      }),
    });
    await expect(gate({ storage })).resolves.toBe("allow");
  });

  it("loses no write when two providers are accepted one after the other", async () => {
    // Two providers accepted back to back: the second write must carry both,
    // which is what putting the read-modify-write on the same chain as the
    // dialog buys.
    let written: string | null = null;
    const store: SearchConsentStorage = {
      getItem: jest.fn(async () => written),
      setItem: jest.fn(async (_key, value) => {
        written = value;
      }),
    };
    await expect(
      confirmSearchProvider({
        locale: "en",
        providerId: "brave",
        confirm: async () => true,
        storage: store,
      }),
    ).resolves.toBe("allow");
    await expect(
      confirmSearchProvider({
        locale: "en",
        providerId: "tavily",
        confirm: async () => true,
        storage: store,
      }),
    ).resolves.toBe("allow");
    expect(parseSearchConsent(written as unknown as string).sort()).toEqual(["brave", "tavily"]);
  });
});

describe("the default storage is AsyncStorage", () => {
  it("reads and writes the consent key there", async () => {
    getItem.mockResolvedValueOnce(null);
    setItem.mockResolvedValueOnce(undefined);
    await expect(gate({ confirm: async () => true })).resolves.toBe("allow");
    expect(getItem).toHaveBeenCalledWith(SEARCH_CONSENT_KEY);
    expect(setItem).toHaveBeenCalledWith(SEARCH_CONSENT_KEY, "v1:brave");

    getItem.mockResolvedValueOnce("v1:brave");
    const confirm = jest.fn(async () => true);
    await expect(gate({ confirm })).resolves.toBe("allow");
    expect(confirm).not.toHaveBeenCalled();
  });
});