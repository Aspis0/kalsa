# Drop sweep on Jelly — time AND bytes, from cold. First measurement of the byte saving.

**Result: the byte saving of `--drop-cold-experts` is NOT monotonic, and the
campaign default (d=0.65) is SLOWER than no drop at all on this device. Only
d=1.0 pays — and it pays enormously.**

Exploratory characterisation, 11 of 12 planned runs, round-robin over 4 drop
levels × 3 rounds. Jelly Star, Marco-Mini-Instruct-KEXP, unplugged, verified-cold
page cache before every run.

## The numbers

| drop | n | s/tok | tok/s | read_MiB | stall s/tok | compute s/tok | cache hit % | vs d0 time | vs d0 bytes |
|---|---|---|---|---|---|---|---|---|---|
| **0.00** | 3 | 0.1703 | 5.873 | 11803.1 | 0.0480 | 0.1150 | 50.2 | — | — |
| **0.30** | 3 | 0.2000 | 5.070 | 12395.9 | 0.0533 | 0.1373 | 48.3 | **+17.4 % SLOWER** | **+5.0 % MORE** |
| **0.65** | 3 | 0.1873 | 5.395 | 10535.0 | 0.0463 | 0.1337 | 52.3 | **+10.0 % slower** | −10.7 % |
| **1.00** | 2 | 0.1240 | 8.068 | 3712.8 | 0.0180 | 0.1025 | 67.1 | **−27.2 % faster** | **−68.5 %** |

Per-run, so the ordering can be checked inside each round (drift-free):

| round | d0.0 | d0.3 | d0.65 | d1.0 |
|---|---|---|---|---|
| r1 | 0.171 | 0.183 | 0.174 | 0.123 |
| r2 | 0.165 | 0.183 | 0.172 | 0.125 |
| r3 | 0.175 | 0.234 | 0.216 | *(not run)* |

r1 and r2 agree closely. r3 is inflated across the board (battery temperature
reached 34 °C) but **preserves the ordering** — which is exactly what the
round-robin design was for.

## The internal control PASSED

d=0.65 without prefetch is the OFF arm of the K-F cold cell. It reproduces:

- `read_MiB` = **10535.0 in all three rounds, bit-identical** — the engine's byte
  accounting is exact and deterministic.
- `/proc read_bytes` = 22.17 / 22.07 / 22.19 GB against the K-F cold cell's
  22.1–22.5 GB for its OFF blocks.

So this cell is measuring the same thing as the pre-registered cell, on the same
binary and model. The comparison is legitimate.

## What is surprising, and what it means

**d=0.3 reads MORE bytes than d=0.0 and is 17 % slower.** A small drop is not a
small saving — it is a net loss. The mechanism is visible in the cache column:
hit rate *falls* from 50.2 % to 48.3 %. Dropping a slot re-points it at the top
expert (`router_hook.cpp:267-268`), which perturbs which experts are touched;
at low fractions that disturbs cache locality more than it removes reads.

At d=1.0 the picture inverts completely: hit rate jumps to 67.1 %, bytes fall by
more than two thirds, and throughput rises 37 % (5.87 → 8.07 tok/s).

**Combined with the PC quality curve, the Pareto front is now knowable:**

| drop | quality cost (PC macro bpb) | speed (this cell) |
|---|---|---|
| 0.0 | — | baseline |
| 0.3 | +0.06 % | **+17 % slower** |
| 0.65 | ~+0.8 % (interpolated) | **+10 % slower** |
| 1.0 | +4.0 % | **−27 % faster** |

**d=0.3 and d=0.65 are strictly dominated**: they cost quality *and* time. The
real choice is **d=0.0 versus d=1.0** — pay 4 % bpb for 37 % more tokens/s, or
do not drop at all.

This also explains a discrepancy the statistics audit found independently: the
pre-registered ship A/B tested arm B as `-t 2 --n-expert-used 6
--drop-cold-experts 1.0`, not the campaign default of 0.65. **The A/B tested the
configuration that is actually fast.** The campaign default at 0.65 is on the
dominated part of the curve.

## Scope and limits

- One device, one model. The PC curve is CalaQwen; this is Marco-Mini. Whether
  the non-monotonicity holds on other models is untested.
- d=1.0 has n=2, not 3 — the last run was lost (see below).
- Exploratory: no pre-registration, no p-value, no ship claim. What it licenses
  is a *re-examination* of the shipped default, not a change by itself.
- The quality figures in the Pareto table come from the CalaQwen PC curve; the
  0.65 row is interpolated, not measured.

## What went wrong, and what it cost

**Three failures, all mine, none of them the device.**

1. **The binary never linked.** `bmoe-cli` loads its `.so` files from its own
   directory, which is not on the loader path. The proven K-F harness sets
   `LD_LIBRARY_PATH` at line 42; I reused the binary without reusing that line.
   First attempt died before reading a byte of model.
2. **`set -e` after `wait`.** The script header sets only `-uo pipefail`, so
   errexit was never on; my `set -e` turned it on mid-loop, and the next
   legitimately-failing command killed the sweep silently.
3. **The parser dropped every timing field.** The engine's keys contain slashes
   (`s/tok`, `tok/s`, `stall_s/tok`). My `sed -n "s/...$1=...//p"` extractor read
   the slash inside the key as the `s///` delimiter, so those fields came back
   empty and every run was written `excluded=1`. Fields without slashes
   (`read_MiB`, `cache_hit_pct`, `experts_dropped`) parsed fine — which is why
   the failure was invisible in the byte columns.

**The data survived all three** because the engine writes its own summary line
into the per-token CSV. The measurement was correct; only my extraction was
broken. Re-parsed offline, the cell is intact.

The root cause of all three: **I wrote a new harness instead of parameterising
the proven one.** Every bug above was already solved in
`run_kf_reality_jelly.sh`.

## Why the run stopped at 11/12

The device's screen timeout is 30 minutes and cannot be set to "never" in the UI;
`settings put system screen_off_timeout` from Termux is refused
(`INTERACT_ACROSS_USERS`). The sweep launched at 23:04:15 and its last completed
run finished at **23:34:26 — 30 minutes and 11 seconds later**. It died at the
screen timeout, despite `termux-wake-lock` and despite being properly detached
(PPID=1, verified from a fresh session; it survived several sshd drops before
that).

**The fix is not to fight the timeout, it is to make a death cost one block.**
The K-F harness survives repeated kills because it has `RESUME_AT` and a
void-scan; this script has neither. Adding resume is the change that makes long
device cells reliable on this phone.
