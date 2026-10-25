/**
 * The owner decision this repo now stands on: web_search and web_fetch run
 * WITHOUT any dialog, confirm hook or per-query permission. Web is on by
 * default; the disclosure is a permanent line under the Web switch in
 * Settings, and that switch is the user's on/off.
 *
 * Two halves, both needed. The runtime half proves the executors reach the
 * network when the policy says they may, with no consent parameter in their
 * signatures to pass. The source half proves the dialogs are not merely
 * unwired but GONE — otherwise the next person can reintroduce a prompt that
 * blocks a turn, and every test above would still pass.
 */
import { readFileSync } from "fs";
import { join } from "path";

type SearchOutcome = {
  results: Array<{ title: string; url: string }>;
  provider: string;
  fallbackUsed: boolean;
};

const searchWeb = jest.fn<Promise<SearchOutcome>, [string, unknown]>(async () => ({
  results: [{ title: "a result", url: "https://r.example/1" }],
  provider: "brave",
  fallbackUsed: false,
}));

jest.mock("../search", () => ({
  searchWeb: (query: string, opts: unknown) => searchWeb(query, opts),
  normalizeNumResults: (value: unknown) => Number(value) || 4,
  buildWebSearchSnippet: () => "a snippet",
  PROVIDERS: { brave: { id: "brave", name: "Brave", label: "Brave Search" } },
}));

import { makeWebSearchExecutor } from "./webSearchTool";
import { makeFetchAllowlist, makeWebFetchExecutor } from "./webFetchTool";

const read = (...parts: string[]) => readFileSync(join(__dirname, ...parts), "utf8");

beforeEach(() => {
  searchWeb.mockClear();
});

describe("a web_search runs with no dialog and no confirm dependency", () => {
  it("reaches searchWeb and hands it no gate to answer", async () => {
    // The builder takes a locale and nothing else: there is no second
    // parameter a caller could be expected to supply a confirm function to.
    expect(makeWebSearchExecutor.length).toBe(1);

    const exec = makeWebSearchExecutor("en");
    const out = await exec("web_search", { query: "who won the 2026 world cup" });
    expect(searchWeb).toHaveBeenCalledTimes(1);

    const opts = searchWeb.mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(opts).not.toHaveProperty("consent");
    expect(opts).not.toHaveProperty("confirm");

    expect(out.text).toContain("1. a result");
    expect(out.sources).toEqual([
      { title: "a result", url: "https://r.example/1", provider: "brave" },
    ]);
  });

  it("answers an empty query without asking anything", async () => {
    const exec = makeWebSearchExecutor("en");
    const out = await exec("web_search", { query: "   " });
    expect(out.text).toBe("Empty search query.");
    expect(searchWeb).not.toHaveBeenCalled();
  });
});

describe("a web_fetch runs with no dialog and no confirm dependency", () => {
  it("reaches the network for an allowlisted page, deps are optional", async () => {
    expect(makeWebFetchExecutor.length).toBe(3); // locale, allowlist, deps?

    const url = "https://site.example/page";
    let networkCalls = 0;
    const allowlist = makeFetchAllowlist();
    allowlist.add(url);
    const exec = makeWebFetchExecutor("en", allowlist, {
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("network reached");
      },
    });
    const out = await exec("web_fetch", { url, query: "anything" });
    expect(networkCalls).toBe(1);
    expect(out.text).toContain("network reached");
  });
});

describe("no dialog can be reintroduced without failing a test", () => {
  const sources = {
    "agent/webSearchTool.ts": read("webSearchTool.ts"),
    "agent/webFetchTool.ts": read("webFetchTool.ts"),
    "search/index.ts": read("..", "search", "index.ts"),
    "host/agentTurnOptions.ts": read("..", "host", "agentTurnOptions.ts"),
  };

  it("no web-tool module imports a notice, a consent gate or Alert", () => {
    for (const [name, source] of Object.entries(sources)) {
      expect(source).not.toMatch(/firstSearchNotice|firstFetchNotice|oneTimeConsent/);
      expect(source).not.toMatch(/webSearchNotice|webFetchNotice/);
      expect(source).not.toMatch(/\bAlert\b/);
      expect(source).not.toMatch(/consent/i);
    }
  });

  it("no source file still references the retired consent storage keys", () => {
    // Stored keys kalsa.search.consent.v1 / kalsa.fetch.consent.v1 are simply
    // no longer read. Nothing migrates them off; nothing may read them again.
    for (const [name, source] of Object.entries(sources)) {
      expect(source).not.toContain("kalsa.search.consent.v1");
      expect(source).not.toContain("kalsa.fetch.consent.v1");
      expect(name).toBeTruthy();
    }
  });

  it("the host still builds both executors without passing any gate", () => {
    const host = sources["host/agentTurnOptions.ts"];
    expect(host).toContain("makeWebSearchExecutor(locale)");
    expect(host).toContain("makeWebFetchExecutor(locale, allowlist, fetchDeps)");
  });
});
