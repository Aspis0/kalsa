# Jelly conversation-switch during extract — APK `8be587c` — 2026-09-11

**Verdict: PASS.** Drawer tap of `drawer-conversation-conv-g1-m01-1789025137` landed (`activeId` changed) and in-flight extract aborted (`stopReason:"aborted_by_send"`, native `interrupted:true`).

Jelly only `JELLYS0000053795`. Installed SHA-256 `52970eba0d5e7d587ddc048878425f97af69ecd0708be09716886cf8f6b5fb6e` **hash_match=true**. S23/Xiaomi not used. No new APK, no uninstall, no phone file deletes. Do not claim G2.

Earlier Jelly switch-during-extract was **HARNESS_MISS** (`activeId` never changed). This APK has `testID=drawer-conversation-{id}` (`3431db4`). Idle drawer dump: `resource-id=drawer-conversation-conv-g1-m01-1789025137` bounds `[42,520][438,619]` center `240,569`. Race: Menu `44,171` → 1.5s → tap `240,569`. No uiautomator dump in the race window. Thinking 512.

---

## Switch proof (sqlite after force-stop)

| | |
|---|---|
| before | `conv-g1-t11-1789031213` |
| after | `conv-g1-m01-1789025137` |
| target | `drawer-conversation-conv-g1-m01-1789025137` |

## Quoted lines (pid 28177)

Turn-end (extract fields `-1`):

```text
09-11 08:43:23.221 I ReactNativeJS: KALSA_THINKING {"turnId":"3","budget":512,"decodeTokPerSec":null}
09-11 08:46:44.416 I ReactNativeJS: KALSA_MEMORY {"memoryEnabled":1,"factsExtracted":-1,...,"extractStopReason":-1,...}
```

Switch utc=`2026-09-11T12:46:44Z`.

Native extract started then interrupted:

```text
09-11 08:46:55.547 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"util-extractMemory-4",...,"tokensPredicted":0,"promptMs":10712.139,"interrupted":true,"prompt_n":210}
09-11 08:46:55.629 I ReactNativeJS: KALSA_MEMORY_EXTRACT {...,"extractGateSource":1,"extractStopReason":0,"durationMs":10902,"stopReason":"aborted_by_send"}
```

`extractGateSource:1` = afterSessionSave. `extractStopReason:0` = in-flight abort. Facts not stored (`factsExtracted:0`).

Kalsa force-stopped after the shot.

Evidence: sibling `JELLY-SWITCH-EXTRACT-8be587c-2026-09-11/` (`ui-drawer-2.xml`, `before-activeId.txt`, `after-activeId.txt`, `verdict-detail.json`).
