import { sha256Hex } from "./crypto";
import { ownerLogin, readPages, type Pages } from "./pages";
import { currentRemovals, type Removal } from "./removals";
import { gone, unavailable, type PageKind } from "./respond";

const READ_METHODS = new Set(["GET", "HEAD"]);
const EDGE_TTL_SECONDS = 60;
/** The browser revalidates every time, so a removal or an undo shows at once. */
const CLIENT_CACHE = "public, max-age=0, must-revalidate";

/** Lowercased id → the catalog's spelling, so an encoded or differently-cased path still matches. */
interface Removed {
  engines: Map<string, string>;
  developers: Map<string, string>;
}

/**
 * The static site, with the owner's removals applied. With nothing removed the asset answer passes
 * through untouched. With something removed, every answer that could name it is rewritten under a
 * cache key that carries the removals version, so the edge keeps the rewritten body but a removal or
 * an undo is never served stale. One D1 read per request, and the last known set when D1 fails.
 *
 * HEAD runs the same pipeline as GET and then drops the body: a HEAD asset body is null, and caching
 * or parsing it would blank the page for every later GET.
 */
export async function serve(request: Request, env: Env): Promise<Response> {
  const head = request.method === "HEAD";
  if (!READ_METHODS.has(request.method)) return env.ASSETS.fetch(request);
  const removals = await currentRemovals(env);
  if (removals === null) return bodyless(unavailable(), head);
  if (removals.length === 0) return env.ASSETS.fetch(request);

  const removed = index(removals);
  const url = new URL(request.url);
  const path = normalisePath(url.pathname);
  const target = pageTarget(path);
  const canonical = target ? (target.kind === "engine" ? removed.engines : removed.developers).get(target.id.toLowerCase()) : undefined;
  if (target && canonical) return bodyless(gone(target.kind, canonical), head);
  const badge = /^\/badge\/(.+)\.svg$/.exec(path)?.[1]?.toLowerCase();
  const badgeId = badge ? removed.engines.get(badge) : undefined;
  if (badgeId) return bodyless(gone("engine", badgeId), head);

  const pipeline = head ? new Request(request, { method: "GET" }) : request;
  return bodyless(await rewritten(pipeline, env, path, url.pathname, removed, await version(removals)), head);
}

function bodyless(response: Response, head: boolean): Response {
  return head ? new Response(null, { status: response.status, headers: response.headers }) : response;
}

function index(removals: Removal[]): Removed {
  const engines = new Map<string, string>();
  const developers = new Map<string, string>();
  for (const row of removals) {
    (row.kind === "engine" ? engines : developers).set(row.target.toLowerCase(), row.target);
  }
  return { engines, developers };
}

/** Any change to the set changes the version, so a cached rewrite can never outlive the decision. */
async function version(removals: Removal[]): Promise<string> {
  const set = removals.map((row) => `${row.kind}:${row.target}`).sort().join("|");
  return (await sha256Hex(set)).slice(0, 16);
}

/** Assets resolve encoded and plain paths to the same file, so matching must see the same string. */
function normalisePath(path: string): string {
  let out = path;
  for (let pass = 0; pass < 3; pass += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(out);
    } catch {
      break;
    }
    if (decoded === out) break;
    out = decoded;
  }
  return out.replace(/\/{2,}/g, "/");
}

/** The page a path names, in either the pretty or the index.html form. */
function pageTarget(path: string): { kind: PageKind; id: string } | null {
  const match = /^\/(engines|dev)\/([^/]+?)(?:\/(?:index\.html)?)?$/.exec(path);
  if (!match || match[2] === "engines.json") return null;
  return { kind: match[1] === "engines" ? "engine" : "developer", id: match[2] as string };
}

async function rewritten(request: Request, env: Env, path: string, rawPath: string, removed: Removed, version: string): Promise<Response> {
  const url = new URL(request.url);
  // The key uses the raw pathname: a decoded "#" or "?" would move the version out of the query.
  const key = new Request(`${url.origin}${rawPath}?_kalsa_removals=${version}`);
  const hit = await cachedCopy(key);
  if (hit) {
    // A revalidating visitor gets a 304 from the cached copy too, without the body.
    const cachedTag = hit.headers.get("ETag") ?? "";
    if (revalidates(request.headers.get("If-None-Match"), cachedTag)) return notModified(cachedTag);
    // The stored copy carries the edge TTL; the visitor must still get the revalidating one.
    return withClientCache(new Response(hit.body, hit));
  }

  // A copy cached before the removal must not be revalidated into a 304: ask for the whole asset.
  const asset = await env.ASSETS.fetch(unconditional(request));
  if (!asset.ok) return asset;
  const etag = validator(asset, path, version);
  if (revalidates(request.headers.get("If-None-Match"), etag)) return notModified(etag);

  const rewrittenBody = await rewrite(asset, path, removed, env);
  const headers = new Headers(rewrittenBody.headers);
  headers.set("ETag", etag);
  headers.set("Cache-Control", `public, max-age=${EDGE_TTL_SECONDS}`);
  const stored = new Response(rewrittenBody.body, { status: rewrittenBody.status, headers });
  await storeCopy(key, stored.clone());
  return withClientCache(stored);
}

/**
 * The page cache is best-effort. Neither a read nor a write failure may 5xx a page: a miss just
 * rewrites, and a failed write only costs the next request the same rewrite. The write is awaited
 * rather than handed to waitUntil because it is a local cache op and the handler is also invoked
 * directly (tests, and any caller without an ExecutionContext).
 */
