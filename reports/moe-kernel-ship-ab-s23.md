# Kernel ship A/B — pre-registered p-value cell, Mellum2 on S23 — 2026-08-14/15

## Verdict: **SHIP CRITERION MET — p = 0.000488, every pair favors the certified config**

Owner criterion (PLAN decision 3): "ship a kernel that improves the
shipped models in a general, significant way — I want that p-value."
Pre-registered protocol (`results/kernel_ship_ab_s23/PREREG.md`, two
amendments both dated before any analyzed data), 12 ABBA pairs, fresh-
reboot RAM state declared, campaign ELF `0ac612de` (config-only, never
written), model/prompt sha-pinned, UNPLUGGED, floors honored.

## Confirmatory metric — decode wall s/token

| | A (stock: t4, k8, no drop) | B (certified: t2, k6, d1.0) |
|---|---|---|
| median s/token | 0.2585 | 0.1480 |
| median tok/s | 3.87 | **6.76** |

- **Hodges-Lehmann shift: −0.108 s/token (−42.7% median wall = +74.7% tok/s)**
- **Wilcoxon signed-rank two-sided: W=0, p=0.000488** (scipy; W=0 means
  ALL 12 pair differences favor B — the strongest possible result at
  N=12; p = 2/4096 is the exact-test floor)
- Decision at alpha 0.05: **significant**, direction B.

## Supporting metrics (declared in PREREG, all 12 pairs)

| axis | A | B | reading |
|---|---|---|---|
| sustained late-rep (last 4 pairs) | 0.2685 | 0.1660 | **B holds the win hot** (−38%) |
| J/token | 0.1089 | 0.1218 | **B costs +11.8% energy per token** — honest regression on the battery axis (B pushes the cores harder; per-answer energy is ~+12%) |
| max battery temp | 39.3 C | 39.5 C | parity (+0.2 C) |
| TTFT (first measured run) | 10.90 s | 10.78 s | parity |

Scorecard vs the owner's "improves in general" bar: speed massively
green (p at the exact-test floor), sustained green, thermal parity,
TTFT parity, **energy-per-token mildly red (+12%)** — disclosed, not
hidden. Four of five axes green or neutral.

## Drift note (honest)

Both arms slow over the session (A 0.220→0.267, B 0.127→0.169 across
pairs 1→12): thermal soak + RAM-state creep, affecting both arms; the
ABBA pairing absorbs it (every pair still favors B). Session started
from a declared fresh reboot per PREREG amendment 2.

## Context: what the two invalidated sessions taught

Session 1-2 died to an environmental pathology worth its own finding:
with ~1.5 GB of anon pages in zram, arm A (k8 no-drop, 183 MiB/token of
page-cache churn) degraded 60-100x (21.3 s/token) while arm B (39
MiB/token) was unaffected. **The certified config is not only faster —
it is robust to real-world RAM pressure that collapses the stock
config.** (Reproduced twice, recovered 100x by reboot; archived in
`misconfig_session1/` and the master logs.)

## Provenance

`results/kernel_ship_ab_s23/` — PREREG.md (+2 dated amendments),
device/runs.csv, device/ANALYSIS.md (verbatim analyzer output),
device/SHIP.master.log, misconfig_session1/. Analyzer selftest passed
before launch; harness hostile-reviewed (GO_WITH_FIXES, all fixes
applied and verified pre-launch).

## What this cell does NOT claim

- Nothing about `--kf-prefetch` (deliberately excluded; separate lane,
  own scoreboard).
- Single device x single model: the ship report basket may add cells
  (Marco-Xiaomi t4/screen +158% is already banked from the campaign,
  not pre-registered). This is the first PRE-REGISTERED brick.
