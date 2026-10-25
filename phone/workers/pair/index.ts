/**
 * kalsa-pair Cloudflare Worker.
 *
 * Only two paths are routed here (see wrangler.toml); anything else that
 * still reaches the Worker gets 404. No bindings, no logging.
 */

import { PAGE_HEADERS, pairPageHtml } from "./page";
import { assetLinksResponse } from "./assetlinks";

const ZONE_HOST = "kalsa.io";

function notFound(): Response {
  return new Response("Not Found\n", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname !== ZONE_HOST) {
      return notFound();
    }
    if (url.pathname === "/.well-known/assetlinks.json") {
      return assetLinksResponse();
    }
    // The wrangler route pattern is kalsa.io/pair*; the page itself only
    // exists at /pair and below it — /pairfoo and friends stay 404.
    if (url.pathname === "/pair" || url.pathname.startsWith("/pair/")) {
      return new Response(pairPageHtml(), { status: 200, headers: PAGE_HEADERS });
    }
    return notFound();
  },
};
