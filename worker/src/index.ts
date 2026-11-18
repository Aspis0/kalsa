import { providerById } from "./providers";
import { json } from "./respond";
import { callback } from "./routes/callback";
import { me } from "./routes/me";
import { signout } from "./routes/signout";
import { start } from "./routes/start";

const AUTH_ROUTE = /^\/auth\/([a-z]+)\/(start|callback)$/;
const READ_METHODS = new Set(["GET", "HEAD"]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
      // The Host header is whoever sent the request. Only the configured origin is served,
      // so no redirect_uri, Origin baseline or cookie is ever built from an attacker's host.
      if (url.origin !== env.SITE_ORIGIN) return json({ error: "unknown_origin" }, 400);
      return route(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** Everything under /api and /auth is the Worker's: an unmatched path is its own JSON 404, never an asset lookup. */
async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const method = request.method;
  if (url.pathname === "/api/me") {
    return READ_METHODS.has(method) ? me(request, env) : notAllowed("GET, HEAD");
  }
  if (url.pathname === "/auth/signout") {
    return method === "POST" ? signout(request, env) : notAllowed("POST");
  }
  const match = AUTH_ROUTE.exec(url.pathname);
  if (match) {
    if (!READ_METHODS.has(method)) return notAllowed("GET, HEAD");
    const provider = providerById(match[1] ?? "");
    if (!provider) return json({ error: "not_found" }, 404);
    return match[2] === "start" ? start(request, env, provider) : callback(request, env, provider);
  }
  return json({ error: "not_found" }, 404);
}

function notAllowed(allow: string): Response {
  const response = json({ error: "method_not_allowed" }, 405);
  response.headers.set("Allow", allow);
  return response;
}
