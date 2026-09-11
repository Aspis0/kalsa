# S23 conversation-switch extract abort — `1807aad` / f99fe45 — 2026-09-11

**Verdict: HARNESS_MISS** — not a product FAIL. `activeId` did not change, so `abortRef.abort()` on the conversation-change effect never ran. Extract completed `done` because the switch never happened.

S23 only `192.168.1.152:5555`. Hash `9c03c710655e607ac2181063c589a507c1084de8adbe16a4fd4e2a50c6213693` matched; no reinstall. `memoryEnabled=1`, LFM. No uninstall/clear-data. Force-stop at end. Not committed.

This is not Nuova-chat and not HOME.

---

## What was attempted

Idle drawer dump (before the turn) recorded a unique inactive row:

- Menu `96,351` bounds `[42,297][150,405]`
- Target `Convert 125 minutes into hours and minutes. Repl` `540,1178` bounds `[94,1088][986,1268]` `selected=false`
- Active before: `conv-g1-i14-1789042691`

Two full races with real `KALSA_SEND` and turn-end `KALSA_MEMORY {` (fields `-1`), then a tap in the race window (no dump):

1. Menu tap + 0.4s + target (miele turn) — `activeId` unchanged, EXTRACT `done`
2. Left-edge swipe + 0.7s + target (vino turn) — same. Left-edge swipe is One UI back, not a drawer open.

sqlite after force-stop: `before=after=conv-g1-i14-1789042691`.

---

## Quoted lines (pid 25015, vino attempt)

```text
09-10 21:24:53.397 I ReactNativeJS: KALSA_SEND {"empty":false,...,"activeModel":"lfm2.5-2.6b"}
09-10 21:24:53.403 I ReactNativeJS: KALSA_SEND {"phase":"fit","liveness":"alive","alreadyResident":true,"allow":true,"availableMb":2339}
09-10 21:25:13.835 I ReactNativeJS: KALSA_MEMORY {"memoryEnabled":1,"factsExtracted":-1,...,"extractStopReason":-1,...}
```

Switch utc=`2026-09-11T01:25:14Z` target=`540,1178`.

```text
09-10 21:25:23.814 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"util-extractMemory-2",...,"tokensPredicted":59,"interrupted":false}
09-10 21:25:23.854 I ReactNativeJS: KALSA_MEMORY_EXTRACT {...,"extractGateSource":1,"extractStopReason":0,"durationMs":9924,"stopReason":"done"}
```

Native extract started and **finished** (`interrupted:false`, `factsStored:3`). That is expected if `conversationId` never changed — not a f99fe45 miss.

---

Product FAIL would require EXTRACT `done` **after a proven switch**. That did not happen. The remaining G2 path is untested, not refuted.

Evidence: sibling `S23-SWITCH-EXTRACT-CANCEL-1807aad-2026-09-11/` (`quoted-lines.txt`, `verdict-detail.json`, `ui-drawer.xml`, `attempt4-harness-miss/`). Logcats <10 KB.
