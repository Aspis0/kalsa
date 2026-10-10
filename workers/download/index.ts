/**
 * kalsa-download Cloudflare Worker: the alpha download page, its installers behind
 * the tester link, and the desktop updater's check and artifact behind UPDATE_KEY.
 * Only kalsa.io/download* reaches it (see wrangler.toml); a request without a
 * matching key gets the same 404 as any other.
 */

import { admit } from "./admission";
import { sha256Hex } from "./hash";
import { methodNotAllowed, notFound, notModified, serviceUnavailable } from "./http";
import { installerResponse } from "./installer";
import { pickLang } from "./language";
import { readManifest, type Manifest } from "./manifest";
import { PAGE_HEADERS, downloadPageHtml } from "./page";
import { artifactResponse, updateCheck } from "./update";
import { installerPath } from "./routes";

export interface Env {
  DOWNLOADS: R2Bucket;
  /** Worker secret, set with `wrangler secret put LINK_KEY`. */
  LINK_KEY?: string;
  /** Worker secret, set with `wrangler secret put UPDATE_KEY`; embedded in every shipped app. */
  UPDATE_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch {
      // Only reached after the key matched: a bucket or manifest failure answers 503.
      response = serviceUnavailable();
    }
    return withLinkHeaders(response);
  },
};

// The key sits in the URL, so no Referer may carry it and no crawler may index it.
function withLinkHeaders(res: Response): Response {
  res.headers.set("x-robots-tag", "noindex, nofollow");
  res.headers.set("referrer-policy", "no-referrer");
  return res;
}

async function route(request: Request, env: Env): Promise<Response> {
  const admission = await admit(request.url, env);
  if (admission === null) return notFound();
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const url = new URL(request.url);
  const manifest = await readManifest(env.DOWNLOADS);
  const { route: target, key } = admission;
  const ifNoneMatch = request.headers.get("if-none-match");

  switch (target.kind) {
    case "page":
      return pageResponse(manifest, key, method, url, request.headers.get("accept-language"), ifNoneMatch);
    case "installer":
      return installerResponse(env.DOWNLOADS, manifest[target.platform], {
        method,
        path: installerPath(key, target.platform),
        requestedSha: url.searchParams.get("v"),
        ifNoneMatch,
      });
    case "update-check":
      return updateCheck(manifest, key, target, method);
    case "artifact":
      return artifactResponse(env.DOWNLOADS, manifest.updates[target.platform], { method, ifNoneMatch });
  }
}

async function pageResponse(
  manifest: Manifest,
  key: string,
  method: "GET" | "HEAD",
  url: URL,
  acceptLanguage: string | null,
  ifNoneMatch: string | null,
): Promise<Response> {
  const html = downloadPageHtml(manifest, key, pickLang(url, acceptLanguage));
  const etag = `"${await sha256Hex(html)}"`;
  if (ifNoneMatch === etag) {
    const unchanged = notModified(etag, PAGE_HEADERS["cache-control"]);
    unchanged.headers.set("vary", "accept-language");
    return unchanged;
  }
  return new Response(method === "HEAD" ? null : html, {
    status: 200,
    headers: { ...PAGE_HEADERS, etag, vary: "accept-language" },
  });
}
