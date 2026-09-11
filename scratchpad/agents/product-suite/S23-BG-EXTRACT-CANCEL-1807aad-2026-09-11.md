# S23 background-discard extract abort — `1807aad` / f99fe45 — 2026-09-11

**Verdict: PASS.** HOME while memory extract was in flight aborted it. `stopReason:"aborted_by_send"` and native extract had started (`util-extractMemory-2` `interrupted:true`, `extractGateSource:1`, `durationMs:23123`). Not `done`. Not VOID.

S23 only `192.168.1.152:5555` (SM-S911U). Jelly/Xiaomi not used. Installed SHA-256 `9c03c710655e607ac2181063c589a507c1084de8adbe16a4fd4e2a50c6213693` matched; no reinstall. `kalsa.memory.enabled=1`, LFM. No uninstall/clear-data/file deletes. No commit.

This is not the Nuova-chat path (already PASS). This shot is **KEYCODE_HOME** / background discard.

---

## Sequence

1. Keep-awake + `svc power stayon true`. Force-stop hung pid, start app. Session restore `ok:true` tokens 1867; `KALSA_PREWARM skip kv_holds_chat` at `21:08:46.956` (resident LFM, not a cold 40s prefill).
2. Share `Dimmi una frase breve sul sale, in italiano.` via `device_share_intent`; collapse shade; tap chat to keep AppState active. Invia `963,2115`. Real `KALSA_SEND` (not prev==count false submit).
3. Turn-end `KALSA_MEMORY {` at `21:09:45.480` (extract fields `-1`). No dump in the race.
4. HOME immediately `utc=2026-09-11T01:09:46Z`.
5. EXTRACT 23s later. Then `am start`, then `am force-stop`. Stayon/timeout restored.

Attempt 1 stalled (`KALSA_STALL` → `extractStopReason:4`, no turn-end MEMORY) — not this verdict (`attempt1-stall/`).

---

## Quoted lines (pid 20315)

Send:

```text
09-10 21:08:58.585 I ReactNativeJS: KALSA_SEND {"empty":false,...,"historyLoaded":true,"jsReady":true,"activeModel":"lfm2.5-2.6b"}
09-10 21:08:58.591 I ReactNativeJS: KALSA_SEND {"phase":"fit","liveness":"alive","alreadyResident":true,"allow":true,"availableMb":2329}
```

Turn-end (extract not settled):

```text
09-10 21:09:45.480 I ReactNativeJS: KALSA_MEMORY {"memoryEnabled":1,"factsExtracted":-1,"factsStored":-1,"factsRejectedFull":-1,"factsInjected":0,"totalFactsInStore":-1,"dnaDeferred":0,"dnaInjected":0,"dnaBudgetTokens":1200,"extractParseOutcome":-1,"extractGateSource":-1,"extractStopReason":-1,"ciswireFlags":3}
```

HOME: `utc=2026-09-11T01:09:46Z epoch=1789088986.029`

Native extract started then interrupted:

```text
09-10 21:10:08.606 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"util-extractMemory-2","round":0,"tokensCached":226,"tokensEvaluated":229,"tokensPredicted":0,"promptMs":23036.568,"predictedMs":0,"interrupted":true}
09-10 21:10:08.675 I ReactNativeJS: KALSA_MEMORY_EXTRACT {"memoryEnabled":1,"factsExtracted":0,"factsStored":0,"factsRejectedFull":0,"extractParseOutcome":0,"extractGateSource":1,"extractStopReason":0,"durationMs":23123,"timeoutMs":20000,"stopReason":"aborted_by_send"}
```

`extractGateSource:1` = afterSessionSave. `extractStopReason:0` = in-flight abort. `awaitLifecycleForBackgroundDiscard` aborts `abortRef`; f99fe45 forwards that onto `extractMemory`.

---

Evidence: sibling `S23-BG-EXTRACT-CANCEL-1807aad-2026-09-11/` (`quoted-lines.txt`, `kalsa-memory.txt`, `home.txt`, `kalsa-extract.txt`, `kalsa-native-extract.txt`, `verdict-detail.json`). Logcats are 7 KB, not multi-MB. Not committed.
