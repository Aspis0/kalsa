# E — Desktop (kalsa-brain)

Source: `/Users/marco/Projects/kalsa-brain` @ branch `brain`, plus the server side at `/Users/marco/Projects/kalsa/workers/` (read for retention/handling, not part of this repo).

**Shape:** all inference is local. The engine binds loopback; the door binds `Ipv4Addr::LOCALHOST`; the webview CSP is `connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:* http://localhost:*`. There is no cloud model API anywhere in `src-tauri/` or `crates/` (no `openai`, `anthropic`, `ollama` HTTP). Everything below is the *complete* set of off-device destinations.

## Destination table

| # | Destination | Owner | What leaves | Trigger | Default |
|---|---|---|---|---|---|
| 1 | `https://mcp.exa.ai/mcp` (Exa, MCP-over-HTTP) | Exa (third party) | **The model's raw search query text**, verbatim | Model calls the `web_search` tool | On |
| 2 | `https://kalsa.io/report` (Cloudflare Worker → R2 `kalsa-reports`) | Kalsa (first party) | The app's own 2 log files, redacted, ≤4 MiB | Tester presses "Send the log"; also automatic on crash severity ≥ `crash`, and after any network failure inside a telemetry post | Off unless pressed / on for crash |
| 3 | `https://kalsa.io/.../v2/report` (telemetry Worker → Durable Object) | Kalsa (first party) | Fixed enumerated event fields, no user text | Every qualifying state transition | **On for fresh installs** |
| 4 | `https://kalsa.io/download/update/{key}/{target}/{arch}/{version}` | Kalsa (first party) | App version, platform, arch | Startup update check | On (can be disabled in Settings) |
| 5 | `https://huggingface.co/{repo}/resolve/{commit}/{file}` | Hugging Face (third party) | Which model file is being fetched (GET, byte-range) | Model download / resume | On first download of each model |
| 6 | `https://dl.kalsa.io/kalsa-server/v1.1.5/` | Kalsa (first party) | Which asset file is being fetched | Runtime binary download (the forked supervisor) | On first run, self-updating |
| 7 | `imap(s)://…` / `smtp(s)://…` — the user's own provider | User's mailbox provider | IMAP commands, mail **contents**; SMTP message bytes | Model uses `mail_*` tools | Off until the user adds an account |
| 8 | n0 public relays + n0 discovery (`pkarr`) | **n0, Inc. (third party)** | Encrypted QUIC packets; relay-visible metadata = both node IDs, IPs, timing, sizes | Phone pairing / remote chat | On when a phone is paired |
| 9 | Arbitrary site via `brain_web_fetch` | Whatever the user/model targets | URL path + client IP | Model calls `web_fetch` on a URL | Gated |
| 10 | User's own Tailscale tailnet | Tailscale (third party, user's account) | WireGuard handshake keys to their own coord server | `src-tauri/src/tailnet.rs` shells to the local `tailscale` CLI | Off unless the user enables it |
| — | Model download → any HTTP page | any site | `Range` GET of a URL derived from a search result | `web_fetch` | — |

No analytics SDK exists in either tree. `git grep sentry|bugsnag|rollbar|datadog|posthog|amplitude|mixpanel|gtag` over all `*.toml`/`*.json`/`*.ts`/`*.tsx` returns nothing. `chat/package.json` is React + a PDF/media library and nothing else.

---

## 1. Web search — the sharpest content path

`crates/kalsa-web/src/exa.rs:15` — the provider is **Exa**, hardcoded, no configuration, no key.

```rust
const ENDPOINT: &str = "https://mcp.exa.ai/mcp";
"arguments": { "query": query, "numResults": RESULTS },   // RESULTS = 4
```

What Exa receives, in full:
- **The search query string exactly as the model wrote it** — `crates/kalsa-web/src/exa.rs:69`. This is the single most content-bearing egress in the app. If the model forms a query from user text, that text reaches Exa.
- `clientInfo: {"name": "kalsa-brain", "version": CARGO_PKG_VERSION}` (`exa.rs:35-36`) — self-identifies the app by name and version.
- **`mcp-session-id`** echoed after the handshake (`exa.rs:18`, `:59`, `:73`) — a per-search-request correlation id.
- Ordinary HTTP metadata: source IP, TLS fingerprint, timing.

