# REPORT — s23-unplugged-baseline-night0 (Amendment 1)

**Status: BLOCKED (ADB loss) on kexp_tg128_b1 cell A.** Incomplete ABBA block. No median. **FINITA — riattaccare il telefono.**

AMENDMENT-1 (f90a1d5e): cool-start ≤36.0 °C for **one** block only (`kexp_tg128_b1`). Screen ON during measured runs.

## Preflight (logged)

| item | value |
|---|---|
| serial | `192.168.1.152:37687` |
| amendment-1 gate | ≤36.0 °C |
| runner preflight | 46 %, **36.0 °C**, ac:false, screen Dozing |
| launch() battery.pre (cell A) | 46 %, **35.9 °C**, ac:false |
| screen at START A | **Awake** (KEYCODE_WAKEUP) |
| unplugged | PASS |

Cool-start amendment **met**. Battery 46 % ≥ 45 %.

## What happened

Cell `kexp_tg128_b1_1_A` (`-ngl 99 -nr -fa off`, tg128, screen Awake) started 10:59:12. Guard/workload were launched. Battery samples: 35.9 °C / 46 % / ac:false for ~20 s, then dumpsys None. `adb connect 192.168.1.152:37687` for 10 min: **Connection refused**. No new ports hunted. Jelly `192.168.1.82:34037` left alone.

No stdout jsonl. No avg_ts. Block **invalid** (partial). Remaining ABBA cells (C,C,A) **not started** (stop on transport).

## Speed numbers

None. Partial block is not a median.

## vs #18 / #20 (caveat only — no datum)

Amendment-1 reading caveat still applies to any future number from this window: comparators #18 KEXP A 14.252 / C 17.553 (A/C 0.812) and #20 OLMoE A 20.034 / C 27.685 (A/C 0.724) started cooler. A ~36 °C hot start with screen ON can depress tg128 via earlier throttle; it would have been a **lower bound** on cool-start unplugged tg128. **This cell produced no t/s, so no comparison and no adjudication.**

## Battery / screen / temp (this attempt)

- Start: 46 %, 35.9–36.0 °C, ac:false, screen woken Awake for the measured cell.
- End: transport dead; last live sample 46 %, 35.9 °C, ac:false. No post snapshot.
- Floor 45 % not hit. Plug not seen.

## Still valid from night-0

MUL_MAT_ID 407/407, MUL_MAT 925/925, pin set. Unplugged correctness.

## Not valid

Any t/s, A/C, #18/#20 delta, night-0 `kexp_pp512_b1_1_A` attempt, this morning's incomplete A cell.
