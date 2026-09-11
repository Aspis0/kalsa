# S23 conversation-switch during extract — APK `8be587c` — 2026-09-11

**Verdict: PASS.** Drawer tap of `drawer-conversation-conv-g1-i12-1789042175` landed (`activeId` changed) and in-flight extract aborted (`stopReason:"aborted_by_send"`, native `interrupted:true`).

S23 only `192.168.1.152:5555`. Installed SHA-256 `52970eba0d5e7d587ddc048878425f97af69ecd0708be09716886cf8f6b5fb6e` **hash_match=true**. Xiaomi/Jelly not used. No APK, no uninstall. Not committed. Do not claim G2.

1807aad was HARNESS_MISS (Menu/swipe never changed `activeId`). This APK has `testID=drawer-conversation-{id}` (`3431db4`). Idle drawer dump: `resource-id=drawer-conversation-conv-g1-i12-1789042175` bounds `[94,1088][986,1268]` center `540,1178`. Race: Menu `96,285` → 1.2s → tap `540,1178`. No uiautomator dump in the race window.

---

## Switch proof (sqlite after force-stop)

| | |
|---|---|
| before | `conv-g1-i14-1789042691` |
| after | `conv-g1-i12-1789042175` |
| target | `drawer-conversation-conv-g1-i12-1789042175` |

## Quoted lines (pid 15335)

Turn-end (extract fields `-1`):

```text
09-11 07:05:51.380 I ReactNativeJS: KALSA_MEMORY {"memoryEnabled":1,"factsExtracted":-1,...,"extractStopReason":-1,...}
```

Switch utc=`2026-09-11T11:05:51Z`.

Native extract started then interrupted:

```text
09-11 07:06:03.645 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"util-extractMemory-4",...,"tokensPredicted":0,"promptMs":11579.47,"interrupted":true,"prompt_n":267}
09-11 07:06:03.698 I ReactNativeJS: KALSA_MEMORY_EXTRACT {...,"extractGateSource":1,"extractStopReason":0,"durationMs":11674,"stopReason":"aborted_by_send"}
```

`extractGateSource:1` = afterSessionSave. `extractStopReason:0` = in-flight abort. Facts not stored (`factsExtracted:0`).

Evidence: sibling `S23-SWITCH-EXTRACT-8be587c-2026-09-11/` (`ui-drawer.xml`, `before-activeId.txt`, `after-activeId.txt`, `verdict-detail.json`).
