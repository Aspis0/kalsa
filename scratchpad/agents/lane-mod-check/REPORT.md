# LANE_MOD equidistribution check — queue item #5 (analysis only, PC-only)

Status: DONE — verdict in §5
Date: 2026-08-21
Constraint: read-only outside this directory; no git commits; no device work.

## 1. What LANE_MOD is (reconstructed from archives)

LANE_MOD is a pattern tag emitted by the **GEMV_AUDIT classifier** inside
`ggml-opencl.cpp` (production GEMV/MUL_MAT_ID in-situ audit, commit lineage
`2bdef5c7d` → `6c822d826` (regressed) → `d77e82347` (current)). Source of
truth read directly at:

- `BigMoeOnEdge/third_party/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp`
  lines 21684–21744 (`kalsa/kernel-s3-repack` lineage, sha of the audited
  build: `acb41c32…` per PLAN-archive / oracle-consumer-review).

What the classifier classifies: for each audited dispatch it reads back dst,
compares against a host double-precision reference dot over dequantized q4_0,
marks rows bad beyond a Higham f32 error bound (`n_bad`), and tags the error
pattern. Tags (ranked): ROUTING_OOB > SIGN_SMEAR > REDUCTION_OR_SCALE >
LANE_MOD > BLOCK_RUNS > ROUTING_EXPERT > ROUTING_SLOT > UNSTRUCTURED.

What LANE_MOD computes (exact algorithm from source):

```
for r in 0..127:                       # residue class of dst-row index i mod 128
    if mod_tot[128][r] < 4: skip       # too few observations
    rt = mod_bad[128][r] / mod_tot[128][r]
    rt >= 0.80        -> n_full_bad += 1
    0.20 < rt < 0.80  -> n_partial += 1
fire LANE_MOD_{period} iff:
    n_partial == 0  and  n_full_bad > 0
    and 128 % n_full_bad == 0
    and period = 128 / n_full_bad >= 2
```

Semantics claimed by the tag: "single-coset lattice at period N" — dst-row
errors hit exactly one residue class `{i ≡ r0 (mod N)}`, the natural shape of
a per-hardware-lane defect.

## 2. The known gap (why this check exists)

