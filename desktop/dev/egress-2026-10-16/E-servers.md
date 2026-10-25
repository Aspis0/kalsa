# E — Server side: what Kalsa's own Cloudflare Workers receive, store, and expose

Scope: repo `/Users/marco/Projects/kalsa`, folder `workers/` (four Workers), their wrangler
configs, and the iroh/pairing relay question. Read-only exploration; no changes to the repo.
Every claim below is quoted verbatim from the repo with `path:line`.

**Verdict up front:** Kalsa runs **no relay of its own** and **no Worker forwards user traffic**.
No Worker stores chat text, prompts, answers, documents or queries. Only two Workers store
anything at all, and only after an explicit trigger. There is **no KV, no D1, no Queues** in any
wrangler file. The one real retention gap: the R2 30-day deletion rule for `kalsa-reports` is a
**manual owner command documented in a README, not configured in the repo**.

---

## 0. Inventory: everything we run

| Unit | wrangler file | Origin / route | Bindings | Stores? |
| --- | --- | --- | --- | --- |
| `kalsa-telemetry` | `workers/telemetry/wrangler.toml` | custom domain `telemetry.kalsa.io` | 1 Durable Object | **Yes** — DO SQLite |
| `kalsa-report` | `workers/report/wrangler.toml` | `kalsa.io/report*` | R2 `kalsa-reports` + RateLimit | **Yes** — R2 |
| `kalsa-download` | `workers/download/wrangler.toml` | `kalsa.io/download*` | R2 `kalsa-installers` + 2 secrets | **No user data** |
| `kalsa-pair` | `workers/pair/wrangler.toml` | `kalsa.io/pair*`, `kalsa.io/.well-known/assetlinks.json` | none | **No** |
| *(no Worker)* | — | `dl.kalsa.io` | public bucket `kalsa-downloads` | engine downloads only |

Repo-wide sweep of every wrangler file for bindings and observability (proves KV/D1/Queues/Logpush
are absent):

```
workers/download/wrangler.toml:14:[[r2_buckets]]
workers/download/wrangler.toml:19:[observability]
workers/pair/wrangler.toml:14:[observability]
workers/report/wrangler.toml:15:[[r2_buckets]]
workers/report/wrangler.toml:32:[observability]
workers/telemetry/wrangler.example.toml:12:[[durable_objects.bindings]]
workers/telemetry/wrangler.toml:15:[[durable_objects.bindings]]
```

