# QDC V81 GPU-prefill fallback — app main df359450 (engine f1f612388, binding 2581a9aa), SM8850 (2026-10-11)

## Verdict

**The NOLANE arm passes on device: with the NPU lane forced off, the shipped governor runs prefill on the GPU (6 chunks, GPUOpenCL), decode on the CPU, no fallback, no crash, on-topic answers.** The ON arm still routes prefill to the NPU. Two NOLANE turns agree (295.0 / 294.8 tok/s). Answer equality is only checked on topic and completeness; no logit oracle was run in this cell.

| turn | arm | prefill tok/s (595 tok) | decode tok/s | route (engine_prefill / engine_decode) | fallback / failed | crash | answer | source |
|---|---|---:|---:|---|---|---|---|---|
| nolane-1 | NOLANE | **294.8** | 30.16 | GPU / CPU | 0 / false | 0 | on topic, 3 sentences | raw/sm8850/nolane-1-kalsa.txt, nolane-1-answer.txt |
| on-1 | ON | **1342.0** | 30.37 | NPU / CPU | 0 / false | 0 | on topic, 3 sentences | raw/sm8850/on-1-kalsa.txt, on-1-answer.txt |
| nolane-2 | NOLANE | **295.0** | 30.35 | GPU / CPU | 0 / false | 0 | on topic, 3 sentences | raw/sm8850/nolane-2-kalsa.txt, nolane-2-answer.txt |
| off-1 | OFF (CPU) | **224.0** | 30.03 | CPU (inferred, no route record) | — | 0 | on topic, 3 sentences | raw/sm8850/off-1-kalsa.txt, off-1-answer.txt |

Prefill tok/s = `tokensEvaluated / (promptMs / 1000)` = 595 / (promptMs / 1000), from the round-0 `KALSA_TELEMETRY` line. Decode = `predictedPerSecond`.

Morning comparison (cell `qdc-oracle-onoff-41dc728f`, app 41dc728f, SM8850): NPU 1332.7 / 1341.5 (mean 1337.1), CPU 216.8 / 215.2 (mean 216.0), GPU-oracle 303 tok/s (595 tok / 1.962 s, probs on, different harness). Today: NPU 1342.0, CPU 224.0, GPU fallback 294.8 / 295.0. The GPU fallback is about 1.32× the CPU prefill and about 22% of the NPU prefill. Decode is CPU in all arms (30.0–30.4 tok/s), as expected.

## Pass criteria (raw lines quoted)

NOLANE (nolane-1 and nolane-2, checked the same way):
- `KALSA_GOVERNOR_PLAN` has `"npu_lane":"off"` (nolane-1-kalsa.txt, 15:59:22.088; nolane-2 identical).
- No `KALSA_GOVERNOR_FALLBACK` line and no `gpu-prefill-incorrect-V81` reason: count 0 across all turns (`grep -c` over `*-kalsa.txt` = 0).
- `KALSA_GOVERNOR {... "engine_prefill":"GPU","engine_decode":"CPU", ... "failed":false, ... "fallback_reason":""` (nolane-1-kalsa.txt, 16:00:47.111).
- `route_chunks`: 6 chunks, each `"actual":"gpu","forced":false,"layers_device":"GPUOpenCL"` (tokens 128+128+128+126+82+3).
- Round-0 telemetry: `"tokensEvaluated":595,"promptMs":2018.378,"predictedPerSecond":30.164669…,"prompt_n":595` (nolane-1). nolane-2: `"promptMs":2016.675,"predictedPerSecond":30.348963…`.
- Answer on topic and complete (nolane-1-answer.txt; the two NOLANE answers are identical word for word).
- Crash markers: `nolane-*-crash.txt`, `off-1-crash.txt`, `on-1-crash.txt` all 0 bytes (grep for CDSP CRASHED, dspqueue, INTERNAL-ERROR, ggml_abort, GGML_ASSERT, Aborted, Segmentation, FATAL, SIGSEGV).
- `ggml_opencl: platform IDs not available`: 0 hits in `*-kalsa.txt` and `*-hexlog.txt`.
- lowmemorykiller on kalsa: 0. The 10 `am_kill` lines for `com.kalsa.app` are `stop com.kalsa.app due to from pid …`, our own `am force-stop` before each turn (reason USER REQUESTED), not LMK.

ON (on-1):
- `KALSA_GOVERNOR_PLAN` `"npu_lane":"auto","npu_device":"HTP0"`; `KALSA_GOVERNOR` `"engine_prefill":"NPU","engine_decode":"CPU"` (on-1-kalsa.txt, 16:03:35.439). Telemetry `promptMs":443.366`, `predictedPerSecond":30.367…`.

OFF (off-1): no governor record (expected: `kalsa.governor.enabled=0`); CPU inferred. Telemetry `"promptMs":2656.344,"predictedPerSecond":30.027…`.

## Setup and device

