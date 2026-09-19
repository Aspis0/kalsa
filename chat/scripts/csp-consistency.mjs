// Two content security policies apply to this app at the same time — the meta
// tag `chat/index.html` ships and the `csp` value Tauri injects from
// `src-tauri/tauri.conf.json` — and the webview enforces their INTERSECTION.
//
// So a `connect-src` in one policy and not the other is not silence: the one
// without it falls back to `default-src 'self'`, and `'self'` is the page's own
// origin (`tauri://localhost`), not the local server. That is how every `fetch`
// in `chat/src/lib/chat.ts` — the context size, the sampling defaults and the
// chat completion itself — came to be blocked in a built binary, while every
// test that talks to the server directly kept passing.
//
// This reads both real files and fails when the two lists disagree, when either
// policy would block the local server, or when either has been widened to admit
// any origin. It parses the directives; it holds no copy of the expected list.
// Run: `node scripts/csp-consistency.mjs`

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REPO_DIR = fileURLToPath(new URL("../..", import.meta.url));
const INDEX_HTML = "chat/index.html";
const TAURI_CONF = "src-tauri/tauri.conf.json";

/// The local server the frontend must reach, named both ways the owner may
/// have typed it. The port is `startup::PORT`, and the policies allow any port
/// on the loopback hosts.
const REACHABLE = ["http://127.0.0.1:8130", "http://localhost:8130"];

function directives(policy) {
  const found = new Map();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) found.set(name.toLowerCase(), sources);
  }
  return found;
}

/// The sources that govern `connect-src`, and whether the policy names them at
/// all — the fallback to `default-src` is what blocked every frontend fetch.
function connectSources(policy) {
  const found = directives(policy);
  const named = found.get("connect-src") ?? null;
  return { named, effective: named ?? found.get("default-src") ?? [] };
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
  const named = target.port || (target.protocol === "http:" ? "80" : "443");
  return port === "*" || port === named;
}

/// `*` and a scheme-wide source admit any host on that scheme. `ipc:` is the
/// exception: it is Tauri's own in-process channel, not a network origin.
function anyHost(source) {
  const value = source.toLowerCase();
  return value === "*" || (/^[a-z][a-z0-9+.-]*:$/.test(value) && value !== "ipc:");
}

function sameSources(left, right) {
  const normalized = (sources) => sources.map((source) => source.toLowerCase()).sort().join(" ");
  return normalized(left) === normalized(right);
}

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
  ...(metaPolicy ? [{ label: INDEX_HTML, ...connectSources(metaPolicy) }] : []),
  ...(typeof tauriPolicy === "string" ? [{ label: TAURI_CONF, ...connectSources(tauriPolicy) }] : []),
];

for (const { label, named } of policies) {
  if (named === null) {
    problems.push(
      `${label}: connect-src is missing, so default-src governs it and only the page's own origin is allowed; ` +
        `name the local server there in the same words as the other policy`,
    );
  }
}

if (policies.length === 2 && policies.every(({ named }) => named !== null)) {
  const [first, second] = policies;
  if (!sameSources(first.named, second.named)) {
    problems.push(
      `the two connect-src lists disagree, so the webview enforces their intersection and the narrower one wins:\n` +
        `      ${first.label}: ${first.named.join(" ")}\n` +
        `      ${second.label}: ${second.named.join(" ")}\n` +
        `    Make the two lists identical.`,
    );
  }
}

for (const { label, effective } of policies) {
  for (const url of REACHABLE) {
    if (!effective.some((source) => admits(source, new URL(url)))) {
      problems.push(
        `${label}: ${url} is not allowed, so the frontend's fetches would be blocked; ` +
          `add that origin to connect-src in both files`,
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

if (problems.length > 0) {
  console.log("CONTENT SECURITY POLICY FAILURES:");
  for (const problem of problems) console.log(`  - ${problem}`);
  process.exitCode = 1;
} else {
  const sources = policies[0]?.named?.join(" ") ?? "";
  console.log(`ok: both policies allow the same local origins and reach the server — connect-src ${sources}`);
}
