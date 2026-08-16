# F5 Measurement-Claim Audit — final-c (revised)

Audit angle: **are the quantitative claims in REPORT.md, STATUS.txt, and the spec
supported by the raw logs and code?** Three prior audits (0b725d3, d31ad8d, 2a7f365)
found real code/logic defects. This audit checks whether the *numbers the report
presents as measured* trace back to artifacts that actually say what the report
claims.

---

## C1. CONFIRMED (severity 2) — the report's non-alpha performance values come from run 4; the surviving .out.log files are from run 5; the two runs produce different numbers for everything except alpha

**Files:** `REPORT.md`, `p0_plain.out.log`, `p1_freeze_off.out.log`, `p2_freeze_on.out.log`,
`STATUS.txt`

The .out.log files in `results/selfspec_f5_pc/` are from run 5 (STATUS.txt timestamp
07:44:07, git_rev not pinned for run 5 but the err.log shows the same context layout).
The report's performance numbers come from run 4 (07:35, git_rev=d31ad8d). The two
runs produce different values for every metric *except* the selfspec acceptance
counts:

| metric | report (run 4) | .out.log (run 5) | match? |
|---|---|---|---|
| p0 decode s/tok | 0.167 | 0.170 | ✗ (1.8% diff) |
| p0 tok/s | 5.99 | 5.894 | ✗ (1.6% diff) |
| p1 decode s/tok | 0.397 | 0.397 | ✓ |
| p1 alpha | 51/594 = 8.6% | 51/594 = 8.6% | ✓ |
| p1 tok/verify | 1.25 | 1.25 | ✓ |
| p1 effective tok/s | 1.33 | 1.33 | ✓ |
| p1 prefill | 37.0 s | 39.194 s | ✗ (5.9% diff) |
| p2 decode s/tok | 0.291 | 0.292 | ✗ (0.3% diff) |
| p2 alpha | 126/512 = 24.6% | 126/512 = 24.6% | ✓ |
| p2 tok/verify | 1.97 | 1.97 | ✓ |
| p2 effective tok/s | 1.82 | 1.81 | ✗ (0.5% diff) |
| p2 prefill | 37.1 s | 39.018 s | ✗ (5.1% diff) |
| p0 model load | 6.2 s | 6.387 s | ✗ (3.0% diff) |
| p1 model load | 6.7 s | 6.825 s | ✗ (1.9% diff) |
| p2 model load | 6.1 s | 5.894 s | ✗ (3.4% diff) |

The selfspec acceptance counts (51/594 and 126/512) are **bit-identical** across
run 4 and run 5. This is the expected signature of deterministic greedy decoding
on the same model/prompt — the alpha is a function of the model's routing decisions,
not of system timing. The timing-dependent metrics (decode s/tok, prefill, model
load) vary between runs because they depend on system load, cache state, and I/O
conditions.

The .out.log files are correctly labeled — p1_freeze_off.out.log contains freeze-OFF
data (51/594), p2_freeze_on.out.log contains freeze-ON data (126/512). The filename-
to-content mapping is correct.

**Verdict: CONFIRMED.** The alpha values are independently verified from the current
.out.log files. The timing values are not — they come from run 4's overwritten logs.
The report mixes run 4's timing with run 5-confirmed alpha values without noting the
provenance difference.

---

## C2. CONFIRMED (severity 2) — "bit-identical acceptance counts across two binaries" is now partially supported by surviving artifacts, but the second binary's run has no STATUS.txt

**Files:** `REPORT.md` (Result 2), `run1/p2_freeze_on.out.log`

The report claims: "Run 1 used `08d16910…` (rev `d31ad8d`), run 2 used `524973b8…`
(rev `2a7f365`): acceptance counts **bit-identical** (51/594 and 126/512)."

Evidence now available:
- `run1/p2_freeze_on.out.log` (run 1, 0b725d3): `selfspec: 126/512 drafts accepted
  (24.6% = alpha)` ✓ — matches the report.
- `p2_freeze_on.out.log` (run 5, current directory): `selfspec: 126/512 drafts accepted
  (24.6% = alpha)` ✓ — matches.
- `p1_freeze_off.out.log` (run 5): `selfspec: 51/594 drafts accepted (8.6% = alpha)` ✓
  — matches.
- The "run 2" binary (2a7f365) has no surviving STATUS.txt or .out.log. Its data exists
  only in the report's assertion.

The cross-binary claim is now supported by run 1's surviving .out.log (126/512 matches)
and by run 5's .out.log (both values match). The 2a7f365 binary's specific run is still
unverifiable, but the *claim* that the counts are stable across binaries is corroborated
by three independent runs (run 1 at 0b725d3, run 4 at d31ad8d, run 5 at an unknown rev)
producing the same acceptance counts.

