# S23 G2 in-app long session, APK 233486dd (graduated pacing, S23 full line 0.99) - 2026-10-10

**The in-app 20-turn session completed on the S23: `T20C RUN COMPLETE — turns=20/20 toolcap=1 toolcap_no_answer=0
recoveries=0 unparseable=0`. No crash, no harness pause, Android status never 3.**

## Build and setup

| | |
|---|---|
| APK | CI run `38097645331`, app `233486dd`, debuggable, arm64, sha256 `60f9c64d` |
| Binding | kalsa.rn `0da3b1eb` (engine `74b75037f`, skels for 74b7503) |
| Pacing | duty = min(headroom ramp 0.87 -> **0.99** (S23 only, owner 2026-10-10) down to 0.35, battery ramp 39.5 -> 43 C, status cap 2 -> 0.5, >= 3 -> 0.35) |
| Harness | `run-t20c.sh` with app `e0ae695d`: pause at battery > 43 C read from `campaigns/t20c-g2.json` (log: `T20C thermal pause battery > 43 C`) |
| Device | S23 (SM-S911U, `ro.soc.model=SM8550`), unplugged; 100 % and skin 30.9 C at start; `persist.traced.enable=0` |
| Side sampler | `raw/g2-side.csv`, every 5 s |

The 0.99 line reached the engine: at headroom 0.9733 the reported duty is 0.440, which is the 0.99 ramp
(1 - (0.9733 - 0.87) / 0.12 x 0.65); with the 0.97 default it would already have been at the 0.35 floor
(`raw/governor-pacing.csv`).

## Three runs on the same S23, same day

| | 2a1d1055 flat 0.5 | 867affaa ramp, full 0.97 | **233486dd ramp, full 0.99** |
|---|---|---|---|
| Turns completed | 15 (harness DB-read abort) | 16 (harness thermal abort at 42 C) | **20/20** |
| Wall time | 76 min | 123 min (incl. a 10-min tool-round wait) | 106 min |
| Completions >= 10 tok/s | 2 | 6 | 4 |
| Hot completions, median (range) | 6.03 (5.6-7.6) tok/s | 5.34 (4.4-6.8) | 5.77 (4.8-7.7) |
| Skin max / battery max | 41.4 / 42.3 C | 41.5 / 42.6 C | 41.5 / 42.5 C |
| Android status 3 samples | 0 | 0 | 0 |
| MemAvailable min | 1.24 GB | 1.37 GB | 1.35 GB |

Speed is `predictedPerSecond` per completion (`raw/telemetry-speed.csv`); "hot" = completions under 10 tok/s.

## Reading

- The session goal is met on the S23: 20 turns in-app, unplugged, from cold, with no crash and no stop. What changed
  versus the earlier attempts is mostly the harness (DB-read retry `0c8a711d`, pause line read from the config
  `e0ae695d`) and the battery staying at or under 42.5 C.
- The ramp buys the first turns: 4-6 completions at 10-16 tok/s instead of 2.
- In the hot steady state the 0.99 line runs at duty ~0.42-0.48 and a median of 5.8 tok/s: back near the flat 0.5
  (6.0) and above the 0.97 line (5.3). Under continuous load the S23 sheds about the same heat whatever the ramp, so
  the steady-state speed moves only with where the skin is allowed to settle.
- Recovery without corruption was not exercised here (zero recoveries); it was exercised on 867affaa (a force-stop
  at turn 10 resumed with `already-landed-skip-send`, no duplicate).
- `toolcap=1`: turn 1 used tools and answered; turns 1 and 3 are timing-invalid by design (`tool_rounds`).

## Not covered

- One device, one run per arm, same day; the phone's start state differed slightly (96-100 %, skin 30.9-31.0 C).
- Tools-ON shorter session and the other Snapdragons are separate cells.
