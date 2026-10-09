# S23 G2 in-app long session, APK 1f0e967b (rule v3 default, A1 fix) — 2026-10-09

**Verdict: G2 NOT met.** The 20-turn session stopped at turn 4 on the harness's thermal hard abort: Android thermal status 3 (SEVERE), unplugged, battery at 42.6 C. The governor stayed `FAST` throughout, because the app feeds it the platform status once per completion and the jump to SEVERE happened inside a turn.

## Build and setup

| | |
|---|---|
| APK | CI run `37961298208`, app `1f0e967b` (debuggable, arm64) |
| Pins | kalsa.rn `f0ca4692`, engine `2e723bd9d` |
| Install | `adb install -r`, app data kept |
| Device | S23 (SM-S911U), unplugged, `persist.traced.enable=0` |
| Harness | `scripts/campaign/run-t20c.sh` with `campaigns/t20c-g2.json` |

Harness settings:
- `T20C_COMPACTION=anchored`: the shipped context default.
- Memory off: the shipped default is opt-in.
- Tools: web, device and calendar off (measurement rule). The built-in notes tool stays on.
- `BENCH_TARGET=device`.
- `CAMPAIGN_MIN_BATTERY_LEVEL=70`: the run started at 84 %.

The harness fixes made during this session are app commit `9c8c001f`.

## The four attempts

1. **Attempt 1:** stopped before turn 1. Without `BENCH_TARGET=device`, the harness's `sql()` ran `sqlite3` on the phone, which has none, and parsed the error text as the conversation index.
2. **Attempt 2:** stopped before turn 1. The device had stale bench keys, `kalsa.bench.npu_lane=off` and `kalsa.bench.route=gpu`, so the plan said `"npu_lane":"off"` (`raw/attempt2-plan-npu-lane-off.grep`). The conversation index was also 452 KB (98 old test chats), read while the app was rewriting it.
   - Fix: backed up `RKStorage` to `~/kalsa-backups/s23-rkstorage-2026-10-09-before-g2/`.
   - Removed the two bench keys and every conversation, message, compactor and summary key.
   - 49 settings keys left; `quick_check` ok.
3. **Attempt 3:** `pid-death` recoveries. The app's process was force-stopped repeatedly, including mid-decode.
   - **This was the harness, not a crash.** Every `ApplicationExitInfo` is `reason=10 (USER REQUESTED) subreason=21 (FORCE STOP)` from adb (`raw/exit-info-after-attempt3.grep`).
   - The trigger was one empty wireless `adb shell pidof`.
   - Fixed: the harness now requires three empty reads one second apart.
   - The repeated stops set the app's dead-load marker, which was cleared before attempt 4.
4. **Attempt 4:** turns 1-3 ran, then the thermal abort at turn 4 (`raw/attempt4-harness.grep`).
   - The PID was stable across the whole turn.
   - Turn 1 hit the tool-round cap. The model called `write_note` twice, then a `web_search` fallback that was blocked. The app emitted `KALSA_TOOLROUND_EXHAUSTED {"streamedLen":0,"fallbackOk":false}`, so the user saw no answer.
   - The harness waited 600 s for a round that never comes. Fixed in `9c8c001f`: `EXHAUSTED` now ends the turn.

## What attempt 4 shows (`raw/attempt4-kalsa-lines.grep`)

| turn end | prefill / decode | decode tokens NPU / GPU / CPU | hops | Android status | governor state |
|---|---|---|---|---|---|
| 1 (14:34) | NPU / NPU | 2037 / 192 / 0 | 3 | 0 | FAST |
| 2 (14:47) | NPU / NPU | 1647 / 0 / 0 | 0 | 0 | FAST |
| 3 (14:51) | NPU / NPU | 3506 / 64 / 0 | 1 | 1 | FAST |
| 4 | aborted mid-turn at status 3 | — | — | 3 | (no line) |

The governor source was `thermo_source: battery` on every turn.

**What worked in-app on the S23:**
- the one-copy load: process RSS 2.4 GB, against 3.9 GB in the attempt-2 process, which ran two copies with the lane off;
- NPU prefill and NPU decode at 14-15.5 tok/s;
- rule v3 decode hops NPU<->GPU, with per-leg headroom in the log, e.g. `hop npu->gpu at token 0 (headroom cpu 51.1 C, npu 22.2 C, gpu 33.2 C)`;
- the A1 fix: `KALSA_SESSION {"op":"save","ok":false,"reason":"governor_mode"}`, and no file deleted;
- no native crash in any attempt.

## Why the governor missed SEVERE

- `src/engine/governorInputs.ts:456` in the app: "One platform read per completion". The battery snapshot has the same cadence.
- The engine's floor does exist: `src/llama-governor-policy.cpp:42-50` turns status >= 2 into COOLMODE. It never receives the mid-turn change.
- Turn 3 alone decoded 3506 tokens, about 4 minutes. Turn 4 began with the status at 1, and the platform went to 3 inside it.
- The per-leg headroom was large when SEVERE hit (NPU 22 C, GPU 33 C, CPU 51 C). The binding the device limit is whole-phone heat (skin and battery), not a single component.

## Caveats

- The phone was not cold. Three attempts had run in the previous ~45 minutes, and attempt 4 started with the battery at about 29.7 C. That is above the endurance protocol's start bar (skin <= 31 C on the S23 is the criterion, and the battery was already warm).
- One run, so the turn count to SEVERE is not a measurement of a cold phone.

## Next (proposed to the owner 2026-10-09)

- Read the platform thermal status natively in the binding's decode loop, with NDK `AThermal_getCurrentThermalStatus` (API 30+), every N tokens, beside the per-leg headroom reader. The governor would then see SEVERE within seconds and enter COOLMODE.
- Repeat G2 on a cold phone.
- App issue, separate from the governor: a turn that exhausts its tool rounds can end with no visible answer (`streamedLen 0`, `fallbackOk false`).
