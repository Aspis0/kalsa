# SPEED VERDICT — MarcoKEXP-1c vs Marco-Q4KM A2 · Galaxy S23

**Date:** 2026-08-13  
**Device:** Galaxy S23 (Termux ssh `u0_a344@192.168.1.152:8022`)  
**Question:** did the 1c requant fix Marco's I/O (phase-1 A2 = 126 MiB/tok, hit 37%) toward the campaign regime (~30–40 MiB/tok, hit 70–80%)?  
**Status:** COMPLETE · 8/8 runs · UNPLUGGED entire session

---

## File identity (not guessed)

| id | path | size B | sha256 |
|---|---|---:|---|
| **KEXP-1c** | `models/Marco-Mini-Instruct-KEXP.gguf` (`~/models/` on device) | 6 385 238 848 | `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` |
| KEXP-cons (not used) | `models/Marco-Mini-Instruct-KEXP-q3k.gguf` | 7 508 263 744 | `c9570cc4…` |
| **ARM_MARCO** | `~/experiments/models/Marco-Mini-Instruct.i1-Q4_K_M.gguf` | 10 505 424 704 | `a001d324b6edc6a797009fbe6eb94a52a9f32453ee8d06465409875f3e3a6dbc` |
| Binary | `~/src/BigMoeOnEdge/build-bmoe/cli/bmoe-cli.CAMPAIGN` | — | `1ca51420476d4a979552448f1c0b5bc48a04ed2e43643543ce43fa7566bb022f` |

Mapping from `results/marcokexp/PROTOCOL.md` + `QUANTIZE_VERIFY.md`. Local sha = device sha. 1c recipe: attn `q5_k`, gate/up `q2_k`, down `q3_k`.

Freed 3.6 G (`~/models/spike_iq2/`, Llama-3.2-3B spike leftovers) before push. scp ~200 s Wi-Fi. Campaign KEXP 35B and Marco-Q4KM left untouched.

---

## Protocol

Campaign config on both cells:

`-t 4 -c 4096 --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 6 --drop-cold-experts 0.65 --temp 0 --chatml --no-think`

- ABBA × 2 prompts (`p_fact` sha `b5301c32…`, `p_creative` sha `761db0d0…` — byte-identical to phase-1).
- n=200, cold fadvise (`~/bin/cold_model.sh`) every run.
- UNPLUGGED, batt floor 45%, battery-temp abort 45 °C.
- **MemAvailable guard** (NOT MemFree): abort if `< 300 MiB` sustained 60 s (12 × 5 s). Never fired. MemAvailable stayed 4.4–5.0 GiB.
- Cells: **ARM_MARCO** = phase-1 A2 reference, re-measured same session. **ARM_1C** = KEXP-1c, same k/drop.

Order: MARCO → 1C → 1C → MARCO × fact, then creative. 8 runs, all rc=0.

Battery: 92% → 89%. Peak battery temp 34.3 °C. No thermal wait, no plug, no RAM abort.

---

## Absolute numbers (medians, n=4 per cell)

| cell | decode tok/s | MiB/tok | hit% | TTFT s | load s |
|---|---:|---:|---:|---:|---:|
| **ARM_MARCO** (A2, this session) | **5.442** | **126.21** | **36.65** | 12.88 | 6.47 |
| **ARM_1C** | **8.819** | **51.50** | **53.45** | 9.15 | 4.56 |
| phase-1 Marco A2 (context) | 5.371 | 126.2 | 36.7 | 12.64 | — |
| KEXP 35B same-device (context) | 5.696 | 30.7 | 80.7 | 18.98 | — |

Same-session Marco A2 reproduces phase-1 to the reported digit (126.21 / 36.65). Session is valid.

### Per-run

| cell | prompt | o | tok/s | MiB/tok | hit% | TTFT | load | n_gen | batt |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| ARM_MARCO | fact | 1 | 5.279 | 130.10 | 34.7 | 13.446 | 6.824 | 191 | 92→92 |
| ARM_1C | fact | 2 | 8.758 | 52.29 | 52.6 | 9.746 | 4.814 | 200 | 92→91 |
| ARM_1C | fact | 3 | 8.707 | 52.29 | 52.6 | 9.020 | 4.208 | 200 | 91→91 |
| ARM_MARCO | fact | 4 | 5.149 | 130.10 | 34.7 | 13.220 | 6.463 | 191 | 91→91 |
| ARM_MARCO | creative | 1 | 5.604 | 122.31 | 38.6 | 12.380 | 6.196 | 200 | 91→90 |
| ARM_1C | creative | 2 | 8.880 | 50.70 | 54.3 | 9.287 | 4.830 | 200 | 90→90 |
| ARM_1C | creative | 3 | 8.884 | 50.70 | 54.3 | 8.713 | 4.305 | 200 | 90→90 |
| ARM_MARCO | creative | 4 | 5.641 | 122.31 | 38.6 | 12.547 | 6.482 | 200 | 90→89 |

