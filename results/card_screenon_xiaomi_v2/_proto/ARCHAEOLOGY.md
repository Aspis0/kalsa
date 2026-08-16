# Protocol archaeology — Xiaomi screen-on card cells

## Card numbers (PLAN.md lineup "Lineup 3 telefoni")

- Marco1c Xiaomi **10.57 tok/s (t4 screen-on)**
- CalaQwen Xiaomi **4.75**

PLAN.md:376 still flags these as "Xiaomi era in Doze → rifare celle card screen-on".
The numbers themselves already come from the 2026-08-13 night t4+screen round
(`results/xiaomi_t4_round/`), which recorded Awake/Awake on every cell.

## Exact original protocol (NOT ambiguous)

Source of truth, in order:

1. On-device driver (pulled tonight):
   `/data/local/tmp/gdn_750/taskb/run_xiaomi_t4_round.sh`
   host copy: `results/card_screenon_xiaomi_v2/_proto/run_xiaomi_t4_round.sh`
   also: `results/xiaomi_t4_round/run_xiaomi_t4_round.sh`
2. Raw cells: `results/xiaomi_t4_round/runs.csv`
3. Verdict: `results/xiaomi_t4_round/SPEED_VERDICT.md`

### Command (from run_one, lines 204-208 of the on-device script)

```
bmoe-cli -m $MODEL -p "$(cat p_fact.txt)" -n 200 \
  --n-expert-used 6 --drop-cold-experts 0.65 \
  --moe-stream --cache-mb 2000 --dense-weights anon --overlap \
  --io-threads 4 --ubatch 512 \
  -t $THREADS -c 4096 --temp 0 --chatml --no-think
```

Extra vs tonight's part-A campaign string: `--chatml --no-think`.
Those flags matter for Qwen3.6 (thinking model). Keep them on the redo.

### Per-model cells that produced the card numbers

| model | threads | reps | state | n | screen | median tok/s | raw |
|---|---|---|---|---|---|---|---|
| CalaQwen | **t6** | 2 cold | fadv before each | 200 | stayon + WAKEUP, Awake/Awake | **4.750** | 4.697, 4.802 |
| Marco1c | **t4** | 1 cold | fadv before each | 200 | same | **10.574** | 10.574 |

CalaQwen t4 screen-on was also measured (4.613 / 4.547, med 4.580) but the
**card number 4.75 is the t6 pair**, not t4. SPEED_VERDICT.md line 5.

Prompt: `$ROOT/prompts/p_fact.txt` (same text family as kf_general/p_fact.txt).
Binary: campaign pin **1ca51420** at `$ROOT/bin/bmoe-cli` (402416 bytes, 2026-08-13).
UNPLUGGED 65→61%, 31–36 °C. wall CalaQwen ~58-60s; Marco t4 wall **26s**.

### Screen protocol

- `svc power stayon true`
- before each cell: `dumpsys power` mWakefulness; if not Awake, `input keyevent KEYCODE_WAKEUP`
- reject / rerun if screen not Awake/Awake (return 19)

## What this redo will do

Match the original (not the fallback "warm + 3× n=200 t4"):

- campaign binary + `--chatml --no-think`
- COLD (fadv model first) so decode is comparable to the card
- CalaQwen **t6**, n=200, 3 cold reps (original 2; +1 for a real median)
- Marco **t4**, n=200, 3 cold reps (original 1; +2 for stability)
- screen stayon + WAKEUP, record wakefulness
- if a median lands >15% off the card, +2 extra reps and flag
- validity: parsed tok/s, bytes>20KB; wall>40s for CalaQwen, wall>15s for
  Marco (original Marco wall was 26s — the KF-probe 40s floor would false-fail)

Fallback in the user brief (warm, 3× n=200 t4 both models) is **not used**,
because the protocol was found and is not ambiguous.
