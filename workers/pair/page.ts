/**
 * Static invite page served at kalsa.io/pair.
 *
 * One document for every visitor; all per-invite state lives in the URL
 * fragment, which is read and validated client-side and never leaves the
 * browser (CSP `default-src 'none'` + no network APIs on the page).
 *
 * The inline <script> and <style> are hashed into the CSP. The two hash
 * constants below are pinned source text: pair.test.ts recomputes both
 * from PAGE_SCRIPT / PAGE_STYLE, so they cannot drift.
 */

export const PAGE_SCRIPT = `(function () {
  "use strict";
  var B64URL = /^[A-Za-z0-9_-]+$/;
  function applyInvite(hash, doc) {
    var f = hash.length > 1 && B64URL.test(hash.slice(1)) ? hash.slice(1) : "";
    var invite = doc.getElementById("invite");
    var incomplete = doc.getElementById("incomplete");
    if (!f) {
      incomplete.hidden = false;
      return;
    }
    var target = new URL("kalsa://pair");
    target.hash = f;
    doc.getElementById("open").setAttribute("href", target.toString());
    invite.hidden = false;
  }
  applyInvite(location.hash, document);
})();
`;

export const PAGE_STYLE = `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #101418;
  color: #e8eaed;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}
main { text-align: center; padding: 2rem; max-width: 26rem; }
h1 { font-size: 1.4rem; margin: 0 0 1rem; }
#open {
  display: inline-block;
  margin-top: 1.25rem;
  padding: 0.8rem 1.6rem;
  border: 1px solid #6ea8fe;
  border-radius: 10px;
  color: #6ea8fe;
  text-decoration: none;
  font-weight: 600;
}
#open:active { background: #6ea8fe22; }
`;

export const SCRIPT_HASH = "VkmOz8NVDnIolPN6D37+6JbVutdUbqEk+ZN6G5lWblo=";
export const STYLE_HASH = "AWZfn6bYcEjEMeriFKUHTTxPm+9z1CkoaD/ljxSp/u0=";

export const CSP_HEADER = [
  "default-src 'none'",
  "script-src 'sha256-" + SCRIPT_HASH + "'",
  "style-src 'sha256-" + STYLE_HASH + "'",
  "img-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export const PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": CSP_HEADER,
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

export function pairPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kalsa pair</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<h1>Kalsa</h1>
<p id="incomplete" hidden>This invite link is incomplete.</p>
<section id="invite" hidden>
<p>Ask the person who invited you for the Kalsa app.</p>
<a id="open" role="button">Open in Kalsa</a>
</section>
</main>
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
}