The crate header states the economics plainly: *"No API key: the free plan is per-IP, which is what the phone uses too."* So the identity key is **IP address**, and there is no account, no auth header, and nothing the server could use to distinguish one user's queries from another's on the backend — but Exa still sees a stable IP plus a stable client name.

Deliberate detail: the query is never echoed back into the tool result. `crates/kalsa-web/src/exa.rs:124` — *"The query is never echoed into the answer: the model's own words, sent back as a tool result, would read as provenance for an address nobody typed."* Good practice; it prevents the query text from being persisted in the local room transcript.

**Is the user asked?** This is the weak point. `chat/src/lib/tools/registry.ts:146` calls `brain_web_search` directly. The consent gate (`registry.ts:188-`, webgate) prompts only when `pinnedPaths().length > 0 || mailInConversation(...)`. In a plain conversation with no pinned document and no mail, **`web_search` fires with no prompt at all** — the query goes to Exa silently. There *is* a `searchQueryRefusal()` sensitive-content check in `chat/src/lib/webgate/sensitive.ts`, but it is a refusal heuristic (looks for secrets in the query), not a consent mechanism.

**`web_fetch`** (`registry.ts:162`) is the higher-privilege sibling: it fetches an arbitrary URL and returns the text to the model. It goes through the same gate. Its egress destination is whatever URL the model chose, so Kalsa is a generic HTTP client here, with the same IP and the same consent gap.

---

## 2. Telemetry — the largest surprise

### On by default, no opt-in

`src-tauri/src/telemetry/store.rs` — the default is `fresh`:

```rust
enabled: fresh,     // no state file + no initialized marker => telemetry ON
```

A brand-new install sends telemetry without ever being asked. `chat/src/components/TelemetryNotice.tsx` renders a **dismissible banner**, not a consent dialog, and the copy is deliberately hedged (`chat/src/i18n/en/telemetry.ts`):

> "On during the alpha. Reports contain technical details and, when something serious goes wrong, the app's log. Your chats and text are never included."

So the user is *told* it is on, and can turn it off in Settings (`chat/src/components/TelemetrySettings.tsx` → `src-tauri/src/telemetry/commands.rs`). That is disclosed-but-default-on, not opt-in. Compare the tuner's `(Recommended)` markers — no such marker here.

### The field allow-list is the strongest control in the codebase

`src-tauri/src/telemetry/spec.rs` is **generated** from the server contract:

```
// Generated from workers/telemetry/contract-v2.ts; regenerate with dev/generate-telemetry-spec.mjs.
```

So the client's field set cannot drift from what the server stores — a property the client cannot silently widen. Fields are a fixed vocabulary: `code`, `component`, `stage`, `phase`, `detail`, plus enumerated extras (`phase`, `phaseDetail`, `reason`, `request`, `response`, `slot`, `context`, `k`, `draft`…). Crucially there is **no free-text message field and no `error.message`**. Error codes are a closed enum (`unknown`, `refused`, `unreachable`, …), which is the right way to ship diagnostics — a maintainer loses the message, but a user's text can never ride along in one.

### Diagnostics sampling

`src-tauri/src/telemetry/diagnostics.rs` collects hardware, and every string field is regex-validated against an allow-list before it can be sent — `cpuModel` / `gpuModel` must match a hardware-shape regex, `host_name` is cleaned. Continuous values (`cpuLoad`, `freeRam`, `ramUse`) are **bucketed** into ranges (`spec::bucket`), not sent raw. `onBattery` is a boolean. A `memory()` helper (`src-tauri/src/telemetry/resources.rs:30`) emits only `{"thermal", "freeRam", "ramUse", "cpuLoad"}`.

Privacy tests exist and are real: `src-tauri/src/telemetry/privacy_tests.rs` asserts that prompt-like and key-like content is stripped before serialization. This is a genuinely well-engineered subsystem — the design intent and the tests both back the "your chats are never included" claim for the *structured* channel.

### The IP the server sees

Both Workers are Cloudflare and both use `CF-Connecting-IP` for rate limiting (`workers/telemetry/index.ts`), so **the maintainer's Cloudflare sees the user's IP** on every telemetry post and every log upload, and that IP is the rate-limit key. For a single-user alpha that is a durable link between a human and their machine.

