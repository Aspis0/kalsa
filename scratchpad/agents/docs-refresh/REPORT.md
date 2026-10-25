# REPORT - docs-refresh: both living documents brought up to date with 2026-09-22

Scope: writer/planner cell. Read-only on every other repo; no code changed, no phone touched, no
push, no tag, no commit. The only files written are `PLAN.md`, `docs/ALIVE.md` and this report.

## Verification, as required

```
$ ls -la PLAN.md docs/ALIVE.md
-rw-r--r--  1 marco  staff  43885 Sep 22 21:30 PLAN.md
-rw-r--r--  1 marco  staff  30498 Sep 22 21:28 docs/ALIVE.md

$ wc -l PLAN.md docs/ALIVE.md
     642 PLAN.md
     447 docs/ALIVE.md
    1089 total
```

Before the update: PLAN.md 469 lines, docs/ALIVE.md 278 lines (both last modified 2026-09-21).

## Diffstat of what changed

```
$ git diff --stat -- PLAN.md docs/ALIVE.md
 PLAN.md       | 183 ++++++++++++++++++++++++++++++++++++++++++++++++++++--
 docs/ALIVE.md | 195 ++++++++++++++++++++++++++++++++++++++++++++++++++++++----
 2 files changed, 360 insertions(+), 18 deletions(-)

$ git diff --numstat -- PLAN.md docs/ALIVE.md
178	5	PLAN.md
182	13	docs/ALIVE.md
```

## What was written into `docs/ALIVE.md` (the diary of today)

New dated section `### 2026-09-22 (22/09) - GPU numerics: cause found; the stall reproduces on
the shipped build; the chain verified end to end`, appended after the 2026-09-21 entry (the
document appends; nothing in the older entry was rewritten). It carries, every number attributed
to its report path:

1. The fp16 activation scale as the cause of the 57x divergence (s23 REPORT sec. 22): control
   bitwise stock 0.394993 / 63.892 %, fp32 arm 0.005412 / 93.982 % at 76.44 t/s, better than the
   f32 route (0.006954 / 92.913 % at 68.42) on both limbs, -9.9 % recovered; shipped default
   (no env) 0.005412 / 93.982 % / 76.36 t/s (sec. 23); gate still FAIL both limbs.
2. The `-b 1` floor probe (sec. 17): stock == full precision bitwise 0.006012 / 93.138 %, FAIL
   both; acceptance gate (<= 0.005) not reachable by batched-GEMM precision work.
3. The KV term as OPEN (sec. 24, 26): a table with the shipped-config cells (0.010268 / 92.126 %
   full; 0.011096 / 92.717 % reduced), the kernel-side reference points, the isolated term
   +0.001493 vs +0.004754 (3.2x apart) and the FA term (+0.003363 conflated vs +0.000916
   matched). Magnitude explicitly not settled; full-corpus matched reference (`cpu-f16faon`)
   queued; reduced-corpus decomposition-only warning kept.
4. The owner's parity answer (sec. 18-20): prompts 0 material divergences, memory 10/10 differ
   with 0 one-right-one-wrong rows and 0/10 finals, safety 0/24 complied with 4 pre-answer cells
   flagged RELEASE BLOCKER CANDIDATE and the truncation caveat.
5. The stall on the shipped configuration (jelly-rerun sec. 11-16): +1175 s, zero native lines
   across 19.6 minutes of full raw logcat, Run B's two moved variables (EMA + warm KV), and the
   thermal limb written as untested (SEVERE x69 vs NONE in the originals).
6. The instrument lesson twice - the `debuggable true` hand edit deleted by a clean `expo
   prebuild` (tracked bench build in flight), and the cited-hash APK lost to cache cleanup with
   the new rule: an artefact whose hash is cited must be archived before any cleanup touches
   build output.