async function cachedCopy(key: Request): Promise<Response | undefined> {
  try {
    return await caches.default.match(key);
  } catch {
    return undefined;
  }
}

async function storeCopy(key: Request, response: Response): Promise<void> {
  try {
    await caches.default.put(key, response);
  } catch {
    // The next request rewrites it. Serving is unaffected.
  }
}

function withClientCache(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", CLIENT_CACHE);
  return new Response(response.body, { status: response.status, headers });
}

function unconditional(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("If-None-Match");
  headers.delete("If-Modified-Since");
  return new Request(request, { headers });
}

function validator(asset: Response, path: string, version: string): string {
  const assetTag = (asset.headers.get("ETag") ?? path).replaceAll('"', "").replace(/^W\//, "");
  return `"${assetTag}-${version}"`;
}

function revalidates(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
}

function notModified(etag: string): Response {
  return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": CLIENT_CACHE } });
}

async function rewrite(asset: Response, path: string, removed: Removed, env: Env): Promise<Response> {
  if (path === "/engines/engines.json") return withoutEngines(asset, removed);
  if (path === "/pages.json") return withoutPages(asset, removed);
  if (path === "/sitemap.xml") return withoutUrls(asset, removed);
  if ((asset.headers.get("Content-Type") ?? "").includes("text/html")) return strip(asset, removed, env);
  return asset;
}

async function withoutEngines(asset: Response, removed: Removed): Promise<Response> {
  const rows = (await asset.json()) as { id?: string }[];
  return new Response(JSON.stringify(rows.filter((row) => !removed.engines.has((row.id ?? "").toLowerCase()))), asset);
}

async function withoutPages(asset: Response, removed: Removed): Promise<Response> {
  const pages = (await asset.json()) as Pages;
  const kept = {
    engines: pages.engines.filter((row) => !removed.engines.has(row.id.toLowerCase())),
    developers: pages.developers.filter((row) => !removed.developers.has(row.login.toLowerCase())),
  };
  return new Response(JSON.stringify(kept), asset);
}

/** Matched on the path, not the origin: the generator's canonical host and SITE_ORIGIN need not agree. */
async function withoutUrls(asset: Response, removed: Removed): Promise<Response> {
  const gonePaths = new Set([
    ...[...removed.engines.values()].map((id) => `/engines/${id}`),
    ...[...removed.developers.values()].map((login) => `/dev/${login}`),
  ]);
  const kept = (await asset.text())
    .split("\n")
    .filter((line) => {
      const loc = /<loc>([^<]*)<\/loc>/.exec(line)?.[1];
      return !loc || !gonePaths.has(loc.replace(/^https?:\/\/[^/]+/, ""));
    })
    .join("\n");
  return new Response(kept, asset);
}

async function strip(asset: Response, removed: Removed, env: Env): Promise<Response> {
  const pages = await readPages(env);
  const statsGone = new Set((pages?.engines ?? []).filter((row) => removed.engines.has(row.id.toLowerCase())).map((row) => ownerLogin(row.repo)));
  const byRepo = new Map((pages?.engines ?? []).map((row) => [row.repo.toLowerCase(), row.id.toLowerCase()]));
  return new HTMLRewriter()
    .on("[data-engine]", {
      element(element) {
        const id = element.getAttribute("data-engine")?.toLowerCase();
        if (id && removed.engines.has(id)) element.remove();
      },
    })
    .on("[data-dev]", {
      element(element) {
        const id = element.getAttribute("data-dev")?.toLowerCase();
        if (id && removed.developers.has(id)) element.remove();
      },
    })
    .on("[data-dev-stats]", {
      element(element) {
        const login = element.getAttribute("data-dev-stats")?.toLowerCase();
        if (login && statsGone.has(login)) element.remove();
      },
    })
    .on("[data-ref-repo]", {
      element(element) {
        const repo = element.getAttribute("data-ref-repo")?.toLowerCase();
        const id = repo ? byRepo.get(repo) : undefined;
        if (!id || !removed.engines.has(id)) return;
        // The reference is the other engine's own fact, so it stays as a fact and loses the name.
        // The markers go too: they carry the repository string themselves.
        element.setInnerContent(element.getAttribute("data-ref-text") ?? "another project", { html: false });
        element.removeAttribute("href");
        element.removeAttribute("data-ref-repo");
        element.removeAttribute("data-ref-text");
      },
    })
    .on("[data-count]", {
      element(element) {
        recount(element, pages, removed.engines);
      },
    })
    .transform(asset);
}

/** The count is recomputed from the allow-list; the wording stays the generator's, in data-one and data-many. */
function recount(element: Element, pages: Pages | null, engines: Map<string, string>): void {
  const scope = element.getAttribute("data-count");
  if (!pages || !scope) return;
  const kept = pages.engines.filter((row) => !engines.has(row.id.toLowerCase()));
  const count =
    scope === "all"
      ? kept.length
      : scope.startsWith("hw:")
        ? kept.filter((row) => row.hardware.includes(scope.slice(3))).length
        : scope.startsWith("dev:")
          ? kept.filter((row) => ownerLogin(row.repo) === scope.slice(4).toLowerCase()).length
          : null;
  if (count === null) return;
  const template = (count === 1 ? element.getAttribute("data-one") : element.getAttribute("data-many")) ?? "";
  element.setInnerContent(template.replaceAll("{n}", String(count)), { html: false });
}
