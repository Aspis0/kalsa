// Two content security policies apply to this app at the same time — the meta
// tag `chat/index.html` ships and the `csp` value Tauri injects from
// `src-tauri/tauri.conf.json` — and the webview enforces their INTERSECTION.
//
// So a `connect-src` in one policy and not the other is not silence: the one
// without it falls back to `default-src 'self'`, and `'self'` is the page's
// own origin (`tauri://localhost`), not the local server. That is how every
// `fetch` in `chat/src/lib/chat.ts` — the context size, the sampling defaults
// and the chat completion itself — came to be blocked in a built binary, while
// every test that talks to the server directly kept passing.
//
// The same reasoning gates the app's own code. The built page's module
// scripts and the pdf.js worker both come from bundled files on the page's
// origin: `chat/src/lib/attachments.ts` sets `GlobalWorkerOptions.workerSrc`
// to a `?url` asset — same-origin, so pdf.js passes that URL straight to
// `new Worker` instead of wrapping it in a blob. So each policy's effective
// `script-src-elem` (`script-src-elem` → `script-src` → `default-src` — the
// entry point is a script ELEMENT), `script-src` (`script-src` →
// `default-src`) and `worker-src` (`worker-src` → `child-src` → `script-src`
// → `default-src`, CSP3 §6.8.3) must each resolve to a list that allows
// `'self'`, and none may carry a scheme-wide or wildcard source: this code
// loads nothing but its own bundle. A chain that resolves to nothing — no
// directive in it and no default-src — fails it: unrestricted is not
// confined.
//
// This reads both real files and fails when either policy would block the
// local server or Tauri's own IPC channel (the INTERSECTION is what the
// webview enforces: one policy blocking a URL blocks it), when either would
// block the app's own same-origin assets, when either is widened to a
// scheme-wide or wildcard source, or when a gated chain resolves to no
// restriction at all. It parses the directives; apart from what this app
// provably loads — the local server, the IPC channel, and its bundled files
// — it holds no copy of an expected list.
// Run: `node scripts/csp-consistency.mjs`

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
const INDEX_HTML = "chat/index.html";
const TAURI_CONF = "src-tauri/tauri.conf.json";

/// Everything `connect-src` must admit FOR THIS APP to work at all — per
/// policy, since the webview enforces the intersection and one policy
/// blocking a URL blocks it for the whole app. The local server, named both
/// ways an owner may type it (the port is `startup::PORT`, and the policies
/// allow any port on the loopback hosts), and Tauri's own IPC channel in
/// both spellings the policies carry.
const REACHABLE = [
  "http://127.0.0.1:8130",
  "http://localhost:8130",
  "ipc://localhost",
  "http://ipc.localhost",
];

function directives(policy) {
  const found = new Map();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (!name) continue;
    const key = name.toLowerCase();
    // The browser keeps the FIRST occurrence of a directive and ignores
    // every later one; the map must agree with it, or the guard would
    // judge a policy the webview does not enforce.
    if (!found.has(key)) found.set(key, sources);
  }
  return found;
}

/// One directive's effective sources: its own list, or the first entry of the
/// fallback chain that names it. `null` — nothing in the chain names it — is
/// the spec's "no restriction": it would admit everything, which is why the
/// check below fails it instead of trusting it.
function effectiveSources(found, chain) {
  for (const name of chain) {
    const sources = found.get(name);
    if (sources) return sources;
  }
  return null;
}

/// Whether the effective list allows the page's own origin. `'self'` is the
/// only source expression that names it — it is not a host a copy can drift
/// with, it is wherever this page was served from.
function admitsSelf(sources) {
  return sources.some((source) => source.toLowerCase() === "'self'");
}

/// Whether a host stands for every host: `*`, `https://*`, `https://*.x.com`,
/// `*.x.com` — with or without a scheme, as CSP writes host-sources. The
/// scheme is stripped first so the host is what gets judged; a port wildcard
/// (`http://127.0.0.1:*`, the local server's own shape) is not one.
function wildcardHost(value) {
  const host = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/:]/)[0];
  return host === "*" || host.startsWith("*.");
}

/// Whether a source widens past this app's own files: a bare scheme
/// (`http:`, `blob:`, `data:`), the bare `*`, or a wildcard HOST (above).
/// Nothing in the code loads anything outside its own bundle, so one of
/// these in an effective gated directive is a permission no line asks for —
/// inert only while the other policy still narrows it, and live the moment
/// both drift the same way.
function widening(source) {
  const value = source.toLowerCase();
  return /^[a-z][a-z0-9+.-]*:$/.test(value) || wildcardHost(value);
}

/// Whether one source expression admits `target`. Only the shapes a
/// `connect-src` carries are handled: `*`, a scheme source, and a host with an
/// optional port where `*` stands for any port. `'self'` is the page's own
/// origin, which is never the local server: different scheme, different host.
function admits(source, target) {
  const value = source.toLowerCase();
  if (value === "*") return true;
  if (value === "'self'") return false;
  if (/^[a-z][a-z0-9+.-]*:$/.test(value)) return value === target.protocol;
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^:/]+)(?::(\d+|\*))?$/.exec(value);
  if (!match) return false;
  const [, scheme, host, port] = match;
  if (`${scheme}:` !== target.protocol) return false;
  if (host !== "*" && host !== target.hostname) return false;
  // No port in the source is the scheme's DEFAULT port, not any port: the
  // source `http://ipc.localhost` admits http://ipc.localhost and refuses
  // that host on another port.
  const defaultPort = target.protocol === "http:" ? "80" : "443";
  const sourcePort = port ?? defaultPort;
  const targetPort = target.port || defaultPort;
  return sourcePort === "*" || sourcePort === targetPort;
}