**Verdict: CONFIRMED** that the 2a7f365 run is unverifiable; **partially refuted** as a
measurement-claim problem because the surviving artifacts (run 1, run 5) corroborate
the bit-identical claim independently.

---

## C3. CONFIRMED (severity 2) — the freeze's contribution to the alpha gain is misrepresented; the gain comes from the n_rs_seq=0 seq_rm failure, not from freezing the recurrent state

**Files:** `REPORT.md` (Result 2, "Why the freeze buys acceptance"),
`run_p1p2.ps1` (arm definitions)

The report states: "The alpha gain is not a bonus, it is the removal of a silent
state defect." This attributes the 2.9× alpha improvement to freezing the
recurrent state. The actual mechanism is different:

1. **p1 (freeze OFF)** has `n_rs_seq = draft_max = 4`. The draft context has 4
   snapshot planes. After a rejected cycle, `seq_rm` can rewind through the
   snapshots and restore the recurrent state to s_{t0}. The draft context
   conditions on a restored (but E4-showed-to-be-wrong) state.

2. **p2 (freeze ON)** has `n_rs_seq = 0`. The draft context has zero snapshot
   planes. After a rejected cycle, `seq_rm` tries to rewind but `rollback > 0`
   with `n_rs_seq = 0` returns false → the hybrid rm short-circuits →
   `llama_memory_clear` fires → full wipe → the next cycle rebuilds from scratch.

The p2 path's alpha gain comes from the **full wipe and rebuild** on every
rejection, not from the freeze mechanism. The freeze mechanism itself is defeated
by graph reuse (Audit R1, commit 2a7f365): `FreezeGuard` restores the store ops
on exit, the next draft's graph is reused without rebuilding, and the frozen
decode only engages on the first draft of each cycle (the only one that triggers
a graph rebuild). Drafts 2..γ are genuinely unfrozen.

The report's causal narrative — "with the freeze on there is no rewind at all:
the live row *is* s_{t0} by construction" — is true for the first draft of the
first cycle only. After the first rejection, the live row has been wiped and
rebuilt, so subsequent drafts condition on a *rebuilt* state, not s_{t0}. The
report does not mention the R1 finding (graph reuse defeats the freeze) or
acknowledge that the observed alpha difference is between two *architectural*
paths (snapshot-based rewind vs. clear+rebuild), not between frozen and unfrozen
recurrent states.

**Verdict: CONFIRMED.** The alpha attribution is misleading. The 2.9× gain is
real and measured, but its cause is the n_rs_seq=0 seq_rm failure forcing full
rebuilds, not the freeze mechanism per se. The report should state this
explicitly and note the R1 finding.

---

## C4. CONFIRMED (severity 3) — the report's prefill and model-load timing values are from run 4; the surviving .out.log files show different values from run 5

**Files:** `REPORT.md` (Result 3 retraction, Result 1 table), `.out.log` files

The report's retracted speed table and the Result 1/Result 3 tables quote prefill
and model-load values from run 4:

| metric | report (run 4) | .out.log (run 5) |
|---|---|---|
| p0 prefill (293 tok) | 19.1 s | 20.159 s (304 tok) |
| p1 prefill | 37.0 s | 39.194 s |
| p2 prefill | 37.1 s | 39.018 s |
| p0 model load | 6.2 s | 6.387 s |
| p1 model load | 6.7 s | 6.825 s |
| p2 model load | 6.1 s | 5.894 s |

Note the token count difference: the report says "293 tok" for the prefill, but
the .out.log files show 304 tokens. The prompt is the same file (`p_longfact.txt`);
the difference is in how the chat template wraps it (the `--chatml --no-think`
flags add system/user/assistant markers that tokenize to ~11 extra tokens).

The report's prefill-doubling claim (+94%) uses run 4's values (37.0/19.1 = 1.937×
= +93.7%). The .out.log values from run 5 show 39.194/20.159 = 1.944× = +94.4%.
The claim holds either way.

**Verdict: CONFIRMED** as a provenance issue. The specific timing numbers are from
run 4's overwritten logs. The qualitative claims (prefill doubles, selfspec is
slower) are supported by run 5's data.

---

## C5. CONFIRMED (severity 3) — the prefill I/O figures (188.8 MiB / 420.3 MiB) are from the retracted 1-token runs and are not in any surviving log

**File:** `REPORT.md` (Result 3)

The report states: "p0 read 188.8 MiB for its single step, p1 420.3 MiB." The
current .out.log files show cumulative I/O for 256-token runs:

- p0: `moe-stream: read 12734.2 MiB (49.74 MiB/token)`
- p1: `moe-stream: read 51775.5 MiB (202.25 MiB/token)`
- p2: `moe-stream: read 32833.5 MiB (128.26 MiB/token)`

