/**
 * Where one query actually goes: the active provider, and — when it fails — the
 * free Exa MCP fallback. The providers are faked because what is under test is
 * routing, not the network.
 *
 * These cases used to pin a per-provider consent gate in front of each
 * recipient. There is no gate any more: the Web switch and the disclosure under
 * it are the consent, so what survives is the question this file now asks —
 * does a failed primary really retry on the fallback, and does a query ever go
 * somewhere the user did not expect?
 *
 * A cancelled turn is a routing property too: the façade checks the signal
 * before each dispatch, so a cancelled search never reaches a provider and a
 * cancel during the primary never starts the fallback (the cases below).
 */
const braveSearch = jest.fn(async () => {
  throw new Error("Brave Search: 429 rate limited");
});
const exaMcpSearch = jest.fn(async () => [{ title: "ok", url: "https://e.example/1" }]);

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));
jest.mock("./ExaMCP", () => ({
  exaSearch: { search: (...args: unknown[]) => exaMcpSearch(...(args as [])) },
}));
jest.mock("./registry", () => ({
  DEFAULT_PROVIDER_ID: "exa-mcp",
  PROVIDER_IDS: ["exa-mcp", "exa", "brave", "tavily"],
  PROVIDER_STORAGE_KEY: "kalsa.search.provider",
  PROVIDERS: {
    "exa-mcp": { id: "exa-mcp", name: "Exa", label: "Exa MCP (free)", needsKey: false },
    exa: { id: "exa", name: "Exa", label: "Exa API", needsKey: true },
    brave: { id: "brave", name: "Brave", label: "Brave Search", needsKey: true },
    tavily: { id: "tavily", name: "Tavily", label: "Tavily", needsKey: true },
  },
  getActiveProviderId: jest.fn(async () => "brave"),
  getProvider: jest.fn(async (id: string) => {
    if (id !== "brave") throw new Error(`no key for ${id}`);
    return { search: braveSearch };
  }),
}));
jest.mock("./secretStore", () => ({
  secretStore: { getSecret: jest.fn(async () => "k") },
  getSecret: jest.fn(async () => "k"),
  setSecret: jest.fn(async () => undefined),
  deleteSecret: jest.fn(async () => undefined),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import { en } from "../i18n";
import { searchWeb } from "./index";

const QUERY = { locale: "en" } as const;

beforeEach(() => {
  braveSearch.mockClear();
  exaMcpSearch.mockClear();
});

describe("searchWeb and where one query goes", () => {
  it("needs no consent option at all to reach the active provider", async () => {
    const braveOk = jest.fn(async () => [{ title: "brave", url: "https://b.example/1" }]);
    const { getProvider } = jest.requireMock("./registry") as { getProvider: jest.Mock };
    getProvider.mockImplementationOnce(async () => ({ search: braveOk }));
    const out = await searchWeb("kalsa", QUERY);
    expect(braveOk).toHaveBeenCalledTimes(1);
    expect(out.provider).toBe("brave");
    expect(out.fallbackUsed).toBe(false);
    expect(out.results).toHaveLength(1);
    // No gate ran, so no refusal can come back: an outcome that carries one
    // would be a gate nobody asked for.
    expect(out).not.toHaveProperty("refused");
  });

  it("retries on the free Exa MCP fallback when the active provider fails", async () => {
    const out = await searchWeb("kalsa", QUERY);
    expect(braveSearch).toHaveBeenCalledTimes(1);
    expect(exaMcpSearch).toHaveBeenCalledTimes(1);
    expect(out.provider).toBe("exa-mcp");
    expect(out.fallbackUsed).toBe(true);
    expect(out.results).toHaveLength(1);
    // The primary's diagnosis stays on the outcome, so the caller can say
    // which provider failed rather than pretending nothing did.
    expect(out.primaryError).toContain("429");
  });

  it("never retries on the fallback when the active provider IS the fallback", async () => {
    // There is no second recipient to retry on: the error the user sees has to
    // be the one the free provider actually gave.
    const { getActiveProviderId } = jest.requireMock("./registry") as {
      getActiveProviderId: jest.Mock;
    };
    getActiveProviderId.mockResolvedValueOnce("exa-mcp");
    const { getProvider } = jest.requireMock("./registry") as { getProvider: jest.Mock };
    getProvider.mockImplementationOnce(async () => ({
      search: jest.fn(async () => {
        throw new Error("Exa MCP: down");
      }),
    }));
    await expect(searchWeb("kalsa", QUERY)).rejects.toThrow("Exa MCP: down");
    expect(exaMcpSearch).not.toHaveBeenCalled();
  });

  it("a turn cancelled before the search sends nothing, and the model gets the cancelled text", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(searchWeb("kalsa", { ...QUERY, signal: controller.signal })).rejects.toThrow(
      en.errors.searchCancelled,
    );
    expect(braveSearch).not.toHaveBeenCalled();
    expect(exaMcpSearch).not.toHaveBeenCalled();
  });

  it("a cancel while the primary is in flight never starts the fallback", async () => {
    const controller = new AbortController();
    braveSearch.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error("Brave Search: aborted");
    });
    await expect(searchWeb("kalsa", { ...QUERY, signal: controller.signal })).rejects.toThrow(
      en.errors.searchCancelled,
    );
    expect(exaMcpSearch).not.toHaveBeenCalled();
  });

  it("a spent budget never starts the fallback and says the search timed out", async () => {
    // The clock is the only thing that moves: the primary takes past the whole
    // 20 s budget, so the second request must not be fired.
    const start = 1_000_000;
    let now = start;
    const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
    braveSearch.mockImplementationOnce(async () => {
      now = start + 25_000;
      throw new Error("Brave Search: slow");
    });
    try {
      await expect(searchWeb("kalsa", QUERY)).rejects.toThrow(en.errors.searchDeadline);
      expect(exaMcpSearch).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  });

  it("reports both providers when the primary and the fallback both fail", async () => {
    exaMcpSearch.mockImplementationOnce((async () => {
      throw new Error("Exa MCP: 502");
    }) as never);
    await expect(searchWeb("kalsa", QUERY)).rejects.toThrow(
      /Brave Search: Brave Search: 429 rate limited; fallback Exa MCP: Exa MCP: 502/,
    );
  });
});
