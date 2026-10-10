# S23 G2 in-app long session, APK 867affaa (graduated decode pacing) - 2026-10-10

**G2 not met: the harness thermal hard abort stopped the run in turn 16. No app crash, never Android SEVERE.
Graduated pacing buys speed in the first turns and costs some in the hot steady state.**

## Build and setup

| | |
|---|---|
| APK | CI run `38078019923`, app `867affaa`, debuggable, arm64, sha256 `cbd27007` |
| Binding | kalsa.rn `52718a55` (`2b85937b` + HTP skels rebuilt for the engine) |
| Engine | `74b75037f` |
| Pacing | duty = min(headroom ramp 0.87 -> 0.97 down to 0.35, battery ramp 39.5 -> 43 C, status cap 2 -> 0.5, >= 3 -> 0.35) |
| Device | S23 (SM-S911U), unplugged; 96 % and skin 31.0 C at start; `persist.traced.enable=0` |
| Harness | `scripts/campaign/run-t20c.sh`, `campaigns/t20c-g2.json`, anchored context, memory off |
| Side sampler | `raw/g2-side.csv`, every 5 s |

The native headroom read worked on the S23: `KALSA_GOVERNOR_HEADROOM {available:1}` at every load (`raw/native-thermal.grep`),
and the engine reported the forecast every turn (`raw/governor-pacing.csv`, `decode_pacing_headroom_last`).

## Versus attempt 1 on 2a1d1055 (flat COOLMODE duty 0.5, same morning)

| | 2a1d1055 flat 0.5 | 867affaa graduated |
|---|---|---|
| Completions at >= 10 tok/s | 2 (15.2, 13.3) | 5 (15.7, 13.3, 12.9, 11.7, 10.2) |
| Hot steady state | 5.6-6.4 tok/s | 5.3-5.6 tok/s, then 4.4-5.0 late (duty at the 0.35 floor) |
| Max Android status | 2 | 2 (status 3 never) |
| Skin max / battery max | 41.4 / 42.3 C | 41.5 / 42.6 C |
| MemAvailable min | 1.24 GB | 1.37 GB |
| Turns / wall time | 15 in 76 min | 16 in 123 min |
| Stop | harness DB read (fixed in `0c8a711d`) | harness thermal hard abort |

Speed is `predictedPerSecond` per completion (`raw/telemetry-speed.csv`).

## What happened, in order

1. Turns 1-3 ran with the forecast below the start line: duty 1.0-0.83, 15.7 -> 10.2 tok/s.
2. From ~5 min the skin crossed 38 C and the forecast 0.94: COOLMODE, Android status 2, duty 0.5 (the status cap).
3. With the skin at ~40.8 C the forecast settled at 0.96 and the ramp held duty ~0.41: 5.3 tok/s. The hot steady
   state sits wherever the duty balances the heat the phone can shed; this ramp settles about 0.5 C lower than the
   flat 0.5 did, so it is about 10 % slower there.
4. Turn 10: the harness waited 600 s for a "tool round" continuation and then force-stopped the app
   (`RECOVERY reason=toolround`). Tools are OFF in this campaign and the answer had already landed
   (`already-landed-skip-send`), so this looks like a harness misdetection: open. The phone cooled to status 0
   during the wait.
5. Turns 13-16: the forecast reached 0.97 and the duty its 0.35 floor (4.4-4.8 tok/s).
6. Turn 14: harness thermal pause at battery 42.2 C, resumed after 240 s without a restart.
7. Turn 16: a second pause at battery 42.2 C. The pause does not stop the app (`record only — app NOT
   force-stopped`), and a completion landed at 18:58:39 during it. The battery rose 42.2 -> 42.5 C over three
   samples, and the harness's "still rising after the overshoot window" rule hard-aborted the unplugged run.

## Harness defect found

`run-t20c.sh` hard-codes `CAMPAIGN_THERMAL_MAX_C=42` and ignores `recovery.thermalMaxC` in the campaign config; only
`supervisor.sh` reads it. The owner's 43 C (app `64b05470`) never reached this runner, so both pauses fired at 42.
With 43 C neither pause would have fired at 42.2-42.6 C. Fixed in app `e0ae695d` (pushed 2026-10-10).

## Reading

- The graduated ramp gives the speed back where there is margin: the first ~5 minutes run 1.5-2x faster than with the
  flat 0.5.
- Under continuous load the throughput at equilibrium is set by how much heat the S23 sheds at that skin
  temperature (~5-6 tok/s on the NPU at skin 40-41 C). A ramp only chooses the equilibrium temperature; the closer
  it sits to SEVERE (skin 42.1 C, fixed by Android), the faster the steady state.
- Many completions hit 2047 tokens (`raw/governor-pacing.csv`, `decode_paced_tokens`), so turns are long.

## Next

1. Fix `run-t20c.sh` to read `recovery.thermalMaxC`.
2. Owner decision: keep the S23 lines (0.87 / 0.97) or move the full line toward SEVERE (e.g. 0.99 = skin ~41.7 C)
   to trade margin for steady-state speed.
3. Look at the turn-10 tool-round wait (tools OFF).
