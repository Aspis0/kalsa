# S23 share-intent verification — 2026-09-09

Device was only Galaxy S23, `192.168.1.152:5555`; no Xiaomi/Jelly access. No
turn was sent and no model generation was requested. Initial battery temperature
was 37.8 C after cooling (the earlier reading was 41.7 C / thermal status 3).

## Six-case matrix

Tokens were unique per case. `am start` was checked with `dumpsys activity` and
logcat (`ActivityTaskManager`, `ReactNativeJS`, and Kalsa native lines). “Direct”
SEND means the requested explicit `-n com.kalsa.app/.MainActivity` invocation;
it bypasses Android resolver matching. The real external-share verdict for every
SEND row is **expected FAIL on the installed APK; fixed in source; needs a CI APK**.

| State | VIEW `kalsa://share?text=` | SEND `text/plain` |
|---|---|---|
| Cold | **FAIL (old APK)** — COLD, 1629 ms; screenshot showed composer placeholder and no `CASE_COLD_VIEW_S23_001`. | **FAIL (old APK)** — explicit SEND was COLD, 1209 ms; awake screenshot showed placeholder and no `CASE_COLD_SEND_S23_005`. Resolver path is also expected to fail. |
| Warm/background | **PASS** — HOT, 118 ms; screenshot showed `CASE_WARM_VIEW_S23_002`. HOME caused `ReactNativeJS: model.unload {reason:"background"}` before VIEW delivery. | **No positive draft evidence** — explicit SEND was HOT, 164 ms and reached `singleTask` MainActivity; UI capture repeatedly hit Signal 36 while the model was restoring. No unload was logged because this run was still loading/not ready. External resolver remains expected FAIL. |
| Foreground | **PASS** — top instance delivery; compressed UI XML contains `CASE_FOREGROUND_VIEW_S23_004B` in the EditText, hint `Fai una domanda…`. | **PASS for direct explicit `-n` only** — top instance delivery; screenshot showed `CASE_FOREGROUND_SEND_S23_006` in the composer. External resolver remains expected FAIL. |

The installed APK’s malformed filters explain why a normal share chooser cannot
match SEND/SEND_MULTIPLE. Direct explicit SEND still reaches MainActivity, which
is why its foreground result must not be confused with resolver success.

## Code-path map and races

* `android/app/src/main/AndroidManifest.xml:24` declares `MainActivity` as
  `singleTask`; VIEW has a correct filter at `:29-34`, while the installed
  generated SEND filters are malformed at `:35-53`.
* Cold launch enters `MainActivity.onCreate`:21-22. Warm/foreground delivery uses
  `onNewIntent`:66-70. `rewriteShareIntent`:72-117 recognizes ACTION_SEND and
  SEND_MULTIPLE at `:75-81`, reads EXTRA_TEXT at `:94-98`/`:119-124`, and rewrites
  it to `kalsa://share?text=...` before React Native sees it.
* `src/app/shareIntent.ts:37-61` validates the kalsa scheme/share host and
  extracts text/file. `src/app/AppShell.tsx:3036-3044` turns text into a nonce-
  tagged prefill; `:5644-5649` passes it to AiChatPage.
* `src/screens/AiChatPage.tsx:1825-1828` merges the prefill into draft state
  (`:896-899`). The old AppShell effect read `getInitialURL()` at
  `src/app/AppShell.tsx:3115-3117` and only then registered the URL event at
  `:3118`; its URL dedup guard is `:3034`, `:3109-3112`.
* Cold VIEW failure plus warm/foreground success confirms an initial-URL bridge
  race, not a missing JS SEND handler. Before the fix this effect read the
  initial URL before subscribing; it now subscribes at `src/app/AppShell.tsx:3115`
  and retries the initial read at `:3119-3133`. This is not in the installed APK,
  so it needs CI APK verification.
* HOME/background invokes AppShell’s lifecycle at `:2808-2910`; the page also
  persists/cancels background work at `src/screens/AiChatPage.tsx:1315-1372`.
  This explains the observed warm VIEW unload/restore boundary.

## Root cause and source fix

Expo’s intent-filter renderer prefixes values (`node_modules/@expo/config-plugins/
build/android/IntentFilters.js:54,77`). The old `app.config.js:36-52` supplied
already-qualified action/category names, producing e.g.
`android.intent.action.android.intent.action.SEND` and
`android.intent.category.android.intent.category.DEFAULT` in the installed
generated manifest. `app.config.js:36-52` now supplies `SEND`, `SEND_MULTIPLE`,
and `DEFAULT`. The generated manifest was deliberately not edited or regenerated
by hand; prebuild/CI must produce the corrected APK. No local build/install was
performed because CI builds are required.

Validation: `npx tsc --noEmit -p . > /tmp/share-tsc.log 2>&1; echo rc=$?` returned
`rc=0`. No `src/documents` or `src/util/pdf*` files were touched. No commit/push.

## S23 UI inspection finding

`uiautomator dump` and `--compressed` intermittently returned rc=164 / `Signal
36` on this One UI device, usually while dozing, changing task state, or the
model was loading. It is not a permanent accessibility disable: a later focused,
idle compressed dump returned rc=0 and its XML proved the foreground VIEW draft.
`settings get secure enabled_accessibility_services` was `null` and
`accessibility_enabled` was `0`; `cmd accessibility help`, `dumpsys accessibility`,
`dumpsys window`, and `dumpsys activity` worked. `dumpsys device_policy` showed no
device owner and screen capture allowed; Secure Folder is installed but no active
Knox restriction was found. Harness fallback: retry dump after focus/idle, then
use `dumpsys window/activity`; `adb exec-out screencap -a -p` also produced a
usable PNG when the normal dump path signalled 36.