---

## 3. Log / report upload — where the redaction claim gets tested

`src-tauri/src/report.rs` — `https://kalsa.io/report`, `text/plain`, 30 s budget, no retries, no queue, `https_only(true)`, `redirects(0)`.

**Header:** `X-Kalsa-App: {version}/{os}/{arch}` (`report.rs:84`). No device id, no user id. Clean.

**Body:** exactly two files, oldest-first, each trimmed to the newest 4 MiB, joined, then trimmed again to 4 MiB (`report.rs:126-151`).

Two controls are worth calling out because they are the ones most systems get wrong:

1. **The engine's log is excluded.** `report.rs:120`: *"The engine's stderr file (`kalsa-engine.log`, beside these two) is not read here and stays a local diagnostic."* This is the correct call — `kalsa-engine.log` is where generation output would live, so it is structurally kept out of the upload.

2. **The body is re-redacted at upload time, not just at write time.** `report.rs:117`: *"the files can hold lines an older build wrote before the sink learned to redact, and this body is uploaded as it sits, so the joined body goes through the same rule here, before any send."* That covers log lines written by older versions, which a log-sink-only redactor misses entirely.

**The logger's redaction** (`src-tauri/src/logging.rs:380`, `redact_str`) removes: `$HOME`/user paths → `<home>`, `/Users/<name>` → `<user>`, hostname, IPv4/IPv6, and URL **query strings** (keeping scheme+host+path). The URL rule is the important one — it is what keeps any token that ended up in a URL from leaving.

**Where I think the claim is thinner than the UI states.** The UI says, in big letters (`chat/src/i18n/en/report.ts`):

> "The log never contains your messages, Kalsa's answers, your files, or any code or key."

Redaction is a **deny-list** applied to already-written lines. It is only as good as what no one logs. Two paths deserve scrutiny:

- `src-tauri/src/main.rs:1263` — `log::warn!("{text}")` inside a generic `From<String> for CommandError`, i.e. *arbitrary* strings from any `?`-converted error reach the log verbatim. `redact()` removes paths/host/IP/URL-query from them, but it does not remove prose. If an upstream error ever embeds content, it lands in the uploaded body.
- `src-tauri/src/mail/commands.rs:132-133` logs the first 80 chars of the sidecar's `for_model` text. I verified this one is safe: the comment's claim holds. All the mail error texts are fixed `&'static str` constants from `MailError::message()` (`crates/kalsa-mail/src/imap.rs:44`), and `mail.call` logs arguments nowhere. Also `host.rs:50,78` logs only codes and words.

So: the mail path is genuinely clean, and the residual risk is the generic `CommandError` funnel in `main.rs`, not any specific subsystem.

**Automatic uploads.** Three `with_log: true` sites send the log without the tester pressing anything:
- `src-tauri/src/telemetry/events.rs:26,57` — severity ≥ crash / error-classified events.
- `src-tauri/src/telemetry/mod.rs:250` — **any network failure during a telemetry post also uploads the log.** So a flaky network escalates into a log upload.
- `src-tauri/src/main.rs:2651` — unclean previous exit, auto-firing on the next launch. The comment frames this as "one report per unclean exit, under the same consent as every other report, and the tester never has to send anything."

That last one is the one I'd flag to a user: a crash sends their recent log to the vendor **without them pressing a button**, and the banner they dismissed is the only notice.

**Storage.** `workers/report` writes to R2 bucket `kalsa-reports`; `workers/telemetry` writes to a Durable Object buffer. The telemetry README is candid and worth quoting: **"No silent eviction: accepted reports stay until a maintainer flush/purge. There is no automatic expiry."** So the log body is retained **indefinitely until someone manually purges it**. An end-user reading "turn these off" would reasonably assume that stops accumulation; it stops *sending*, and the operator's purge discipline is what bounds the archive.

---

## 4. Crash reports

`src-tauri/src/crash_restart.rs` — the in-process restart logic. Crash *data* leaves only via the two paths above (auto-report at events.rs / `main.rs:2651`). No minidump uploader, no separate crash SDK, no Sentry. A crash's content exposure is exactly the crash-telemetry case, which is `with_log: true`.