No match anywhere in the repo for `kv_namespaces`, `d1_databases`, `queues`, `hyperdrive`, or
`logpush`. `workers/telemetry/cf-ambient.d.ts:6-13` declares a `KVNamespace` ambient type, but no
Worker binds one — it is dead ambient typing for standalone `tsc --noEmit`
(`workers/telemetry/cf-ambient.d.ts:2-3`: *"Minimal Cloudflare Worker ambient types for standalone
`tsc --noEmit`. … Not a runtime dependency."*).

---

## 1. `kalsa-report` — desktop log upload (the only Worker that stores user-generated text)

### Path table

| Field | Finding | Proof (`path:line`, verbatim) |
| --- | --- | --- |
| Trigger | **Explicit user press only.** No queue, no retry, no background send. | `src/logReport/sendLog.ts:3-4`: *"Call it ONLY from a user press — there is no queue, no retry, no background send, and nothing runs at import time."* |
| Default | Not automatic; nothing is sent unless the user presses | same line |
| Destination | Our server — `kalsa-report` Worker, R2 bucket `kalsa-reports` | `workers/report/wrangler.toml:16-17`: `binding = "REPORTS"` / `bucket_name = "kalsa-reports"` |
| Route | `POST kalsa.io/report` only, exact path | `workers/report/wrangler.toml:11`: `routes = [ { pattern = "kalsa.io/report*", zone_name = "kalsa.io" } ]` |
| Fields sent | `Content-Type: text/plain; charset=utf-8` (the log text), `X-Kalsa-App: <version>/<os>/<arch>`. **Nothing else is read.** | `workers/report/index.ts:132-139` reads only `content-type` and `x-kalsa-app`; README `workers/report/README.md:91`: *"Any header other than `X-Kalsa-App` (no User-Agent, no URL, no referer)."* |
| IP address | **Read only as the rate-limiter key. Never stored, never in the object.** | `workers/report/index.ts:145-147`: `const { success } = await env.REPORT_RATE_LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "" });` — and `workers/report/README.md:89-90`: *"The connecting IP — it exists only as the rate-limiter key, inside the limiter binding, and never reaches the `put`."* |
| User agent | Never read, never stored | no UA reference in `workers/report/index.ts` (verified by grep); README line above |
| Device id | None. Only coarse `<version>/<os>/<arch>` in one header. | `workers/report/index.ts:20`: `const APP_HEADER_PATTERN = /^[0-9A-Za-z._-]{1,32}\/[a-z0-9_]{1,16}\/[a-z0-9_]{1,16}$/;` |
| Stored value | raw log bytes + two custom-metadata fields | `workers/report/index.ts:108-112`: `await env.REPORTS.put(`${day}/${id}.log`, bytes, { onlyIf: …, httpMetadata: { contentType: "text/plain" }, customMetadata: { app, received } });` |
| Can content ride along? | **Yes — the Worker stores whatever it is sent and does not inspect it.** | `workers/report/README.md:3-7`: *"Cloudflare Worker that receives the desktop app's log file from alpha testers and stores it privately in R2. The Worker stores whatever it is sent and cannot verify its content: the promise that the log never contains chat content, prompts, answers, file contents, pairing codes or invite links is enforced by the desktop app's log writer, not here."* |
| The "filter" | **There is no server-side content filter.** The only filter is client-side. | same quote — *"enforced by the desktop app's log writer, not here"* |
| Retention | **30 days, but only via a manual owner command. Not configured in the repo.** | `workers/report/README.md:117`: `npx wrangler r2 bucket lifecycle add kalsa-reports delete-after-30d --expire-days 30` — and `workers/report/README.md:61-63`: *"The lifecycle rule (owner runs once, see below) deletes objects after 30 days; deletion can lag up to ~24 h"*. **No `lifecycle` block exists in `workers/report/wrangler.toml`** (verified by repo-wide grep — zero matches for `lifecycle` in any wrangler file). |
| Size cap | 4 MiB per object, 300 objects/day soft cap | `workers/report/index.ts:17-18`: `const MAX_BODY_BYTES = 4 * 1024 * 1024; // two 2 MiB log files` / `export const DAILY_CAP = 300;` |
| Who can read | **Owner only, via the Cloudflare dashboard. The Worker exposes no read endpoint.** | `workers/report/README.md:142-144`: *"Cloudflare dashboard → R2 → `kalsa-reports` → browse objects (one per `YYYY-MM-DD/<id>.log`) and download to read. The Worker exposes no endpoint that returns stored data."*; `workers/report/README.md:29-30`: *"There is no `GET` for a stored report and no listing"* |
| Logs / observability | Off | `workers/report/wrangler.toml:31-33`: `# Private bucket, no request logging: nothing to observe, logs off.` / `[observability]` / `enabled = false` |
| Runtime logging | **No `console.*` call anywhere in the Worker.** | grep of `console\.(log\|error\|warn\|info\|debug)` across `workers/` returns only `workers/download/manifest.ts:74` and README/test files; nothing in `workers/report/` |
| Browser uploads | Blocked only by requiring a custom header (CORS preflight, never answered) | `workers/report/README.md:105-109`: *"**No CORS headers are sent.** … What stops browser uploads is `X-Kalsa-App`: setting a custom header forces a CORS preflight, which this Worker never answers"* |

---

## 2. `kalsa-telemetry` — opt-in/out-of-alpha error reports (the only Worker with a Durable Object)

### Path table

| Field | Finding | Proof (`path:line`, verbatim) |
| --- | --- | --- |
| Trigger | Automatic error reports (crash / function failure) — **default ON during the alpha** | `src/telemetry/config.ts:24-25`: *"Fresh-install default: alpha builds default on (owner 2026-10-09). Applies only when nothing is stored — a tombstone or a stored `enabled: false` envelope always wins."* / `export const TELEMETRY_DEFAULT_ENABLED = true;` |
| Consent screen | Present, and the live copy is accurate (it says on by default) | `src/i18n/en.ts:254-255`: `privacyBody:` / *"During the alpha, error reports with technical details are on by default; you can turn them off in Settings."* and `src/i18n/en.ts:264-265`: `alphaTelemetryNotice:` / *"During the alpha, Kalsa sends error reports with technical details (which AI, the phone's model and memory use) to help fix problems. Never your chats or text."* |
| Destination | Our server — `telemetry.kalsa.io`, a Kalsa-owned custom domain, the only origin | `workers/telemetry/wrangler.toml:11`: `routes = [ { pattern = "telemetry.kalsa.io", custom_domain = true } ]`; `src/telemetry/config.ts:18-19`: `export const TELEMETRY_WORKER_URL: string =` / `"https://telemetry.kalsa.io";` |
| **No unknown-endpoint fallback** | An empty URL silently disables all network send | `src/telemetry/config.ts:15`: *"Empty string is correct for local/dev/staging until deploy; it silently disables network send (no unknown-endpoint fallback)."* |
| Route | `POST /report` — **unauthenticated** | `workers/telemetry/index.ts:116-118`: `if (request.method === "POST" && url.pathname === "/report") { return await handleReport(request, env); }` |
| Fields sent | Strict allow-list: `v, app, appVersion, platform, deviceBucket, osMajor, error{code,detail,signal}, context{modelCategory,memoryClass,hadWebTools,phase,attempt,chunks}, dateBucket, manual` (+ v2 `diagnostics`) | `workers/telemetry/schema.ts:100-111`: `export const TOP_KEYS = new Set([ "v", "app", "appVersion", "platform", "deviceBucket", "osMajor", "error", "context", "dateBucket", "manual" ]);` |
| **Filter that keeps content out** | **Top-level unknown keys are rejected outright** (real allow-list, verified) | `workers/telemetry/schema.ts:182-184`: `for (const k of Object.keys(o)) {` / `if (!TOP_KEYS.has(k)) return \`unknown key: ${k}\`;` / `}` — nested objects are equally closed: `schema.ts:208-210` (`ERROR_KEYS`) and `schema.ts:229-231` (`CONTEXT_KEYS`) |
| Can content ride along? | **No free text can pass.** `error.signal` is tokenised, not raw; `detail` is per-code enum | `workers/telemetry/schema.ts:154-161`: `normalizeSignal` → `if (!SIGNAL_CHARSET.test(value)) return null; if (SIGNAL_FIXED.has(value)) return value; return null;` and `schema.ts:215-217`: `if (typeof err.detail !== "string" \|\| !detailsForCode(err.code).has(err.detail)) { return "error.detail invalid"; }` |
| Design-doc statement of the same rule | *"Mai nel payload"* (never in the payload) | `archived/docs/TELEMETRY_OPTIN.md:137-138`: *"**Mai nel payload:** testo chat, query, nomi documenti, contenuti, API keys, docId, IP utente (il Worker vede l'IP solo per rate-limit, non lo persiste), seriali, timestamp esatti, stack con path."* |
| Device identifiers | **Coarse buckets only.** Exact device model, serial, `Build.FINGERPRINT` are not in the schema. | `workers/telemetry/schema.ts:77`: `export const DEVICE_BUCKETS = new Set(["low", "mid", "high"]);`; `schema.ts:79-80`: `MEMORY_CLASSES = new Set(["lt-4gb","4-6gb","ge-6gb","unknown"])`, `MODEL_CATEGORIES = new Set(["dense.2b","dense.4b","moe","unknown"])`. Design doc `archived/docs/TELEMETRY_OPTIN.md:133-135`: *"**Rimosso rispetto a v1 (quasi-identificatori):** deviceModel esatto, reportedAt esatto, uptimeSec, hadDocs, stack trace completo, modelId esatto. … i campi esatti sono quasi-identificanti (hardware raro come Jelly Star è linkabile); restano solo bucket grezzi."* |
| IP address | Read from `cf-connecting-ip`, used **only in a per-isolate in-memory Map**. Never persisted, never sent to the DO. | `workers/telemetry/index.ts:89-92`: `/** Only trust Cloudflare's connecting IP. Do not fall back to x-forwarded-for. */` / `function clientIp(req: Request): string {` / `return req.headers.get("cf-connecting-ip") || "unknown";` ; `index.ts:67-68`: `// Best-effort in-memory IP rate (single isolate; not global).` / `const ipHits = new Map<string, number[]>();` |
| IP retention | ≤1 h window, ≤2048 keys, evicted from RAM | `workers/telemetry/index.ts:64-65`: `const IP_RATE_LIMIT = 10;` / `const IP_WINDOW_MS = 60 * 60 * 1000;`; `workers/telemetry/schema.ts:21`: `export const IP_MAP_MAX = 2048;` |
| Proof IP never enters storage | The DO receives only sig/report/now | `workers/telemetry/index.ts:202-206`: `const res = await stub.fetch("https://do/append", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sig, report, now }), });` |
| User agent | Never read from the client. The only UA is ours, outbound to GitHub. | `workers/telemetry/index.ts:570` and `:608`: `"user-agent": "kalsa-telemetry-worker",` |
| **Storage: Durable Object** | SQLite-backed DO `TelemetryBuffer`, singleton | `workers/telemetry/wrangler.toml:15-17`: `[[durable_objects.bindings]]` / `name = "TELEMETRY_BUFFER"` / `class_name = "TelemetryBuffer"`; `workers/telemetry/wrangler.toml:22`: `new_sqlite_classes = ["TelemetryBuffer"]` |
| What the DO holds | the full validated report JSON, its sha256 signature, timestamps, occurrence count, log refs | `workers/telemetry/index.ts:446-458`: `st.entries.push({ reportId, sig, report, state: "pending", reviewAck: false, …, createdAt: now, count: 1, lastSeenAt: now, logRefs: … });` |
| **Retention / TTL** | **NONE. No TTL, no alarm, no expiry, no eviction, no cap.** Entries live until a manual purge. | `workers/telemetry/README.md:36-38`: *"Accepted reports are never silently evicted. The buffer keeps every accepted entry until a maintainer flush or `/admin/flush-and-purge`. There is no 5000-entry cap."*; code comment `workers/telemetry/index.ts:460`: `// No silent eviction: accepted reports stay until maintainer flush/purge.`; every write is a bare `await txn.put("state", st);` (`index.ts:432`, `:461`, `:490`, `:528`, `:545`) — and the DO type itself cannot express an expiry: `workers/telemetry/cf-ambient.d.ts:28-31` `put<T>(key: string, value: T): Promise<void>;` |
| **No server-side deletion after opt-out** | A user turning telemetry off cannot remove already-accepted reports | `archived/docs/TELEMETRY_OPTIN.md:389-391`: *"**Nessuna revoca server-side**: un report già accettato dal Worker non può essere richiamato dopo l'opt-out (nessuna API di delete). La copy dell'Alert lo dice esplicitamente. Il purge locale è l'unico controllo."* |
| Quota | 50 new signatures/hour globally; duplicates are counted, not stored | `workers/telemetry/schema.ts:10`: `export const GLOBAL_QUOTA = 50;`; `workers/telemetry/index.ts:427-434` (duplicate path) |
| **Who can read it** | Three separate bearer tokens, all fail-closed, all constant-time compared | `workers/telemetry/index.ts:119-127`: `if (request.method === "GET" && url.pathname === "/flush") … if (request.method === "POST" && url.pathname === "/admin/flush-and-purge") … if (request.method === "GET" && url.pathname === "/admin/reports")` |
| Token names (never values) | `FLUSH_TOKEN`, `ADMIN_TOKEN`, `READ_TOKEN`, plus `GITHUB_TOKEN` | `workers/telemetry/wrangler.toml:24-28`: `# Secrets (wrangler secret put …) — never commit values:` / `#   GITHUB_TOKEN …` / `#   FLUSH_TOKEN …` / `#   ADMIN_TOKEN …` / `#   READ_TOKEN …` |
| Fail-closed | Unset token ⇒ 503, never open access | `workers/telemetry/auth.ts:20`: `if (!secret) return { ok: false, status: 503 };` |
| Constant-time compare | yes | `workers/telemetry/auth.ts:7-15`: `for (let i = 0; i < Math.max(x.length, y.length); i++) { diff |= (x[i] ?? 0) ^ (y[i] ?? 0); }` |
| Read endpoint returns | the stored report verbatim | `workers/telemetry/admin-read.ts:94-102`: `report: e.report,` inside the page mapping |
| Response caching | `no-store` | `workers/telemetry/index.ts:77-80`: `/** Stored reports must never land in a shared cache. */` … `res.headers.set("cache-control", "no-store");` |
| **GitHub egress** | **Only if `AUTO_OPEN_ISSUES` is flipped to `"true"` — default is `"false"`, so by default reports do NOT leave our infrastructure.** | `workers/telemetry/wrangler.toml:31`: `AUTO_OPEN_ISSUES = "false"`; `workers/telemetry/index.ts:228`: `const autoOpen = (env.AUTO_OPEN_ISSUES ?? "false").toLowerCase() === "true";` |
| If flipped | report fields go to a **public GitHub issue** in `Aspis0/kalsa` — a third party (GitHub/Microsoft) becomes a processor | `workers/telemetry/index.ts:610-615`: `body: JSON.stringify({ title, body, labels: ["telemetry"] }),` to `https://api.github.com/repos/${repo}/issues`; `workers/telemetry/wrangler.toml:34`: `GITHUB_REPO = "Aspis0/kalsa"` |
| Issue body is a projection | allowlisted, no raw JSON, no report id | `workers/telemetry/schema.ts:551`: `/** Public GitHub issue body. Never includes \`_reportId\` or raw JSON. */`; `schema.ts:504`: `return s.replace(/[\`*_\[\]()<>!#|\\]/g, "").replace(/https?:\/\//gi, "").trim();` |
| `GITHUB_TOKEN` isolation | never serialized into the DO | `workers/telemetry/index.ts:10`: `* GITHUB_TOKEN stays in the Worker (never serialized into the DO).` |
| **Observability / Logs** | **NOT DISABLED. This is the one Worker with no `[observability]` block, so Workers Logs are at Cloudflare's default (on).** | `workers/telemetry/wrangler.toml` contains `durable_objects.bindings`, `migrations` and `[vars]` only — grep for `observability` in `workers/telemetry/wrangler.toml` returns **no match** |
| Runtime logging | none (no `console.*` in `workers/telemetry/*.ts`) | grep of `console\.(log\|error\|…)` across `workers/` returns only `workers/download/manifest.ts:74` and README/test/CLI files |
| Logpush | **none configured anywhere in the repo** | repo-wide grep for `logpush` → no matches |

### Provider-side IP retention (the honest disclosure)

`workers/telemetry/README.md:145-146`: *"Cloudflare may retain connection metadata per their policy; IP is not stored in the report body. Rate limit uses `cf-connecting-ip` only."*

Same disclosure is shipped to users in the consent dialog,
`src/i18n/en.ts:272` (verbatim): *"Network provider logs (Cloudflare) may briefly record connection
metadata; we don't store your IP in the report."* — and the design doc concedes it is outside our
control, `archived/docs/TELEMETRY_OPTIN.md:396-398`: *"**Disclosure provider/IP**: il Worker non
persiste l'IP, ma Cloudflare (infrastruttura di rete) mantiene i propri log di richiesta (indirizzo
IP, timestamp) secondo le sue policy di retention — fuori dal nostro controllo."*