7. The day's second refuted hypothesis (`scratchpad/agents/quant-alignment/REPORT.md`): the
   activation-quantiser reading of the common residual, with the three reasons it was refuted
   (quantiser absent at b1; its removal costs +0.001542; weight-side fp16 and the Q8_K floor
   survive), the pre-registered falsifiers, the two open anomalies, and the pattern: a hypothesis
   is only useful if the number that would kill it is written before the measurement.
8. The delivery chain verified end to end (tag, manifest, binding, app pin) as a table, with the
   two honest caveats (CI failed before the gate; jest dead in the binding environment).
9. The desk's panel number (other workstream): 69.17 alone / 52.20 each / 1.51x aggregate, A2/A
   1.0105, matched to the release artefact by published sha (kalsa-brain commit `5b9b98f`), plus
   the fact that three runs exist and the panel row carries the third (1.4672, A2/A 1.0037).

Also updated, because the document's own logic requires current values:

- **Proven table**: four new rows pointing at the s23 sections, the jelly-rerun, the chain
  reports, and the quant-alignment report.
- **Standing cautions**: the three open limbs (KV magnitude, thermal, governor runtime
  engagement) written as open, not smoothed.
- **Engine release pipeline**: the source/release identity table now shows v1.1.1 as current
  (tag object `0f1b3bec...`, commit `a7d2cec79`, release branch `kalsa-release-v1-1-1`, phone
  branch `kalsa-phone-v1-1-1` at `1577495b9`), with v1.1.0 and v1.0.0 retained as previous rows;
  new "Published state, v1.1.1" subsection with the manifest fields read back consumer-side;
  the 2026-09-21 published-state table retitle-marked as history; the rebuild-dispatch sentence
  corrected to name the branch each tag was cut from; `exe_sha256` trap now documented across all
  three tags; a manifest-contract note for v1.1.1.

## What was written into `PLAN.md` (state, debts, next steps, blockers)

- New section `## Verified state, 2026-09-22` (after the 2026-09-20 verified state): GPU numerics
  (cause found, gate still unreachable, refuted quantiser hypothesis, the weight-side lead, the
  two running zero-build probes and the pre-registered falsifiers, the two open anomalies);
  the KV term marked OPEN with its queued reference; the parity answer; the stall with its two
  open limbs; the instrument lesson; the delivery chain with its caveats; the desk panel number.
- `### Where the schedule stands`: a 2026-09-22 check bullet - still no G2 claim on disk, and the
  stall reproduces on the shipped build, so G2's long-session criterion stays blocked behind the
  governor.
- `## Roadmap and next steps`: items 5 and 6 added - run the two zero-build probes against the
  pre-registered falsifiers before building anything; rerun the Jelly stall cool and separate
  seeded EMA from warm KV once the tracked bench build exists.
- Engine release section: new `### Position, 2026-09-22` (release line, v1.1.1 published and
  read back, phone line, binding `5b966218`, app `e206a945`, both caveats); the old position
  retitle-marked `(history)`.
- `### Open items and debts`: item 1 gains 1a (v1.1.1 published, nothing remaining); item 4
  rewritten to the current chain (the 0288dc27 bump it described has landed); items 5-11 added,
  each with what it is blocked on and on whom: GPU residual/falsifiers (phone time + owner GO for
  builds), KV magnitude (the S23 unplugged), the stall's thermal and EMA limbs (tracked bench
  build + owner's order), instrument debt (app workstream), CI-enforced provenance (action pin,
  owner decides who), jest debt (unbooked), governor runtime engagement (open; last smoke
  REFUSED; V73 lane unmeasured).

## Attribution and honesty rules followed

- Every number carries its report path and section.
- Uncertain facts are written as uncertain: KV magnitude (+0.0015..+0.0048, 3.2x disagreement),
  the thermal limb, and whether the governor engages at runtime are all stated OPEN in both
  documents.
