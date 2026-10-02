# Phone “Send the log” design

Design only. Scope: the React Native phone app at `kalsa-wt-gov` HEAD `0b7c5e71`; report endpoint and UX follow the live owner-approved contract. No upload occurs except after an explicit Send press.

## 1. Report contents and privacy boundary

The uploaded text is a newly assembled, allow-listed diagnostic log. Do not upload logcat, the current console stream, `nativeLogTail`, existing telemetry queue, or arbitrary exception text. `ensureNativeLogCapture` retains raw native lines and mirrors WARN/ERROR text into `KALSA_NATIVE` (`src/engine/nativeLogTail.ts:53–74`); debuggable llama builds can expose content, so this source is excluded even when a line looks diagnostic. No engine debug/verbose switch is set or enabled by this feature.

Proposed accepted records (one record per line; examples show normalized fields, not necessarily current raw output):

| Shape | Example | Source / rule |
|---|---|---|
| `app event=<closed lifecycle enum> version=<validated version> os=<enum> arch=<enum>` | `app event=started version=1.4.2 os=android arch=arm64` | New safe header/event builder; no model, device label, or account metadata. |
| `KALSA_PAIRING_FAIL {stage:<closed enum>,status:<integer|null>}` | `KALSA_PAIRING_FAIL {"stage":"claim_network","status":503}` | Exact fields are stage and HTTP status only (`src/pairing/pairingFailLog.ts:19–28`). |
| `KALSA_ROAD {road,lane,stage,reason,ms}` | `KALSA_ROAD {"road":"iroh","lane":"door","stage":"dial","reason":"deadline","ms":37}` | Retain closed enums and bounded integer time only. The current builder can also emit `node8`; strip that field (`src/remote/road.ts:79–82,95–111,117–120`). |
| `KALSA_GOVERNOR_PAUSE {site|round,reason}` | `KALSA_GOVERNOR_PAUSE {"site":"translate","reason":"<closed-value>"}` | Retain only validated site/reason/round scalars; no turn id (`src/engine/governorPauseLog.ts:16–24,33–41`). |
| `KALSA_THERMAL_COOLING {phase,waitedMs,generationMs,batt_temp_tenths_c,outcome}` | `KALSA_THERMAL_COOLING {"phase":"enter","waitedMs":420,"generationMs":1200,"batt_temp_tenths_c":410,"outcome":"<closed-value>"}` | Retain enumerated phase/outcome and finite bounded integers only (`src/engine/governorPauseLog.ts:44–58`). |
| `js_exception name=<safe error class> frame=<first stack frame>` | `js_exception name=TypeError frame=App.tsx:42:7` | New global JS error boundary/handler; read `name` and first frame only. Never read or serialize `message`, props, component state, or the rest of the stack. |
| `native_crash location=<file:line:column>` | `native_crash location=llama.cpp:304:9` | New native crash hook; location only, no native message or logcat text. |

All records, including these, pass through one final normalizer: drop any line containing (case-insensitive) `got exception`, `last read`, `parse_error`, `json.exception`, `api_keys:`, `old: `, or `new: `; strip every URL query and fragment; redact home/user paths, user and host names, serials, and IPs; clip each line to 300 characters. Validate JSON by tag and construct output fields one by one; never retain unknown fields. Keep the newest 4 MiB, cut at a line boundary, and enforce the cap in bytes after UTF-8 encoding.

### Verdict for every `KALSA_*` token in app `src`

“Include” below means include only the listed normalized fields after schema validation. “Exclude” means the full tag is rejected. Unknown tags always fail closed. The scan was `rg -o 'KALSA_[A-Z_]+' src | sort | uniq -c`; the rows cover every unique source token (tests excluded from runtime collection).