**So: an IP address is unavoidably visible to Cloudflare on every telemetry POST, even though no IP
is written to our own storage.** For an e-Evidence response this is the single most important
server-side fact in this document.

---

## 3. `kalsa-download` — tester page, installers, Tauri updater (stores no user data)

| Field | Finding | Proof (`path:line`, verbatim) |
| --- | --- | --- |
| Trigger | User action (tester opens the secret link) or automatic (Tauri update poll) | `workers/download/README.md:3-4`: *"Download page and two installer routes for the alpha testers, behind a secret link on the `kalsa.io` zone."* |
| Route | `kalsa.io/download*` | `workers/download/wrangler.toml:9`: `routes = [ { pattern = "kalsa.io/download*", zone_name = "kalsa.io" } ]` |
| Read tokens | `LINK_KEY` (page + installers), `UPDATE_KEY` (updater) — both Worker **secrets** | `workers/download/index.ts:18-24`: `LINK_KEY?: string;` / `/** Worker secret, set with \`wrangler secret put UPDATE_KEY\`; embedded in every shipped app. */` |
| Comparison | SHA-256 both sides, XOR loop, no early exit | `workers/download/keys.ts:17-23`: `/** Both sides are hashed first, so the loop always runs over 32 bytes and never exits early. */` … `for (let i = 0; i < expected.length; i++) diff \|= expected[i] ^ given[i];` |
| Uniform 404 | every failure path is indistinguishable | `workers/download/README.md:22-27`: *"Every other request that reaches this Worker gets one 404, with the same status, body and headers."* |
| What is sent off-device | **Nothing.** Only the URL path + `accept-language` + `if-none-match` | `workers/download/index.ts:54,58`: `const ifNoneMatch = request.headers.get("if-none-match");` … `request.headers.get("accept-language")` |
| IP / UA / device id | **never read, never stored** | no IP/UA reference anywhere in `workers/download/*.ts` runtime code (verified by grep) |
| Stored | installers + `current.json` + the Tauri `.sig` — **our own build artifacts, no user data** | `workers/download/wrangler.toml:14-16`: `[[r2_buckets]]` / `binding = "DOWNLOADS"` / `bucket_name = "kalsa-installers"` |
| Retention | **No lifecycle rule configured.** Old releases are never deleted by any rule in the repo. | repo-wide grep for `lifecycle` in wrangler files → no matches; `workers/download/README.md:1-7` lists bindings and observability but no retention |
| Observability | off | `workers/download/wrangler.toml:18-20`: `# Static page and streamed installers: nothing to observe, logs off.` / `[observability]` / `enabled = false` |
| **Who can read** | Anyone holding the URL. **`UPDATE_KEY` is in every shipped app, so the update endpoint is readable by anyone who has the app.** | `workers/download/README.md:97-101`: *"**A key in every app, not a secret.** … Every shipped app carries it, so anyone who has an app can read it out. It keeps the update endpoint away from casual discovery … It does not keep the update channel private from people who have the app"* |
| **Key-in-URL leak, admitted in-repo** | The secret is in the request line, which Cloudflare logs outside the Worker | `workers/download/README.md:44-45`: *"Cloudflare zone-level analytics, any sampled-URI report, and any Logpush job you may configure later, which record request lines outside the Worker."* |
| Logpush | **none currently configured** ("any Logpush job you may configure later") | same quote |
| Runtime logging | one `console.error`, reason-only, no manifest text | `workers/download/manifest.ts:72-74`: `/** Logs the reason only, never the manifest's text. */` / `function unusable(reason: string): Manifest {` / `console.error(\`${reason}; no installers and no updates are offered\`);` |
| Headers | `noindex` + `no-referrer` on every response | `workers/download/index.ts:39-43`: `// The key sits in the URL, so no Referer may carry it and no crawler may index it.` … `res.headers.set("x-robots-tag", "noindex, nofollow");` |

