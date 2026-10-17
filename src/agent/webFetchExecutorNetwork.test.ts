/**
 * The fetch executor's network boundary, with no dialog in the picture: what
 * still reaches fetchImpl and what never does.
 *
 * The cases here drive the REAL executor over a fake network that counts calls,
 * so "the page was never opened" is observed rather than assumed. They used to
 * live in the first-fetch-notice suite, where the allowlist was only the thing
 * standing between a refusal and the network; now that there is no consent gate,
 * the allowlist is the whole gate and this is what is left worth pinning.
 */
import { en } from "../i18n";
import {
  makeFetchAllowlist,
  makeWebFetchExecutor,
} from "./webFetchTool";

describe("a turn cancelled before the page is opened never reaches the network", () => {
  it("answers with the cancelled text and makes no network call", async () => {
    let networkCalls = 0;
    const url = "https://site.example/page";
    const allowlist = makeFetchAllowlist();
    allowlist.add(url);
    const exec = makeWebFetchExecutor("en", allowlist, {
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("network reached");
      },
    });
    const controller = new AbortController();
    controller.abort();
    const out = await exec("web_fetch", { url, query: "anything" }, controller.signal);
    expect(networkCalls).toBe(0);
    expect(out.text).toBe(en.errors.webFetchAborted);
  });
});

/** The real executor over a fake network that only ever records that it ran. */
function fetchOver(args: { url?: string; allowlisted?: boolean } = {}) {
  const url = args.url ?? "https://site.example/page";
  let networkCalls = 0;
  const allowlist = makeFetchAllowlist();
  if (args.allowlisted !== false) allowlist.add(url);
  const exec = makeWebFetchExecutor("en", allowlist, {
    // Throwing is enough: what these cases observe is whether the network
    // function was reached at all, not what a live page would have said.
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error("network reached");
    },
  });
  return {
    run: () => exec("web_fetch", { url, query: "anything" }),
    networkCalls: () => networkCalls,
  };
}

describe("the fetch executor reaches the network with no dialog wired in", () => {
  it("calls it once for an allowlisted URL, with nothing to answer first", async () => {
    const f = fetchOver();
    const out = await f.run();
    expect(f.networkCalls()).toBe(1);
    // The executor is honest about the failure rather than reporting a page.
    expect(out.text).toContain("network reached");
  });

  it("never calls it for a URL the allowlist refuses", async () => {
    const f = fetchOver({ allowlisted: false });
    const out = await f.run();
    expect(f.networkCalls()).toBe(0);
    expect(out.text).not.toContain("network reached");
    expect(out.text).toMatch(/only pages already surfaced|refused/i);
  });

  it("needs no deps at all to decide — the refusals answer first", async () => {
    // No fetchImpl, no consent, no host state: every policy refusal is still
    // answered without a network call, so a bare caller opens nothing.
    const allowlist = makeFetchAllowlist();
    const exec = makeWebFetchExecutor("en", allowlist);
    for (const args of [
      { url: "", query: "anything" },
      { url: "https://site.example/page", query: "" },
      { url: "http://127.0.0.1/admin", query: "anything" },
      { url: "https://not-allowed.example/page", query: "anything" },
    ]) {
      const out = await exec("web_fetch", args);
      expect(typeof out.text).toBe("string");
      expect(out.text.length).toBeGreaterThan(0);
    }
  });
});
