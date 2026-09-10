# Jelly lifecycle verification — e89bd2a / CI 34483949398

- Timestamp markers: gate 2026-09-10T14:32:37Z; long HOME 2026-09-10T14:34:18Z; brief 2026-09-10T14:37:36Z; stop attempt 2026-09-10T14:42:19Z.
- Phone: Jelly Star, serial `JELLYS0000053795`; model `lfm2.5-2.6b`; charge 100%; temperature 29.0°C at gate/long, 30.0°C at later state check.
- APK: `/private/tmp/kalsa-ci-34483949398-e89bd2a/kalsa-apk-arm64-v8a-debuggable-e89bd2aafb3fb9caffadf492fb0319dd9ec5a6cf/app-release.apk`; local SHA-256 `a2d08f9df19d179d86d55db1e0407bd4ec77ec9e6d2edb0954083487c27ea5fb`; installed `base.apk` SHA-256 identical. See `apk-provenance.log`.

| Cycle / item | Expected | Observed | Verdict |
|---|---|---|---|
| Startup gate | Native timer, once | `09-10 10:32:33.573 ... 'background.grace', '{"timer":"native"}'` (count 1) | PASS |
| Long background + reopen | save, unload near 45 s, `.kvs` restore, cold fit gate, no full prewarm | `10:34:18.945 ... KALSA_SESSION ... "op":"save"`; `10:35:04.621 ... 'model.unload', '{"reason":"background","graceMs":45000}'`; fit `alreadyResident:false ... "reasonKey":"no_active_model","availableMb":5789`; load `"ok":true,"tokens":3628`; telemetry `promptMs":1489.054,"tokensCached":3697` | PASS |
| Long healthy turn watchdog | no stall | `10:37:04.549 ... "promptMs":1489.054 ... "interrupted":false`; no `KALSA_STALL` in slice | PASS |
| Brief background 15 s | resident, cancel on reopen, no unload | `10:38:26.813 ... 'background.grace', '{"cancelled":true}'`; no unload; turn `promptMs":2140.418,"tokensCached":3761` | PASS* |
| Stop mid-generation | partial kept, interrupted turn, next send works | UI dump returned `ERROR: could not get idle state`; no helper; generation completed `"interrupted":false` | SKIP (harness) |
| Message edit / actions | discover `message-action-edit` only if exposed | Found `message-action-copy`/`Copia` and `message-action-more`/`Altro`; Altro exposed only `Salva nelle note`, `Traduci`, `Annulla`; no edit | SKIP (manual owner) |
| Regenerate | exercise if present | Not present in UI | SKIP |
| e455afc memory extraction | memory enabled; done/facts; timeout measured; abort on new send | Read-only key `kalsa.memory.enabled|0`; observed only `stopReason":"skipped_no_snapshot"`, `durationMs":0`, `timeoutMs":20000`; no enabled extraction or `aborted_by_send` | BLOCKED (setup/UI) |

*Brief verdict is app PASS with a harness limit: the user interruption removed the explicit shell HOME/reopen markers, but the native cancellation and absence of unload were observed. No phone files were deleted; raw slices are in this evidence directory. No trim-memory cycle was added because this was the single scoped verification and setup/memory/stop limits were already reached.
