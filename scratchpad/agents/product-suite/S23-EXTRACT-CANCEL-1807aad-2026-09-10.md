# S23 extract-cancel one-shot — APK `1807aad` / f99fe45 — 2026-09-10

**Verdict: PASS.** `clearChat` / header **Nuova chat** while memory extraction was in flight aborted the extract. `KALSA_MEMORY_EXTRACT.stopReason` is `aborted_by_send` (outer turn-signal forwarded). Extract did **not** complete as `done`. Memory was on (`memoryEnabled:1`) — not VOID.

Device: Galaxy S23 / SM-S911U only, `ANDROID_SERIAL=192.168.1.152:5555`. Jelly `JELLYS0000053795` and Xiaomi `192.168.1.193` were attached or known and were **not** touched. No uninstall, no `clear-data`, no phone file deletes, no Mac APK build, no MiniCPM5, no battery campaign, no full Jest, no commit/push.

Evidence: sibling dir `S23-EXTRACT-CANCEL-1807aad-2026-09-10/`.

---

## Provenance

| Item | Value |
|---|---|
| Fix under test | `f99fe45` `fix(memory): forward chat cancellation to extraction` |
| Installed app commit | `1807aad` `fix(engine): bound model-switch dispose so a hung stop cannot freeze the UI` |
| Ancestry | `f99fe45` **is** an ancestor of `1807aad` (`git merge-base --is-ancestor` rc=0) |
| CI APK | run `34539915778`, SHA-256 `9c03c710655e607ac2181063c589a507c1084de8adbe16a4fd4e2a50c6213693` |
| Installed `base.apk` | same SHA-256 — **hash_match=true**, no `adb install -r` |
| Package | `com.kalsa.app`, `pkgFlags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]`, `firstInstallTime=2026-08-15`, `lastUpdateTime=2026-09-10 20:01:55` |
| Prefs | `kalsa.memory.enabled=1`, `kalsa.model.id=lfm2.5-2.6b`, `kalsa.locale=it` |
| Device clock | UTC−4 (logcat `09-10 20:42:*` = `2026-09-11T00:42:*Z`) |

---

## Sequence (measured)

1. Wake / collapse shade / `am start com.kalsa.app/.MainActivity`. A prior hung prewarm (screen-off, no keep-awake) was unstuck with **`am force-stop`** only — not uninstall/clear-data. Keep-awake `screen_off_timeout=86400000` for the shot; restored on exit (deleted the 24h leak; original saved value was already the ceiling).
2. Cold PID `16661`. `KALSA_PREWARM` start `20:40:51.914` → done `20:41:26.282`, `promptMs=34349.763`, `promptN=1832` (34.3 s).
3. One short Italian turn via `kalsa://share?text=` (`scripts/device-share-send.sh` `device_share_intent`): *Scrivi una frase breve sul pane, in italiano.* Immediately collapsed the shade and tapped the chat surface so RN AppState stayed `active` (otherwise S23 `am start` VIEW trips the 45 s background dispose). Tapped **Invia** at `963,2115`.
4. Waited for turn-end **`KALSA_MEMORY {`** (not `KALSA_MEMORY_EXTRACT`). Tapped header **Nuova chat** at `984,285` (`content-desc="Nuova chat"`, bounds `[930,231][1038,339]`) **immediately** — no UI dump in the race window.
5. Settled extract line 4.3 s later.

Harness note: a first share-send (v1) was a **false submit** (`prev=7 count=7` on empty composer, no `KALSA_SEND`). v2 required `KALSA_SEND` before the race. That first attempt is in `run.log` / `run-prev.log` and is not the verdict.

---

## Quoted log lines (pid 16661)

Turn accepted, engine resident:

```text
09-10 20:41:36.804 I ReactNativeJS: KALSA_SEND {"empty":false,...,"historyLoaded":true,"jsReady":true,...,"activeModel":"lfm2.5-2.6b"}
09-10 20:41:36.811 I ReactNativeJS: KALSA_SEND {"phase":"fit","liveness":"alive","alreadyResident":true,"recoverLost":false,"allow":true,"reasonKey":null,"availableMb":2344}
```

Turn-end (extract not yet settled — fields `-1`):

