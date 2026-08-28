# HOSTILE AUDIT — prereg arithmetic: prereg.json × prereg.mjs × KIT_REV5 §2

Audited 2026-08-26, by direct recomputation (exact normal quantiles via NormalDist,
`statistics`), not by trusting either side. Scope: the 8 checks. Files:

- `campaigns/ciswire/prereg.json`
- `scripts/campaign/prereg.mjs`
- `docs/ciswire-rollout/AUDIT_PART3_KIT_REV5.md` §2 (intended numbers)

## Verdict summary

| # | Check | Verdict |
|---|---|---|
| 1 | 15 contrasts | **CONFIRMED** |
| 2 | Holm first α = 0.05/15 | **CONFIRMED** (0.0033 is a rounded display; see nit) |
| 3 | δ80 = 2.802σ√(2/n); 0.81 / 1.14 / 1.62 / 2.29 σ | **CONFIRMED** |
| 4 | Holm first-rank 3.777 → 1.09 / 1.54 σ | **CONFIRMED** |
| 5 | `z_{0.05/(2·15)}` comment | **CONFIRMED** (number right; it is both, see text) |
| 6 | provisional σ 0.082 / 0.35 | **CONFIRMED** (with a rounding-tier kit nit) |
| 7 | nPooled=24, nVariant=12 | **CONFIRMED** |
| 8 | off-by-one in holmAlphas | **NONE FOUND** (both repo Holm impls correct) |
| — | Kit §2 "+5 pp → 25/45/74 %" and F7 "74 %/45 %" | **REFUTED** — true powers 18/32/56 % |

Bottom line: the code and prereg.json are arithmetically sound. The kit's own §2
contains one internally-fabricated power row that F7 then quotes. One coverage gap in
`selftest.mjs`.

---

## 1. 3 factors × 5 axes = 15 contrasts — CONFIRMED

`scripts/campaign/prereg.mjs:10-11`:
`export const FACTORS = ["compaction", "memory", "toolhelp"];`
`export const PRIMARY_AXES = ["echo-rate", "hedge-rate", "drift", "tool-call-rate", "recall"];`

`primaryContrasts()` (lines 21-30) emits the full cross product. Executed:

```
contrasts count: 15
unique factor×axis pairs: 15   (no duplicates)
```

`prereg.json` `"m": 15` ✓; `HOLM_M = 15` ✓; selftest asserts `contrasts.length === 15` ✓.
Axis names match kit §4 item 4 verbatim. No defect.

## 2. Holm first-rank α — CONFIRMED

`prereg.mjs:13`: `export const HOLM_FIRST_ALPHA = 0.05 / HOLM_M;`
`prereg.mjs:34-36`: holmAlphas rank formula `alpha / (m - i + 1)`.

Computed:

```
HOLM_FIRST_ALPHA            = 0.0033333333333333335  (= 0.05/15)
holmAlphas()[0]             = {rank:1, alpha:0.0033333333333333335}
holmAlphas()[14]            = {rank:15, alpha:0.05}
```

Kit's 0.0033 is the 4-dp truncation of 0.003333… — consistent as display.

**Nit:** `prereg.json:7` stores `"holmFirstAlpha": 0.0033` (rounded) while the code
computes 0.0033333…, and *nothing ever reads the JSON field* (grep: only the selftest
demands `HOLM_FIRST_ALPHA === 0.05/15`). Harmless today; a two-source drift trap if a
report quotes the JSON. The two disagree in the 4th decimal (α=0.0033 → z=2.9391 vs
2.9352 if ever used for a floor).

## 3. δ80 two-sided α=0.05 — CONFIRMED

Formula is the standard two-sample z-test sample size: δ = (z_{1−α/2} + z_{0.80})σ√(2/n).
Exact quantiles: z_0.025 = 1.959964, z_0.80 = 0.841621, sum = **2.801585** → code's
`Z80_A05 = 2.802` (`prereg.mjs:16`) is the correct 3-dp rounding.

| n | exact (2.801585) | code (2.802) | kit §2 |
|---|---|---|---|
| 3 | 2.2875σ | 2.2878σ | 2.29σ ✓ |
| 6 | 1.6175σ | 1.6177σ | 1.62σ ✓ |
| 12 | 1.1437σ | 1.1439σ | 1.14σ ✓ |
| 24 | 0.8087σ | 0.8089σ | 0.81σ ✓ |

All four kit values match at 2 dp; code drift from exact is ≤0.0003σ (0.04 %).

## 4. Holm first-rank δ80 — CONFIRMED