- The panel number is recorded as briefed (run 1: 69.17 / 52.20 / 1.51x, A2/A 1.0105) AND as the
  desk's own record states it (three runs; the panel row carries the third, 1.4672 / A2/A 1.0037),
  because both are on disk and smoothing either way would falsify one of them.
- History was not rewritten: dated sections were appended or retitle-marked `(history)`, never
  renumbered or silently replaced.

Not done, per the standing rules: no commit, no push, no tag, no PR, no comments anywhere.

## Addendum pass (same session): the panel figure discrepancy closed, and the desk's unpushed work

The desk answered the flag: **not a transcription - three different runs of the same
measurement**, all three registered. Both documents were updated again, same voice, no history
rewritten.

Written into the panel row of `PLAN.md` and the diary entry of `docs/ALIVE.md`:

| run | commit | per device | aggregate | A2/A | load floor |
|---|---|---|---|---|---|
| 1 | `5b9b98f` | 0.7546 (69.17 alone / 52.20 each t/s) | 1.5093 | 1.0105 | ~4-6 |
| 2 | `fe14e78` | 0.7302 | 1.4604 | 0.9982 | ~2 |
| 3 | `34de14f` | 0.7336 | 1.4672 | 1.0037 | 4.08 |

- The panel row keeps **run 3**, with the reason stated next to it: tightest drift control
  (1.0037 against 1.0105) and provenance as fields inside `results.json` rather than prose.
- **Path-plus-commit rule, stated once:** run 3 overwrote
  `dev/results/concurrency-two-devices/results.json`; run 1's artefact survives only in git
  history at `5b9b98f`, so the path must be cited with its commit wherever either figure is used.
- **Never a constant:** the three runs agree within 3 % (1.4604 / 1.4672 / 1.5093), per-device
  0.73-0.75 - the spread is the floor, not the measurement; read the figure with the artefact
  label and the load alongside.

Also recorded for the record, as local-only pending an owner decision: the desk's four commits -
`1f22bb7` (panel row labelled with the release), `fe14e78` (provenance fields in the artefact),
`6efec90` (`Stopping`), and the `Stopped` invariant with its proof (`f1df191`, `ae78761`,
`f9d8861`). `origin/brain` still sits at `cac9068` (re-verified read-only); the session handoff
says "no push was authorized". One citation note: the brief gave the third `Stopped` commit as
`9d8861`; the on-disk sha in `kalsa-brain` history is `f9d8861`, and that is what both documents
cite. The structural fact is stated instead of the personalities: work that exists in one place
only has bitten this project three times today - this is the fourth candidate.

Diffstat after the addendum pass (cumulative, vs the committed versions):

```
 PLAN.md       | 207 ++++++++++++++++++++++++++++++++++++++++++++++++++++--
 docs/ALIVE.md | 221 ++++++++++++++++++++++++++++++++++++++++++++++++++++++----
 2 files changed, 410 insertions(+), 18 deletions(-)
```

Still no commit, no push, no tag, no PR.

## Correction pass: the desk pushed; one journal line was wrong and is now corrected in place

The line recording the four desk commits as local-only (`PLAN.md` item 12, `docs/ALIVE.md`
diary paragraph) became wrong when the desk pushed. Corrected in BOTH documents with the
correction kept visible, not erased:

- The local-only state is retained in the record (commits named: `1f22bb7`, `fe14e78`, `6efec90`,
  `f1df191`/`ae78761`/`f9d8861`; `origin/brain` at `cac9068`; "no push was authorized"), stated as
  the state that held while it lasted and as the fourth candidate of the day for one-place work.
- The correction follows it explicitly: **PUSHED 2026-09-22**, `cac9068..3660706  brain -> brain`,
  exit 0, fast-forward re-verified an instant before pushing (remote still `cac9068`, 0 behind /
  14 ahead), tree clean before and after, local `HEAD` = remote sha; remote
  `refs/heads/brain = 3660706793dad68f0ac85366ab09805cb6ddb733`.