- APK `/tmp/kalsa-apk-df359450/…/app-release.apk`, sha256 `b10a79605a08e87d99fd8f6139b29c7c66c1afc29a04bd0f24135e553a3d4a7c` (checked on the Mac before install; setup.sh also checked). Install `Success` (raw/sm8850/install.txt); `pkg.txt`: versionName 0.1.0, DEBUGGABLE.
- Model `LFM2.5-2.6B-QAD-Q4_0.gguf`, device sha `a247afd6…0b03` OK, app-dir size 1593894944 (`setup` log).
- SM8850 `serial=4816891`, `ro.product.device=canoe`, Android 16, 8 cores (cpu6/cpu7 4608000 kHz).
- Skin: live `mName=skin` entry is **#2** (`raw/sm8850/skin-index.txt`). Entry #1 frozen (`skin-samples.txt`).
- Battery: faked unplugged at 30.0 C (`battery-faked.txt`: `temperature: 300`, `AC powered: false`). Restored with `dumpsys battery reset`; read back (`battery-restored.txt`): `temperature: 420`, AC false (the QDC stub value seen in recon, `recon.txt`).

## Turns and skin

| turn | start skin (C) | peak skin (C) | watchdog KILL | cooldown |
|---|---:|---:|---|---|
| nolane-1 | 28.2 | 38.5 | none | cool_wait 1 s (`nolane-1-cool.txt`) |
| on-1 | 33.0 | 39.6 | none | — |
| nolane-2 | 34.5 | 41.4 | none | — |
| off-1 | 36.1 | 42.3 | none | — |

Hard stop 48.0 C was never reached. Source: `raw/sm8850/all-rows.tsv` (`skin_start`, `skin_peak` columns), `*-watchdog.txt`.

## Minutes

| board | session | submitted | started → ended (portal) | used | cap | card before → after |
|---|---|---|---|---|---|---|
| SM8850 | 889904 `v81-fallback-df35` | 6:52:09 PM | 6:53:23 PM → 7:10:53 PM | ≈17.5 min | 60 | 799 → 739 (−60 = cap, provisional hold; the portal shows "Total Minutes Used 0" at end, re-read later) |

Timeline: setup 18:54:23 → 18:57:55; nolane-1 18:58:46 → ~19:01:28 (rc 0); on-1 → ~19:04:19 (rc 0); nolane-2 and off-1 → campaign done ~19:10:00 (rc 0 each); End Session confirmed 19:10:53 (state Completed). Tunnel closed by PID 6300 at about 19:12, port 6037 free.

## Changes made to the cell

1. `turn.sh:45` added: `NOT AWAKE AT SEND` check (`mWakefulness=Awake`) right after the foreground check, before each Send, as the brief asked. `bash -n` exit 0.
2. `turn.sh:88` crash grep: `FATAL EXCEPTION` widened to `FATAL` (the brief lists FATAL as a marker).
3. `extract.sh`: `failed` used `.failed // "NA"`, which turns `false` into NA. Changed to `(.failed | tostring)`; `bash -n` exit 0; regenerated `raw/sm8850/all-rows.tsv` (`failed` now `false` on the GPU/NPU turns).
4. `extract.sh` still sources env.sh with the tunnel closed, and env.sh's `STOP` echo goes to stdout. It leaked into line 1 of the regenerated `all-rows.tsv`; I removed that line by hand (header now line 1, 4 data rows). The script itself is not fixed.
5. UI dumps (`*-ui*.txt`, ~17 KB each, 16 files) removed from `raw/sm8850/`; the answer text is kept in `*-answer.txt`.
6. `campaign.sh`, `arm.sh`, `kmulti.sh`, `setup.sh`, `env.sh`, `skin-id.sh`, `wipe-chats.sh`, `oparse.sh` unchanged. The turn order was the planned one: nolane-1, on-1, nolane-2, off-1.

## Not covered / odd

- No logit oracle here; "answer correctly" is checked only as on topic, complete, three sentences. The two NOLANE answers are identical; the ON answer differs in wording (different numerics), which is expected but not measured.
- **KV config differs between arms.** NOLANE `"cache_type_k":"q8_0","cache_type_v":"q4_0"` (nolane-1, nolane-2); ON `"cache_type_v":"q8_0"` (on-1). The GPU fallback keeps V at q4_0. This is part of the route difference, not isolated.
- `tokensCached` in telemetry is 1090 / 1103, larger than `tokensEvaluated` 595. Not explained here; prefill is computed from `tokensEvaluated`/`promptMs` as the brief says.
- OFF arm has no governor record; "CPU" is inferred from `kalsa.governor.enabled=0`.
- `*-lmk.txt` also contain system-service `am_kill` lines dated before the turn (device-clock times ~15:40–15:47, and the logcat clock is about 7 h behind the exit-info clock). None names kalsa as lowmemorykiller. Not investigated further.
- Device Configuration in the wizard showed "Android 17"; the created session and the device report Android 16. Recorded as Android 16.
- The SSH public key `kalsa-mac` was picked from the portal's saved list. The tunnel authenticated with `~/.ssh/qdc_ed25519`, so it matched.
- Screen: keep-awake loop from turn.sh; the new wakefulness check passed on all four turns (no `NOT AWAKE AT SEND`).
- Billed minutes are provisional (card 739 after the hold).
- The earlier attempt (NOT RUN) is superseded by this run.
