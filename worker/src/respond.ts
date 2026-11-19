export type PageKind = "engine" | "developer";

const HARDENING = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), display-capture=(), payment=(), usb=(), serial=(), bluetooth=(), magnetometer=(), gyroscope=(), accelerometer=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/** A page the Worker writes loads one stylesheet and nothing else: no script, no image, no framing, no inline style. */
const PAGE_CSP = "default-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export function json(body: unknown, status = 200, cookies: string[] = []): Response {
  return respond(JSON.stringify(body), status, "application/json; charset=utf-8", cookies);
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, ...HARDENING });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 302, headers });
}

/** A browser lands here mid-flow, so the answer is a page in the site's own style, not a bare string. */
export function failure(status: number, message: string, cookies: string[] = []): Response {
  return htmlPage(
    "Sign in",
    "Sign-in did not complete",
    `<p class="lede">${escapeHtml(message)}</p><p class="mt18"><a class="btn two" href="/signin/">Back to sign in</a></p>`,
    status,
    cookies,
  );
}

/** A removed page answers 410 wherever it is asked for, with the owner's own way back in. */
export function gone(kind: PageKind, id: string): Response {
  const undo = `/remove/?kind=${kind}&id=${encodeURIComponent(id)}`;
  return htmlPage(
    "This page was removed",
    "This page was removed",
    `<p class="lede">This page was removed at its owner's request.</p><p class="mt18"><a class="btn two" href="${escapeHtml(undo)}">Undo this removal</a></p>`,
    410,
  );
}

/** The removals set cannot be read and there is no last known one: refuse rather than serve a page that may be removed. */
export function unavailable(): Response {
  const response = htmlPage(
    "Temporarily unavailable",
    "This page is temporarily unavailable",
    `<p class="lede">The catalog cannot be read right now. Please try again in a moment.</p>`,
    503,
  );
  response.headers.set("Retry-After", "30");
  return response;
}

function htmlPage(title: string, heading: string, inner: string, status: number, cookies: string[] = []): Response {
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/static/palette.css"><link rel="stylesheet" href="/static/base.css"></head><body><main id="main"><div class="wrap"><section class="pagehead"><h1>${heading}</h1>${inner}</section></div></main></body></html>`;
  const response = respond(page, status, "text/html; charset=utf-8", cookies);
  response.headers.set("Content-Security-Policy", PAGE_CSP);
  return response;
}

function respond(body: string, status: number, contentType: string, cookies: string[]): Response {
  const headers = new Headers({ "Content-Type": contentType, ...HARDENING });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(body, { status, headers });
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
