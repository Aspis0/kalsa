/**
 * kalsa-download Cloudflare Worker: the alpha download page and its two
 * installer routes. Only kalsa.io/download* reaches it (see wrangler.toml).
 */

import { sha256Hex } from "./hash";
import { methodNotAllowed, notFound, notModified, serviceUnavailable } from "./http";
import { INSTALLER_PATHS, installerResponse } from "./installer";
import { readManifest } from "./manifest";
import { PAGE_HEADERS, downloadPageHtml } from "./page";

export interface Env {
  DOWNLOADS: R2Bucket;
}

const ZONE_HOST = "kalsa.io";
const PAGE_PATHS = new Set(["/download", "/download/"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // A bucket or manifest failure answers 503 rather than a bare 500.
    try {
      return await route(request, env);
    } catch {
      return serviceUnavailable();
    }
  },
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname !== ZONE_HOST) return notFound();
  const { pathname } = url;
  const isPage = PAGE_PATHS.has(pathname);
  const isWindows = pathname === INSTALLER_PATHS.windows;
  const isInstaller = isWindows || pathname === INSTALLER_PATHS.mac;
  if (!isPage && !isInstaller) return notFound();
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const manifest = await readManifest(env.DOWNLOADS);

  if (isPage) {
    const html = downloadPageHtml(manifest);
    const etag = `"${await sha256Hex(html)}"`;
    if (request.headers.get("if-none-match") === etag) return notModified(etag);
    return new Response(method === "HEAD" ? null : html, {
      status: 200,
      headers: { ...PAGE_HEADERS, etag },
    });
  }
  return installerResponse(env.DOWNLOADS, isWindows ? manifest.windows : manifest.mac, {
    method,
    path: isWindows ? INSTALLER_PATHS.windows : INSTALLER_PATHS.mac,
    requestedSha: url.searchParams.get("v"),
    ifNoneMatch: request.headers.get("if-none-match"),
  });
}