/// `*`, a scheme-wide source, and a wildcard HOST admit any origin on that
/// scheme. `ipc:` is the exception: it is Tauri's own in-process channel,
/// not a network origin.
function anyHost(source) {
  const value = source.toLowerCase();
  if (/^[a-z][a-z0-9+.-]*:$/.test(value)) return value !== "ipc:";
  return wildcardHost(value);
}

function show(sources) {
  return sources.join(" ") || "(nothing allowed)";
}

/// The directives whose failure stops a BUILT binary from running its own
/// code, each with the fallback chain the spec resolves it through when a
/// policy does not name the directive (CSP3 §6.8.3).
///
/// THE MODEL IS THE INTERSECTION, not list equality: the webview enforces
/// both policies at once, so a source one policy names and the other omits
/// is simply not allowed — a meta-only `'unsafe-inline'` changes nothing —
/// and demanding identical lists would fail on differences the binary cannot
/// feel. What it can feel is a load NEITHER policy admits, a widening
/// EITHER policy carries, and a chain that resolves to nothing: no directive
/// and no default-src is NO RESTRICTION, which is not confinement to the
/// bundle. So each entry below is checked for all three: `'self'` must be
/// present (the bundle's files are same-origin), no widening source may be
/// (a permission the code never asks for, inert only while the other policy
/// still narrows it), and the chain must resolve at all.
const GATED = [
  {
    directive: "script-src",
    chain: ["script-src", "default-src"],
    loads: "the bundle's module scripts",
  },
  {
    // The entry point is a script ELEMENT (`<script type="module" src=…>`),
    // which script-src-elem governs directly once a policy names it.
    directive: "script-src-elem",
    chain: ["script-src-elem", "script-src", "default-src"],
    loads: "index.html's entry module script",
  },
  {
    directive: "worker-src",
    chain: ["worker-src", "child-src", "script-src", "default-src"],
    loads: "the pdf.js worker (the `?url` asset of chat/src/lib/attachments.ts)",
  },
];

const problems = [];

const html = await readFile(`${REPO_DIR}/${INDEX_HTML}`, "utf8");
const metaTag = html.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/i)?.[0] ?? null;
const metaPolicy = metaTag?.match(/\bcontent="([^"]*)"/i)?.[1] ?? null;
if (!metaPolicy) {
  problems.push(`${INDEX_HTML}: no Content-Security-Policy meta tag with a content attribute was found`);
}

const conf = JSON.parse(await readFile(`${REPO_DIR}/${TAURI_CONF}`, "utf8"));
const tauriPolicy = conf?.app?.security?.csp ?? null;
if (typeof tauriPolicy !== "string") {
  problems.push(`${TAURI_CONF}: no "app.security.csp" string was found`);
}

const policies = [
  ...(metaPolicy ? [{ label: INDEX_HTML, found: directives(metaPolicy) }] : []),
  ...(typeof tauriPolicy === "string" ? [{ label: TAURI_CONF, found: directives(tauriPolicy) }] : []),
];

/// `connect-src` as each policy makes it: the directive, or what default-src
/// makes of it when absent — the fallback is not silence. What the WEBVIEW
/// allows is the INTERSECTION: every policy must admit each URL below, and
/// two lists that both admit them need not match in any other word.
const connections = policies.map(({ label, found }) => ({
  label,
  effective: found.get("connect-src") ?? found.get("default-src") ?? [],
}));

for (const { label, effective } of connections) {
  for (const url of REACHABLE) {
    if (!effective.some((source) => admits(source, new URL(url)))) {
      problems.push(
        `${label}: the effective connect-src (${show(effective)}) does not allow ${url}; the webview ` +
          `enforces the intersection, so this policy alone would block it — add the origin here`,
      );
    }
  }
  for (const source of effective) {
    if (anyHost(source)) {
      problems.push(
        `${label}: connect-src allows "${source}", which admits any origin; ` +
          `this app only talks to its own machine, so narrow it to the local server`,
      );
    }
  }
}

for (const { directive, chain, loads } of GATED) {
  for (const { label, found } of policies) {
    const sources = effectiveSources(found, chain);
    if (sources === null) {
      problems.push(
        `${label}: the ${directive} chain resolves to nothing — none of ${chain.join(", ")} is named — ` +
          `so the load is unrestricted, and unrestricted is not confined to the bundle; name the ` +
          `directive or default-src`,
      );
      continue;
    }
    if (!admitsSelf(sources)) {
      problems.push(
        `${label}: the effective ${directive} (${show(sources)}) does not allow 'self'; ${loads} must ` +
          `come from the page's own origin and would be blocked in a built binary`,
      );
    }
    for (const source of sources) {
      if (widening(source)) {
        problems.push(
          `${label}: the effective ${directive} allows "${source}" — a scheme-wide or wildcard source, ` +
            `and nothing in this app loads outside its own bundle; narrow it`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.log("CONTENT SECURITY POLICY FAILURES:");
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
} else {
  console.log(
    `ok: both policies admit the local server and Tauri's IPC channel in their effective connect-src ` +
      `(the intersection is what the webview enforces), and every gated chain (script-src, ` +
      `script-src-elem, worker-src) resolves to a list that allows 'self' for the bundle's own files ` +
      `and carries no scheme-wide or wildcard source`,
  );
}