No ABBA order effect. 1c fact pair 8.76 / 8.71; creative 8.88 / 8.88. Marco fact 191 tok (EOS, same as phase-1); 1c always 200.

Flash I/O (fact o1/o2, raw stdout):

| | flash I/O s/tok | stream MiB/s | read MiB | re-reads/tok |
|---|---:|---:|---:|---:|
| ARM_MARCO | 0.362 | 360 | 24848.5 | 85.9 |
| ARM_1C | 0.182 | 287 | 10458.3 | 55.1 |

I/O time halved. Bandwidth is *not* higher — 1c is slower MiB/s (287 vs 360) and still wins because it reads 2.4× fewer bytes.

---

## Pre-declared readouts

### REGIME (the product prize)

| bar | target | observed | call |
|---|---|---|---|
| 1c MiB/tok | ≤ **60** | **51.50** | **PASS** |
| 1c hit vs Marco | ≥ **+20 pt** | **+16.8 pt** (53.45 vs 36.65) | **SHORT** |
| vs campaign KEXP 35B | ~30–40 MiB/tok, hit 70–80% | 51.50 / 53.45% | **not in campaign regime** |

MiB/tok vs Marco: **−59.2%** (126.21 → 51.50). Direction is right. Magnitude is most of the way from Marco-Q4KM toward KEXP 35B, but 51.5 is still 1.68× KEXP's 30.7 and above the 30–40 band.

Hit is the leftover. +17 pt is real and repeatable (fact 52.6, creative 54.3) but it is not +20 and it is not 70–80. 2 GiB cache still evicts: 55 re-reads/tok vs Marco 86 vs KEXP-class that sits at 81% hit.

So: the requant **fixed a large slice of Marco's I/O** (bytes/token and flash time). It did **not** put Marco into the campaign I/O regime. Battery/flash/sustained get a clear win; they do not get a KEXP-35B-shaped win.

Two mechanisms, both expected from the recipe:

1. Smaller expert tiles (gate/up `q2_k`, down `q3_k` vs Q4_K_M). File is 6.39 G / 10.51 G = 0.61×; implied tile ratio from `(1−hit)×tile ∝ MiB/tok` is ~0.56 — experts were quantized harder than the rest of the file (attn stayed `q5_k`).
2. More tiles fit in 2000 MiB → hit 37% → 53%. Secondary.

(1) is most of the 126 → 51 drop. (2) is why it overshoots a pure size-scale (~77 MiB/tok at unchanged hit).

### SPEED

| | |
|---|---|
| decode median 1c / Marco | **8.819 / 5.442 = 1.621×** |
| bar | any ≥ 1.0 is a win given equal quality gates |
| call | **WIN** |

TTFT also down (9.15 vs 12.88 s) and load down (4.56 vs 6.47 s) — smaller mmap. Decode is not close: 1c is the fastest cell this device has shown on this family (KEXP 35B was 5.70).

---

## Verdict

| question | answer |
|---|---|
| Did 1c beat Marco-Q4KM A2 on I/O? | **Yes.** 51.5 vs 126.2 MiB/tok (−59%), hit +17 pt, flash I/O 0.18 vs 0.36 s/tok. |
| Did 1c reach the campaign regime? | **No.** 51.5 is above 30–40; hit 53% is well below 70–80. |
| Is decode a win? | **Yes, clearly.** 1.62×. |
| Ship 1c as the I/O fix? | It is a **real** I/O fix vs i1-Q4_K_M. It is **not** “we are now in the KEXP 35B regime.” Treat 51 MiB/tok / 53% hit as the measured 1c operating point, not as 30/80. |

No SESSION_SLOW. No plugged data. No MemFree false kill.

---

## Artifacts

| path | content |
|---|---|
| `runs_speed.csv` | 8 data rows + header |
| `SPEED.master.log` | device master log |
| `logs/<cell>_<prompt>_oN/` | stdout / stderr / combo / cmdline / tail |
| `mem/<label>.csv` | MemFree+MemAvailable every 5 s |
| `prompts/` | byte-identical phase-1 prompts |
| `models.sha256` / `kexp1c.sha256` / `marco.sha256` / `bin.sha256` | pins |
| `run_speed_s23_1c.sh` | harness used |
