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