| Verdict | Tags and reason (current emitter / reference) |
|---|---|
| Include | `KALSA_PAIRING_FAIL`: fixed stage + status only (`src/pairing/pairingFailLog.ts:19–28`). `KALSA_ROAD`: allow only the normalized road/lane/stage/reason/time fields; redact `node8` (`src/remote/road.ts:79–82,95–120`). `KALSA_GOVERNOR_PAUSE`, `KALSA_THERMAL_COOLING`: closed literals and numbers only; omit turn IDs (`src/engine/governorPauseLog.ts:16–58`). |
| Exclude | `KALSA_NATIVE`: arbitrary llama text (`src/engine/nativeLogTail.ts:58–73`). `KALSA_SESSION`: current save/load events can include `stemHash`, derived from a session stem (`src/engine/LlamaService.ts:3357–3373,3406,3661–3672,3703`). `KALSA_PAIRING_DIAGNOSTIC`: gated record shape is not a stable upload schema (`src/screens/PairingScreen.tsx:293–298`). `KALSA_IROH_ABORTED`, `KALSA_IROH_ASYNC_CONTEXT`, `KALSA_IROH_CLOSED`, `KALSA_IROH_CONFIG`, `KALSA_IROH_DEADLINE`, `KALSA_IROH_ENTROPY`, `KALSA_IROH_INVALID_NODE_HEX`, `KALSA_IROH_IO`, `KALSA_IROH_KEY_CORRUPT`, `KALSA_IROH_LINKAGE`, `KALSA_IROH_NO_MODULE`, `KALSA_IROH_OTHER`, `KALSA_IROH_TRANSPORT`: error-code names, not records; only normalized `KALSA_ROAD` can represent an outcome (`src/remote/road.ts:34–48,85–92`). |
| Exclude | `KALSA_ANSWER_TRUNCATED` (`src/engine/turnTelemetry.ts:245–255`), `KALSA_BENCH_PROBS` and `KALSA_BENCH_TOKENS` (`src/engine/LlamaService.ts:4474–4482,5277,5716`), `KALSA_BENCH_ROUTE` (`src/engine/benchRoute.ts:58–63`): benchmark-only values/identifiers are unnecessary in a tester report. |
| Exclude | `KALSA_CTX_FLOOR` (`src/engine/LlamaService.ts:2345–2347`), `KALSA_DEPENDENCIES` (`src/context/windowProfile.ts:298`), `KALSA_DIGEST` (`src/engine/digestTelemetry.ts:33`), `KALSA_DOC_STRATEGY` (`src/documents/documentChatStrategy.ts:88–96`), `KALSA_EAGER` and `KALSA_EAGER_SKIP` (`src/host/eagerKickDelay.ts:48–88`), `KALSA_FOREGROUND_IDLE_PROTOCOL` (`src/app/foregroundIdleProvenance.ts:3`), `KALSA_LOAD` (`src/host/engineLoad.ts:159–170`): omit broad engine/model/document context; `KALSA_DEPENDENCIES` and `KALSA_FOREGROUND_IDLE_PROTOCOL` are identifiers rather than emitted diagnostic records. |
| Exclude | `KALSA_GOVERNOR`, `KALSA_GOVERNOR_FAILED`, `KALSA_GOVERNOR_FALLBACK`, `KALSA_GOVERNOR_FALLBACK_RETRY`, `KALSA_GOVERNOR_PLAN`, `KALSA_GOVERNOR_RUNTIME_FALLBACK`, `KALSA_GOVERNOR_THERMO` (`src/engine/LlamaService.ts:1722–1732,1777,1821–1828,2436–2459,2875`): broad experimental/runtime state; only the narrow pause/cooling builders above are allow-listed. |
| Exclude | `KALSA_GPU_FALLBACK` (`src/engine/LlamaService.ts:2716–2725`), `KALSA_HF_ORG` (`src/engine/modelHost.ts:5`), `KALSA_IDLE_STALL` (`src/host/foregroundIdle.ts:249–263`), `KALSA_KVDIAG` (`src/engine/LlamaService.ts:3679–3685`), `KALSA_KVPREFIX` (`src/engine/LlamaService.ts:1087`), `KALSA_KVSHIFT` (`src/engine/turnTelemetry.ts:14`), `KALSA_NATIVE_VARIANT` (`src/engine/LlamaService.ts:2664–2675`): unnecessary engine/device/cache details; `KALSA_HF_ORG` is configuration, not a log line. |
| Exclude | `KALSA_MEMORY`, `KALSA_MEMORY_EXTRACT` (`src/memory/memoryTelemetry.ts:61–69`, emitted from `src/host/engineTurnMemory.ts:84–103`): omit memory activity/configuration counts from this support log. `KALSA_PREFIX`, `KALSA_PREFIX_FALLBACK`, `KALSA_PREFIX_MEASURED` (`src/engine/LlamaService.ts:1015–1020,1265–1271,1405–1408,4581–4588`): prompt/cache behavior and broad engine state. `KALSA_PREWARM` (`src/engine/LlamaService.ts:857`, `src/host/useHostEngine.ts:142`): model/init state. |
| Exclude | `KALSA_STALL` (`src/engine/LlamaService.ts:4338–4348,4391–4401`), `KALSA_TELEMETRY` (`src/engine/turnTelemetry.ts:220–235`), `KALSA_THINKING` (`src/engine/LlamaService.ts:4448–4458`), `KALSA_TOOLCALL` and `KALSA_TOOLROUND_EXHAUSTED` (`src/engine/toolCallTelemetry.ts:62–114`), `KALSA_TOOL_CEILING` (`src/engine/LlamaService.ts:5021–5032`), `KALSA_WINDOW` (`src/host/engineTurnStream.ts:129–152`), `KALSA_WINDOW_SLIDE` (`src/host/engineTurnSlide.ts:223–241`): broad turn/tool/window data; model-derived tool names or identifiers are not needed. |