---

## 5. Model downloads

`crates/kalsa-catalog/src/manifest.rs:96`:

```rust
"https://huggingface.co/{}/resolve/{}/{}"
```

- **What is sent:** the model identity — `{repo}/resolve/{commit_sha}/{filename}` — via a `Range` GET (`crates/kalsa-download/src/range.rs:29`, resumable). Plus ordinary HTTP metadata.
- **What is NOT sent:** no device id, no user id, no app telemetry header. `crates/kalsa-download/src/fetch.rs` sets only `Range` and reads `Content-Length`.
- **Consequence:** Hugging Face sees one IP downloading GGUF weights. It cannot tell a Kalsa user from any other HF client by request shape, but it can see which models this IP wants and when. Nothing links this to the telemetry IP records beyond the shared IP.

Integrity is checked — `crates/kalsa-download/src/verify.rs` (SHA-256 against the manifest) — so this is a supply-chain-positive fetch, not an arbitrary-URL fetch. The download manifest ships inside the app rather than being pulled from Kalsa at runtime, which is the better design.

---

## 6. OTA updater

`src-tauri/tauri.conf.json` — the Tauri updater plugin:

```json
"pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk…",
"endpoints": ["https://kalsa.io/download/update/REPLACE_WITH_UPDATE_KEY/{{target}}/{{arch}}/{{current_version}}"],
"requireSignedVersion": true
```

- **What is sent:** `{target}` (os/arch), `{arch}`, `{current_version}`. Nothing else. This is the least data-leaking of all the endpoints and needs no commentary.
- **Verification:** minisign signatures are mandatory (`requireSignedVersion: true` + pinned pubkey). `src-tauri/src/updater.rs` handles the startup check and logs only `failure.code()` on failure (`updater.rs:347`) — never the version string's origin or any state.
- **Same infra as telemetry.** `telemetry.kalsa.io` / `kalsa.io` are the same domain, so an observer sees "this IP updates the app" and "this IP posts telemetry" and can correlate them. That's a minor but real linkage between the update channel and the telemetry stream.
- **A template placeholder is live in config** — `REPLACE_WITH_UPDATE_KEY` in the committed `tauri.conf.json`. It's presumably substituted at release time; worth confirming it's never shipped literally, since a literal placeholder would mean the update channel is broken (fails safe — no silent unsigned updates).

---

## 7. Mail — IMAP/SMTP to the user's own provider

This is the most content-bearing path in the app, and it is the one where "content leaves the machine" is most obviously true — but the destination is the user's own mailbox provider, which is the user's own infrastructure.

- `crates/kalsa-mail/src/imap.rs:123` — `TcpStream::connect((account.host(), account.port()))`. Plain TCP to the account's own IMAP host; TLS/STARTTLS handled by the `async-imap`/`async-native-tls` dependency in `crates/kalsa-mail/Cargo.toml`.
- `src-tauri/src/mail/providers.rs:26` — provider guessing by domain (`icloud.com`/`me.com`/`mac.com` → `smtp.mail.me.com:587`), i.e. it only ever connects to the host belonging to the address the user typed. There is no Kalsa-hosted mail relay.
- **Credentials:** `src-tauri/src/mail/keychain.rs` stores the password in the OS keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service), not in Kalsa's files and never in the log. Account settings live locally.
- **Logging:** verified clean, as covered in §3. `mail.call {name} refused/failed: {code}` only — codes and fixed sentences, never addresses, subjects, bodies, or search terms.
- **Local transcript:** mail the model reads is returned as a tool result into the room, which is written to `room-log.jsonl` — local disk, `0600`, owner-only, with damage recovery (`crates/kalsa-room/src/lib.rs`). Not uploaded.

Net: mail content goes to the user's mailbox provider (expected) and stays on local disk otherwise. Kalsa is a mail client here, not a mail intermediary.

---

## 8. Phone pairing / relay — the third-party party users won't expect

`crates/kalsa-iroh/` — iroh QUIC (`iroh = "=1.2.0"`, pinned) between desktop and phone.

