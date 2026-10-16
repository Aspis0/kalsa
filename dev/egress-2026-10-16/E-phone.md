# Egress census — Kalsa PHONE app

Repo `/Users/marco/Projects/kalsa`, branch `main`. Scope: `src/`, `native/`, `package.json`,
`android/` gradle, `app.config.js`. **`workers/` is explicitly out of scope** (another explorer).

**Headline:** exactly **two** Kalsa-owned endpoints exist in the entire phone app — `kalsa.io/report`
and `telemetry.kalsa.io`. No third-party crash reporter, analytics SDK, session replay, or error
tracker is present in npm or gradle. The upload filter in `src/logReport` is a real allow-list and
does hold. The material risk is **not** Kalsa's own telemetry — it is (a) telemetry being **on by
default**, (b) the **default web-search provider sending queries to Exa with no key**, and (c) the
**iroh road traversing n0's public relay**.

---

## 0. Third-party SDK census (the "is anything phoning home automatically?" question)

| SDK class | Present? | Proof |
|---|---|---|
| Crash reporter (Sentry/Bugsnag/Crashlytics) | **No** | full dep list below |
| Analytics (Firebase/Amplitude/PostHog/GA) | **No** | full dep list below |
| Session replay / error tracker | **No** | full dep list below |
| Cloud LLM SDK (OpenAI/Anthropic client) | **No** | the `openai*` files are a hand-rolled XHR wire for the *user's own PC*, see §5 |
| OTA / update checker (`expo-updates`) | **No** | absent from deps |
| Remote push registration | **No** | `grep getExpoPushToken\|registerForRemoteNotifications` over `src/` and `native/` returns **nothing**; `src/host/downloadNotifications.ts:56` uses `expo-notifications` for **local scheduled notifications only** |

`package.json` `dependencies` (verbatim, complete):
```
@expo-google-fonts/bricolage-grotesque @expo-google-fonts/fraunces @expo-google-fonts/ibm-plex-mono
@expo-google-fonts/inter @expo-google-fonts/source-serif-4 @expo/vector-icons
@fugood/react-native-audio-pcm-stream @react-native-async-storage/async-storage buffer
expo expo-application expo-asset expo-battery expo-blur expo-build-properties expo-calendar
expo-camera expo-clipboard expo-constants expo-crypto expo-device expo-document-picker
expo-file-system expo-font expo-image-manipulator expo-image-picker expo-keep-awake
expo-linear-gradient expo-notifications expo-secure-store expo-sharing expo-speech fflate
llama.rn lucide-react-native react react-dom react-native react-native-draggable-flatlist
react-native-fs react-native-gesture-handler react-native-keyboard-controller
react-native-reanimated react-native-safe-area-context react-native-svg react-native-view-shot
react-native-web react-native-webview react-native-worklets whisper.rn
```
`devDependencies`: `@types/jest @types/node @types/react expo-doctor jest pdfjs-dist
react-test-renderer ts-jest typescript`.

Android `android/app/build.gradle:80-107` `dependencies` block adds only
`com.facebook.react:react-android`, optional Fresco gif/webp, and Hermes — **no analytics or crash
artifact**. `android/build.gradle:8-12` buildscript is AGP + RN + Kotlin only.

`native/GovernorBatteryModule.kt` — **zero network code**:
```
grep -rn "http\|URL\|OkHttp\|socket\|Socket\|HttpURL" native/GovernorBatteryModule.kt
  → (no matches)
```

---

## 1. Log report upload — `kalsa.io/report` ✅ filter holds