```text
09-10 20:42:34.731 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":2785,"tokensEvaluated":2726,"tokensPredicted":58,...,"promptMs":52951.913,"predictedMs":4823.148,"predictedPerSecond":12.025341125754384,"interrupted":false,"ciswireFlags":3}
09-10 20:42:34.732 I ReactNativeJS: KALSA_MEMORY {"memoryEnabled":1,"factsExtracted":-1,"factsStored":-1,"factsRejectedFull":-1,"factsInjected":0,"totalFactsInStore":-1,"dnaDeferred":0,"dnaInjected":0,"dnaBudgetTokens":1200,"extractParseOutcome":-1,"extractGateSource":-1,"extractStopReason":-1,"ciswireFlags":3}
```

Nuova chat tap: `utc=2026-09-11T00:42:35Z` `epoch=1789087355.175` `xy=984,285`.

Native extract had **started** and was interrupted (not a gate-only cancel):

```text
09-10 20:42:38.958 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"util-extractMemory-2","round":0,"tokensCached":228,"tokensEvaluated":231,"tokensPredicted":0,...,"promptMs":4110.041,"predictedMs":0,"predictedPerSecond":0,"interrupted":true}
09-10 20:42:39.024 I ReactNativeJS: KALSA_MEMORY_EXTRACT {"memoryEnabled":1,"factsExtracted":0,"factsStored":0,"factsRejectedFull":0,"factsInjected":-1,"totalFactsInStore":0,"dnaDeferred":-1,"dnaInjected":-1,"dnaBudgetTokens":-1,"extractParseOutcome":0,"extractGateSource":1,"extractStopReason":0,"ciswireFlags":3,"durationMs":4222,"timeoutMs":20444.57484577388,"stopReason":"aborted_by_send"}
```

---

## Why this is PASS (f99fe45 contract)

| Check | Observed |
|---|---|
| Memory on | `memoryEnabled:1` on both `KALSA_MEMORY` and `KALSA_MEMORY_EXTRACT` |
| Tap after turn-end, before extract settle | MEMORY `20:42:34.732` → tap `00:42:35Z` → EXTRACT `20:42:39.024` |
| Outer cancel forwarded | `stopReason:"aborted_by_send"` |
| Native completion reached | `extractStopReason:0` (in-flight abort, not pre-native 1); `extractGateSource:1` = `afterSessionSave` (gate opened normally, then abort) |
| Interrupted extract | `util-extractMemory-2` `interrupted:true`, `tokensPredicted:0`, `promptMs≈4110` |
| Aborted facts dropped | `factsExtracted:0` `factsStored:0` |
| FAIL mode not seen | no EXTRACT `stopReason:"done"` after the tap |

`clearChat` aborts `abortRef` (`AiChatPage.tsx`); header Nuova chat is `onNewChat={clearChat}`. `f99fe45` forwards that outer signal through `createExtractAbort` onto `extractMemory`'s own controller, which `stopCompletion()`s if native work already started. That is what the S23 log shows.

---

## Evidence index

Sibling directory `S23-EXTRACT-CANCEL-1807aad-2026-09-10/`:

| File | What |
|---|---|
| `verdict.txt` / `verdict-detail.json` | `PASS aborted_by_send` |
| `run-v2.log` | v2 shot (authoritative) |
| `logcat-excerpt.txt` | PREWARM + SEND + MEMORY + EXTRACT |
| `logcat-kalsa-v2.txt` | shot ReactNativeJS |
| `logcat-load-v2.txt` | cold prewarm |
| `kalsa-memory-line.txt` `kalsa-extract-line.txt` `kalsa-send-line.txt` | single quoted lines |
| `tap-newchat.txt` `nuova-chat-coords.txt` | tap time + bounds |
| `apk-hash.txt` `prefs.txt` `preflight.txt` | hash match, prefs, serial |
| `ui-ready.xml` `ui-composer-1.xml` `ui-during-gen.xml` | dumps **outside** the race |
| `run.log` `oneshot.sh` | failed v1 (false submit / hung prewarm); not the verdict |

No changes in `/Users/marco/Projects/kalsa` from this shot. Not committed.