The inference counts fully-bad residues but **ignores their spacing**. It is
only valid when the fully-bad set is one equidistributed coset
`{r0 + k·period}`. Two deterministic counterexamples were identified at
final-check of `d77e82347` (oracle-consumer-review REPORT.md, §"Residual
mislabel"), deferred to before session-2 with the note "~10 lines":

1. **Contiguous band**: rows 32..63 of every 512-row window → residues
   {32..63} fully bad → n_full_bad=32 → **fires LANE_MOD_4** (false period-4
   claim; co-fires BLOCK_RUNS).
2. **Union of two offset mod-64 classes** (rows ≡ k1 and k2 mod 64, k1≢k2):
   4 fully-bad residues at mod 128 → **fires LANE_MOD_32**, no contradicting
   tag — indistinguishable from a genuine period-32 lattice.

## 3. Method

Script: `lane_mod_check.py` (this directory), output in `OUTPUT.txt`.
Read-only over the archive; no device, no engine changes.

- **Part A — empirical replay**: parsed every `GEMV_AUDIT{…}` case line in
  `results/oracle_consumer_s23/` (run5–run10 logs + `_extract_r9r10.txt`).
- **Part B — construction check**: faithful Python reimplementation of the
  LANE_MOD block exactly as in the C source (thresholds 0.80/0.20/tot≥4,
  guards `n_partial==0`, `128%n==0`, `period≥2`), replayed over synthetic
  dst-row maps at m=512 (the geometry of every archived case): six nominal
  single-coset lattices, the two adversarial classes named in the review,
  a third adversarial class found during this check, and the four guard
  cases. On top of the current classifier, the proposed equidistribution
  gate was run: *every cyclic gap between consecutive fully-bad residues
  must equal the inferred period* (single-coset test).

## 4. Results

### Part A — real device data

| metric | value |
|---|---|
| GEMV_AUDIT case lines archived | 76 (6 logs × 12 + 4 in extract) |
| cases with n_bad > 0 | **0** |
| patterns other than `ok` | **0** |
| LANE_MOD firings on device data | **0** |
| m values | 512 only |

Every archived dispatch is clean (`max_abs` ≈1.5–2.3e-6, well inside the
Higham bound). In run9/run10 the outer MUL_MAT_ID harness FAILs
(ERR≈0.35–0.58) while the inner audit is clean — the binding defect was
glue-side, confirming the PLAN-archive step-3 verdict. Independent
corroboration: `scratchpad/agents/evidence-audit/REPORT.md` line 99 reports
the identical all-clean parse.

### Part B — classifier vs classifier+eq-gate (synthetic replay)

| map | current tag | eq-gate | note |
|---|---|---|---|
| single-coset p∈{4,8,16,32,64,128} | correct LANE_MOD_N | PASS | tag kept |
| contiguous 32-row band tiled @128 rows | **LANE_MOD_4** | FAIL | false tag; gaps = 1×31 + 97; BLOCK_RUNS co-fires (discountable) |
| union of two offset mod-64 classes {3,40} | **LANE_MOD_32** | FAIL | false tag; gaps 37/27 alternating; **no contradicting tag** |
| union of two offset mod-32 classes {7,19} | **LANE_MOD_16** | FAIL | false tag (NEW, this check); gaps 12/20; no contradicting tag |
| 3 non-divisor residues / partial-rate / all-bad / clean | none | – | existing guards hold under both versions |

All three false-tag classes are deterministic and reproduce exactly; the
~10-line gap-equality gate suppresses all three while keeping every nominal
tag. The shipped source contains no spacing logic (verified: the LANE_MOD
block counts only). The dual-mod-32 union (ADVERSARIAL-3) is a third silent
mislabel class not in the original two-item list — same mechanism, one more
level down.

## 5. VERDICT: **BIASED (by construction) — reusable only as a single-coset hint, not as an exclusive period verdict**

Two facts drive this:

1. **The bias is proven, not suspected.** The classifier ignores residue
   spacing; three deterministic pattern classes produce confident false
   period tags (band→MOD_4, dual-64→MOD_32, dual-32→MOD_16), two of them
   silently. If session-2 hits any non-single-coset dst pattern, LANE_MOD_N
   would point the investigation at a lane period that does not exist — the
   exact failure mode the d77e82347 final-check flagged and deferred.
2. **Empirical equidistribution is unmeasurable from the archive.** Zero
   positive samples exist (76/76 clean cases); nothing in the device data
   validates OR refutes the tag in the field. The measured "skew" here is
   by-construction, established on a faithful reimplementation verified
   against the C source, not against firing logs.

### Conditions for reuse in session-2 (any one suffices)

- **Preferred:** land the ~10-line equidistribution gate before session-2
  (all cyclic gaps == inferred period, else suppress the LANE tag and let
  BLOCK_RUNS/UNSTRUCTURED speak). Verified here to remove all three false
  classes with zero nominal regressions. Fresh sha + re-verify per campaign
  rules.
- **Fallback (no code change):** keep the binding session-1 reading rules —
  grep `^GEMV_AUDIT_NOTE` first; read `LANE_MOD_N` strictly as "single-coset
  lattice at period N"; discount any MOD tag co-fired with BLOCK_RUNS;
  treat ratio_clusters + raw dumps as the decision channel.

### What session-2 must collect so this becomes empirically checkable

The archived logs carry only summary fields (`n_bad`, `pattern`, rates);
per-residue counters (`mod_tot[]`/`mod_bad[]`) are never dumped. Session-2
should, for every n_bad>0 case: dump the full bad-row index list (or the
128-entry residue table) alongside the tag, so tags can be re-derived and
gap-checked offline — that would convert this verdict from by-construction
into empirical.


---

## ERRATUM (owner arbitration post-audit, 2026-08-22)

The hostile audit (AUDIT.md) CONFIRMS the core BIASED verdict but REFUTES the
sufficiency of the proposed gap-equality gate: it kills the three classes found
here but MISSES threshold-boundary unions and i20/slot-dependent unions.
Binding consequences for session-2:
1. LANE_MOD_N remains a single-coset HINT, never an exclusive verdict — with
   or without the gate.
2. The gate may be landed as hardening only; it must not be cited as proof of
   tag correctness.
3. The decision channel is the raw dump (bad-row indices or 128-entry residue
   table per failing case) — this is a session-2 REQUIREMENT, with explicit
   handling of dump size limits (see AUDIT.md).