---

## 4. `kalsa-pair` — static invite page (stores nothing)

| Field | Finding | Proof (`path:line`, verbatim) |
| --- | --- | --- |
| Bindings | **none at all** | `workers/pair/README.md:3-5`: *"Static Cloudflare Worker for pairing invite links on the `kalsa.io` zone. No KV, no D1, no Durable Objects, no bindings of any kind."* |
| Stores | nothing; returns two constant documents | `workers/pair/index.ts:24-39`: the whole handler is `assetLinksResponse()` / `pairPageHtml()` / `notFound()` |
| **Invite code / pairing secret** | **Never leaves the browser.** | `workers/pair/page.ts:5-6`: *"all per-invite state lives in the URL fragment, which is read and validated client-side and never leaves the browser (CSP \`default-src 'none'\` + no network APIs on the page)."*; `workers/pair/README.md:28`: *"**The fragment never leaves the browser.** The page makes no fetch/XHR/beacon, has no form, no analytics, no third-party assets, no external fonts"* |
| Fragment handling | charset-validated, built with the URL constructor, never `innerHTML` | `workers/pair/page.ts:15-17`: `var B64URL = /^[A-Za-z0-9_-]+$/;` … `var f = hash.length > 1 && B64URL.test(hash.slice(1)) ? hash.slice(1) : "";`; `README.md:20-22`: *"only then builds the \`kalsa://pair#<fragment>\` deep link … via the \`URL\` constructor + \`setAttribute\` — never \`innerHTML\`, never string HTML"* |
| CSP | `default-src 'none'`, hashed script+style, no `unsafe-inline` | `workers/pair/page.ts:62-70`: `"default-src 'none'"` … `"frame-ancestors 'none'"` |
| IP / UA / device id | never read | no reference in `workers/pair/*.ts` |
| Observability | off | `workers/pair/wrangler.toml:13-15`: `# Static page + static JSON: nothing to observe, logs off.` / `[observability]` / `enabled = false` |
| Runtime logging | none | no `console.*` in `workers/pair/*.ts` |
| Who can read | nobody — nothing is stored | same as "Stores" |

