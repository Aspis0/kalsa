/**
 * The per-provider consent as searchWeb sees it: every recipient must be named
 * before ITS query leaves, the free Exa MCP fallback included — the recipient
 * a Brave user's consent never covered.
 *
 * The providers are faked here because what is under test is who the query
 * reaches, not the network.
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

import { searchWeb, type WebSearchOutcome } from "./index";
import type { SearchConsentVerdict } from "./firstSearchNotice";

const QUERY = { locale: "en" } as const;

/** A gate that answers per provider from a fixed table. */
const gateFor = (answers: Record<string, SearchConsentVerdict>) =>
  jest.fn(async (providerId: string) => answers[providerId] ?? "allow");

beforeEach(() => {
  braveSearch.mockClear();
  exaMcpSearch.mockClear();
});

describe("searchWeb and the recipients of one query", () => {
  it("never sends when the turn is cancelled before the answer lands", async () => {
    // The 300 s tool timeout aborts the signal while the prompt is open; the
    // user's late "Search" must not start a request nobody is waiting for.
    const abort = new AbortController();
    let tap!: (answer: boolean) => void;
    let promptOpen!: () => void;
    const opened = new Promise<void>((resolve) => {
      promptOpen = resolve;
    });
    const consent = jest.fn(async () => {
      promptOpen();
      await new Promise<boolean>((resolve) => {
        tap = resolve;
      });
      return "allow" as const;
    });
    const searching = searchWeb("kalsa", {
      ...QUERY,
      consent,
      signal: abort.signal,
    });
    await opened;
    abort.abort();
    tap(true);
    await expect(searching).rejects.toThrow("Search cancelled");
    expect(braveSearch).not.toHaveBeenCalled();
    expect(exaMcpSearch).not.toHaveBeenCalled();
  });

  it("passes the turn's signal to the gate so it can stop waiting", async () => {
    const seen: Array<AbortSignal | undefined> = [];
    const consent = jest.fn(async (_id: string, signal: AbortSignal | undefined) => {
      seen.push(signal);
      return "deny" as const;
    });
    await searchWeb("kalsa", { ...QUERY, consent, signal: new AbortController().signal });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
  });

  it("sends nothing before the active provider has been named", async () => {
    const consent = gateFor({ brave: "deny" });
    const out = await searchWeb("kalsa", { ...QUERY, consent });
    expect(braveSearch).not.toHaveBeenCalled();
    expect(exaMcpSearch).not.toHaveBeenCalled();
    expect(out.refused).toContain("The search did not run");
    expect(out.results).toEqual([]);
  });

  it("asks the fallback for itself when the active provider fails", async () => {
    // The user agreed to Brave only. Brave fails, and the query was about to
    // go to Exa MCP — so Exa MCP has to be asked, not assumed.
    const consent = gateFor({ brave: "allow" });
    const out = await searchWeb("kalsa", { ...QUERY, consent });
    expect(braveSearch).toHaveBeenCalledTimes(1);
    expect(consent.mock.calls.map((call) => call[0])).toEqual(["brave", "exa-mcp"]);
    expect(exaMcpSearch).toHaveBeenCalledTimes(1);
    expect(out.fallbackUsed).toBe(true);
  });

  it("skips the fallback when the user declines it, naming both providers", async () => {
    const consent = gateFor({ brave: "allow", "exa-mcp": "deny" });
    const out = await searchWeb("kalsa", { ...QUERY, consent });
    expect(exaMcpSearch).not.toHaveBeenCalled();
    expect(out.results).toEqual([]);
    // "The search did not run" would be false here: Brave already got the
    // query. The refusal names the provider that received it.
    expect(out.refused).toBe(
      "The search reached Brave but failed, and the user chose not to send it to Exa. " +
        "Say the search failed and that they can try again.",
    );
    // The primary's diagnosis stays on the outcome for telemetry.
    expect(out.primaryError).toContain("429");
  });

  it("fails closed when the fallback's gate cannot be resolved, with the same words", async () => {
    const consent = gateFor({ brave: "allow", "exa-mcp": "unavailable" });
    const out = await searchWeb("kalsa", { ...QUERY, consent });
    expect(exaMcpSearch).not.toHaveBeenCalled();
    // Either way the query never reached Exa, so the text is the same one:
    // the user did not agree to the fallback, however the gate resolved.
    expect(out.refused).toBe(
      "The search reached Brave but failed, and the user chose not to send it to Exa. " +
        "Say the search failed and that they can try again.",
    );
  });

  it("asks the active provider once when it succeeds", async () => {
    const braveOk = jest.fn(async () => [{ title: "brave", url: "https://b.example/1" }]);
    const { getProvider } = jest.requireMock("./registry") as {
      getProvider: jest.Mock;
    };
    getProvider.mockImplementationOnce(async () => ({ search: braveOk }));
    const consent = gateFor({});
    const out: WebSearchOutcome = await searchWeb("kalsa", { ...QUERY, consent });
    expect(consent.mock.calls.map((call) => call[0])).toEqual(["brave"]);
    expect(out.provider).toBe("brave");
    expect(exaMcpSearch).not.toHaveBeenCalled();
  });

  it("never asks twice for the provider that already failed", async () => {
    // The active provider IS the free fallback: there is no second recipient.
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
    const consent = gateFor({ "exa-mcp": "allow" });
    await expect(searchWeb("kalsa", { ...QUERY, consent })).rejects.toThrow("Exa MCP: down");
    expect(consent.mock.calls.map((call) => call[0])).toEqual(["exa-mcp"]);
    expect(exaMcpSearch).not.toHaveBeenCalled();
  });

  it("spends the user's 25 s in the dialog, not the network's 20 s budget", async () => {
    // The user reads the notice for 25 s — longer than TOTAL_DEADLINE_MS.
    // With either dialog inside the timeout, that wait would abort the request
    // and the fallback would never run.
    jest.useFakeTimers();
    try {
      const consent = jest.fn(async (id: string) => {
        if (id === "brave") return "allow" as const;
        await new Promise((resolve) => setTimeout(resolve, 25_000));
        return "allow" as const;
      });
      // The fallback takes a second and honours its signal: a budget that kept
      // running through the dialog would have aborted it.
      exaMcpSearch.mockImplementationOnce((async (_query: string, opts: { signal: AbortSignal }) => {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        if (opts.signal.aborted) throw new Error("aborted");
        return [{ title: "ok", url: "https://e.example/1" }];
      }) as never);
      const searching = searchWeb("kalsa", { ...QUERY, consent });
      await jest.advanceTimersByTimeAsync(26_000);
      const out = await searching;
      expect(braveSearch).toHaveBeenCalledTimes(1);
      expect(exaMcpSearch).toHaveBeenCalledTimes(1);
      expect(out.fallbackUsed).toBe(true);
      expect(out.results).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});