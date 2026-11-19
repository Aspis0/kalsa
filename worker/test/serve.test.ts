import { env, SELF } from "cloudflare:test";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ORIGIN, get, jar, network, postJson, signIn, useWorker } from "./helpers";

useWorker();

/** A removal made through the real endpoint, so the serving path is tested against real stored state. */
async function removeFrink(): Promise<void> {
  const { response } = await signIn("github");
  network.use(
    http.get("https://api.github.com/repos/antonellof/frink", () =>
      HttpResponse.json({ owner: { id: 4242, login: "antonellof", type: "User" } }),
    ),
  );
  const removed = await postJson("/api/remove", { kind: "engine", id: "frink" }, jar(response));
  expect(removed.status).toBe(200);
}

describe("with nothing removed the static site is served as it is", () => {
  it("keeps the asset's own headers and caching", async () => {
    // /privacy/ is not a run_worker_first path: it is the asset answer, untouched by the Worker.
    const direct = await get("/privacy/");
    const served = await get("/engines/");
    expect(served.status).toBe(200);
    for (const header of ["Content-Security-Policy", "X-Robots-Tag", "Cache-Control", "Strict-Transport-Security", "Cross-Origin-Opener-Policy", "Cross-Origin-Resource-Policy", "Permissions-Policy"]) {
      expect(served.headers.get(header), header).toBe(direct.headers.get(header));
    }
    expect(await served.text()).toContain('data-engine="frink"');
  });

  it("serves the scripts and styles it always did", async () => {
    for (const path of ["/static/base.css", "/static/filters.js", "/static/remove.js", "/robots.txt", "/llms.txt", "/pages.json"]) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      expect((await response.text()).length, path).toBeGreaterThan(0);
    }
  });
});

describe("a removed page is gone from every answer", () => {
  it("answers 410 with a short plain page, hardened and never cached", async () => {
    await removeFrink();
    for (const path of ["/engines/frink/", "/engines/frink", "/engines/frink/index.html"]) {
      const response = await get(path);
      expect(response.status, path).toBe(410);
      const body = await response.text();
      expect(body, path).toContain("This page was removed at its owner's request.");
      expect(body, path).not.toContain("<script");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
      expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
      expect(response.headers.get("Content-Security-Policy") ?? "").toContain("default-src 'none'");
    }
  });

  it("answers 410 on every path that would serve the page, encoded or not", async () => {
    await removeFrink();
    for (const path of [
      "/engines/frink", "/engines/frink/", "/engines/frink/index.html",
      "/engines/%66rink/", "/engines/%66%72%69%6e%6b/", "/engines/frink%2Findex.html",
      "/engines/FRINK/", "/engines/Frink/index.html", "//engines/frink/", "/engines/frink//",
      "/badge/frink.svg", "/badge/%66rink.svg",
    ]) {
      const response = await get(path);
      expect(response.status, path).toBe(410);
    }
  });

  it("still serves a live page on those same path shapes", async () => {
    for (const path of ["/engines/frink", "/engines/frink/", "/engines/frink/index.html", "/engines/%66rink/"]) {
      let response = await get(path);
      // The bare and index.html forms are redirected to the pretty path by the asset layer.
      if (response.status >= 300 && response.status < 400) {
        const location = new URL(response.headers.get("Location") ?? "", ORIGIN);
        response = await get(`${location.pathname}${location.search}`);
      }
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toContain('data-engine="frink"');
    }
    // Assets are case-sensitive: an uppercase path is not a page, removed or not.
    expect((await get("/engines/FRINK/")).status).toBe(404);
  });

  it("answers HEAD like GET, with no body", async () => {
    await removeFrink();
    const head = await SELF.fetch(`${ORIGIN}/engines/frink/`, { method: "HEAD" });
    expect(head.status).toBe(410);
    expect(await head.text()).toBe("");
  });

  it("drops the engine from engines.json, pages.json and the sitemap, and its badge with it", async () => {
    await removeFrink();
    const engines = (await (await get("/engines/engines.json")).json()) as { id: string }[];
    expect(engines.some((row) => row.id === "frink")).toBe(false);
    expect(engines.length).toBeGreaterThan(30);

    const pages = (await (await get("/pages.json")).json()) as { engines: { id: string }[] };
    expect(pages.engines.some((row) => row.id === "frink")).toBe(false);

    const sitemap = await (await get("/sitemap.xml")).text();
    expect(sitemap).not.toContain(`${ORIGIN}/engines/frink<`);
    expect(sitemap).toContain(`${ORIGIN}/engines/llama-cpp<`);

    expect((await get("/badge/frink.svg")).status).toBe(410);
  });

  it("recounts the engines page and the developer's own figures", async () => {
    const before = await (await get("/engines/")).text();
    const total = Number(before.split('data-count="all"')[1]?.split(">")[1]?.match(/\d+/)?.[0]);
    expect(total).toBeGreaterThan(30);
    await removeFrink();
    const after = await (await get("/engines/")).text();
    expect(after).toContain(`Browse all ${total - 1} engines, A to Z.`);
    const dev = await (await get("/dev/antonellof/")).text();
    expect(dev).not.toContain("data-dev-stats=");
    expect(dev).not.toContain('data-engine="frink"');
  });

  it("keeps a rewritten page cacheable at the edge, keyed on the removals version", async () => {
    await removeFrink();
    const first = await get("/engines/");
    expect(first.status).toBe(200);
    // The browser must revalidate, so a removal or an undo shows at once.
    expect(first.headers.get("Cache-Control")).toContain("must-revalidate");
    expect(first.headers.get("Cache-Control")).not.toContain("no-store");
    const etag = first.headers.get("ETag");
    expect(etag).toBeTruthy();

    const revalidated = await SELF.fetch(`${ORIGIN}/engines/`, { headers: { "If-None-Match": etag ?? "" } });
    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");

    // An undo changes the version, so the old validator must not survive it.
    const { response } = await signIn("github");
    network.use(
      http.get("https://api.github.com/repos/antonellof/frink", () =>
        HttpResponse.json({ owner: { id: 4242, login: "antonellof", type: "User" } }),
      ),
    );
    expect((await postJson("/api/undo", { kind: "engine", id: "frink" }, jar(response))).status).toBe(200);
    const afterUndo = await SELF.fetch(`${ORIGIN}/engines/`, { headers: { "If-None-Match": etag ?? "" } });
    expect(afterUndo.status).toBe(200);
    expect(await afterUndo.text()).toContain('data-engine="frink"');
  });

  it("leaves a transformed page uncacheable in the browser but revalidatable, and keeps its CSP", async () => {
    await removeFrink();
    const list = await get("/engines/");
    expect(list.headers.get("Cache-Control")).toContain("must-revalidate");
    expect(list.headers.get("Content-Security-Policy") ?? "").toContain("script-src 'self'");
  });

  it("still serves the assets that carry no engine id", async () => {
    await removeFrink();
    for (const path of ["/static/base.css", "/static/remove.js", "/robots.txt", "/llms.txt", "/privacy/", "/signin/"]) {
      expect((await get(path)).status, path).toBe(200);
    }
  });

  it("keeps the removal in D1, not in the assets", async () => {
    await removeFrink();
    const stored = await env.DB.prepare("SELECT kind, target FROM removals").all();
    expect(stored.results).toEqual([{ kind: "engine", target: "frink" }]);
  });
});