Kit: "detectable δ80 = 1.09σ pooled / 1.54σ per variant" (§2, Holm line; also F6).
Code: `Z80_HOLM_FIRST = 3.777` (`prereg.mjs:18`), consumed at lines 56-57:

```
holmFirstPooledSigma  = Z80_HOLM_FIRST * Math.sqrt(2/nPooled)   // 3.777·√(2/24)
holmFirstVariantSigma = Z80_HOLM_FIRST * Math.sqrt(2/nVariant)  // 3.777·√(2/12)
```

Is 3.777 the right z_{α/2}+z_0.80 for α=0.05/15 two-sided? Yes:

```
z_{0.05/(2·15)} = z_{0.0016667} = 2.935199
+ z_0.80                      = 0.841621
sum                           = 3.776821 → 3dp: 3.777 (code diff: -0.000179)
```

Computed floors:

```
holmFirstPooledSigma  = 1.090326σ  (exact: 1.0903σ)  → kit 1.09σ ✓
holmFirstVariantSigma = 1.541954σ  (exact: 1.5419σ)  → kit 1.54σ ✓
```

Absolute pp floors at the provisional σ (code output): echo/hedge/drift/tool at σ=0.082:
pooled 8.94 pp, per-variant 12.64 pp; recall at σ=0.35: pooled 38.16 pp, per-variant
53.97 pp. (Kit doesn't print these; they're derivable and consistent.)

Sanity: kit's other Holm family m=90 → 1.24σ / 1.75σ also checks (z=4.294,
1.2396σ / 1.7530σ).

## 5. The `z_{0.05/(2·15)}` comment — CONFIRMED, and it is both Holm and Bonferroni

`prereg.mjs:17-18`:
`/** z_{0.05/(2·15)} + z_{0.80} ≈ 2.935 + 0.842 */`
`export const Z80_HOLM_FIRST = 3.777;`

`z_{0.05/(2·15)}` is the per-tail quantile of α=0.05/15. Holm's rank-1 threshold is
α/m = 0.05/15 — **numerically identical to Bonferroni's per-test α**, which applies
α/m to every rank. So at rank 1 the two procedures coincide and the comment's number
is correct for both; "Holm" is the honest label (ranks ≥2 use larger α, so this is the
binding constraint, i.e. the conservative family floor — the right thing to pin a δ80
to). Number verified: 2.935199 + 0.842 = 3.777 (exact sum 3.776821, rounds to 3.777).

No defect. Pedantic caveat only: applying 3.777 to *all* 15 contrasts overstates the
required δ for ranks ≥2 (their α is larger) — but the code labels it first-rank only.
Fine as written.

## 6. Provisional σ — CONFIRMED (one kit rounding-tier nit)

`prereg.json:22-26`: echo/hedge/drift/tool-call 0.082, recall 0.35.
Kit §2: "p=0.2 → sd 0.082"; "δ=+0.635 vs σ∈{0.083, 0.2, 0.35}"; C1 "σ≤0.35 measured".

```
√(0.2·0.8/24) = 0.081650 → 0.082   ✓ (matches kit p=0.2 row; uses 24 turns, and
                                     ciswire.json "turns": 24 ✓)
0.35 = measured recall σ (kit C1 / KALSA §6)   ✓; note it is NOT √(p(1−p)/24)
                                     (impossible: p(1−p)=2.94 > 0.25) — it's an
                                     empirical σ, correctly marked provisional
```

Kit pp-table nit: §2 prints 6.6/9.3/13.2/18.7 pp and CI ±9.2 pp — those come from
**unrounded** σ=0.08165 with exact z (6.60/9.34/13.21/18.68; CI n=6: 9.24 pp) while
the sd row above them shows the rounded 0.082. With the code's actual σ=0.082 the
same cells are 6.63/9.38/13.27/18.76 pp, variant cell rounds to **9.4 vs kit 9.3**,
arm cell **13.3 vs 13.2**, CI n=6 **±9.3 vs ±9.2**. Sub-rounding-tier; not a defect,
but the kit's two-decimal precision is nominal only.

## 7. nPooled=24, nVariant=12 — CONFIRMED, by construction

`ciswire.json`: `"conversations": 6` per arm × 8 arms = 48 conversations;
`"variants"`: 2 (A: winbudget PHASE0, B: default) → 16 arm×variant cells
(`runOrder.cellsFrom`), i.e. 3 conversations per variant per arm.

Full 2³ → each factor level = 4 arms. Per side:

```
pooled:  4 arms × 6 convs = 24 ✓   (matched by code nPooled=24, and kit "n=24/side")
variant: 4 arms × 3 convs = 12 ✓   (matched by nVariant=12)
```

