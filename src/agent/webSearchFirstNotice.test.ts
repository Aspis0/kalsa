/**
 * The consent gate as the search tool sees it: a provider that refuses must
 * end the tool call with the refusal text and no sources, and the gate must
 * never fire for a query that will not run. searchWeb is mocked because what
 * is under test is the decision, not the network (its own per-recipient
 * gating is covered in searchConsentFallback.test.ts).
 */
type SearchOutcome = {
  results: Array<{ title: string; url: string }>;
  provider: "brave" | "exa-mcp";
  fallbackUsed: boolean;
  primaryError?: string;
  refused?: string;
};

const searchWeb = jest.fn<Promise<SearchOutcome>, [string, unknown]>(async () => ({
  results: [],
  provider: "brave",
  fallbackUsed: false,
}));

jest.mock("../search", () => ({
  searchWeb: (query: string, opts: unknown) => searchWeb(query, opts),
  normalizeNumResults: (value: unknown) => Number(value) || 4,
  buildWebSearchSnippet: () => "snippet",
  PROVIDERS: { brave: { id: "brave", name: "Brave", label: "Brave Search" } },
}));
// The refusal text lives in src/search/firstSearchNotice.ts, which reaches the
// provider registry and from there the secure store. Neither is under test.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

import { makeWebSearchExecutor } from "./webSearchTool";

/** The gate is REQUIRED: a search always passes one, even when it just allows. */
const gate = (verdict: "allow" | "deny" | "unavailable") => {
  const consent = jest.fn(async () => verdict);
  const exec = makeWebSearchExecutor("en", consent);
  return { consent, exec };
};

describe("the consent gate inside the web_search tool", () => {
  beforeEach(() => {
    searchWeb.mockClear();
  });

  it("runs the search once the answer allows it", async () => {
    const { consent, exec } = gate("allow");
    const out = await exec("web_search", { query: "who won the 2026 world cup" });
    expect(searchWeb).toHaveBeenCalledTimes(1);
    // The gate travels with the call: searchWeb owns which recipients exist.
    expect(searchWeb.mock.calls[0][1]).toMatchObject({ consent });
    expect(out.text).toBe("No results found.");
  });

  it("does not judge consent itself: only searchWeb knows the recipients", async () => {
    // The tool must not pre-empt the gate for one provider and miss the other,
    // so it hands the gate over rather than calling it once itself.
    const { consent, exec } = gate("deny");
    await exec("web_search", { query: "who won the 2026 world cup" });
    expect(consent).not.toHaveBeenCalled();
    expect(searchWeb).toHaveBeenCalledTimes(1);
  });

  it("relays the refusal searchWeb produced for the fallback provider", async () => {
    searchWeb.mockResolvedValueOnce({
      results: [{ title: "x", url: "https://x.example/1" }],
      provider: "exa-mcp",
      fallbackUsed: false,
      primaryError: "Brave Search: 429",
      refused: "The search did not run: the user chose not to send it to the web this time.",
    });
    const { exec } = gate("allow");
    const out = await exec("web_search", { query: "who won the 2026 world cup" });
    expect(out.text).toBe(
      "The search did not run: the user chose not to send it to the web this time.",
    );
    // The refused search made no request, so it has no sources to show.
    expect(out.sources).toBeUndefined();
  });

  it("never asks about a query that will not run", async () => {
    const { consent, exec } = gate("deny");
    const out = await exec("web_search", { query: "   " });
    expect(consent).not.toHaveBeenCalled();
    expect(searchWeb).not.toHaveBeenCalled();
    expect(out.text).toBe("Empty search query.");
  });

  it("always hands searchWeb a gate", async () => {
    const { exec } = gate("allow");
    await exec("web_search", { query: "kalsa" });
    const opts = searchWeb.mock.calls[0][1] as { consent?: unknown };
    // searchWeb's options type requires it, and the builder supplies one.
    expect(typeof opts.consent).toBe("function");
  });

  it("does not gate the other tools", async () => {
    const { consent, exec } = gate("deny");
    await exec("device_info", {});
    expect(consent).not.toHaveBeenCalled();
  });

  it("speaks the user's language in the refusal", async () => {
    const consent = jest.fn(async () => "deny" as const);
    const exec = makeWebSearchExecutor("it", consent);
    searchWeb.mockResolvedValueOnce({
      results: [],
      provider: "brave",
      fallbackUsed: false,
      refused: "La ricerca non è partita: l'utente ha scelto di non inviarla.",
    });
    expect((await exec("web_search", { query: "notizie" })).text).toContain(
      "La ricerca non è partita",
    );
  });
});