Every other `console.log/warn/error/info` call is excluded by default. In particular, do not capture general error objects or message arguments such as `src/engine/ModelDownloader.ts:133–147`, `src/engine/contextSizePref.ts:66`, `src/host/useHistoryHost.ts:89–95`, or the raw failure tail at `src/engine/nativeLogTail.ts:95–105`. Existing `redactForLog` is defense-in-depth for selected network text, not a safe collector boundary (`src/engine/remote/redactForLog.ts:1–21,43–52`).

## 2. Capture, storage, and native aborts

Add an early-installed JS collector at the app console/logger boundary. It observes calls only to recognize an exact allow-listed tag and schema; it never forwards arbitrary console arguments to storage. Wrap the global JS error handler without replacing its normal handler. Native callback text is rejected, including every `KALSA_NATIVE` line.

Persist only complete normalized lines through a tiny native-backed append API. The native writer keeps a bounded 4 MiB rolling file (newest records, line-boundary rotation); an in-memory ring of the same accepted records is a fast snapshot only. A synchronous append/flush is required before the collector returns so the latest completed safe line survives a native abort. Native fatal handling may append only `file:line:column`; it must never copy the abort message. If native abort prevents JS from running, the already-flushed safe tail remains available at next launch. The sender reads only this report file, never logcat or the llama tail.

Current facts: the app has no log file in this source (`src/engine/nativeLogTail.ts:23–27` is process-memory arrays capped at 50 lines; `:53–73` mirrors to console). Existing console output goes to logcat on device. There is no app-level crash marker in the inspected `src`; current AppState tracking in telemetry is only foreground/background state (`src/telemetry/telemetry.ts:156–173`).

## 3. Unclean-exit detection

Use a small native durable session marker, set before JS startup and cleared only by an orderly explicit app-exit path. Do not clear on ordinary backgrounding: a process killed while backgrounded should be detectable. On next cold launch, atomically consume the previous marker, show the approved ask once, then arm the new session marker. “Not now” dismisses only this prompt for the current run. Do not send on detection.