- **Direct P2P where possible** — LAN discovery via `iroh-mdns-address-lookup = "=0.6.0"`, so on the same network no third party is involved at all.
- **n0's public relays otherwise.** `crates/kalsa-iroh/src/bridge.rs:32-` selects the relay tier, and the fallback is n0's public relay network — **operated by n0, Inc., a third party, not by Kalsa.**
- **What n0 sees:** QUIC is end-to-end encrypted between desktop and phone, so the relay carries **ciphertext**. What it does see is transport metadata: both node IDs (stable long-term pseudonyms), both IP addresses, connection timing, and packet sizes/timing patterns. It cannot read the conversation.
- **Discovery traffic:** n0's PKI/DNS-based discovery means node-ID lookups go out to n0-operated infrastructure.
- **Pairing payload is a URL *fragment*.** `crates/kalsa-pairing/src/invite.rs:62`:

  ```rust
  const LINK_ORIGIN: &str = "https://kalsa.io/pair#";
  ```

  The payload sits after `#`. Fragments are never transmitted to the server in an HTTP request — so **the pairing secret does not touch kalsa.io**, and the QR/link is genuinely local-to-local. `src-tauri/src/invites/tests.rs:95-103` asserts the serialized wire form and debug form contain no `kalsa.io` string, locking the property down. This is a well-designed detail.

- **n0 key is a third-party dependency:** `Cargo.toml` pins iroh exactly (`=1.2.0`) and the header in `transport.rs` documents the upgrade discipline. Both node secrets are 32 bytes from OS entropy, stored as 64 hex chars, owner-only, with a Windows protected DACL.

Honest framing for a user: **"your chats stay between your devices" is true of content. "Nothing goes to a third party" is false when off-LAN** — n0's relays carry the encrypted traffic and see the metadata above, and Tailscale sees its own if the tailnet feature is on.

---

## 9. Tailscale

`src-tauri/src/tailnet.rs` — runs the user's own `tailscale` CLI to publish the door at `desk.tail99zz44x.ts.net`. No Kalsa-mediated tunnel, no Kalsa-held keys. Off unless the user turns it on. Worth a line in a user-facing note because "remote access" features are where vendors usually insert themselves; this one doesn't.

---

## What I'd flag

Ordered by how much a user would be surprised:

1. **Web search queries go to Exa with no prompt in the common case.** The consent gate in `registry.ts` only fires when documents are pinned or mail is in the conversation. The query text is the model's raw words and may be derived from the user's message. This is the one place where the user's conversational content routinely reaches a third party, and it is the least disclosed.

2. **Telemetry is on by default for fresh installs** (`store.rs`: `enabled: fresh`), announced by a dismissible banner rather than asked for. Disclosed, but opt-out.

3. **Crash and post-failure log uploads happen without a button press** (`events.rs:26,57`; `mod.rs:250`; `main.rs:2651`). The banner text covers "when something serious goes wrong, the app's log," but a user who read "Send the log" as user-initiated would be wrong.

4. **No server-side expiry.** Telemetry README: *"accepted reports stay until a maintainer flush/purge… no automatic expiry."* Log bodies containing redacted diagnostics persist indefinitely pending manual action. Turning telemetry off stops sending; it does not bound what was already collected.

5. **Cloudflare sees the user's IP on every telemetry and report post** (used as the rate-limit key), and the same IP also hits the updater. IP is the de facto user identifier across the whole first-party surface.

6. **n0's public relays are a real third party** when pairing off-LAN. Content is encrypted; node IDs, IPs, timing, and sizes are not.

7. **The generic error funnel is the weakest link in the log-redaction story.** `main.rs:1263` logs arbitrary error strings. Redaction is a deny-list over paths/host/IP/URL-query — it does not stop prose that happens to embed content. The specific subsystems (mail, updater, web, tuning) are all verified clean; the funnel is where a future regression would land.

## Not present (checked, worth stating)

- No cloud model API. No prompt, chat, or completion leaves the machine through Kalsa's own code.
- No analytics/crash SDK of any kind, in either repo.
- No advertising identifiers, no fingerprinting, no third-party cookies.
- No Kalsa-operated mail relay — IMAP/SMTP go only to the provider belonging to the user's own address.
- No silent model download from arbitrary URLs — manifest-pinned repos, SHA-256 verified, signed OTA artifacts.
- The webview CSP blocks all non-loopback `connect-src`, so all egress is Rust-side and auditable.