/**
 * The download page behind the secret link: one static document listing the
 * current installers from the manifest. No script, no cookies, no third-party requests.
 */
import { COPY, type Lang } from "./language";
import { installerPath } from "./link";
import type { Installer, Manifest } from "./manifest";

export const STYLE = `:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.5;
}
main { max-width: 40rem; margin: 0 auto; padding: 2rem 1.25rem; }
h1 { font-size: 1.8rem; margin: 0 0 0.25rem; }
h2 { font-size: 1.2rem; margin: 2rem 0 0.5rem; }
h3 { font-size: 1rem; margin: 1.25rem 0 0.25rem; }
.lead { margin: 0 0 1.5rem; }
.platform { margin: 0 0 1.25rem; }
.button {
  display: inline-block;
  padding: 0.7rem 1.2rem;
  border: 1px solid currentColor;
  border-radius: 8px;
  color: inherit;
  text-decoration: none;
  font-weight: 600;
}
.meta { margin: 0.35rem 0 0; font-size: 0.85rem; }
.sha {
  display: block;
  margin-top: 0.15rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.7rem;
  word-break: break-all;
  opacity: 0.8;
}
.soon { margin: 0; opacity: 0.7; }
.first { margin-top: 1.5rem; }
.lang { margin: 0 0 1rem; text-align: right; font-size: 0.9rem; }
#tester-guide { margin-top: 2.5rem; border-top: 1px solid currentColor; }
h2[id] { scroll-margin-top: 1rem; }
p { margin: 0.6rem 0; }
ol, ul { padding-left: 1.4rem; }
li { margin: 0.25rem 0; }
blockquote {
  margin: 0.75rem 0;
  padding: 0 1rem;
  border-left: 3px solid currentColor;
  opacity: 0.9;
}
blockquote p { margin: 0.4rem 0; }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  word-break: break-all;
}
`;

export const STYLE_HASH = "uw8nF51Bjr/3SoEkbyYc+QyFBSVKHwE7vDEX8mSxu6o=";

export const CSP_HEADER = [
  "default-src 'none'",
  `style-src 'sha256-${STYLE_HASH}'`,
  "img-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export const PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": CSP_HEADER,
  "x-content-type-options": "nosniff",
  "cache-control": "private, no-cache",
};

function formatSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

// Nothing here is escaped: the sha256, the size, the constant labels and the
// link key are all restricted to characters that need no escaping.
function platformBlock(label: string, soon: string, path: string, installer: Installer | null): string {
  if (installer === null) return `<div class="platform"><p class="soon">${label}: ${soon}</p></div>`;
  return `<div class="platform">
<a class="button" href="${path}?v=${installer.sha256}">${label}</a>
<p class="meta">${formatSize(installer.size)}</p>
<code class="sha">sha256 ${installer.sha256}</code>
</div>`;
}

export function downloadPageHtml(manifest: Manifest, key: string, lang: Lang): string {
  const copy = COPY[lang];
  const other = copy.switchTo;
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kalsa alpha</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<p class="lang"><a href="?lang=${other.lang}" hreflang="${other.lang}" lang="${other.lang}">${other.label}</a></p>
<h1>Kalsa alpha</h1>
<p class="lead">${copy.lead}</p>
${platformBlock(copy.windows, copy.comingSoon, installerPath(key, "windows"), manifest.windows)}
${platformBlock(copy.mac, copy.comingSoon, installerPath(key, "mac"), manifest.mac)}
<p class="first">${copy.readFirst}: <a href="#windows">Windows</a> · <a href="#mac">Mac (Apple silicon)</a></p>
<section id="tester-guide">
<h2>${copy.guideTitle}</h2>
${copy.guide}
</section>
</main>
</body>
</html>
`;
}