| Field | Finding |
|---|---|
| Trigger | **User action only** — a button press |
| Default | Off (nothing is queued or sent automatically) |
| Consent screen | `src/components/SendLogPanel.tsx:1-6`, copy at `src/i18n/en.ts:1626` |
| Destination | **Our server** — `https://kalsa.io/report` (Worker `workers/report`, other explorer's scope) |
| Fields sent | The projected report text only |
| **Any user content?** | **NO — structurally impossible, see proof below** |

### The two questions asked

**Q1 — can the uploaded log report carry any user text?**
**No.** There are two independent gates, and both are real.

*Gate 1 — closed allow-list projection (`src/logReport/schema.ts:96-107`):*
```ts
  const schema = Object.prototype.hasOwnProperty.call(TAG_SCHEMAS, tag)
    ? TAG_SCHEMAS[tag]
    : undefined;
  if (!schema) return null;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const input = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [field, rule] of Object.entries(schema)) {
    if (!(field in input)) continue;
    const projected = projectValue(rule, input[field]);
    if (projected !== undefined) out[field] = projected;
  }
```
The loop iterates the **schema's** keys, not the payload's. A field the schema does not declare is
never even read. The header comment states the intent (`schema.ts:1-6`):
```
 * The projection engine for the report records: walk a parsed payload through
 * its tag's allow-list (tagSchemas.ts) field by field and serialize the
 * survivors as `TAG {json}`. Free-form strings are never copied — only
 * schema-validated values reach the output.
```

Crucially, **no field kind in the type admits arbitrary text** (`tagSchemas.ts:13-39`): the kinds are
`num`, `bool`, `enum`, `counter`, `safeId8`, `modelId`, `numObj`, `numArray`, `strArray`, `idObj`.
Every string-bearing kind is closed:
- `enum` — `typeof value === "string" && rule.values.includes(value)` (`schema.ts:30`)
- `counter` — `/^\d{1,12}$/` (`schema.ts:32`)
- `safeId8` — `/^[a-zA-Z0-9_-]{1,8}$/` (`schema.ts:34`)
- `modelId` — must be in the catalog set (`schema.ts:36`)
- `strArray` — `/^[a-zA-Z0-9._-]+$/` per item, length+count capped (`schema.ts:67-68`)
- `idObj` — `/^[a-zA-Z0-9._-]+$/` per value under closed keys (`schema.ts:78-80`)

I read **all 27 tags** in `TAG_SCHEMAS` (`tagSchemas.ts:69-464`). Every `enumOf(...)` value is a
code-defined literal. The privacy boundary is documented at `tagSchemas.ts:8-10`:
```
 * Privacy boundary (owner sentence): no messages, no answers, no files, no
 * code or key. Only finite numbers, booleans, code-defined enum literals and
 * catalog model ids pass. Every closed set quotes the code that emits it.
```
Two tags explicitly drop known-prose fields, with the reason:
- `tagSchemas.ts:102-103` — `` `reason` (stats.failure_reason) is DROPPED: native free prose (llama.rn rn-governor.cpp:47-58 builds it from error strings).``
- `tagSchemas.ts:115-116` — `` `reason` is DROPPED: a sanitized slice of a native error message, "not semantically filtered" (governorRuntime.ts:56).``
- `tagSchemas.ts:272-273` — `DROPPED fields: hash / prewarm / send (prefix hashes ...) and err (native error text, ...)`

*Gate 2 — final safety pass on every accepted line (`src/logReport/normalize.ts:8-16`, `39-47`):*
```ts
const DENY_WORDS = [
  "got exception", "last read", "parse_error", "json.exception",
  "api_keys:", "old: ", "new: ",
] as const;
const MAX_LINE_CHARS = 300;
...
export function finalizeLine(line: string): string | null {
  const lower = line.toLowerCase();
  for (const word of DENY_WORDS) {
    if (lower.includes(word)) return null;
  }
  const redacted = redactText(stripUrlQueryAndFragment(line));
  const clipped = redacted.length > MAX_LINE_CHARS ? redacted.slice(0, MAX_LINE_CHARS) : redacted;
  return `${new Date().toISOString()} ${clipped}`;
}
```
plus IPv4/IPv6 → `<ip>`/`<ip6>`, `/Users/<user>`, `/home/<user>`, `/data/user/<n>/<pkg>`
(`normalize.ts:24-36`) and URL query/fragment stripping (`normalize.ts:20-22`).

*Console tap is itself narrow* — `collector.ts:48-50` only captures lines whose first argument is a
string starting with `KALSA_`, and `collector.ts:64-67` drops anything that is not valid JSON:
```ts
  if (typeof first !== "string" || !first.startsWith("KALSA_")) return;
...
    payload = JSON.parse(payloadParts.join(" "));
  } catch {
    return;
  }
```

*JS errors never carry the message* — `src/logReport/jsErrorLine.ts:1-7`:
```
 * The js_error record for an unhandled JS exception: the error's `name` when
 * it is a code-defined literal, and the FIRST stack frame reduced to
 * `basename:line:column`. NEVER reads or serializes `error.message` — the
 * message is where user text, URLs and paths live, and on Hermes release
 * builds the message IS the first stack line.
```
`jsErrorLine.ts:96` is the entire output: `` return `js_error name=${errorName(error)} frame=${firstFrame(error)}`; ``
with `name` restricted to a 24-entry literal set (`jsErrorLine.ts:18-42`) and the frame restricted to
5 known bundle basenames (`jsErrorLine.ts:50-56`).

*Transport is anonymous* — `sendLog.ts:89-102`:
```ts
    const res = await fetch(REPORT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Kalsa-App": app,
      },
      body,
      ...
        credentials: "omit",
        redirect: "error",
```
`X-Kalsa-App` is `${appVersion()}/${Platform.OS}/${REPORT_ARCH}` (`sendLog.ts:83`) where
`REPORT_ARCH = "arm64"` is a **constant, not a device probe** (`sendLog.ts:13-15`). **No device ID, no
install ID, no user ID.** `credentials: "omit"` means no cookies — the report is unlinkable to a
session. The server's reply text is never surfaced (`sendLog.ts:43`).

**Verdict: the filter is real and it does hold.** No user text can ride the log report.

---

## 2. Does `KALSA_GOVERNOR_LEARNED` reach the report? — **YES, and it is numbers-only**

The tag exists in the schema at `src/logReport/tagSchemas.ts:188-204`:
```ts
  KALSA_GOVERNOR_LEARNED: {
    tps_cpu: NUM,
    tps_gpu: NUM,
    tps_npu: NUM,
    prefill_tps_cpu: NUMN,
    prefill_tps_gpu: NUMN,
    prefill_tps_npu: NUMN,
    heat_cpu: NUMN,
    heat_gpu: NUMN,
    heat_npu: NUMN,
    heat_bg: NUMN,
    heat_sigma: NUM,
    heat_rows: NUM,
    heat_rejects: NUM,
    breaker: NUM,
    breaker_hold_ms: NUMN,
  },
```
Every rule is `NUM`/`NUMN`. Under `projectValue` (`schema.ts:25-26`) a non-finite-number value is
dropped:
```ts
    case "num":
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
```
So it is **arithmetically impossible** for a string to pass this tag. The emitter is
`src/engine/governorLearned.ts:221-247` (`learnedLogFields`), whose return type is
`Record<string, number | null>` and which emits exactly those fifteen numeric keys.

## 3. Does `Build.FINGERPRINT` reach the report? — **NO, and it is deliberately excluded**

The schema says so at `src/logReport/tagSchemas.ts:183-187`:
```
  // governorLearned.ts: the learned store's own numbers, after each row it
  // absorbs. Numbers only — Build.FINGERPRINT and the store key stay out, so
  // no identifier is collected. tps_* are tok/s per leg (EWMA), prefill_tps_*
  // the tok/s of the device that ran the prompt, heat_* the learned ucb in
  // skin C per 1k tokens and heat_bg in C per minute.
```
and the emitter repeats it at `src/engine/governorLearned.ts:218-220`:
```ts
/** The KALSA_GOVERNOR_LEARNED payload: numbers only. The fingerprint stays out
 *  on purpose — Build.FINGERPRINT is not a bounded identifier, and the line
 *  already comes from this one phone. */
```

Where the fingerprint **actually** goes: it is one component of a **local AsyncStorage key**, never
transmitted (`src/engine/governorLearned.ts:80-81`):
```ts
export const learnedStoreKey = (fp: LearnedFingerprint): string =>
  `${LEARNED_STORE_PREFIX}:${fp.model}|${fp.device}|${fp.soc}|${fp.build}|${fp.pin}`;
```
The `build` component is typed and explained at `governorLearned.ts:76-77`:
```
  /** Build.FINGERPRINT: an OTA or a firmware change invalidates the row. */
```

I grepped the whole `src/logReport` subsystem for `FINGERPRINT`: the **only** hit is the comment
itself (`tagSchemas.ts:184`). Confirmed absent.

**Note for the owner:** `deviceProfile.ts:56` carries the field in-process
(`/** Android Build.FINGERPRINT (the whole build id, "/" and ":" included);`) — it is read locally to
key the learned store and does not egress.

---

## 4. Telemetry — `telemetry.kalsa.io/report` ⚠️ **DEFAULT ON**

| Field | Finding |
|---|---|
| Trigger | **Always**, once enabled |
| Default | **ON** for fresh installs |
| Consent screen | `src/screens/SettingsScreen.tsx:415-453` (a confirm sheet, opt-out also available) |
| Destination | **Our server** — `https://telemetry.kalsa.io` (`src/telemetry/config.ts:18-19`) |
| Fields sent | The `TelemetryReport` type below |
| **Any user content?** | **No — but the payload does carry coarse device facts.** |

### ⚠️ Default is ON, not opt-in

`src/telemetry/config.ts:24-25`:
```ts
/** Fresh-install default: alpha builds default on (owner 2026-10-09). Applies only when nothing is stored — a tombstone or a stored `enabled: false` envelope always wins. */
export const TELEMETRY_DEFAULT_ENABLED = true;
```
This is an **opt-out** product, and the product's claim is about *conversations*, not about
diagnostics — so it is defensible, but the legal answer must say "on by default", not "opt-in".

### The payload (`src/telemetry/pure.ts:245-258`) — complete
```ts
export type TelemetryReport = {
  /** 2 only when `diagnostics` is present. */
  v: 1 | 2;
  app: "kalsa";
  appVersion: string;
  platform: "android" | "ios";
  deviceBucket: DeviceBucket;
  osMajor: string;
  error: TelemetryErrorField;
  context: TelemetryContext;
  dateBucket: string;
  manual: boolean;
  diagnostics?: Diagnostics;
};
```
`app: "kalsa"` is a constant. **There is no device ID, install ID, user ID, or account ID field in
the payload** — reports are not linkable to an install at the application layer. Note `appVersion` is
raw and `osMajor` is a major-version string only (`pure.ts:139-142`).

`error` is a `code` + `detail` + `signal`, where `code` and `detail` are closed enums
(`config.ts:76-221`) and `signal` is a **fixed token** extracted by regex from an error message —
`config.ts:228-233`:
```ts
export const SIGNAL_PATTERNS: readonly {
  re: RegExp;
  /** Fixed token, or null to use the matched text (trimmed/sliced). */
  token: string | null;
}[] = [
  { re: /\bENOSPC\b/i, token: "ENOSPC" },
```
The one pattern that emits matched text is `config.ts:243`, and it is tightly scoped:
```ts
  { re: /\bggml_[A-Za-z0-9_]+/i, token: null }, // use match → normalized ggml_*
```
and the result must still pass the charset gate `config.ts:255`:
```ts
export const SIGNAL_CHARSET_RE = /^[A-Za-z0-9_ .-]+$/;
```

### v2 diagnostics (`src/telemetry/diagnosticsSanitize.ts:35-51`)
```ts
export type Diagnostics = {
  component: DiagComponent;
  stage: DiagStage;
  osFamily: "android" | "ios";
  arch?: "aarch64";
  backend?: DiagBackend;
  offload?: DiagOffload;
  thermal?: DiagThermal;
  modelId?: DiagModelId;
  cpuModel?: string;
  ctxTokens?: string;
  promptTokens?: string;
  tokensPerSecond?: string;
  sinceStart?: string;
  signature?: string;
  breadcrumbs?: DiagBreadcrumb[];
};
```
`modelId` is a **4-value registry allow-list** (`diagnosticsContract.ts:24-29`). `ctxTokens`,
`promptTokens`, `tokensPerSecond`, `sinceStart` are **buckets**, not raw counts
(`diagnosticsBuckets.ts`). `signature` is a canonical token, never the message
(`diagnosticsSignature.ts:1-4`):
```
 * Canonical engine signature from a native error message. Only fixed tokens
 * leave the device; the message itself never does.
```
**`cpuModel` is the one quasi-identifier** — a CPU marketing string validated against a strict
regex copied from the Worker contract (`diagnosticsContract.ts:32-34`), e.g. `"Snapdragon 8 Gen 3"`.
It is hardware, coarse, and not user data, but it does narrow the population of anonymous reports.

### Transport and IP
`src/telemetry/telemetry.ts:1212-1222`:
```ts
      const res = await deps.fetchImpl(`${baseUrl}/report`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body,
```
**No auth header, no ID header.** Body soft-capped at 4 KiB (`config.ts:70`,
`BODY_SOFT_LIMIT_BYTES = 4 * 1024`), 10 s timeout, retry ceiling 5, backoff to 1 h
(`config.ts:62-66`). Local queue caps 50 with a 30-day dead TTL (`config.ts:57-61`).

**IP:** every request necessarily exposes the source IP to Cloudflare. The product discloses this
honestly in the consent copy (`src/i18n/en.ts:269`):
```
Network provider logs (Cloudflare) may briefly record connection metadata; we don't store your IP in the report.
```
Storage/retention on the Worker side is **out of my scope** (`workers/telemetry`, other explorer).

### Consent copy — quoted verbatim (`src/i18n/en.ts:263-272`)
```
    telemetryOptInTitle: "Share error reports?",
    telemetryOptInBody:
      `When enabled, Kalsa may send pseudonymous diagnostic reports about crashes and function failures (error category, coarse device RAM bucket, OS major version, app version — never chat text, documents, API keys, exact device model, or stack traces).

A report already in transit may still arrive after you turn this off.

Network provider logs (Cloudflare) may briefly record connection metadata; we don't store your IP in the report.

Manual "Report a problem" is under your control: do not paste sensitive content — that text goes to a public GitHub form if you submit it.`,
```
⚠️ One wording discrepancy worth flagging: the body promises "never … **exact device model**", yet
`diagnostics.cpuModel` emits a **CPU model string**. It is CPU, not handset model, so the sentence is
arguably accurate — but if the consent text is quoted in a legal response, expect this to be asked.

The banner also states the default-on posture (`src/i18n/en.ts:261-262`):
```
    alphaTelemetryNotice:
      "During the alpha, Kalsa sends error reports with technical details (which AI, the phone's model and memory use) to help fix problems. Never your chats or text. You can turn this off in Settings.",
```

### Manual "Report a problem" — user-mediated, app does not transmit
`src/i18n/en.ts:274-276`:
```
    reportProblem: "Report a problem",
    reportProblemBody:
      "Preview a sanitized diagnostic report, copy it, then open GitHub to paste it yourself. Do not paste chat contents, documents, or API keys — GitHub issues are public.",
```
The app **copies text to the clipboard and opens the browser** — it never POSTs to GitHub
(`GITHUB_ISSUE_CHOOSE_URL`, `config.ts:73-74`). Fully user-mediated.

---

## 5. Remote engine / "desk" mode — full conversation to a remote host

| Field | Finding |
|---|---|
| Trigger | User configures a remote host, then uses chat |
| Default | Off until configured |
| Destination | **The user's own computer** (a URL the user types) — *not* a Kalsa server |
| **User content?** | **YES — the whole conversation, verbatim.** |

This is the single largest content-egress path in the app, and it is legitimate (it is the
phone-as-client-to-your-PC feature), but it must be in the legal answer.

**The turn body carries the conversation as user/assistant words** —
`src/engine/remote/turnBody.ts:20-31`:
```ts
export function toTurnMessages(messages: readonly EngineMessage[]): OpenAiChatMessage[] {
  const out: OpenAiChatMessage[] = [];
  for (const message of messages) {
    const raw =
      message.role === "assistant" && typeof message.modelEmittedText === "string"
        ? message.modelEmittedText
        : message.content;
```
serialized at `turnBody.ts:41-45`:
```ts
  return JSON.stringify({
    messages: args.messages,
    ...(args.replyFor ? { reply_for: args.replyFor } : {}),
    ...(args.language ? { language: args.language } : {}),
  });
```
Header comment (`turnBody.ts:1-4`) confirms the content class:
```
 * The wire body of a turn to the computer (PHONE-CHAT-PROTOCOL §2): the
 * conversation as `user`/`assistant` words, the mail a reply is for, and the
 * phone's own language.
```

The OpenAI-compatible route carries the same plus pictures and a system prompt
(`src/engine/remote/openaiMessages.ts`). **This is not a cloud LLM vendor**: the endpoint is the
user's own host, gated by `remoteUrl.ts:99-111`:
```ts
export function remoteUrlAllowedInThisBuild(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    // Loopback http is allowed in release too: traffic never leaves this
    // device, and Android network-security-config permits cleartext only for
    // 127.0.0.1 / localhost / ::1. Gating on __DEV__ made the phone unusable.
    return isLoopbackHost(parsed.hostname);
```
and a Bearer token is only ever sent over HTTPS or loopback (`remoteUrl.ts:73-81`):
```ts
export function canSendAuthorization(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    return parsed.protocol === "http:" && isLoopbackHost(parsed.hostname);
```

### Mail via the PC
| Field | Finding |
|---|---|
| Trigger | User opens a mail card / presses Send |
| Destination | **The user's own computer** |
| **User content?** | **YES — mail body, and the id of the mail being read** |

`src/engine/remote/mailApi.ts:95-105` (read — sends the mail id, receives the body):
```ts
export function readRemoteMail(id: string, signal?: AbortSignal) {
  return postMailRoute<MailReadPayload>(
    MAIL_ROUTES.read,
    { id },
```
`src/engine/remote/mailApi.ts:109-115` (send — carries the body):
```ts
export function sendRemoteMailDraft(draftId: string, body: string, signal?: AbortSignal) {
  return postMailRoute<string>(
    MAIL_ROUTES.send,
    { draft_id: draftId, body },
```
The recipient is **not** named by the phone — `mailApi.ts:107-108`:
```
/** The recipient the computer actually sent to, taken from its own answer:
 *  the phone named no recipient and must not claim one. */
```
So the phone never transmits a recipient address; the computer supplies it. The computer holds the
mail account credentials (routes answer `{"error": "keychain"}`, `mailApi.ts:8-10`).

---

## 6. Web search — ⚠️ **third parties, and the default needs no key**

| Field | Finding |
|---|---|
| Trigger | Model invokes `web_search`, or the user tests search |
| Default | **On** — `exa-mcp` is the default provider |
| Destination | **Third parties**: Exa, Brave, Tavily |
| **User content?** | **YES — the search query, which is model-authored from the user's conversation** |

### ⚠️ Default provider is key-less Exa MCP
`src/search/registry.ts:30`:
```ts
export const DEFAULT_PROVIDER_ID: SearchProviderId = "exa-mcp";
```
`src/search/registry.ts:3`:
```
 * Default: exa-mcp (free, no key).
```
Endpoint, `src/search/ExaMCP.ts:20`:
```ts
const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp";
```
The free-plan posture is stated at `src/search/ExaMCP.ts:6-7`:
```
 * Verificato il 2026-08-01: NESSUNA API key richiesta (free plan per-IP,
 * ~1000 richieste/mese; oltre il limite il server risponde 429).
```
**Consequence:** with no key, *Kalsa* is the client and **Exa sees the query plus the user's IP
address**, rate-limited per IP. The provider issues are Brave (`Brave Search`), Tavily, and Exa —
three separate companies.

Payloads:
- Brave — query in the **URL query string** (`src/search/providers/brave.ts:70-71`):
  ```ts
        const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=${count}`;
        const response = await fetch(url, {
  ```
- Tavily — query in the **POST body** (`src/search/providers/tavily.ts:54-64`):
  ```ts
        const response = await fetch(TAVILY_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query,
  ```
- Exa API — same shape (`src/search/providers/exaApi.ts:61`).

Keys are user-supplied and held in the OS keystore, never bundled
(`src/search/secretStore.ts:1-5`):
```
 * Secure storage for search-provider API keys.
 * Single source of truth: always read/write through expo-secure-store.
 * Never cache secrets in memory (avoids desync / accidental logging).
```
with `const KEY_PREFIX = "kalsa.secret.";` (`secretStore.ts:10`) and the keyed set
`secretStore.ts:13`:
```ts
const KEYED_PROVIDER_IDS = new Set(["exa", "brave", "tavily"]);
```
(exa-mcp is excluded because it is free — confirming the no-key path is intentional.)

**No secret value is printed anywhere in this report**, per the brief.

---

## 7. Pairing / Room sync / iroh relay

### Pairing goes to the user's own computer, authenticated
`src/pairing/pairingUrls.ts:12-23` gates the pairing target — https, or http only on loopback:
```ts
export function isAllowedPairingUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
```
An HMAC authenticates the completion request, and a pseudonymous install id rides it
(`src/pairing/pairingTransport.ts:246-252`):
```ts
      const mac = phoneMacHex(square.code, square.nonce, {
...
      const installId = square.node ? await getPairingInstallId(square.node) : null;
      const installIdField = installId === null ? "" : `,"install_id":"${installId}"`;
      const body = `{"phone":${canonicalPhoneJson(phone)},"mac":"${mac}","delivery_token":"${this.deliveryToken}"${installIdField}}`;
```
`install_id` is **HMAC-derived, not a hardware identifier** — a random 16-byte local secret keyed to
the peer node (`src/pairing/pairingInstallId.ts:7-13`, secret minted at `:20-24` via `expo-crypto`).
It goes to the user's own desk/door, never to Kalsa.

### iroh road — ⚠️ the relay is **n0's public infrastructure**, not Kalsa's
`native/kalsa-iroh-mobile/src/bridge.rs:52`:
```rust
        let config = BridgeConfig::dial_only().with_relay(RelayChoice::N0Public);
```
This is the direct answer to the brief's "can our relay read it?" — **there is no Kalsa relay here.**
On an iroh road, packets traverse **n0 (the company behind Iroh)** relay servers.

The authors are explicit that this is not anonymity, at `bridge.rs:47-48`:
```
    /// publication is not anonymity: on a relayed road this node still
    /// tells the relay its stable EndpointId. The dial itself is bounded
```
and at `bridge.rs:41-46`:
```
    /// already exist; on Android mDNS listens on the LAN so
    /// the desktop is still found when n0's relay and DNS are unreachable
    /// — the phone never announces itself, and the app holds the Android
```
**Answer:** *content* is end-to-end encrypted — iroh tunnels carry QUIC, and the relay is a
packet forwarder (raw HTTP/1.1 bytes ride a tunnel to the peer's loopback server,
`native/kalsa-iroh-mobile/README.md:3-4`: "one tunnel object carries raw HTTP/1.1 bytes on the door
and desk lanes"). But **n0 sees the stable node EndpointId, plus IP addresses, timings and volumes.**
So: n0 cannot read the conversation; n0 can link your phone to a pseudonymous identifier over time.
The iroh test seam disables relays entirely (`bridge.rs:99-103`, `RelayChoice::Disabled`).

The iroh tunnel URL is deliberately unresolvable — `pairingUrls.ts:5-10`:
```
 * the string only names the request line's path. The .invalid
 * domain cannot resolve, so a bug that ever routed one of these to the
 * network fetch fails closed instead of leaking the request.
export const IROH_TUNNEL_URL = "https://iroh.kalsa.invalid";
```

### Room sync
`src/room/roomStreamWire.ts:5`:
```
 * go to the SSE parser. No EventSource, no new networking: this file
```
Traffic rides the same door road to the user's own desk. The transport abstraction is
`src/remote/road.ts` with two values, `https` and `iroh` (matching `KALSA_ROAD.road`
`tagSchemas.ts:415`: `road: enumOf("https", "iroh")`).

---

## 8. Model downloads — `huggingface.co`

| Field | Finding |
|---|---|
| Trigger | User picks a model to download |
| Default | User action |
| Destination | **Third party** — Hugging Face |
| **User content?** | **No** — outbound is a plain GET of a public file |

`src/engine/ModelDownloader.ts:98-105`:
```ts
export function hfFileUrl(model: ModelInfo, file: string, spec?: ModelFileSpec): string {
  const resolution = resolveModelArtifact(model, spec);
  if (resolution.status === "unpublished") {
    throw new UnpublishedArtifactError(resolution.artifact);
  }
  const { hfRepo: repo, revision } = resolution;
  const [owner, repoName] = repo.split("/").map((part) => encodeURIComponent(part));
  return `https://huggingface.co/${owner}/${repoName}/resolve/${revision}/${encodeURIComponent(file)}`;
}
```
Downloads are **integrity-verified by SHA-256** (`ModelDownloader.ts:139-153`,
`fileMatchesSha256`), so the user is not trusting the CDN blindly. Outbound carries no user data;
inbound is the model. Hugging Face sees the IP and which model file was requested — nothing about
the user. Unpublished artifacts are refused rather than fetched.

## 9. STT — on-device ✅

`src/voice/WhisperService.ts:2`:
```
 * On-device ASR via whisper.rn (whisper.cpp).
```
Model is a local file (`WhisperService.ts:49-50`: `/** Absolute local path of the whisper model file. */`). Raw PCM is
transcribed locally (`transcribePcm`, `WhisperService.ts:104`). **Audio never leaves the device.**
The only egress is the model download (§8).

## 10. TTS — platform engine, ⚠️ one caveat

`src/voice/TtsService.ts:2` and `:15`:
```
 * Text-to-speech via expo-speech (~57).
...
import * as Speech from "expo-speech";
```
`Speech.speak(segments[index], ...)` at `TtsService.ts:174` hands answer text to the **OS speech
engine**. On iOS that is `AVSpeechSynthesizer`; on Android it is the device TTS engine, which on many
stock builds is a **network** engine. Kalsa's code makes no network call of its own and cannot
control which engine the OS picks — flag this as a platform-level dependency rather than a Kalsa
egress path. Not verifiable from this repo (see §13).

---

## 11. Content that CAN leave the device (even opt-in)

1. **The entire chat conversation** — user + assistant text, to the user's own configured remote
   host, whenever "desk"/remote mode is used (`turnBody.ts:20-31, 41-45`). *Default off.*
2. **Mail bodies and mail ids** — to the user's own PC (`mailApi.ts:95-115`). *User action.*
3. **Search queries** — to Exa / Brave / Tavily, model-authored from the conversation
   (`ExaMCP.ts:20`, `brave.ts:70-71`, `tavily.ts:54-64`). *Default provider needs no key.*
4. **Answer text to the OS TTS engine** — platform-level (`TtsService.ts:174`).
5. **Coarse device facts + crash/performance diagnostics** — to `telemetry.kalsa.io`
   (`pure.ts:245-258`). *Default **on**.*
6. **The sanitized report text** — to `kalsa.io/report`, on button press (`sendLog.ts:11, 89`).
   *Contains no content — §1.*
7. **Pseudonymous `install_id` + a pairing MAC** — to the user's own PC (`pairingTransport.ts:246-252`).
8. **Pseudonymous node `EndpointId`, IP, timings** — to **n0** relay servers on the iroh road
   (`bridge.rs:52`, `bridge.rs:47-48`). *Not content; not readable content.*

**What cannot leave the device:** chat text via telemetry; chat text via the log report; audio;
uploaded documents and their text; API keys (keystore + never logged); `Build.FINGERPRINT`;
the learned-store key; exact prompt or answer text in any diagnostic.

## 12. What Kalsa holds on its servers

Only two Kalsa-owned endpoints ship in the phone app (verified by enumerating every `https://…kalsa…`
literal in `src/`):
```
src/logReport/sendLog.ts     ==> https://kalsa.io/report
src/pairing/pairingUrls.ts   ==> https://iroh.kalsa.invalid      (unresolvable by design)
src/telemetry/config.ts      ==> https://telemetry.kalsa.io
```

| Store | Content | Identifiers | Retention |
|---|---|---|---|
| `kalsa.io/report` | Sanitized `TAG {json}` lines + ISO timestamp; header `X-Kalsa-App: version/os/arm64` | **None** — no device, install, or user id; `credentials: "omit"` | **UNKNOWN — server-side, out of my scope** (`workers/report`) |
| `telemetry.kalsa.io` | `TelemetryReport` (see §4): error code/detail/signal, RAM bucket, OS major, app version, platform, date bucket, optional v2 diagnostics incl. CPU model + buckets | **None** in payload; **IP visible to Cloudflare** at the network layer | Client queue TTLs known (30 d, `config.ts:59-61`); **server retention UNKNOWN — out of my scope** (`workers/telemetry`) |
| Third parties | Search query + IP (Exa/Brave/Tavily); model file GET + IP (Hugging Face); node id + IP + timings (n0) | per their policies | **UNKNOWN** |

## 13. Gaps / could not verify

1. **Server-side storage and retention for both Kalsa endpoints is unverified** — `workers/` was
   explicitly excluded from my scope. The client sends no identifiers, but I did not read the Worker
   to confirm what it logs (notably whether it stores the Cloudflare IP) or its R2/bucket retention.
   **This is the single most important open question for a legal response.**
2. **Does `workers/report` apply a second server-side filter?** The client filter is airtight, but
   whether the Worker re-validates line grammar (vs. storing the text as-is) is unverified.
3. **TTS engine behaviour** (§10) — whether Android/iOS actually ships a network TTS engine is a
   device/OS property I cannot determine from this repo. Worst case, read-aloud answer text reaches
   the OEM/Google speech backend.
4. **`diagnostics.cpuModel` vs the consent sentence "never … exact device model"** (§4) — a wording
   nuance a regulator or user could challenge. It is CPU model, not handset model.
5. **`llama.rn` is a fork pinned to a GitHub commit** (`github:Aspis0/kalsa.rn#f385ebd…`). I did not
   audit its internals for telemetry; it is a native inference library with no expected egress, but
   that is an assumption, not a verified fact.
6. **The iroh Rust crate `kalsa_iroh`** (the upstream dependency, not in this repo) — I read only
   `native/kalsa-iroh-mobile`, the thin mobile binding. The QUIC/encryption claim rests on iroh's
   documented design, not on code I read.
7. **iOS-specific paths** — `ios/` was outside my working files; iOS has no Kotlin modules, but I
   did not sweep `ios/` for any separate analytics or its own report sender.

---

## Bottom line for the legal answer

The claim "**conversations stay on your device**" is **true for Kalsa's own servers**: neither
`telemetry.kalsa.io` nor `kalsa.io/report` can carry chat text, and the code proves it with closed
allow-lists rather than best-effort redaction. What the answer must also concede:

- diagnostics are **on by default**, not opt-in;
- **search queries go to third parties by default** (Exa, no key, IP-visible);
- with "desk" mode configured, **the full conversation goes to a remote host** — the user's own, but
  that must be stated;
- on the iroh road, **n0 relay servers see the phone's stable node id**, though not the content.

None of these is Kalsa reading your conversations. But "nothing stored by us" is narrower than
"nothing leaves your device", and the second sentence of the product claim should be scoped to say so.