The 188.8 / 420.3 MiB figures must come from the retracted 1-token runs (run 2
or run 3), whose .out.log files were overwritten. The claim that "prefill nearly
doubles" is supported by the prefill *time* doubling, but the specific MiB figures
are unverifiable.

**Verdict: CONFIRMED.** The I/O figures are from overwritten logs. The doubling
claim is supported by the timing data.

---

## C6. PLAUSIBLE (severity 3) — the "F1 published loop alpha 0.117" comparison uses a different binary, prompt, and run

**File:** `REPORT.md` (Result 2: "Freeze-OFF reproduces F1's published loop alpha")

The report states freeze-OFF alpha 8.6% "reproduces F1's published loop alpha
(0.117 pooled window on the same prompt family)." The 0.117 figure is from the
F1 report on a different binary, possibly different prompt file, and a different
session. 8.6% vs 11.7% is a 27% relative difference. The report calls this a
"reproduction" — the direction is the same (both are low), but the magnitudes
differ enough that the claim is weaker than stated.

**Verdict: PLAUSIBLE** as a qualitative consistency check; **not a statistical
reproduction** in any formal sense.

---

## C7. CONFIRMED (severity 3) — the report omits the R1 finding (graph reuse defeats the freeze) from its "What these arms could NOT catch" section

**File:** `REPORT.md` ("What these arms could NOT catch")

The report's honesty section correctly flags the chat-mode trim bug. It does not
mention Audit R1's finding that the freeze mechanism is defeated by graph reuse
on the live loop — draft 1 rebuilds (frozen), drafts 2..γ reuse (unfrozen). This
is directly relevant to Result 2's causal narrative.

**Verdict: CONFIRMED.** The "could NOT catch" section should list R1.

---

## C8. CONFIRMED (severity 4) — the "mechanism" paragraph in Result 2 implies the freeze is active for all drafts; it is active for the first only

**File:** `REPORT.md` (Result 2, "Why the freeze buys acceptance")

"With the freeze on there is no rewind at all: the live row *is* s_{t0} by
construction." This is true for draft 1 of each cycle (the only decode that
triggers a graph rebuild and engages the FreezeGuard). For drafts 2..γ, graph
reuse means the store ops are restored (unfrozen) and the recurrent state
advances.

**Verdict: CONFIRMED.** The mechanism description is accurate for one draft per
cycle and misleading for the others.

---

## C9. CONFIRMED (severity 4) — the report does not note that the .out.log files are from a different run than the report's timing data

**File:** `REPORT.md` (all tables)

The report presents a single table with timing values from run 4 and alpha values
confirmed by run 5's .out.log files. It does not note that the timing and alpha
data come from different runs. A reader checking the .out.log files would find
different timing values (5-6% higher prefill, 1.6% slower p0 decode) and might
conclude the report is wrong, when in fact both are correct for their respective
runs.

**Verdict: CONFIRMED.** The report should note the run provenance of each value
or use values from a single run consistently.

---

## C10. CLEAN — RAM claim (Result 1)

**Files:** `p1_freeze_off.err.log`, `p2_freeze_on.err.log`, `p0_plain.err.log`

| claim | log value | status |
|---|---|---|
| p1 RS buffer = 314.06 MiB (n_rs_seq=4) | `CPU RS buffer size = 314.06 MiB (1 seqs 4 rs_seq)` | ✓ |
| p2 RS buffer = 62.81 MiB (n_rs_seq=0) | `CPU RS buffer size = 62.81 MiB (1 seqs 0 rs_seq)` | ✓ |
| p0 RS buffer = 62.81 MiB | `CPU RS buffer size = 62.81 MiB (1 seqs 0 rs_seq)` | ✓ |
| saving = 251.25 MiB | 314.06 − 62.81 = 251.25 | ✓ |
| formula: (n_rs_seq+1) × 62.81 | (4+1)×62.81 = 314.05 ≈ 314.06 | ✓ |
| peak RSS delta ≈ −260 MiB | 6176.4 − 5916.0 = 260.4 (run 2); 6176.3 − 5915.9 = 260.4 (run 3) | ✓ |
| bit-stable across 322-line diff | 6176.4/6176.3 and 5916.0/5915.9 (0.1 MiB) | ✓ |

The RAM claim is measured from the engine's own allocator output. The err.log
values are from run 5's current logs, which show the same n_rs_seq values as
the earlier runs (the model and context parameters are unchanged).

**Verdict: CLEAN.**

---

## C11. CLEAN — alpha values independently verified

**Files:** `p1_freeze_off.out.log`, `p2_freeze_on.out.log`, `run1/p2_freeze_on.out.log`

