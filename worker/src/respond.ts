const HARDENING = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

/** The error page loads one stylesheet and nothing else: no script, no image, no framing, no inline style. */
const ERROR_CSP = "default-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

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
  const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title><link rel="stylesheet" href="/static/palette.css"><link rel="stylesheet" href="/static/base.css"></head><body><main id="main"><div class="wrap"><section class="pagehead"><h1>Sign-in did not complete</h1><p class="lede">${escapeHtml(message)}</p><p class="mt18"><a class="btn two" href="/signin/">Back to sign in</a></p></section></div></main></body></html>`;
  const response = respond(page, status, "text/html; charset=utf-8", cookies);
  response.headers.set("Content-Security-Policy", ERROR_CSP);
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