δ80's √(2/n) requires equal n per side — satisfied (4 arms each level; 3+3 within arm).
`prereg.mjs` line 62 (`floors.nPooled || 24, floors.nVariant || 12`) echoes the JSON.
No defect. (Run-order randoms arm×variant *cells*; the 3+3-per-arm split is by
construction, matching the kit's "A/B variants 3+3".)

## 8. Off-by-one — NONE in either Holm implementation

`prereg.mjs:34-36` (1-based rank, i = 1..m): α/(m−i+1) → rank 1 gets 0.05/15, rank 15
gets 0.05 — correct Holm step-down thresholds; selftest pins rank 1 exactly.

`scripts/bench/benchAggregate.mjs:507-521` `holmAdjust` (0-based rank, running max):
`(m - rank) * p` → rank 0 gets m·p, last gets 1·p, with `Math.max(running, …)`
monotonicity — also correct. (Note: this is a *separate*, unconnected Holm path in the
analyzer; neither imports the other — same math, two copies.)

**Coverage gap (recommend fixing):** `selftest.mjs:111-112` asserts HOLM_FIRST_ALPHA and
holmAlphas()[0], and `:120-121` asserts the σ values — but **nothing asserts
`Z80_HOLM_FIRST === 3.777`, the δ80 values, or the 1.09/1.54 σ-multiples** — i.e. the
two constants that encode the campaign's power claims are the only prereg numerics the
harness never verifies. Add: `Math.abs(m.delta80(1,24,m.Z80_HOLM_FIRST) - 1.09) < 0.005`
style checks (or lock the constants' exact values).

---

## REFUTED — kit §2 power row for "+5 pp echo" (and F7's quote of it)

Kit §2: "+5 pp echo at sd 0.082 (0.61σ) → 25 % / 45 % / 74 %." F7: "a real +5 pp
echo-rate shift (0.61σ) → 74 %/45 %."

δ/σ = 0.05/0.082 = 0.6098 ("0.61σ" label is right). True two-sided power
(two-sample z, α=0.05, λ = (δ/σ)/√(2/n)):

```
n= 6: 18.2 %   (kit 25 %)
n=12: 32.0 %   (kit 45 %)
n=24: 56.0 %   (kit 74 %)
```

All three kit figures are unreproducible. The numbers 25/45/74 correspond exactly to
δ/σ = **0.7432 / 0.7489 / 0.7515** — i.e. the row was computed with δ/σ ≈ 0.75, not
0.61. Checked alternatives that also fail: one-sided power gives 27.8/44.0/68.0 %;
t-based power is lower than z, not higher. The row contradicts the same paragraph's
own sd (0.082) and its own 0.5σ row above it (0.5σ → 14/23/41 %, which I reproduce:
13.5/23.0/41.0 % — so the *other* row is right).

Impact direction: F7's argument survives — the corrected numbers make it *stronger*
(56 % instead of 74 % at n=24 means 'no significance' bites even harder at +5 pp) —
but F7's quoted evidence "74 %/45 %" is wrong as printed, and the §2 row misleads
anyone sizing the toolhelp/echo contrasts. Also note the recall-power row in the same
paragraph is clean: σ=0.35 → n=12 power 0.994 (kit "0.99"), n=24 1.000; per-arm n=6
0.881 (kit "0.88"). Permutation floors also clean: 2/C(6,3)=0.1, 2/C(12,6)=0.0021645,
2/C(24,12)=7.396e-7, 2/C(48,24)=6.202e-14.

---

## Annex — exact constants used

```
z_0.025        = 1.959964
z_0.80         = 0.841621
z_0.025+z_0.80 = 2.801585   → display 2.802 (code) — matches kit
z_{0.05/30}    = 2.935199   (comment says 2.935 — right)
z+0.841621     = 3.776821   → display 3.777 (code) — matches kit
√(0.2·0.8/24)  = 0.081650   → 0.082 (code, kit)
3.777·√(2/24)  = 1.090326   → 1.09 (kit)
3.777·√(2/12)  = 1.541954   → 1.54 (kit)
2.802·√(2/24)  = 0.8089     → 0.81 (kit); n=12 1.1439→1.14; n=6 1.6177→1.62; n=3 2.2878→2.29
```

**Verdict:** code and prereg.json pass all 8 checks; the kit's §2 arithmetic is sound
except the "+5 pp → 25/45/74 %" row (should read 18/32/56 %), which F7 then quotes.
Fixes: correct the two power figures in KIT §2 and F7; add Z80_HOLM_FIRST / δ80 /
1.09-1.54 assertions to selftest.mjs; optionally make prereg.json's `holmFirstAlpha`
either exact (0.003333…) or documented as display-only.