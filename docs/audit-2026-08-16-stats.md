# HOSTILE AUDIT C — statistics, pre-registration discipline, measurement method

Repo: `C:\Users\gualt\Desktop\Kalsa\moe-experiments` (branch `main`, 7 commits ahead of origin)
Date of audit: 2026-08-16
Method: every number below was recomputed from the raw CSVs with python/scipy
(1.17.1); every pre-registration date was checked against `git log` commit times
and the timestamps inside the data files. Nothing was edited in the repo.

---

## One-paragraph verdict

**The two shipped claims are arithmetically correct — I recomputed both and they
hold.** S23: median 0.2585 → 0.1480 s/tok (−42.75%), all 12 pairs favor B, W=0,
exact two-sided p = 2/2¹² = 0.000488, Hodges–Lehmann (B−A) = −0.10825 s/tok
(bootstrap 95% CI −0.1115…−0.1030), Cohen's dz = 12.6. Xiaomi: median 0.368 →
0.3145 (−14.54%), W=0 on 11 effective pairs after dropping the one exact tie,
p = 2/2¹¹ = 0.000977, HL −0.05625 (95% CI −0.0705…−0.0410), dz = 2.13. The
pairing matches the PREREGs (verified AB/BA alternation in every cell), the
exact-test floors match the effective Ns, and the xiaomi report's explanation
of the 11-vs-12 floor discrepancy is exactly right. The xiaomi replication is a
model of pre-registration discipline (PREREG committed 02:18, four hours before
staging; all three amendments committed before data; kill conditions honored;
analyzer untouched). The S23 cell is where the discipline breaks: its PREREG was
first committed 23:27 on 14-Aug — **after two discarded sessions had already
run** — session 2's raw data exist nowhere in the repo, the file attributes
session 1's exclusion to two mutually exclusive causes, the declared "screen
state logged every run" was silently never logged, and the energy axis
(metric 3, the one RED axis, shipped as "+11.8% disclosed") was measured by a
sampler that recorded physically impossible values. **The confirmatory p-values
stand; the surrounding pre-registration narrative for the S23 cell does not, and
the energy axis on the S23 should not be quoted as a measurement.**

---

## Section 1 — the two shipped claims: recomputed

### 1.1 kernel_ship_ab_s23/device (the claim: −42.7%, W=0, p=0.000488, N=12)

Recomputed from `results/kernel_ship_ab_s23/device/runs.csv`, 24 measured runs,
paired per the PREREG rule (adjacent A/B within ABBA pair):

| | claim | recomputed | verdict |
|---|---|---|---|
| median A / B s/tok | 0.2585 / 0.1480 | 0.2585 / 0.1480 | CONFIRMED |
| % change | −42.7% | −42.75% | CONFIRMED |
| W (two-sided) | 0 | 0 | CONFIRMED |
| p | 0.000488 | 0.00048828 = 2/2¹² | CONFIRMED (exact floor, N=12, no ties) |
| HL (B−A) | −0.10825 | −0.10825 | CONFIRMED |

Pair differences (A−B), all positive: 0.093, 0.125, 0.110, 0.107, 0.110, 0.110,
0.111, 0.116, 0.098, 0.108, 0.106, 0.098. Cohen's dz = 12.6 (mean diff 0.1077,
sd 0.0085). This is not a borderline result; the arm separation is ~4–8× the
within-arm run-to-run spread.

The screen-on session (`screenon/runs.csv`, exploratory): −41.28%, W=0,
p=0.000488, 12/12 — recomputed, same result, on an independent second sample.

### 1.2 kernel_ship_ab_xiaomi (the claim: −14.5%, W=0, p=0.000977, N=12 with 1 tie → 11 effective)

Recomputed from `results/kernel_ship_ab_xiaomi/runs.csv`:

| | claim | recomputed | verdict |
|---|---|---|---|
| median A / B | 0.368 / 0.3145 | 0.368 / 0.3145 | CONFIRMED |
| % change | −14.5% | −14.54% | CONFIRMED |
| W | 0 | 0 (after dropping the tie) | CONFIRMED |
| p | 0.000977 | 0.00097656 = 2/2¹¹ | CONFIRMED — and the REPORT's claim that this is the N=11 floor, **not** the N=12 floor of 0.000488, is correct |
| HL (B−A) | −0.05625 | −0.05625 | CONFIRMED |

