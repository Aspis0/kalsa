import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { get, jar, network, postJson, signIn, useWorker } from "./helpers";

useWorker();

interface EngineRow {
  id: string;
  name: string;
  repo: string;
  hardware: string[];
}

interface Pages {
  engines: EngineRow[];
  developers: { login: string; name: string }[];
}

/** The pages every removal is checked against: every kind of page the site serves. */
const SECTIONS = [
  "/", "/engines/", "/hardware/", "/submit/", "/listed-and-community/", "/signin/", "/privacy/", "/app/", "/remove/",
  "/llms.txt", "/robots.txt", "/sitemap.xml", "/engines/engines.json", "/pages.json",
];
/** Engine pages that name another engine in their upstream, relation or baseline. */
const CROSS_REFERENCING = ["/engines/frink/", "/engines/neutronstar/", "/engines/qvac-fabric/", "/engines/omlx/"];

async function crawl(paths: string[]): Promise<{ path: string; body: string }[]> {
  const out: { path: string; body: string }[] = [];
  for (const path of paths) {
    const response = await get(path);
    expect(response.status, path).toBe(200);
    out.push({ path, body: await response.text() });
  }
  return out;
}

/**
 * The entry must not be *represented* anywhere: no card, no row, no link to its page, no title, no JSON row,
 * and its repository string nowhere. What IS neutralised: the upstream link, the "Fork of …" relation and the
 * Details upstream row — the structured references the generator marks with data-ref-repo.
 * What is NOT neutralised, deliberately: the baseline name inside a benchmark sentence ("than llama.cpp",
 * "<td>llama.cpp (build unknown)</td>") and any engine name in an authored summary. Those are facts about
 * another engine's own measurement or description, exactly like authored prose; rewriting them would
 * falsify the catalog author's data. So this test asserts representation and the repo string, not the bare name.
 */
function assertNotRepresented(body: string, engine: EngineRow, path: string): void {
  expect(body, `${path} still links the removed engine`).not.toContain(`data-engine="${engine.id}"`);
  expect(body, `${path} still carries its card id`).not.toContain(`data-id="${engine.id}"`);
  expect(body, `${path} still links its page`).not.toContain(`engines/${engine.id}/index.html`);
  expect(body, `${path} still names it as a card`).not.toContain(`<b>${engine.name}</b>`);
  expect(body, `${path} still names it in a title`).not.toContain(`<title>${engine.name}`);
  expect(body, `${path} still publishes its repository`).not.toContain(engine.repo);
}

/**
 * Each removal and undo is a real POST, so a chunk stays inside the published limits (30 an hour per
 * account, 60 per address). The catalog is split across two tests for that reason, not for coverage.
 */
async function crawlRemovals(engines: EngineRow[], cookie: string): Promise<void> {
  for (const engine of engines) {
    // The crawl tests the serving path, not ownership: GitHub is mocked as a user account that matches.
    // The organisation rule is tested in removal.test.ts.
    const owner = engine.repo.split("/")[0] ?? "";
    network.use(
      http.get(`https://api.github.com/repos/${engine.repo}`, () =>
        HttpResponse.json({ owner: { id: 4242, login: owner, type: "User" } }),
      ),
    );
    const removed = await postJson("/api/remove", { kind: "engine", id: engine.id }, cookie);
    expect(removed.status, engine.id).toBe(200);

    for (const path of [`/engines/${engine.id}/`, `/engines/${engine.id}/index.html`, `/badge/${engine.id}.svg`]) {
      expect((await get(path)).status, `${engine.id} ${path}`).toBe(410);
    }

    const paths = [...SECTIONS, ...CROSS_REFERENCING, `/dev/${owner}/`, ...engine.hardware.map((tag) => `/hardware/${tag}/`)]
      .filter((path) => path !== `/engines/${engine.id}/`);
    for (const { path, body } of await crawl(paths)) {
      assertNotRepresented(body, engine, path);
    }
    const list = (await (await get("/engines/engines.json")).json()) as { id: string }[];
    expect(list.some((row) => row.id === engine.id), engine.id).toBe(false);
    const allow = (await (await get("/pages.json")).json()) as Pages;
    expect(allow.engines.some((row) => row.id === engine.id), engine.id).toBe(false);

    expect((await postJson("/api/undo", { kind: "engine", id: engine.id }, cookie)).status, engine.id).toBe(200);
    expect((await get(`/engines/${engine.id}/`)).status, `${engine.id} back`).toBe(200);
  }
}

async function catalogEngines(): Promise<{ engines: EngineRow[]; cookie: string }> {
  const { response } = await signIn("github");
  const pages = (await (await get("/pages.json")).json()) as Pages;
  expect(pages.engines.length).toBeGreaterThan(30);
  return { engines: pages.engines, cookie: jar(response) };
}

describe("removing each engine in turn leaves it on no served page", () => {
  // A remove and its undo are two POSTs against the same 30-an-hour account bucket, so a chunk is 14.
  const CHUNK = 14;

  it("covers the first 14 engines", async () => {
    const { engines, cookie } = await catalogEngines();
    await crawlRemovals(engines.slice(0, CHUNK), cookie);
  }, 240_000);

  it("covers the next 14 engines", async () => {
    const { engines, cookie } = await catalogEngines();
    await crawlRemovals(engines.slice(CHUNK, CHUNK * 2), cookie);
  }, 240_000);

  it("covers the rest of the catalog", async () => {
    const { engines, cookie } = await catalogEngines();
    const rest = engines.slice(CHUNK * 2);
    expect(rest.length).toBeGreaterThan(0);
    await crawlRemovals(rest, cookie);
  }, 240_000);

  it("strips a removed engine from every hardware and developer page, not just a sample", async () => {
    const { response } = await signIn("github");
    const cookie = jar(response);
    const pages = (await (await get("/pages.json")).json()) as Pages;
    const engine = pages.engines.find((row) => row.id === "frink") as EngineRow;
    network.use(
      http.get(`https://api.github.com/repos/${engine.repo}`, () =>
        HttpResponse.json({ owner: { id: 4242, login: "antonellof", type: "User" } }),
      ),
    );
    expect((await postJson("/api/remove", { kind: "engine", id: engine.id }, cookie)).status).toBe(200);

    const hardware = pages.engines.flatMap((row) => row.hardware);
    const paths = [...new Set(hardware)].map((tag) => `/hardware/${tag}/`).concat(pages.developers.map((dev) => `/dev/${dev.login}/`));
    for (const { path, body } of await crawl(paths)) {
      assertNotRepresented(body, engine, path);
    }
  }, 120_000);
});
