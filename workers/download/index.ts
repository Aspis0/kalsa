/**
 * kalsa-download Cloudflare Worker: the alpha download page and its two
 * installer routes, behind a secret link. Only kalsa.io/download* reaches it
 * (see wrangler.toml); a request without the key gets the same 404 as any other.
 */

import { sha256Hex } from "./hash";
import { methodNotAllowed, notFound, notModified, serviceUnavailable } from "./http";
import { installerResponse } from "./installer";
import { pickLang } from "./language";
import { admit, installerPath } from "./link";
import { readManifest } from "./manifest";
import { PAGE_HEADERS, downloadPageHtml } from "./page";

export interface Env {
  DOWNLOADS: R2Bucket;
  /** Worker secret, set with `wrangler secret put LINK_KEY`. */
  LINK_KEY?: string;
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
  const admission = await admit(request.url, env.LINK_KEY);
  if (admission === null) return notFound();
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const url = new URL(request.url);
  const manifest = await readManifest(env.DOWNLOADS);

  if (admission.kind === "page") {
    const html = downloadPageHtml(manifest, admission.key, pickLang(url, request.headers.get("accept-language")));
    const etag = `"${await sha256Hex(html)}"`;
    if (request.headers.get("if-none-match") === etag) {
      const unchanged = notModified(etag);
      unchanged.headers.set("vary", "accept-language");
      return unchanged;
    }
    return new Response(method === "HEAD" ? null : html, {
      status: 200,
      headers: { ...PAGE_HEADERS, etag, vary: "accept-language" },
    });
  }
  return installerResponse(
    env.DOWNLOADS,
    admission.platform === "windows" ? manifest.windows : manifest.mac,
    {
      method,
      path: installerPath(admission.key, admission.platform),
      requestedSha: url.searchParams.get("v"),
      ifNoneMatch: request.headers.get("if-none-match"),
    },
  );
}