Pair 3 is an exact tie at the harness's 4-decimal resolution (A = B = 0.2940).
scipy `wilcoxon(zero_method='wilcox')` drops zeros → W=0 on 11 pairs. I checked
the tie-handling sensitivity: the two-sided p stays ≈0.001 under any reasonable
zero policy (all 11 non-zero differences favor B), so the choice does not affect
the verdict. **The tie handling is arithmetically correct.** It was **not
declared in advance** — the xiaomi PREREG's analysis section is silent on
zero-differences; the REPORT discloses it post-hoc, explicitly and correctly
(it even pre-empts the "recompute the floor from N=12" discrepancy). The
kf_cold_jelly PREREG (written 3 h later) does declare the tie policy — the
campaign fixed the gap, but the xiaomi cell itself did not pre-declare it.

### 1.3 Both claims: what is defensible after recomputation

The confirmatory numbers are exactly as shipped. Verified pairing (AB BA AB BA
... AB in both runs.csv files), verified exact floors, verified HL and % change.
**REFUTED** as arithmetic errors: I attacked them and they held.

---

## Section 2 — pre-registration discipline (git vs data timestamps)

### 2.1 kernel_ship_ab_s23 — BROKEN (highest-severity finding)

Git history of `results/kernel_ship_ab_s23/PREREG.md` has exactly **one**
commit: `da9fa34`, **2026-08-14 23:27:38**. That commit *is* "amendment 2". The
analyzed (v3) session's log starts 23:27:15 and its first measurement (warmup)
completes 23:28:13 — so the PREREG was technically committed ~55 s before the
analyzed data. But the experiment had already started hours earlier:

| event | time |
|---|---|
| push + start session 1 (misconfig) | 17:00:03 (push.log) |
| session 1 runs (misconfig_session1/runs.csv) | 17:03–18:25 |
| push + start session 2 | 18:29:34 (push.log) |
| session 2 suspended "with root cause" | 20:56 (commit a65cc02, touches only PLAN.md) |
| **PREREG first committed (already containing amendments 1 and 2)** | **23:27:38** |
| v3 session (the committed data) | 23:28–23:49 |

Three consequences:

1. **The claim "Registered: 2026-08-14, BEFORE any run of this experiment" is
   not git-verifiable, and the git record contradicts it.** The only committed
   version of the PREREG postdates two sessions. The amendment-1 date "19:0x"
   and amendment-2 date "23:2x" are self-reported inside a file that first
   entered the tree at 23:27 — there is no evidence the amendment-1 version ever
   existed at 19:00.
2. **Session 2's raw data are gone.** push.log proves a second session started
   18:29:34 (battery 61%). No runs.csv, master log, or artifact for it exists
   anywhere in the repo (`git log --diff-filter=D` is empty; the only archived
   session is `misconfig_session1/`). The shipped report says the RAM collapse
   was "reproduced twice" — only **one** reproduction is archived. The second is
   asserted, not auditable.