- **Android:** query `ApplicationExitInfo` on API 30+ for the OS-recorded process-exit reason; retain the marker fallback on older supported Android. Use an atomic marker write and do not treat Activity recreation as process exit. (`getHistoricalProcessExitReasons` is available from API 30: [Android ActivityManager reference](https://developer.android.com/reference/android/app/ActivityManager#getHistoricalProcessExitReasons(java.lang.String,int,int)).)
- **iOS:** use a native session marker plus available termination/crash hooks. UIKit says `applicationWillTerminate` is generally not called when a background-capable app is quit because it moves to the background, though it can be called when the system terminates an app that is running in the background but not suspended; do not treat it as a complete detector. ([Apple UIApplicationDelegate reference](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/applicationwillterminate(_:)).) No such detector exists in current app `src` (see telemetry AppState-only observation above).

The phone cannot show a prompt after a native abort has already killed the process; show it at the next launch. The native crash handler and the next-launch marker must report location only, never the crash message.

## 4. Send path and UI result mapping

Create a one-shot `sendLog()` sender, invoked only by the explicit button. Build the body from the safe file, UTF-8 encode, trim to the newest 4 MiB at a line boundary, and reject an empty body locally. Construct `X-Kalsa-App` from validated `<version>/<os>/<arch>`; use the app version source already used by telemetry (`src/telemetry/telemetry.ts:184–198`), `Platform.OS`, and a native ABI/architecture value. Validate against the Worker regex before networking. `expo-device` is present in dependencies, but no existing source API for CPU ABI was found; do not infer ABI from the phone model.

POST `https://kalsa.io/report`, headers `Content-Type: text/plain; charset=utf-8`, `X-Kalsa-App: ...`, body raw log text, with an abort timeout. Read status and JSON defensively; accept only 201 plus string `id`. The existing telemetry sender shows the app’s fetch/AbortController/status-handling style (`src/telemetry/telemetry.ts:1033–1039,1074–1085,1114–1158`), but its automatic queue, retry, and JSON report body are not reused. No queue, background send, or retry: a failed press produces UI copy and the tester may press again.

| Worker outcome | UI mapping |
|---|---|
| 201 `{"id":"…"}` | Show the report number; keep Send disabled for that view. |
| 429 `rate_limited` | “Wait a minute and try again.” |
| 503 `daily_limit` | “We received too many reports today. Try again tomorrow.” |
| 503 `storage_conflict`, 413, 415, 400, other HTTP, malformed response, timeout/network | Generic “Could not send. Check the internet connection and try again.” Never show raw server body. |

The Worker enforces text/plain and the header shape (`workers/report/index.ts:17–21,132–160`), body limit (`:65–93`), and response IDs/errors (`:37–43,115–118,149–160`).

## 5. UI placement and five-language copy

Place a “Send the log” panel in Settings → Diagnostics, replacing or sitting beside the current “Report a problem” preview flow (`src/screens/SettingsScreen.tsx:2896–2919`; that flow currently previews/copies telemetry and opens GitHub at `:425–465`). Match the desktop’s report panel: privacy sentence large and bold above primary button; show “Sending…” while pending; show the report number after 201. The desktop implements the shared block and disabled-success state in `chat/src/components/ReportProblem.tsx:20–61` and places the section in Advanced at `:64–91` (desktop repo `kalsa-brain`, commit `06efb49d`).

At next launch after the unclean-exit marker, show a single crash prompt with **Send** and **Not now**, the same large bold privacy sentence, and no automatic send. Desktop’s prompt strings and one-session dismissal behavior are in `chat/src/components/CrashDialog.tsx:6–29` and `chat/src/surfaces/useCrashAsk.ts:16–54` at `06efb49d`. Reuse the approved desktop report keys/wording below. The phone catalog currently supports only `en` and `it` (`src/i18n/index.ts:12–22,52–55`, `src/i18n/types.ts:3`); add `es`, `fr`, and `zh` catalogs as part of the design implementation plan, with all report keys present. The desktop has separate report tables in `chat/src/i18n/en/report.ts:5–22` and `chat/src/i18n/{it,es,fr,zh}/report.ts:3–20` at `06efb49d`.

| Key | EN | IT | ES | FR | ZH |
|---|---|---|---|---|---|
| `privacy` | The log never contains your messages, Kalsa's answers, your files, or any code or key. | Il log non contiene mai i tuoi messaggi, le risposte di Kalsa, i tuoi file, né codici o chiavi. | El registro nunca contiene tus mensajes, las respuestas de Kalsa, tus archivos, ni ningún código o clave. | Le journal ne contient jamais vos messages, les réponses de Kalsa, vos fichiers, ni aucun code ou clé. | 日志永远不会包含你的消息、Kalsa 的回答、你的文件，也不会包含任何代码或密钥。 |
| `send` | Send the log | Invia il log | Enviar el registro | Envoyer le journal | 发送日志 |
| `sending` | Sending… | Invio… | Enviando… | Envoi… | 正在发送… |
| `sentWithId(id)` | Sent. Your report number is {id} — tell us this number. | Inviato. Il numero della tua segnalazione è {id}: dicci questo numero. | Enviado. Tu número de informe es {id}: dinos este número. | Envoyé. Votre numéro de rapport est {id} : communiquez-nous ce numéro. | 已发送。你的报告编号是 {id}——请告诉我们这个编号。 |
| `errRateLimited` | Wait a minute and try again. | Aspetta un minuto e riprova. | Espera un minuto e inténtalo de nuevo. | Attendez une minute et réessayez. | 请等一分钟再试。 |
| `errTryTomorrow` | We received too many reports today. Try again tomorrow. | Oggi abbiamo ricevuto troppe segnalazioni. Riprova domani. | Hoy hemos recibido demasiados informes. Inténtalo de nuevo mañana. | Nous avons reçu trop de rapports aujourd'hui. Réessayez demain. | 我们今天收到的报告太多了。请明天再试。 |
| `errSend` | Could not send. Check the internet connection and try again. | Impossibile inviare. Controlla la connessione e riprova. | No se pudo enviar. Comprueba la conexión a internet e inténtalo de nuevo. | Impossible d'envoyer. Vérifiez la connexion internet et réessayez. | 无法发送。请检查网络连接后重试。 |
| `crashUncleanTitle` | Kalsa did not close normally last time | Kalsa non si è chiusa normalmente l'ultima volta | Kalsa no se cerró correctamente la última vez | Kalsa ne s'est pas fermée normalement la dernière fois | Kalsa 上次没有正常关闭 |
| `crashUncleanBody` | If something went wrong, sending the log helps us fix it. | Se qualcosa è andato storto, inviare il log ci aiuta a correggerlo. | Si algo fue mal, enviar el registro nos ayuda a arreglarlo. | Si quelque chose s'est mal passé, envoyer le journal nous aide à le corriger. | 如果出了问题，发送日志能帮我们修复它。 |
| `notNow` | Not now | Non ora | Ahora no | Pas maintenant | 暂不发送 |

These values are the desktop’s approved strings in `chat/src/i18n/{en,it,es,fr,zh}/report.ts` (`06efb49d`); the privacy sentence is exact across platforms. `crashTitle` (“Something went wrong”) is only needed if the owner later chooses to prompt for in-app engine/JS failures too.

## 6. File plan

Keep each file to one job and roughly under 250 lines. Names are proposals; no implementation is included here.

| File | One responsibility | Focused test plan |
|---|---|---|
| `src/logReport/schema.ts` | Parse known tags, project exact fields, reject unknown fields/tags, redact URLs/paths/identifiers, drop denylisted lines, clip to 300 chars, trim UTF-8 body to 4 MiB. | Table tests for every tag; hostile strings in values; URL query/fragment; exact byte cap and line boundary; denylist variants. |
| `src/logReport/collector.ts` | Install early console observer and JS global-error hook; persist only normalized lines; preserve existing handlers. | Unsafe console args never appear; safe examples do; JS error message and later frames never appear; handler still runs. |
| `modules/log-report/{ios,android}` native module | Bounded synchronous append/read and durable session marker; platform crash location only. | Reopen after process recreation; cap/rotation; atomic marker lifecycle; crash line has location only; no logcat read. |
| `src/logReport/sendLog.ts` | Build `X-Kalsa-App`, POST one text body, parse stable result/error codes; no queue or retries. | Header grammar, explicit one-call behavior, timeout/network, each Worker status/body mapping, malformed 201/JSON. |
| `src/logReport/useUncleanExit.ts` | Consume native prior-session result once and provide ask/dismiss state. | Clean exit no ask; unclean exit asks once; dismiss suppresses during run; native query failure asks nothing. |
| `src/components/SendLogPanel.tsx` | Reusable press/send/result state for Settings and crash prompt. | Press-only send; disabled while sending/after success; ID displayed; refusal copy selected by stable code. |
| `src/i18n/{en,it,es,fr,zh}.ts` | Add complete typed report strings and locale entries. | Key parity and interpolation test for `{id}` across all five. |
| `src/screens/SettingsScreen.tsx` | Place report panel in Diagnostics. | Render/click wiring and existing settings accessibility labels. |

The native module needs the Expo config-plugin/prebuild wiring only if the current build does not autolink the local module; keep that wiring separate from collector and transport logic. Portable TypeScript: schema/normalizer, byte trimming, header validation, fetch/error mapping, send state, and translation tables. Rust-only/desktop-specific: `ureq` agent setup, log-directory file reads under the logger mutex, Tauri `invoke` commands, desktop file rotation/session logger, and desktop process-state polling (`kalsa-brain/src-tauri/src/report.rs:105–181,217–240`; `chat/src/lib/report.ts:5–13`; `chat/src/surfaces/useCrashAsk.ts:16–49`, commit `06efb49d`). The report copy and UI state model are portable; native marker/crash hooks must be implemented separately for Kotlin/Android and Swift/iOS.

## 7. Owner-only questions

1. Should iOS OS memory-pressure termination while the app is backgrounded count as “did not close normally” and prompt next launch, matching the desktop’s forced-shutdown semantics, even though iOS may not provide a reliable termination callback?
2. For `X-Kalsa-App` arch, should the header identify the running process ABI or the device’s primary supported ABI on Android, and which single value should iOS report (`arm64`)? The app currently has no architecture helper.
3. Should unclean-exit prompting cover only a prior process exit, as requested, or also a caught in-app engine/JS failure (desktop has a separate engine-death ask)?

## Orchestrator decisions (1d714246, 2026-10-02) - these override the sections above where they differ

1. **Contents: too thin as proposed.** The mechanism stays (per-tag schema, construct fields one by one, unknown tags
   and fields fail closed, `KALSA_NATIVE` and `KALSA_SESSION` excluded). But a log with only pairing/road/pause/cooling
   lines cannot diagnose the failures testers will hit (e.g. today's NPU-lane hang needed `KALSA_GOVERNOR_PLAN`,
   `KALSA_PREWARM`, `KALSA_STALL`, `KALSA_WINDOW`). The privacy boundary is the owner's sentence: no messages, no
   answers, no files, no code or key. Numbers, booleans, code-defined enum literals and catalog model ids are inside
   it. So: every engine/governor/load/stall/thermal/telemetry tag is INCLUDED with a schema that keeps only those
   value kinds; any free-form string field is dropped (or kept only if it matches a closed literal set read from the
   emitting code). Still excluded: `KALSA_NATIVE`, `KALSA_SESSION`, `KALSA_BENCH_*`, any field holding ids derived
   from a conversation, tool arguments, file names, URLs with paths.
2. **No new native module for storage.** Collector = JS ring buffer + append to an app-private file through
   expo-file-system (already a dependency), flushed per line, rotated at 4 MiB. Losing the last few lines on a native
   abort is acceptable; the crash location comes from the OS on the next launch.
3. **Unclean exit, Android:** `ApplicationExitInfo` (API 30+) exposed through the existing local module
   `kalsa-lifecycle` as a reason enum + timestamp (+ native crash location only if the OS gives one without the
   message). Below API 30, a JS session marker file. iOS: JS marker only (no iOS ship target yet).
4. **Owner questions answered by default:** (1) iOS background termination - deferred, no iOS ship target;
   (2) arch = the shipped ABI (`arm64` for arm64-v8a, `arm64` on iOS); (3) prompt only after a prior process exit,
   as requested; engine-death prompt not in scope.
5. **Languages:** the phone app has only `en` and `it` catalogs; the report strings land in those two, using the
   desktop's approved wording above. The other three come with the app-wide translation, not with this feature.
6. **Steps:** (1) schema + collector + tests; (2) sender + Settings panel + strings; (3) unclean-exit prompt. Each:
   implement -> verify on disk -> one hostile audit (privacy first) -> fix.
