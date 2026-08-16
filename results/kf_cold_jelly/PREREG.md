# Pre-registration — K-F confirmatory cell, COLD regime, Jelly Star

Registered 2026-08-16, **before any run of this cell and before staging**. This
is the cell that `KF_SHIP` has been blocked on.

## Why this cell exists

The K-F characterization is complete and says the technique has a **narrow,
measured scope**: it wins only where the residual I/O stall share is high AND the
cache is cold.

| device / regime | result |
|---|---|
| Jelly, cold | **−20 %** (exploratory) |
| Jelly, warm | **+7.1 % against**, pre-registered, W=1 p=0.000977 |
| S23 | null (stall 11 % → 6 %) |
| Xiaomi, warm and cold | null (cold stall share 8.7 %) |
| CalaQwen-35B, cold | stall share 6.0 % — big-model hypothesis refuted |

So the warm regime already has a **pre-registered negative**, and the only
surviving positive is Jelly-cold, which was never pre-registered. This cell fixes
exactly that asymmetry. Shipping a technique on the strength of an exploratory
number while its pre-registered sibling came out negative would be indefensible.

## Hypothesis

H1: on Jelly Star with `Marco-Mini-Instruct-KEXP.gguf` and the certified campaign
config (k6 d0.65, `-t 2`, `--moe-stream --cache-mb 2000 --dense-weights anon
--io-threads 4 --overlap`), enabling `--kf-prefetch --kf-prefetch-width 4`
reduces per-block wall s/token **when every measured run starts from a cold page
cache**. Direction: ON < OFF.

Pre-registered expectation: the exploratory cold measurement was ≈ −20 %. A
smaller effect, a null, or a reversal are all publishable outcomes and will be
reported as the verdict, not buried.

## Design (mirrors `results/kf_ship_jelly/PREREG.md`, with the cold reset added)

- **24 blocks, ABBA at block level**: `OFF ON ON OFF` repeated 6 times.
  Pairing: within each quartet, (block1 OFF, block2 ON) and (block4 OFF,
  block3 ON) → 2 pairs per quartet → **N = 12 pairs**.
- **One binary for both arms** — the arm is the flag and nothing else. The
  binary must be the same K-F build used by the warm cell (sha `77a94640…`);
  its sha is verified on the device before the first block and recorded.
- `N_GEN = 200`, prompt `p_fact.txt` sha `b5301c32…`.
- Device: **UNPLUGGED**, battery floor 45 %, thermal abort 43 °C, block-1 start
  temp ≤ 33 °C, wake-lock held.

### ⚠ The cold reset, and the trap it closes

**Before every measured run** (both arms, no exception): `fadv` DONTNEED on the
model file, then a recorded check.

The trap: if a reset silently fails, that run is a *warm* run — and we already
know warm is where K-F **loses** by 7 %. A cell with a few undetected warm runs
does not become noisy, it becomes **biased toward the negative**, and would read
as an honest refutation of our own positive. The reset must therefore be
verified, not assumed:

1. Record `Cached` (from `/proc/meminfo`) immediately before and after the
   `fadv` call.
2. A run is **COLD-VALID** only if the drop is at least 1000 MB **and** the run's
   own reported read volume exceeds the cold floor (to be pinned from the first
   OFF block, declared before the pairs start).
3. A run failing either check is **excluded**, which voids its pair; the pair is
   re-run appended at the end, exactly as in the S23 cell.
4. The count of excluded-for-warmth runs is reported in the verdict section, not
   a footnote.

## Primary endpoint and test (declared now)

- Per-block `wall_s_tok` from `runs.csv`.
- **Wilcoxon signed-rank, exact, two-sided, on the 12 (OFF − ON) pair
  differences, alpha 0.05.** Effect size: Hodges-Lehmann shift and % change.
- N ≥ 10 complete pairs required for the confirmatory claim.
- Ties: zero differences are dropped by the test, so the effective N and the
  exact-test floor for that N are reported alongside the p-value. (The Xiaomi
  cell hit exactly this and the mismatch between "N=12" and a p of 2/2¹¹ is
  confusing unless stated.)

## Secondary endpoints (disclosed, not gated)

Pooled per-token p50/p95/p99, stutter rate (> 2× pooled p50), J/token ON/OFF,
majflt/token, TTFT, thermal sag, read bytes, and the measured stall share per
arm — the last one because the whole dispatcher policy keys on it.

## The activation policy this cell is meant to license

A pass here is not by itself a ship. The policy below is registered now so it
cannot be reverse-engineered from the result:

> **K-F is enabled if and only if: measured stall share is high AND the cache is
> cold AND no thermal alarm is active.** Battery level is explicitly NOT a gate
> (the screen-on inversion measured earlier makes it the wrong signal).

If this cell passes, that policy ships with it. If it fails, K-F stays off and
the characterization map is the deliverable.

## Kill conditions

- Binary or model sha mismatch → cell void.
- Any post-hoc change of arms, flags, the endpoint, or the test → cell void; a
  new PREREG is required.
- A session that cannot keep runs cold (systematic reset failure) → reported as
  **infeasible**, not as a null.
