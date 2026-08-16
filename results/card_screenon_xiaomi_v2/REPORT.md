# card_screenon_xiaomi_v2 — screen-on card cells redo (Doze queue item)

Redo of the published Xiaomi lineup numbers, screen ON + awake, same
protocol as the 2026-08-13 night cell that produced them.

## Protocol archaeology

The original protocol is **not ambiguous**. Sources (absolute / repo paths):

| what | where |
|---|---|
| On-device driver (campaign pin 1ca51420) | `/data/local/tmp/gdn_750/taskb/run_xiaomi_t4_round.sh` (pulled to `_proto/run_xiaomi_t4_round.sh`) |
| Host copy + raw cells | `results/xiaomi_t4_round/run_xiaomi_t4_round.sh`, `runs.csv`, `SPEED_VERDICT.md` |
| PLAN card line | `PLAN.md` "Lineup 3 telefoni": Marco1c Xiaomi **10.57** (t4 screen-on), CalaQwen Xiaomi **4.75** |

Exact original command (`run_one`, n=200):

```
bmoe-cli -m $MODEL -p "$(cat p_fact.txt)" -n 200 \
  --n-expert-used 6 --drop-cold-experts 0.65 \
  --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
  --io-threads 4 --ubatch 512 \
  -t $THREADS -c 4096 --temp 0 --chatml --no-think
```

| card number | threads | reps | state | n | screen | raw tok/s |
|---|---|---|---|---|---|---|
| CalaQwen **4.750** | **t6** (not t4) | 2 cold | fadv each | 200 | stayon + WAKEUP, Awake/Awake | 4.697 / 4.802 |
| Marco1c **10.574** | **t4** | 1 cold | fadv | 200 | same | 10.574 |

CalaQwen t4 was also measured that night (med 4.580) but the **card is the
t6 pair**. Extra vs tonight's part-A string: `--chatml --no-think`. Prompt:
`$ROOT/prompts/p_fact.txt` (361 B, same text as kf_general). Binary:
campaign `$ROOT/bin/bmoe-cli` (402416 B, 2026-08-13). Original walls:
CalaQwen ~58–60 s, Marco t4 **26 s**.

The user fallback (warm + 3× n=200 t4 both models) was **not used**.

## This redo

- Same command, same campaign binary, same prompt, COLD (fadv before every
  cell), `svc power stayon true` + `KEYCODE_WAKEUP`, mWakefulness=Awake
  recorded before every run.
- Extra reps for a median: CalaQwen t6 ×3 (orig 2), Marco t4 ×3 (orig 1).
- Validity: parsed tok/s, bytes>20KB; wall>40s CalaQwen (orig ~60s);
  wall>15s Marco (orig 26s — the KF-probe 40s floor would false-fail).
  All 6 cells DONE try=1.
- Driver: `run_card_screenon_v2.sh`. Raw: `out/*.txt`. Archaeology notes:
  `_proto/ARCHAEOLOGY.md`.

## Per-block table

| block | model | t | tok/s | MiB/tok | wall | screen | batt/temp |
|---|---|---:|---:|---:|---:|---|---|
| cq_t6_r1 | CalaQwen | 6 | 4.858 | 33.16 | 57s | Awake | 74% / 35.9°C |
| cq_t6_r2 | CalaQwen | 6 | 4.677 | 33.16 | 60s | Awake | 73% / 36.0°C |
| cq_t6_r3 | CalaQwen | 6 | 4.152 | 33.16 | 65s | Awake | 73% / 37.6°C → 38.1°C |
| m1c_t4_r1 | Marco1c | 4 | 11.786 | 52.29 | 26s | Awake | 72% / 37.8°C |
| m1c_t4_r2 | Marco1c | 4 | 10.467 | 52.29 | 28s | Awake | 72% / 37.8°C → 38.1°C |
| m1c_t4_r3 | Marco1c | 4 | 11.780 | 52.29 | 25s | Awake | 71% / 37.9°C |

MiB/token matches the 2026-08-13 cells **to the hundredth** (CalaQwen 33.16,
Marco 52.29). Streaming regime is the same machine.

## Old vs new

| cell | old card | new median (n=3) | delta | >15%? |
|---|---:|---:|---:|---|
| CalaQwen Xiaomi t6 screen-on | **4.75** (4.697 / 4.802) | **4.677** (4.152 / 4.677 / 4.858) | **−1.5%** | no |
| Marco1c Xiaomi t4 screen-on | **10.57** (10.574, n=1) | **11.780** (10.467 / 11.780 / 11.786) | **+11.4%** | no |

No extra reps. CalaQwen r3 (4.152) is a thermal droop at 38 °C, not a
protocol miss — the median still sits on the card. Marco is *faster* than
the single 2026-08-13 point; +11% is inside the 15% flag and inside a
3-rep spread that still contains 10.467 (the old number). Possible that
the original single Marco shot was a slightly slower draw, not residual
Doze (that cell already logged Awake/Awake).

## Verdict

`CARD_CALAQWEN(med=4.677 vs 4.75, delta=-1.5%)`
`CARD_MARCO(med=11.780 vs 10.57, delta=+11.4%)`
`SCREENON_REDO: both cells reproduce; no Doze collapse; no >15% flag`

The published card numbers survive a clean screen-on redo. CalaQwen 4.75
stays. Marco 10.57 is a conservative single-shot; the 3-rep median tonight
is 11.8. Not a reason to rewrite the card without a larger n.

## Caveats

- Battery UNPLUGGED 74% → 71%. Floor 30% not hit.
- Battery temp 35.9 → 38.1 °C; two TEMP_WAIT (38.1 °C) before Marco r1 and
  r3. Thermal threshold 38.0 °C.
- Ran immediately after the CalaQwen stall/K-F probe on the same phone
  (that cell ended 74% / 36.0 °C). Phone was already warm.
- Campaign binary (1ca51420 / 402416 B), not the KF binary. Correct for
  card comparability.
- stayon restored false at the end of the driver.

Data: `out/*.txt`, `STATUS.txt`, `run_card_screenon_v2.sh`, `_proto/`.