- The remote was re-verified independently by this cell, read-only (`git ls-remote origin
  refs/heads/brain` -> that sha; local `HEAD` equal; `git status` clean; 14 commits in
  `cac9068..3660706`).

Why the doubt stays visible rather than being rewritten away: a journal that hides its own
corrections is worse than one that never recorded the doubt - the reason for the flag (work that
exists in one place only, three bites today, this the fourth candidate) is the actual lesson, and
the push closed the window, not the lesson.

No commit, no push, no tag from this cell.

## Third pass (2026-09-23, overnight landings): headline at the top, and the governor question closed

Every claim in the brief was verified on disk before writing; the one claim not previously
transcribed anywhere was re-verified by running the gate myself (read-only, `kalsa-wt-gov-trend`,
exit 0, tree clean afterwards).

What went where:

- **`docs/ALIVE.md` - new `## Headline` section at the TOP of the file** (line 11, above "How to
  read"): the `_cok` regime table (b256 0.005412/93.982 % | b1 0.006012/93.138 % | **b8 `_cok`
  0.304543/66.198 %, catastrophic FAIL**) with its trigger column, the guard sentence (no row
  readable without its trigger), the frequency (31/606 = 5.1 %, ubatch-512 3.8 %, clusters
  516-519) and its three stated caveats, and the pre-registered fix pair (sec. 35). Sources:
  `s23-kld-740-q4-0/REPORT.md` sec. 31b, 34.
- **`docs/ALIVE.md` - new dated diary entry `### 2026-09-23 (overnight from 22/09)`**: the
  screen-state correction (76.39 vs 71.98, -11.7 % -> -6.1 %, 30000 ms timeout, the both-arms
  rule, sec. 33); the Z2 matrix VOID by its own gate (control 5.635640 vs required 5.103422,
  corrected control 0.005454/94.488 %, byte-equal companion 0.005615/94.263 %, -99.9 % collapse,
  fp16-da destroyer / fp16-sa half summary, sec. 32); the governor producer + two attacks +
  cadence numbers (280.65/292.33/274.77 s, 4.7x dilution, 7.2 C -> max 0.75 C/min, 1.0 C band,
  40 s vs >= 600 s, 200:1); **the closing replay recorded as a conclusion** (real estimator
  sha256 `2769fc...afab63`, declared re-implementation of one rule with line pins, TRUE/FALSE
  yardstick the author's, 75 sessions/8871 rows/71 replayed, production 15 opp/0 flips, dense
  122/2/1 and the classifiable one FALSE with the 1216 s tail) with the closing sentence - **inert
  at production cadence, therefore unproven - not safe** - the method line **the file count is not
  the sample**, and consequences (a) not to ship as an escalation trigger, (b) temperature feed on
  the poll path whose cost is what the Meter measures, (c) harness `replay-wrongfire.cjs` stays on
  disk; the two traps (symlink gate-through + my gate re-run triple; dirty tree == `1068eb03d`
  and the which-commit-and-which-tree lesson); and the Meter block (owner's rule sec. 30, 1,045 mA
  bar with 1 % = ~10.5 mA / 5 % = ~52 mA, pre-registration <= +5 % / >= +15 % / > 10 %, soundness
  sec. 5), plus the proven tracked debuggable mechanism (`bench-apk/REPORT.md`).
- **`docs/ALIVE.md` - Proven table**: s23 row extended to sections 17-35; new rows for the
  governor-trend conclusion and the Meter decision block. **Standing cautions**: new screen-state
  bullet.
- **`PLAN.md` - `## Verified state, 2026-09-22`**: `### Headline` is now the FIRST subsection;
  new subsections `### The Z2 attribution matrix: VOID by its own gate`,
  `### Governor trend: the question is CLOSED ...` (conclusion, explicitly not an open item),
  `### The Meter decision: rule, bar, pre-registration, soundness`, and
  `### Overnight corrections and traps` (screen-state rule + both traps).