3. **The file attributes session 1's exclusion to two mutually exclusive
   causes.** Amendment 1 (text): the first session "is discarded as
   misconfigured" — arm A ran flag-absent and compute degenerated 60–90×
   (21.3 s/tok), "an engine flag-default pathology". Amendment 2 (text): "the
   first two sessions were invalidated by device RAM state, **not by config**"
   — zram, "21.3 s/token". Both texts sit in the same committed file using the
   same number for different mechanisms; the 20:56 commit ("explicit-flag
   theory dead") shows the campaign itself refuted the config theory before
   writing amendment 2, yet amendment 1 was never retracted. The shipped report
   then attributes **both** sessions to zram, contradicting amendment 1. A
   hostile reader cannot determine, from the registered file alone, why session
   1 was excluded.

Severity: high for the pre-registration narrative; low for the analyzed data
themselves (v3 ran after the commit under the committed protocol, N≥10 floor
honored at N=12, zero exclusions, no optional stopping). Corrected statement:
"S23: 12 ABBA pairs collected under a protocol committed 55 s before the final
session and after two discarded sessions; the first two sessions' data are
excluded by rules written after they ran (see file-internal contradiction)."

### 2.2 kernel_ship_ab_xiaomi — CLEAN (REFUTED)

PREREG committed `c4b82dc` 02:18:03 (before STAGING.md at 06:31, before data at
11:00). Amendments: 1 → 06:17 ("before any run and before any staging" ✓),
2 → 06:58 (before data ✓), 3 → 10:48:23 (before data at 11:00:04 ✓). Kill
conditions ("model/binary mismatch → void; not fresh-reboot → void; any post-hoc
change of arms/flags/metric1/test → void") are honored in the REPORT's
integrity table (ELF sha identical before/after, uptime 1022 s fresh reboot,
screen Awake every row, UNPLUGGED every row, void_scan empty). The parser fix
after the first failed warmup session is disclosed, is confined to a shell
splitting bug, and no measured row from the failed session entered runs.csv.
**REFUTED** — attacked and held.

### 2.3 kf_ship_jelly (warm) — CLEAN (REFUTED)

PREREG `3785392` committed 12:52:29, blocks start 16:44. Verdict "SHIP-SUPPORT
NOT MET" honors the pre-registered endpoint: W=1, p=0.000977, 11/12 pairs
against ON, ON +7.1% (mean 0.2056 vs 0.1920) — all recomputed exactly.

### 2.4 kf_cold_jelly — CLEAN (REFUTED)

PREREG `01350f1` committed 14:09:56, first run 14:22:15. Cold floor pinned
(11,144,366,080 B = 50% of first OFF) before the pairs. All exclusions are
rule-based (cold-validity gate: Cached drop ≥ 1000 MB AND read ≥ floor). The 3
warmth-excludes + 1 SIGTERM-exclude are all on block 16's attempts, disclosed
with reasons, and the counter discrepancy (excl_warmth.txt says 2, CSV shows 3)
is itself disclosed as a harness bug. Kill/verdict linkage: primary verdict NULL
→ "activation policy not licensed" ✓.

---

## Section 3 — exclusions and stopping

- **S23**: exclusions of sessions 1–2 were post-hoc judgement applied to data
  already collected (see 2.1); the v3 session had zero exclusions. The PREREG's
  declared continuation rule ("excluded run voids the pair; pair re-run appended
  at the end") was **not** followed at session level — the misconfig session's
  pair 1 was never re-run as a pair; the whole session was discarded and the
  experiment restarted. Disclosed, but a deviation from the stated rule.
- **Xiaomi**: zero measured-run exclusions → no issue. The first session's
  three warmup attempts failed on a harness bug and correctly fed no rows.
- **kf_cold_jelly**: 4 excluded rows (all block 16: rc=143, warmth×2, rc=137),
  1 re-run block (`b16_OFF_retry`, appended at 20:03, 3 h after its pair mate —
  disclosed). 4 interruptions (14:20, 16:15, 18:05, 19:39) all disclosed with
  causes; one caused the only cross-interruption pair (8). **No optional
  stopping**: every interrupted session resumed and the cell ran to 24/24.
- **The post-hoc sensitivity analysis in kf_cold_jelly is honestly presented
  and safe.** I verified every number: `without b5: W=1 p=0.0039`; `without b24:
  W=11 p=0.0996`; `without both: W=1 p=0.0078`. Every variant makes the author's
  own hypothesis (K-F wins cold) look **worse**, never better — the reverse of
  the p-hacking hazard. The primary verdict (p=0.0635, +4.3% against) is quoted
  as the verdict and the variants are labelled "post-hoc, disclosed, NOT the
  registered endpoint". This is the correct way to present a near-miss null.
  The one wrinkle: the primary p=0.0635 itself is carried by a single
  anomalous pair (b5), and without it the cell would have been significant
  *against* the technique; the report says exactly this. **REFUTED.**

---

## Section 4 — confounds in measurement design

### 4.1 CPU contention (calaqwen_dropcurve) — disclosed, confined, not shipped

The PLAN (line ~190) states explicitly, in a "⚠️" inset: the arms ran under
*different* contention (d0.0 at 8% of its wall with contention, d0.8 under 100%
[F6 probe], d0.3 under 100%, d1.0 at zero after F6 died). It warns "i tempi
non sono confrontabili fra bracci" and that the d1.0-vs-d0 +58% tok/s "è
gonfiato". **Mitigating**: this is a PPL/quality cell — bpb is deterministic and
load-independent; the cell is INCOMPLETE (3/6 arms) with verdict reserved; no
speed number from it is shipped. The one derived speed observation (+58%) is
explicitly flagged as inflated by the campaign itself. Verdict: the confound
exists, is correctly handled. **REFUTED** as a damaging claim.

### 4.2 ABBA implementation — verified (REFUTED)

All four pre-registered cells implement ABBA as interleaved `AB BA AB BA …`
(12 pairs each) with pairs formed from adjacent runs exactly as declared: S23
device ✓, S23 screenon ✓, xiaomi ✓, kf_ship_jelly ✓ (quartets OFF-ON-ON-OFF,
pairs (1,2),(4,3)), kf_cold_jelly ✓ (same quartet scheme). No "ABBA" cell
reversed or skipped the alternation.

### 4.3 Screen state — declared, then NOT logged (S23, Jelly); logged+forced (Xiaomi)

- S23 PREREG: "screen state logged every run". Reality: the `screen` column is
  `?` on **every** row of **both** S23 sessions, and `screen=` is blank in every
  preflight/RUN log line — the query failed silently and rows were still
  accepted. The screen-off status of the device session that carries the
  shipped claim is **unverifiable from the data**; we only know a screen-on
  session was run separately afterwards.
- kf_cold_jelly / kf_ship_jelly (Jelly): `screen` column also `?` on every row,
  and the PLAN reports a documented screen-off event during the cell
  ("14:41 — schermo spento, sshd morto"). The PREREG claims "wake-lock held";
  a screen that demonstrably turned off mid-cell contradicts that for part of
  the run, and the logged column cannot recover it. Screen state is balanced
  across arms here (ABBA), so it is not a differential confound — it is a
  **disclosed-protocol-vs-reality** gap.
- Xiaomi: `screen=Awake` verified on every row and force-held; this is the one
  cell where the logged column matches the protocol. Initial design defects in
  the S23 cells were honestly flagged as burned-item lessons in the PLAN and
  fixed on Xiaomi.

### 4.4 Battery / charging

All four cells logged `UNPLUGGED` on every kept row and floor 45% was never hit
(S23 98→88%, Xiaomi 83→72%, Jelly similar). Note the exploratory
`kf_cold_xiaomi` deliberately ran PLUGGED with a mid-cell regime shift
(c06: thermal/charge-governor flip 551→323 ms) — disclosed prominently in that
report, and it is an exploratory (non-claim) cell. Battery level declines
monotonically through every session; adjacent-pair design confines its effect to
≲1% per pair.

### 4.5 Page-cache warmth — the one correctly-engineered gate

kf_cold_jelly's cold-validity gate (Cached-drop ≥ 1000 MB AND read ≥ floor, per
run, both arms) is the right answer to the warmth confound and demonstrably
worked: 3 runs that would have been silently warm were excluded by rule, not by
judgement (drop 0/390/222 MB vs the 1000 MB threshold). The kept set is
verified COLD-VALID. This cell's design should be the template.

### 4.6 Token-count asymmetry (144 vs 200) — under-disclosed on S23

In **every** ship cell, arm B generates 144 tokens (EOS) and arm A runs to the
`-n 200` cap; B's output text is consistently ~183 bytes shorter. This is an
arm-correlated property: the two configs produce *different outputs*, not just
different speeds. The xiaomi REPORT discloses it ("B always stopped at 144
tokens (EOS)… not a confound") with the per-token-metric argument — a fair
argument for the confirmatory metric. The S23 PREREG and report do **not**
disclose it at all. Secondary impact: the "equal quality" claim rests on the
routing-level PPL gate, not on the actual generated text, which differs between
arms by construction.

### 4.7 Device variance ±50%

The PLAN/ALIVE record ±50% between consecutive identical runs (3.99 → 8.27
tok/s) and correctly derive the rule "any speed claim needs ABBA pairs". Both
shipped claims are exactly that, with dz = 12.6 (S23) and 2.13 (Xiaomi): even a
±50% multiplicative noise floor cannot reverse either. The claims rest on
comparisons large enough to survive. **REFUTED.**

---

## Section 5 — multiple comparisons, outcome switching, forking paths

### 5.1 Total hypothesis-test count

Exactly **4 pre-registered A/B cells** exist in the campaign (the only PREREG.md
files in `results/`): kernel_ship_ab_s23 (p=0.000488), kernel_ship_ab_xiaomi
(p=0.000977), kf_ship_jelly warm (p=0.000977 against), kf_cold_jelly
(p=0.0635 null). Two exploratory Wilcoxon citations exist (S23 screenon,
kf_cold_xiaomi) and are labelled exploratory/non-claim. That is ~6 p-value tests
in total, of which 2 are confirmatory positives. A Bonferroni correction for any
realistic count (≤50 tests) leaves the S23 p=0.000488 standing (needs ≤102
tests) and the xiaomi p=0.000977 standing (needs ≤51). **Multiple-comparison
correction is not a threat to either shipped claim.** (The counterweight: both
positives are W=0 exact floors, the strongest possible outcomes of their tests —
if the campaign had tested only slightly more, this would be a red flag; at the
actual test count it is not.) REFUTED.

### 5.2 Outcome switching / endpoint drift

No PREREG changed its confirmatory endpoint between registration and report:
S23 metric 1 (decode wall s/token) ✓; xiaomi metric 1 ✓ (metric 6 added as
"reported, not confirmatory" — a declared addition, before data); kf cells use
wall_s_tok as pre-declared ✓. The xiaomi prediction ("effect smaller than
−42.7%, may be null") was registered in advance and its "held" claim is
honest: the result (−14.5%, significant) falls inside the declared envelope
(smaller, not null). The one drift-adjacent item: the S23 screenon session
(−41.3%, W=0, p=0.000488) is called a "second independent sample" in the PLAN —
it is not covered by any S23 PREREG amendment (amendments cover the device/
protocol only) and is protocol-deviant (screen on), so it must stay an
exploratory replication, which the PLAN does label as measured, not registered.
No quiet promotion of secondary endpoints to headlines: the J/token axis, the
only RED one, is carried loudly rather than buried — which makes the fact that
it is a broken measurement (see 5.3) more damaging, not less.

### 5.3 The energy axis on S23 is a broken measurement, presented as a result

The shipped S23 report carries "J/token: 0.1089 vs 0.1218 — B costs +11.8%
energy per token — honest regression." Recomputed from runs.csv, the sources of
that median are physically impossible:

- A p01: 0.3367 J over a ~44 s decode window → **0.008 W** mean whole-device
  draw. A battery discharging at 4.3 V running a 12B MoE decode cannot draw
  0.008 W. B p01: 2.11 J over ~18 s → 0.12 W. Also impossible.
- The per-run joules span 0.28–70 J with no relation to run length; p02_A
  (0.297 J) is 1/10 of p01_B (2.11 J) despite a longer window.
- The values climb ~200× across each session (0.001 → 0.31 J/tok) — a sampler
  that progressively "wakes up", not a real power trend.
- The screen-on session flips the sign of the ratio (+92% B over A with screen
  on — but screen on must compress the ratio toward 1, not double it), and the
  campaign's own BASELINE_screen_on.md back-of-envelope derives the opposite
  sign (−18% B) from plausible physics, noting "the opposite sign of the S23's
  measured +11.8%".
- The raw 1 Hz power samples for the S23 sessions were **never archived**
  (only xiaomi's were) — the ratio cannot be re-derived or audited.
- The arithmetic on top of it is wrong too: "per-answer energy is ~+12%" —
  actual per-answer energy is B = 144 × 0.1218 = 17.5 J vs A = 200 × 0.1089 =
  21.8 J, i.e. **B is −20% per answer**, not +12%. The "+2.6 J compute" figure
  multiplies the per-token difference by A's 200 tokens while ignoring B's 144.

Damage: the campaign's honest-looking RED axis — the thing that makes the
shipment credible ("we even report the bad axis") — is itself an artifact of a
broken instrument, and the derived "net battery saving for interactive use"
(policy matter) is built on it. Corrected statement: "S23 J/token is not
measurable with this sampler; absolute values are 2–500× below physics and the
A-vs-B ratio is unreliable. The energy axis was neither replicated nor measured
on the S23; the Xiaomi cell correctly reported it as not replicated (N=2 usable
pairs, quantized coulomb counter)."

### 5.4 Config mismatch: the shipped "recipe" ≠ the A/B-tested config

ALIVE.md §1 presents the shipped recipe as `-t 4 … --n-expert-used 6
--drop-cold-experts 0.65` and attaches the −42.7%/−14.5% p-value story to it.
The A/B cells tested **`-t 2 --n-expert-used 6 --drop-cold-experts 1.0`**
(explicit in the S23 PREREG's arm B, in run_ship_ab_s23.sh's ARM B line, and in
the REPORT's own "B (certified: t2, k6, d1.0)"). 5.151 t/s was measured for
`k6d10 t2`. The d0.65 config at t2 was measured slower in the S2 gate (compute
0.1735 vs 0.148, i.e. ~17% slower than d1.0). So the p-value validates t2/d1.0;
it does **not** validate the t4/d0.65 recipe that ALIVE ships. Either the
one-pager is wrong or the product config differs from the validated one —
under-disclosed either way.

---

## Section 6 — findings ranked by damage-if-published

1. **[HIGH] S23 pre-registration not verifiable / session 2 data destroyed.**
   PREREG first committed after two sessions; "before any run" claim false as a
   git statement; session 2 raw data absent; "reproduced twice" verifiable once.
   → Rephrase shipped claim as "validated in a single registered session with
   two discarded pre-session attempts", or restore/annotate the missing data.
2. **[HIGH] S23 energy axis is a broken measurement shipped as an honest
   finding.** Impossible absolute powers, unarchived raw samples, sign
   instability, wrong derived arithmetic (+12% per answer should be −20%).
   → Withdraw the "+11.8% J/token" as a measurement; keep it only as "sampler
   unusable; energy not measured on S23".
3. **[MEDIUM] Recipe vs tested-config mismatch in the public one-pager.**
   → Ship the tested config (t2/k6/d1.0) or re-A/B the shipped one.
4. **[MEDIUM] Screen state declared but never logged on S23 and Jelly.**
   Screen-off status of the flagship claim is unverifiable; wake-lock claim
   contradicted by a documented screen-off event mid-cell on Jelly.
5. **[MEDIUM] Exclusive-exclusion contradiction in the S23 PREREG file.**
   Amendment 1 (config) vs amendment 2 (RAM) for the same session; amendment 1
   retracted nowhere; shipped report sides with amendment 2.
6. **[MEDIUM-LOW] 144-vs-200 token asymmetry and output divergence disclosed
   on Xiaomi only.** The S23 report omits it; "equal quality" is gated at
   routing level, not on generated text.
7. **[LOW] Post-hoc exclusion narrative on S23**: sessions excluded by rules
   written after the data; pair-re-run continuation rule not followed at
   session level (disclosed as amendments).
8. **[LOW] Xiaomi tie policy not pre-declared** (correct arithmetic; disclosed
   post-hoc; fixed in the next cell's PREREG).

## Section 7 — REFUTED findings (attacked, held)

- S23 confirmatory claim: −42.7%, W=0, p=0.000488, N=12 — recomputed, correct.
- Xiaomi confirmatory claim: −14.5%, W=0, p=0.000977, 11 effective pairs —
  recomputed, correct; floor statement correct; tie sensitivity negligible.
- Xiaomi pre-registration timeline and kill-condition enforcement — clean.
- kf_ship_jelly warm negative (W=1, p=0.000977, +7.1% against) — recomputed,
  correct, pre-registered in time.
- kf_cold_jelly primary (p=0.0635) and all sensitivity variants (0.0039/0.0996/
  0.0078) — recomputed, correct; disclosure honest and safe (every variant
  worsens the author's hypothesis).
- ABBA alternation — verified in all five measured sessions.
- Multiple-comparison threat — no; ~6 total p-value tests; both shipped
  positives at exact floors.
- Dropcurve CPU-contention confound — real but disclosed, confined to timings
  of a reserved-verdict quality cell, +58% observation explicitly flagged
  inflated by the campaign itself.
- Device-variance (±50%) risk to shipped claims — none; ABBA + dz 12.6/2.13.
- No optional stopping, no outcome switching, no endpoint drift in any
  pre-registered cell.

## Bottom line

The p-values are real and correctly computed; the two shipped claims survive
hostile recomputation on their confirmatory metric, and the xiaomi replication
is a discipline exemplar. What does not survive scrutiny is the *narrative* on
the S23 side: the pre-registration was assembled after two unarchived/discarded
sessions (one of them destroyed), the screen state was never actually logged,
and the one honest-looking RED axis (energy) is a broken measurement dressed as
a finding — which matters because the campaign's credibility is explicitly hung
on "we disclose the bad axis". Fix the energy axis and the S23 provenance
narrative before this leaves the campaign folder; the numbers themselves are
safe to stand on.