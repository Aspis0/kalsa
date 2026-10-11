# Xiaomi 14 in-app long session, APK 233486dd (graduated pacing) - night of 2026-10-11

**14 turns completed in-app on the owner's Xiaomi 14, unplugged, prefill and decode on the NPU, no crash; stopped by
the coordinator's battery watchdog at 29 % during turn 15 (the battery allowed no more: the phone started at 62 %).
Two findings: Android's thermal headroom on this phone has a different scale (the S23 pacing lines never fire), and
the harness's tool-round wait (H6) hit again at turn 2.**

## Setup

| | |
|---|---|
| APK | CI run `38097645331`, app `233486dd`, debuggable, fresh install (no Kalsa before) |
| Model | `LFM2.5-2.6B-QAD-Q4_0.gguf` copied into the app's `files/models/lfm2.5-2.6b/` from `/data/local/tmp/govhtp-xiaomi/model/ship.gguf` (sha256 `a247afd6...`, identical to the S23 app's copy); the app showed it "On this phone" |
| Device | Xiaomi 14 (`23127PN0CG`, `ro.soc.model=SM8650`), unplugged, 62 %, battery 34 C, skin 36 C at start; `persist.traced.enable=1` (left as found: the owner's phone) |
| Harness | `run-t20c.sh`, `campaigns/t20c-xiaomi.json` (copy of t20c-g2 with the Xiaomi serial and `deviceModel`), `CAMPAIGN_MIN_BATTERY_LEVEL=55` (the preflight floor is 85 % by default), pause battery > 43 C |
| Watchdog | `watchdog.sh` (v2): every 60 s logs level / wakefulness / focus; stops the harness at level < 30 % or hottest skin >= 46 C; wakes the screen if needed; at the end stops the sampler, force-stops Kalsa and sets the screen timeout to 60 s (`raw/watchdog.grep`) |
| Side sampler | `xiaomi-g2-sampler.sh`, `raw/g2-side.csv` (starts ~6 min before the session: the first two launches stopped at the harness preflight and on the missing model) |

The pacing lines are the engine defaults (0.87 / 0.97): the S23-only 0.99 is keyed on SM8550.

## Result

| | |
|---|---|
| Turns | 14 completed in-app (turn 2 answered but was recorded only as RECOVERY events, see H6), turn 15 cut by the watchdog |
| Route | `engine_prefill NPU`, `engine_decode NPU`, `npu_device HTP0`, 0 CPU / 0 GPU decode tokens (`raw/governor-pacing.csv`) |
| Speed per completion | 15.3, 15.1, 14.1, 14.2, 12.1, 12.8, 10.5, 9.2, 7.8, 7.2, 7.8, 6.1, 5.1, 5.7, 6.3, 4.5, 6.7 tok/s (`raw/telemetry-speed.csv`) |
| Governor state | FAST turns 1-4, WARM 5-6, COOLMODE from turn 7 (battery 39.5 C) |
| Duty | 1.0 until COOLMODE, then 0.93 -> 0.65, from the battery ramp only |
| Skin (hottest HAL skin sensor) | max 44.9 C |
| Battery | max 42.0 C, level 62 -> 29 % in 90 min |
| Android status | 0 for the whole run (1027 samples) |
| MemAvailable min | 2.51 GB |
| App PIDs in the session | 557 (turns 1-2), 3616 (after the turn-2 force-stop, to the end): no crash |

## Finding 1: the headroom scale differs per phone

`decode_pacing_headroom_last` against the side sampler's hottest skin sensor at the same second (13 turns):

    headroom ~ 0.0327 x skin_C - 1.187    (headroom 0.10 at 39.3 C, 0.28 at 44.9 C; 1.0 would be ~67 C)

On the S23 the same forecast is (skin - 12) / 30, SEVERE at skin 42.1 C (cell 78). Here, at a skin of 44.9 C,
the forecast was 0.28 and the status 0. So the S23-calibrated ramp (0.87 -> 0.97) never paced; the battery ramp
(39.5 -> 43 C) did all the pacing, and the Xiaomi's own hidden frequency caps did the rest (speed 15 -> 5-6 tok/s
with status 0). The forecast may read a different, cooler sensor than the hottest one logged here.

Consequence: the headroom lines must be per phone (per HAL), like the S23's 0.99. A Xiaomi row would be
roughly start 0.15 (skin ~41 C) / full 0.25 (skin ~44 C) on this fit; one run, so a proposal, not a calibration.

## Finding 2: H6 again

Turn 2: `tool round pending` -> 600 s wait -> `RECOVERY reason=toolround (force-stop com.kalsa.app)`, then
`already-landed-skip-send`. Same as the S23 turn 10 on 867affaa: an executed tool round that the app closes without a
continuation costs 10 idle minutes and a restart. The phone cooled meanwhile (battery 32.9 C at the restart).

## Not covered

- One run, from 62 %, so the session could not reach 20 turns.
- The hottest skin sensor is not necessarily the one Android's forecast and status read.
- The owner's skin comfort on this phone (44.9 C peak on the hottest sensor) is above the S23's 43 C bench stop; the
  in-app harness stops on battery (43 / 44 C), which peaked at 42.0 C.