- **`PLAN.md` - Open items**: item 5 gains the overnight bookkeeping (`_cok` at the top, fix pair
  awaiting the coder's sha, Z2 closed with its registered verdict, arm A 0.003546/96.513 % passes
  but inconclusive between its own pre-registered readings); item 8 gains the proven
  `KALSA_DEBUGGABLE` mechanism; new item 13 (trend commits `7921719` + `ed55f7d` local-only,
  push UNRUN, blocked on the owner) and item 14 (Meter sampler-overhead A/B pre-registered,
  result pending). The trend conclusion is deliberately NOT an open item.

Verification ledger for this pass: s23 sections 31b/32/33/34/30 read at source; governor-trend
REPORT rounds 1-4 read at source (605 lines); governor-trend-numeric (586) and governor-trend-audit
(42) numbers cross-checked; COORDINATOR-STATE sixth/seventh lessons read; `build-with-fixes` sec.
2.4 and `shared-term` sec. 0 read for the dirty-tree trap; `kalsa-wt-gov-trend/node_modules`
confirmed a real directory (mtime 2026-09-23 00:53); provenance gate re-run by this cell:
`lockfile pins Aspis0/kalsa.rn@5b966218eadb` / `1119 files match` / `engine inside it:
kalsallama@1577495b9209 == native/kalsallama.pin`, exit 0.

No commit, no push, no tag from this cell.

## Fourth pass (2026-09-23): the provenance verdict (closed) and the desktop test net

Both items verified at source first: `scratchpad/agents/governor-desktop-net/REPORT.md`
(217 lines, sections 2 and 3).

- **`docs/ALIVE.md`** - overnight diary entry gained two blocks, both written as verdicts, not
  open items: **"Desktop provenance audit: CLOSED, as a verdict"** (the sweep counts: 228
  REPORT.md, 87 speed-bearing, 4 desktop, 83 device/third-party, plus analysis/PLAN/ALIVE read
  line by line; a table with one row per desktop number - panel fully attributable / contains
  the fix / GPU-capable; slot-save GPU-capable dylib but lane not attributable, no
  `--n-gpu-layers` on the command line; A/B fork arm CPU-only, survives by luck not by
  construction, CPU-only label not withdrawal; A/B release arm GPU-capable by its single-flag
  control but artefact path and tree NOT ATTRIBUTABLE; upstream 0.94/0.61 at `e02b477`
  third-party NOT ATTRIBUTABLE; the one-sentence verdict verbatim; the load-condition finding)
  and **"Desktop net: a test-only matrix over the profile-validity gate"** (11 rows asserting
  validity+state+lane+admission consequence, +37 check sites, no new test file; 13 failures with
  the gate line removed, ten from the matrix, green again when right; test-only, does not move
  the tagged release, hardens the next one; the four reported surprises incl. admission CLOSED
  on invalid and 41.9 Wait vs 42.0 Abort).
- **`docs/ALIVE.md` - Standing cautions**: the load-condition rule (a published number without
  its load condition cannot be re-examined later; only the A/B and the panel carry load).
- **`docs/ALIVE.md` - Proven table**: one new row pointing at `governor-desktop-net/REPORT.md`.
- **`PLAN.md` - Verified state**: two new subsections after the panel number -
  `### Desktop numbers: provenance verdict (CLOSED, not open)` and
  `### Desktop net: a test-only matrix over the profile-validity gate`. Nothing was added to the
  open items: the brief closed this question, and it is recorded as closed.

No commit, no push, no tag from this cell.

## Fifth pass (2026-09-23, final for tonight): the tail fix, its refusal, the stamp, the queue