| claim | .out.log (run 5) | run1 .out.log (run 1) | report | match |
|---|---|---|---|---|
| p1 alpha | 51/594 = 8.6% | — | 51/594 = 8.6% | ✓ |
| p2 alpha | 126/512 = 24.6% | 126/512 = 24.6% | 126/512 = 24.6% | ✓ |
| p1 tok/verify | 1.25 | — | 1.25 | ✓ |
| p2 tok/verify | 1.97 | 1.97 | 1.97 | ✓ |

The alpha values are confirmed by three independent runs across at least two
different binaries (0b725d3 in run 1, d31ad8d in run 4, unknown in run 5).

**Verdict: CLEAN.**

---

## C12. CLEAN — retraction of the speed table (Result 3)

The retraction is honest and complete. The runner now has a validity gate
(`MIN_TOKENS = 200` in `run_p1p2.ps1`). The retracted numbers appear nowhere
else in the surviving documents.

**Verdict: CLEAN.**

---

## C13. CLEAN — prefill doubling claim

The .out.log files from run 5 show:
- p0: prefill = 20.159 s
- p1: prefill = 39.194 s (+94.4%)
- p2: prefill = 39.018 s (+93.5%)

The report's +94% is supported by both run 4 and run 5 data.

**Verdict: CLEAN.**

---

## C14. CLEAN — "nop'd 0 store nodes" canary never appears

grep across all err.log files: 0 matches. Confirmed.

**Verdict: CLEAN.**

---

## C15. CONFIRMED (severity 4) — the report's effective tok/s figures are self-consistent but mix decode time and draft overhead in a way that obscures the cost breakdown

**Files:** `REPORT.md` (Result 2 table), `.out.log` files

The report lists:
- p1: decode 0.397 s/tok, effective 1.33 tok/s
- p2: decode 0.291 s/tok, effective 1.82 tok/s

The .out.log files clarify the breakdown:
- p1: decode 0.397 s/tok, draft overhead 0.3548 s/token → effective 1/(0.397+0.355) =
  1/0.752 = 1.33 tok/s ✓ (but the "decode" includes draft cost already — the
  selfspec line says "drafting costs 0.3548 s/token on top of decode")
- p2: decode 0.292 s/tok, draft overhead 0.2591 s/token → effective 1/(0.292+0.259) =
  1/0.551 = 1.81 tok/s ✓

The effective tok/s calculation is correct. But the report's table presents
"decode s/tok" and "effective tok/s" as if they were independent measurements,
when effective = 1/(decode + draft_overhead). The draft overhead is not in the
report's table — a reader cannot reproduce the effective tok/s from the table
alone without knowing the draft cost.

**Verdict: CONFIRMED** (presentation issue). The table should include draft
overhead or show the formula explicitly.

---

## Summary, ranked by severity

| # | severity | finding | verdict |
|---|---|---|---|
| C1 | 2 | report's timing values from run 4; .out.log from run 5; differ 1-6% | CONFIRMED |
| C2 | 2 | 2a7f365 binary run unverifiable; but 3 independent runs corroborate alpha | CONFIRMED (partially refuted) |
| C3 | 2 | alpha gain attributed to freeze; actual cause is n_rs_seq=0 seq_rm failure | CONFIRMED |
| C4 | 3 | prefill/model-load timing from overwritten run 4 logs | CONFIRMED |
| C5 | 3 | prefill I/O figures (188.8/420.3 MiB) from overwritten 1-token runs | CONFIRMED |
| C6 | 3 | "reproduces F1's 0.117" is qualitative, not statistical | PLAUSIBLE |
| C7 | 3 | R1 finding (graph reuse defeats freeze) omitted from "could NOT catch" | CONFIRMED |
| C8 | 4 | mechanism paragraph implies freeze active for all drafts; first only | CONFIRMED |
| C9 | 4 | report doesn't note .out.log files are from a different run | CONFIRMED |
| C10 | — | RAM claim (RS buffer sizes) | CLEAN |
| C11 | — | alpha values independently verified (3 runs, 2+ binaries) | CLEAN |
| C12 | — | retraction of speed table | CLEAN |
| C13 | — | prefill doubling claim | CLEAN |
| C14 | — | canary string absent | CLEAN |
| C15 | 4 | effective tok/s table omits draft overhead; not reproducible from table alone | CONFIRMED |

**What is solid:** the RAM allocation claim (314.06 / 62.81 / 251.25 MiB), the
alpha values (51/594 = 8.6% and 126/512 = 24.6%, confirmed by 3 independent runs),
the retraction, the prefill doubling, and the canary absence.

**What is problematic:** the causal attribution of the alpha gain (C3 — the gain
comes from n_rs_seq=0 seq_rm failure, not the freeze mechanism), the missing R1
finding (C7 — graph reuse defeats the freeze), the mixed run provenance of timing
vs. alpha data (C1, C4, C9), and the unverifiable I/O figures (C5).

DONE