---

## 5. The relay question: does any relay **we** run see plaintext?

**No. Kalsa runs no relay. There is no server-side relay or forwarding code anywhere in `workers/`.**

1. **No Worker proxies traffic.** The only outbound network calls in the entire `workers/` folder are
   the two GitHub API calls in the telemetry flush, and they are gated off by default:
   `workers/telemetry/index.ts:564` (`const res = await fetch(` → search) and `workers/telemetry/index.ts:602`
   (`const res = await fetch(\`https://api.github.com/repos/${repo}/issues\`, {`). Every other `fetch`
   in `workers/` is either a Worker entry point or an internal `stub.fetch("https://do/…")` call to
   our own Durable Object.

2. **The pairing invite is a static page, not a relay.** The invite code lives only in the URL
   fragment (§4 above), so even the Worker operator cannot read an invite code from our side.

3. **Device-to-device traffic rides iroh through a third party's public relay, not ours.**
   `native/kalsa-iroh-mobile/src/bridge.rs:52`: `let config = BridgeConfig::dial_only().with_relay(RelayChoice::N0Public);`
   `RelayChoice::N0Public` is the public n0 (N0/Mastercard) iroh relay. Kalsa runs no relay process,
   holds no relay config, and no relay appears in any wrangler file.

4. **What the third-party relay *does* see, admitted in-repo:** stable device identifiers and
   network metadata.
   - `native/kalsa-iroh-mobile/src/bridge.rs:47-48`: *"No publication is not anonymity: on a relayed road this node still tells the relay its stable EndpointId."*
   - `native/kalsa-iroh-mobile/README.md:80-82`: *"Two known upstream (kalsa-brain) items, not fixed here: the phone's node id is published to n0 pkarr DNS under \`RelayChoice::N0Public\`, and brain always spawns an accept loop even for a dial-only endpoint."*

   A terminating relay necessarily sees both peers' IP addresses and traffic timing; the payloads
   ride iroh's encrypted QUIC/Noise tunnels between the two devices, not through us. **I could not
   verify the encryption claim from this repo alone** — it is a property of the iroh library, and
   `docs/DESIGN-PAIRING.md:217` records a different transport decision (*"The owner chose the road
   for the **first real end-to-end pairing**: **Tailscale first**"*). Treat "no plaintext at the
   relay" as *iroh protocol behaviour plus our dial-only configuration*, not as a Kalsa-controlled
   guarantee.

5. **Rooms are explicitly cloudless.** `docs/DESIGN-ROOMS.md:389`: *"No cloud relay. A room lives on
   the PC of the house and on the network, and it stops"* — and `bridge.rs:90-91` shows the test
   seam uses `RelayChoice::Disabled` with an in-process address book.

---

## 6. Observability / Logpush, per Worker

| Worker | `[observability]` | Verbatim |
| --- | --- | --- |
| `kalsa-report` | **off** | `workers/report/wrangler.toml:31-33`: `# Private bucket, no request logging: nothing to observe, logs off.` / `[observability]` / `enabled = false` |
| `kalsa-download` | **off** | `workers/download/wrangler.toml:18-20`: `# Static page and streamed installers: nothing to observe, logs off.` / `[observability]` / `enabled = false` |
| `kalsa-pair` | **off** | `workers/pair/wrangler.toml:13-15`: `# Static page + static JSON: nothing to observe, logs off.` / `[observability]` / `enabled = false` |
| `kalsa-telemetry` | **NOT SET — defaults to Cloudflare's default (Workers Logs on)** | `workers/telemetry/wrangler.toml` has no `[observability]` section; contrast the three files above |

**Logpush: nothing is configured in this repo for any Worker.** Repo-wide grep for `logpush`
returns zero matches. The only acknowledgement that it *could* exist is forward-looking,
`workers/download/README.md:44-45` (*"any Logpush job you may configure later"*).

Note the asymmetry: telemetry is the only Worker that **both stores user reports and leaves Workers
Logs at the default**, and its `/report` endpoint is unauthenticated
(`workers/telemetry/index.ts:116-118`). If Workers Logs capture request metadata at the platform
default, third parties could POST fabricated reports and read back request-level metadata. Worth
turning observability off there.

---

## 7. Content that CAN leave the device (server-side inventory)

1. **Desktop/phone log text — `POST kalsa.io/report`.** User press. Arbitrary text up to 4 MiB,
   stored raw in R2 for ~30 days. The server performs **no** content filtering; the guarantee that
   it contains no chat/prompt/answer/file content rests entirely on the client's log writer
   (`workers/report/README.md:3-7`).
2. **Error-report diagnostics — `POST telemetry.kalsa.io/report`.** Default-on during alpha, togglable.
   Cannot carry free text: strict top-level and nested allow-lists
   (`workers/telemetry/schema.ts:100-111`, `:182-184`, `:208-210`, `:229-231`), enum-only `detail`
   and tokenised `signal` (`:154-161`, `:215-217`). Contains coarse buckets + `osMajor` +
   `appVersion` + `dateBucket` + `manual`.
3. **A pointer to the log text — `diagnostics.logRef`.** Lets a telemetry entry be linked back to a
   specific R2 log object; accepted only in a strict shape
   (`workers/telemetry/schema.ts:334-339`, README `:133-139`).
4. **IP address + timestamp — to Cloudflare, on every request above.** Not stored by us; Cloudflare's
   own request logs retain connection metadata (`workers/telemetry/README.md:145-146`,
   `archived/docs/TELEMETRY_OPTIN.md:396-398`).
5. **Diagnostics to a public GitHub issue — only if `AUTO_OPEN_ISSUES="true"`.** Default `"false"`
   (`workers/telemetry/wrangler.toml:31`). If flipped: GitHub/Microsoft becomes a third-party
   processor and the content is **public** (`workers/telemetry/index.ts:602-615`).
6. **Tester's IP + User-Agent to Cloudflare on `kalsa.io/download*`** — download traffic only, no
   key, no payload; key is in the URL, which Cloudflare logs (`workers/download/README.md:44-45`).
7. **Invite link fragment for `kalsa.io/pair` — does not leave the browser** (§4).
8. **Nothing** from `kalsa-pair`: no storage, no bindings, no logs.

On the server side there is **no** remote LLM API, no analytics SDK, no crash reporter, no session
replay, and no error tracker — none of these exist in `workers/`; the only outbound integration is
GitHub, behind the disabled-by-default flag.

---

## 8. What Kalsa holds on its servers: retention and identifiers

| Asset | System | Content | Identifiers | Retention | Who can read |
| --- | --- | --- | --- | --- | --- |
| `kalsa-reports` R2 objects | `kalsa-report` | raw desktop log text (arbitrary) | `app` (`version/os/arch`) + `received` timestamp; random 8-char id; **no IP, no UA** | **~30 d, manual rule only — not in repo config**; lag up to ~24 h | Owner via Cloudflare dashboard only (`README.md:142-144`); no HTTP read path |
| `TelemetryBuffer` DO | `kalsa-telemetry` | validated error-report JSON, signature, count, timestamps, logRefs | coarse buckets, `osMajor`, `appVersion`, `dateBucket`, `manual`; **no IP, no device id, no free text** | **NO TTL / NO eviction — indefinite** until `/admin/flush-and-purge` or `wrangler delete` | `READ_TOKEN` (`GET /admin/reports`), `FLUSH_TOKEN` (`GET /flush`), `ADMIN_TOKEN` (`POST /admin/flush-and-purge`); plus Cloudflare account owner |
| telemetry IP rate map | isolate RAM | IP → hit timestamps | full IP | ≤ 1 h, ≤2048 keys, RAM only, never persisted (`index.ts:67-68`, `schema.ts:21`) | nobody; not readable as data |
| `kalsa-installers` R2 | `kalsa-download` | installers, `current.json`, `.sig` | none (our artifacts) | **no lifecycle rule** | anyone with `LINK_KEY`; updater artifacts readable by anyone with the app (`README.md:97-101`) |
| *(public)* `kalsa-downloads` @ `dl.kalsa.io` | **no Worker in repo** | engine downloads | none | unknown — **outside this scope** (`workers/download/README.md:223`) | public |
| `kalsa-pair` | `kalsa-pair` | nothing stored | — | n/a | n/a |

---

## 9. Gaps / could not verify

1. **The 30-day R2 lifecycle rule is not in the repo.** It exists only as a manual command in
   `workers/report/README.md:117`. If the owner never ran it, logs are kept **indefinitely**. This
   is the highest-priority item to verify and, ideally, move into IaC.
2. **Telemetry DO has no retention at all** and no per-user delete API
   (`archived/docs/TELEMETRY_OPTIN.md:389-391`). A legal deletion request can only be satisfied by
   a **global** `/admin/flush-and-purge`, which wipes every user's buffer — there is no way to delete
   one user's reports.
3. **Telemetry Workers Logs are not disabled** (no `[observability]` in
   `workers/telemetry/wrangler.toml`), unlike the other three Workers. Current actual state not
   verifiable from the repo; the dashboard is authoritative.
4. **No Logpush config in the repo** — but nothing prevents the owner from enabling one, and
   `workers/download/README.md:44-45` shows the secret download key rides in the request line that
   such a job would record.
5. **`AUTO_OPEN_ISSUES` actual deployed value** — `"false"` in `wrangler.toml:31`, but it is a
   dashboard-togglable var and could have been flipped in production without a repo change. That
   flips reports to **public GitHub issues**.
6. **The report Worker cannot enforce its content promise** (`README.md:3-7`). The client-side log
   writer is out of this scope and was not audited here; if it leaks a prompt or a document name, we
   store it and cannot detect it.
7. **`dl.kalsa.io` / bucket `kalsa-downloads`** — a public bucket with **no Worker in this repo** to
   inspect (`workers/download/README.md:223`). Whether it logs, and its lifecycle, are unverifiable
   from this checkout.
8. **Relay plaintext** — Kalsa runs none, but the iroh relay used is **n0's (third party)** and it
   receives device EndpointIds and both peers' network metadata
   (`bridge.rs:47-48`, `native/kalsa-iroh-mobile/README.md:80-82`). Whether the n0 relay can ever
   see plaintext is a property of the iroh library, **not verified in this repo**.
9. **Documentation drift found:** `archived/docs/TELEMETRY_OPTIN.md:402-403` still asks for copy
   reading *"Telemetry is off by default and opt-in"*, while the shipped code defaults **on**
   (`src/telemetry/config.ts:25`) and the live English copy correctly says on-by-default
   (`src/i18n/en.ts:254-255`). The *user-facing* copy is accurate; the *design doc* is stale. The
   Italian `privacyBody` parity should be re-checked.
10. **`POST /report` is unauthenticated** (`workers/telemetry/index.ts:116-118`) and its IP limit is
    self-described as unreliable — `workers/telemetry/index.ts:67`: *"Best-effort in-memory IP rate
    (single isolate; not global)."* Not a privacy leak of *our* data, but it means the buffer and any
    GitHub issues can be polluted by third parties.
11. `workers/telemetry/cf-ambient.d.ts` types a `KVNamespace` that nothing binds — cosmetic, but a
    future KV binding would not be caught by review here.
12. All R2 lifecycle/`wrangler secret`/deploy operations are documented but, per
    `workers/report/README.md:127-128` (*"wrangler is not installed in the repo, so none of these
    commands were executed"*), have never been run from this checkout. Live bucket state is
    unverified.