All four items verified at source before writing: s23 REPORT sec. 35/36.1/37,
`cok-accumulator/REPORT.md` (362 lines), `cok-accumulator-audit/REPORT.md` (250 lines),
`build-provenance/REPORT.md` (274 lines). One brief-vs-disk discrepancy resolved in favour of
disk after re-checking: the build-provenance report still says push UNRUN, but
`git ls-remote origin refs/heads/kalsa-build-provenance` returns `91ac75c35...` - the push the
brief describes happened, so both documents say pushed-and-re-verified. The tail-fix branch
`kalsa-opencl-cok-fp32` verified local (`319b53937`, one commit above `1577495b9`), NOT claimed
pushed anywhere.

- **`docs/ALIVE.md` - Headline** gained a Status line: fixed and audited, not yet shippable,
  with the four headline numbers and the audit pointer - so the top of the file closes the arc.
- **`docs/ALIVE.md` - overnight diary**: three blocks appended - the fix as results (the
  three-arm table beside its pre-registered predictions; price +8.3436 % / 0 % decode / +0.235 %
  estimate; fast-and-wrong vs slower-and-correct provenance), **the audit's refusal with its
  reason** (two literal author claims refuted; +0.001478 not verified as a floor; K-split
  accumulation order as the next ablation; provenance by triangulation, WARN never captured;
  not shippable on model/KV/attention mismatch; the six-step shipping checklist), **the
  build-provenance stamp** (fields, cap-with-count, +0.25 s, three states, JSON==BINARY rule,
  declared-limit rule, stated limit with the build-id half), and **the queue** (phone at 21 %,
  Meter -> sec. 37's three sets -> K-split, with sec. 37's self-named weakest assumption).
- **`docs/ALIVE.md` - Proven table**: one row for the four reports (sec. 35-37 included).
- **`PLAN.md` - Verified state**: `### The \`_cok\` tail fix: FIXED, AUDITED, NOT YET SHIPPABLE`
  (right after the Headline) and `### Build provenance: the tree state is stamped into the
  artefact (pushed)` (after the desktop net).
- **`PLAN.md` - Roadmap item 7**: the morning queue in the owner's order, with the checklist
  as the gate before any pin-chain move. **Open item 5** corrected: the pair no longer "awaits
  the coder's sha" - it ran, closed 99.51 % as a registered PARTIAL, and the audit's refusal
  points at item 7.

No commit, no push, no tag from this cell.

## Sixth pass (2026-09-23): the K-order ablation and the refspec rule

Verified at source: `scratchpad/agents/cok-residual/REPORT.md` (written 03:34), plus read-only
`git ls-remote` - `refs/heads/kalsa-opencl-cok-korder = 7965f43e0...` (pushed as a NEW ref) and
`refs/heads/kalsa-phone-v1-1-1 = 1577495b9...` (shipping line unmoved), both re-checked while
writing.

- **`docs/ALIVE.md` - overnight diary**: two blocks - the ablation (the K-walk difference with
  file:line, the selector pattern with `fp16` still one-env control, the two byte-identity IR
  gates, branch/commit/build/binary sha, the seven targets, the prediction timestamped 03:25 EDT
  before the build with its stop rule and two fixed-in-advance caveats) and the process point
  (the push block targeting `refs/heads/kalsa-phone-v1-1-1`, what actually ran, and the rule:
  a coder's refspec is a proposal, not a decision). The queue paragraph's third item now names
  the K-split pair and its binary, so the morning reads as one three-item list.
- **`docs/ALIVE.md` - Standing cautions**: the refspec rule as a bullet. **Proven table**: the
  tail-fix row now includes `cok-residual/REPORT.md`.
- **`PLAN.md` - new `## STANDING RULE (2026-09-23): A CODER'S REFSPEC IS A PROPOSAL, NOT A
  DECISION`** directly under the existing upstream rule (rules kept together at the top).
- **`PLAN.md` - `### The residual's next ablation: built, prediction on disk`** appended after
  the tail-fix subsection; **Roadmap item 7**'s third queue entry now names the branch, commit,
  build and binary sha.

No commit, no push, no tag from this cell.
