# Fase 2a round 2 — narrow flip-check of the round-1 findings — app `708499f` (branch `energy-framework`) + fork `2998ad5d6` (branch `kalsa/energy-phase-stamps`)

App commit under audit: `708499f597e5aa49b5f4c14bb202861f0cd1c146` — `fix(energy): close phase stamp
audit findings`, 4 files, +120/−19 (`docs/ENERGY-SCHEMA.md`, `scripts/device-ngram-spec.sh`,
`scripts/energyPhaseSplit.mjs`, `scripts/energyPhaseSplitHarness.mjs`), parent `522903c` (audited
in `ENERGY-PHASE-STAMP-AUDIT-2026-09-15.md`, verdict SHIP). Worktree
`/Users/marco/Projects/kalsa-ngram-spec`, branch `energy-framework`, clean.
Fork commit under audit: `2998ad5d63a9d6ff150fb58aded740f6dcbda8c2` — `fix(cli): silence phase stamp
failures`, 1 file, **4 deletions, 0 insertions** (`tools/cli/cli-context.cpp` only; the header is
untouched), parent `ba33d8b` (audited).
Date: 2026-09-15 23:48 EDT. Mode: read-only; scratch under `/tmp/kalsa-flip-2a/`; no commit, no push,
no branch, no `adb`, no device. Both worktrees are still clean (`git status --porcelain` → 0 lines
each). Scope: **only the delta** — F1, F2, F3, F6 and the F4/F5 doc corrections, plus the regression
gates the brief lists. The round-1 report settled everything else and its SHIP verdict stands.

**Verdict: SHIP.** F1, F2 and F3 flip cleanly under my own re-execution; F6 flips for the geometry
the harness tests and leaves one sibling geometry that now contradicts the new doc sentence
(R2 below, LOW); the F4/F5 corrections are present and factually right. All regression gates green:
77/0, 90/0 (85→90 check sites, none removed or reworded), 4/4 v2 sidecars byte-identical, my own
integrator matches the tool on a real stem and on my own synthetic stem, pin tree and pristine
binaries unchanged. No finding blocks the campaign; three residuals (R1–R3) are worth a line each
before the first stamped run. Everything in the brief was reachable except device-side runtime
behaviour, which this audit is not allowed to touch.

---

## F1 — stamps can no longer reach the captured `_rN.txt` — **FLIPPED**

**Code reading.** The fork delta deletes exactly the two `fprintf(stderr, …)` calls and adds
nothing. `phase_stamps_warned` is now write-only in both failure branches; its only read is the
early-return guard (`cli-context.cpp:457`). A grep of the whole parent commit shows those two lines
were the *only* stream writes the phase-stamp feature ever added — there is no second path. The
parent's commit message ("Written to a side file, never stdout or stderr … Fail-soft: an unopenable
path warns once on stderr") was self-contradictory; the new commit message is the bare subject
`fix(cli): silence phase stamp failures` and claims nothing false.

**Executed run (required evidence).** The CLI is aarch64/Linux and this host has no qemu, so I
extracted the audited function body *mechanically* — `sed -n '456,479p'` of
`tools/cli/cli-context.cpp` (sha256 `8181e686…`), only the signature line rewritten (`f1_gen.sh`,
body sha256 `9ed2e65d…`, generated TU `d5317226…`, and the generator asserts the other 23 lines are
byte-identical to the source) — compiled it natively with clang/libc++ and ran it:

| geometry forced | rc | stdout | stderr | target file |
|---|---|---|---|---|
| path in a non-existent directory | 0 | 0 B | **0 B** | not created |
| directory as the target path | 0 | 0 B | **0 B** | — |
| mode-0500 parent directory (EACCES) | 0 | 0 B | **0 B** | not created |
| open ok, write/flush fails (`RLIMIT_FSIZE=0`, `SIGXFSZ` ignored) | 0 | 0 B | **0 B** | 0 B |
| control: writable path | 0 | 0 B | 0 B | `phase prompt_n=51 prompt_ms=4513.000 predicted_n=30 predicted_ms=3297.000` |

No line matching the warning text exists in the audited source (`grep -c` → 0) nor in the replay
binary (`strings | grep -c` → 0).

**Negative control (proves the test is sensitive to the removed bytes).** The same generator run on
the *parent* body (`git show ba33d8b:…`, sha256 `17417249…`) prints on the open-failure geometry:

```
warning: KALSA_PHASE_STAMPS: failed to open '/tmp/kalsa-flip-2a/nodir/parent.stamps'; continuing without phase stamps
```

(rc 0, 118 B on stderr) and the write-failure warning under the rlimit geometry. Same harness, same
geometry, audited bytes → 0 B.

Methodological trap, named because I hit it first: under `RLIMIT_FSIZE=0` the stderr **redirect
file** is under the same limit, so the parent's warning is buffered and then lost in a failed
flush — the warning only becomes visible when stderr is captured through a pipe. The first run of
this experiment was therefore a false negative.

**Harness side (also executed).** I extracted lines 184–199 of the audited script
(sha256 `7ac5d784…`) and ran them with a stubbed `adb`, three cases:

```
pull failure      -> results.txt: "phase stamps pull FAILED for … r1" + "phase stamps MISSING/EMPTY for … r1 (expected …/…_r1.stamps)"
empty pulled file -> results.txt: "phase stamps MISSING/EMPTY for … r1 (expected …)"
good pull         -> no line
```

In all three cases the captured-text analogue received 0 B from the harness (`blog()` is
`printf … | tee -a "$RESULT"` and `RESULT="$OUT/results.txt"`). `clean_out()` is byte-identical to
the pre-v3 state (`git show 522903c^:scripts/device-ngram-spec.sh` vs HEAD → empty diff), so the
filter was not widened to hide the warning — it was removed at the source.

**Residual.** The stamp failure is now silent in the CLI and visible only in `results.txt` (plus the
tool's per-row "phase stamps absent" line). If an operator reads neither, a stamp failure is
indistinguishable from a v2 campaign — which is the same blind spot as round-1 N1.

---

## F2 — mark timing restored — **CONFIRMED**

Order in `scripts/device-ngram-spec.sh` (line numbers of HEAD):

```
187-190  adb shell "… KALSA_PHASE_STAMPS=$stamps … ./llama-cli …" > "$out" 2>&1
191-194  # comment + [ ENERGY = 1 ] && adb shell "echo r$i $(cut -d' ' -f1 /proc/uptime) >> $TAG.marks"
195-196  adb pull "$stamps" "$OUT/" … || blog "… pull FAILED …"
197-199  [ ! -s "$stamp_out" ] && blog "… MISSING/EMPTY … (expected …)"
```

Nothing but a comment and the unchanged `[ ENERGY = 1 ]` guard sits between the CLI invocation and
the mark. **Exit-path enumeration:** the script runs `set -uo pipefail` with **no `-e`** — verified
by execution, not by reading: after sourcing `device-share-send.sh` and calling
`device_keepawake_begin` with a stubbed `adb`, `$-` is `huBc` (the `set -euo pipefail` at
`device-share-send.sh:248` is inside the `BASH_SOURCE[0] = $0` block and does not run when sourced).
There is no `exit`/`return` between 187 and 194, and the CLI's return status is not tested, so
`timeout 600` → rc 124 still reaches the mark. Every `return 1` path (empty output, missing speed
line, energy stop) now happens *after* the mark. Conclusion: the pull cannot move the mark on any
path that reached the pin's mark, and the mark is now additionally written on rep-**failure** paths
where the pin wrote none.

**Measured side effect of that last point (not in the doc).** A mark for a failed rep protects the
*next* rep's window. Fixture: samples 100…130, marks r1/r2/r3 = 110/120/130, rep texts for r1 and r3
only → r3 keeps its own window (`row r3: window=120.00..130.00`, one note `r2: missing _r2.txt — rep
skipped`). With the pin's mark set (r1, r3 only) my run loses r3 as well: `r3: missing mark boundary
— rep skipped`. So the new order is strictly better in the failure case, not merely equal.

**Doc paragraph vs my finding.** The new paragraph after the nominal-interval block names the lag
(`residual lag`), names the components, declines to quantify it as measured (`The lag is not
measured.`), gives the direction one-way with the right three contaminations (decode gets the
teardown, decode's head sits in prefill, prompt's head sits in load+idle), gives a bound, and states
the decode side stays comparable with v2. It also correctly *omits* the pull from the lag and does
not include the mark's own adb round trip — the timestamp is read on-device by `cut` before any
transport, so that latency is not in Δ′. That is more accurate than round 1's enumeration.

Two sentences I would change, one of them a real misstatement:

1. *"On this geometry, a plausible 0.05–0.5 s lag is 0.1–2% of decode and up to about 10% of a
   short prefill."* — the decode share is wrong at the fast end of its own geometry. The committed
   sidecars' `decode_s` spans **3.297–71.111 s**, so 0.5 s is **15.2 %** of the 1.2B PURE decode and
   0.70 % of the longest: the honest range is 0.07–15 %, with the stated 0.1–2 % valid only for the
   ≥30 s decodes. The prefill half holds (shortest `prefill_est_s` 4.513 s → 0.5 s = 11.1 %, covered
   by "about 10%"). This is the one sentence in the paragraph that overstates.
2. *"so this residual lag is identical in v2 and v3 for the decode side"* — identical to within a
   few milliseconds, not exactly: v3 now has **nothing** host-side between the CLI return and the
   mark, while v2 ran the `! -s "$out"` test, the `speed_of` grep and the `blog` (`date` + `tee`)
   there (≈1–5 ms here), and the v3 CLI writes the 88-byte sidecar before exiting (≈0.1–1 ms). The
   net is a few ms *smaller* in v3, i.e. the residual error moves in v3's favour; the comparability
   conclusion stands, only the word "identical" overstates.

---

## F3 — count cross-check — **CONFIRMED, with one residual silent path**

Counterexample re-run (predecessor's exact geometry: real 1.2B PURE stem, doctored stamp
`predicted_n=7`, tracked manifest says 30, manifest passed on the command line):

```
row r1: gen_tokens=7
warnings: phase stamp predicted_n (7) differs from manifest gen_tokens (30); load+idle bucket …
j_decode=15.783  j_per_tok_decode=2.255            (honest value 0.184 → 12.3× inflated)
exit=0, sidecar written
```

Both values are named in the row warning; the publish-wrong-number case is now *flagged*, not
silent. An honest stamp derived from the run's own speed line (prompt 51, predicted 30, per-rep
`predicted_ms` = the v2 `decode_s`) produces **zero** disagreement warnings on all three reps — the
new check has no false positives on the documented path.

Absurdity band (executed, one case each):

| stamp | result |
|---|---|
| `predicted_n=0` | FATAL `phase stamp predicted_n = 0 is outside the sane range 1..1000000000 - incoherent input`, exit 1, no sidecar |
| `predicted_n=100000000000000000000` (1e20) | FATAL same form, exit 1, no sidecar |
| `predicted_n=-1` | FATAL, exit 1, no sidecar |
| `prompt_n=0` | FATAL, exit 1, no sidecar |
| `predicted_n=1000000001` | FATAL, exit 1, no sidecar |
| `predicted_n=1000000000` (boundary) | accepted, publishes `j_per_tok_decode=0.000` **and** warns about the manifest disagreement |

**Upper bound: 1,000,000,000 tokens** (`MAX_STAMP_TOKENS`, enforced with `Number.isSafeInteger` plus
the range). Defensible as an *absurdity* guard — at the campaign's 2–9 tok/s, 1e9 tokens is 4–16
years of decode, and the unsafe-integer test catches values that cannot be counted exactly. It is
**not** sufficient as a provenance guard: my boundary case shows a stamp that passes the band and
publishes a nonsense `0.000 J/tok` with no in-band complaint of its own; only the manifest
cross-check catches it. That is consistent with the round-1 reading, but the doc sentence "The
accepted stamped count range is 1 through 1,000,000,000 tokens" should not be read as "counts that
pass the band are trustworthy".

**R1 (LOW, residual).** `countSources` in `splitStampedRep` compares the stamp against the perf line
and the manifest **only** — not against the documented `--prompt-tokens/--gen-tokens` provenance.
Measured: doctored stamp + `--prompt-tokens 51 --gen-tokens 30`, no manifest →

```
exit=0, warnings cell: "load+idle bucket low-resolution: …" (nothing about the counts)
j_per_tok_decode=2.255 published silently
```

The tool does print `WARNING: --counts-manifest is the preferred count source …` on stderr in that
invocation, which is the only mitigation. One-line fix: add
`["predicted_n", stamp.predictedN, "--gen-tokens", cliGenTokens]` and the `prompt_n` twin to
`countSources`.

**NIT (behaviour change beyond the brief's ask).** The count regex now accepts a leading `-`, so a
negative count *parses* and then refuses the whole stem, where it previously failed the regex and
fell back to v2 arithmetic with a warning. Loud over silent is the right default for this framework,
but it converts a degradable row into a fatal campaign post-processing failure; if that is not
intended, the fallback branch is the alternative.

---

## F6 — empty decode bucket publishes empty cells — **FIXED for the tested geometry, residual in the sibling geometry**

Executed, my own fixtures (samples 50/51/52 at 1 Hz, mark 54.00, constant 1 W):

| case | `decode_s_int` | `j_decode` | `j_per_tok_decode` | `n_decode` | warning |
|---|---|---|---|---|---|
| `decode_start = 53.0` beyond the last sample (the harness's `empty_decode` case) | `""` | `""` | `""` | 0 | `decode bucket has no intervals …` |
| `decode_start = 51.5`, i.e. exactly one sample left in the bucket | `0.000` | `0.000` | `0.000` | 1 | `decode bucket low-resolution: 0 interval(s) … (coverage 0.00/2.50 s = 0%)` + `implied decode power 0.00 W … outside the 0.1-20 W sanity band` |

So the fix is `decodeInt ? … : ""`, and `decodeInt` is null only when `d == win.length`. When the
decode bucket holds one sample but no interval, `integrate()` of that one-row slice returns a
non-null object with `duration_s = 0`, the condition passes, and the row publishes hard zeros —
the same consumer hazard round-1 F6 described (a reader who drops the warnings column reads
`0.000 J/tok`). Meanwhile the two new doc sentences say, verbatim, that `j_decode` "is empty when
the decode bucket has no intervals" and that `j_per_tok_decode` is "empty when the decode bucket has
no intervals". That bucket **has** no intervals and is not empty: **doc-versus-code mismatch
introduced by the fix**, and the harness's new `empty_decode` fixture covers only the zero-sample
geometry, so the check passes while the sibling case stays uncovered.

**R2 (LOW, residual, one-line fix).** In `splitStampedRep`, require at least one interval:

```js
const decodeInt = d < win.length - 1 ? integrate(decodeSeg) : null;   // was: d < win.length
```

(`n_decode` stays `win.length - d`, so the sample count and the exact-partition property are
unaffected; the cells merely go empty as the doc already claims.) Add a one-sample decode tail
fixture to the harness so both geometries are checked.

Note the same class exists on the untouched v2 path (`row.j_decode = fmt(roundJ(whole.joules -
preInt.joules))` with a one-sample segment) — out of the delta, unchanged by this commit, but if the
convention is "no intervals means unavailable" it should be uniform.

---

## F4 / F5 — the two corrections — **PRESENT and factually right**

**F5 (doc sentence, now correct).** `docs/ENERGY-SCHEMA.md`: *"A fully unstamped stem reports one
fallback line per emitted row on stderr; a mixed stem records fallback only in the v3 row's
`warnings` cell."* Code: the stderr loop is `if (phaseStampTexts.size === 0) for (const r of rows)`
and `rows` holds only emitted rows. Measured: the fully unstamped 4-stem run printed exactly three
lines per stem (12), and the mixed doctored stem printed **zero** such lines while its r2/r3 rows
carry `phase stamps absent; fell back to kalsa-energy-rep-v2 arithmetic; prefill bucket
unavailable; j_load_idle includes …`. The old sentence ("The command also reports that fallback per
row on stderr") is gone.

**F4 (the withdrawn R4/N6 caveat).** The new paragraph — *"That caveat is normative even though the
historical v2 row-warning text ends at 'the sanctioned use': the tracked v2 sidecars retain that
wording for byte identity. Always read `decode_s_int` and compare coverage before using a
low-resolution between-arm delta."* — is present, and both factual claims verify: `LOWRES_TAIL`
(`energyPhaseSplit.mjs:255`) still ends at "remain the sanctioned use" (and the harness constant
`:96` is byte-identical to it), and the four tracked sidecars regenerate byte-identically. The
commit message no longer claims byte-identity (it has no body), so the false claim from `522903c` is
not repeated. **NIT:** the paragraph blames the tracked sidecars; the actual constraint is the
*shared* warning text, so the short wording also appears in newly generated v2 rows. Worth one word
("the code's warning text is shared with the archived rows") but not a defect.

---

## Regression gates (all re-run by me, in this worktree)

| gate | claim | measured |
|---|---|---|
| `node scripts/energySchemaHarness.mjs` | 77/0 | **PASS (77 passed, 0 failed)** |
| `node scripts/energyPhaseSplitHarness.mjs` | 90/0, was 85 | **PASS (90 passed, 0 failed)**; check sites 85→90, **0 removed**, 0 reworded (85 common texts byte-identical), 5 added, `function check()` byte-identical to `522903c` |
| v2 sidecars, no stamps present | 4/4 byte-identical | **4/4 `cmp -s` clean**; no `*.stamps` anywhere in the tree (outside `tmp/`) |
| own re-integration, **real stem** | must match | 1.2B PURE + plausible per-rep stamps: all three buckets, all three `_s_int`, all counts match my independent integrator (max \|Δ\| 9.1e-04 J = print grid; raw sums equal the whole window) |
| own re-integration, **my synthetic stem** | must match | 16 samples @1 Hz, three power levels, mark 215.60, stamp 3500/5000 ms: load/prefill/decode = **24/3/8 J**, sum = whole **35.000000 J**, `n = 8/3/5` → ALL BUCKETS MATCH |
| `tmp/kalsallama-pin` | unchanged | `git archive 67c73d2 \| tar -x` + `diff -rq` → **0 differences over 3174 files** |
| `tmp/build-android/bin` md5s | `cca1187c7974655a50efe45d3cfd73d8`, `4e1eab9cd3d99a65373fe720193e4c24` | both **match** (mtimes 18:57) |
| fork commit scope | only `tools/cli/cli-context.{h,cpp}` | only `cli-context.cpp`; `.h` diff is 0 lines |
| `node scripts/matrixParityHarness.mjs` (extra) | — | PASS (15 passed, 0 failed) |

Re-integration is my own parser + right-Riemann integrator (`/tmp/kalsa-flip-2a/reintegrate.py`,
nothing imported from the repo): interval `[t_k, t_{k+1})` carries sample `k+1`'s power,
`p = |i·v|/1e12`, `p`/`d` = first sample at/after `prefill_start` / `decode_start`, the phantom
interval to no bucket. Sample cells, real stem r1: mine `7.678826 / 8.414558 / 5.520912` vs tool
`7.679 / 8.415 / 5.520`.

---

## Binary coherence — is the unchanged `llama-cli` a stale artifact?

**Coherent, not stale.** Three independent checks:

1. **Where the code links.** `tools/cli/CMakeLists.txt`: `llama-cli-impl` = `cli.cpp` +
   `cli-client.cpp` + **`cli-context.cpp`** (a shared library); `llama-cli` = `main.cpp` linking it.
   The rebuilt executable is 7200 bytes and its dynamic section needs `libllama-cli-impl.so`. An
   unchanged executable hash with a changed `.so` is the expected outcome for a change inside
   `cli-context.cpp`.
2. **Content.** `tmp/build-android-phase-stamps/bin/libllama-cli-impl.so`
   (md5 `b35b2140f2ab708e537c315de9c98108`, matching the author's `b35b2140`) contains **0**
   occurrences of `continuing without phase stamps` and **1** of `KALSA_PHASE_STAMPS` (the `getenv`
   string) — down from 3 in round 1, i.e. the `.so` is the **post-fix** build. `llama-cli` contains
   0 phase strings. No file in either build dir contains the removed warning text.
3. **Timestamps.** `tools/cli/cli-context.cpp` mtime 23:30:05; `cli-context.cpp.o` 23:37:36;
   `llama-cli`/`.so` 23:37:36. `llama-cli` md5 `d376e404e0265426de69bb9b77b94a49` — the author's
   value.

Caveat: I cannot verify either of the two *before* values the author cites for this build dir — the
round-1 `llama-cli` hash (round 1 did not record one) and the pre-fix `.so` `5a0d5e61` — because the
23:12–23:18 build was overwritten at 23:37. What is confirmed is the current `llama-cli` hash
`d376e404…`, the current `.so` hash `b35b2140…` (matching the author's "after" value), the post-fix
content of the `.so`, and the structural reason the executable hash may legitimately not move.

**Still open from round 1, operational (R7):** the campaign's default `LOCAL_BIN` is
`tmp/build-android/bin`, whose `libllama-cli-impl.so` has **0** occurrences of `KALSA_PHASE_STAMPS`.
A campaign launched without `LOCAL_BIN=tmp/build-android-phase-stamps/bin` produces no stamps at all
— v2 rows plus one `MISSING/EMPTY` blog line per rep and one `phase stamps absent` stderr line per
row. Detectable, but it is a v2 campaign wearing v3 intentions; the v3 doc still names no binary
prerequisite.

---

## Residual list (non-blocking, ordered by what would change a number)

| # | sev | where | one-line fix |
|---|---|---|---|
| R1 | LOW | `energyPhaseSplit.mjs` `countSources` | add `--prompt-tokens`/`--gen-tokens` to the cross-check list so the flags provenance cannot be overridden silently |
| R2 | LOW | `energyPhaseSplit.mjs` + doc + harness | `const decodeInt = d < win.length - 1 ? integrate(decodeSeg) : null;` and add a one-sample decode-tail fixture |
| R3 | LOW (doc) | `docs/ENERGY-SCHEMA.md` lag paragraph | "0.1–2 % of decode" → "0.07–15 % of decode (0.1–2 % for the ≥30 s decodes)"; the bound as written does not hold for the 3.3 s decodes in the same campaign |
| R4 | NIT (doc) | same paragraph | "identical in v2 and v3" → "identical to within a few ms (v3 drops the host-side checks between the CLI and the mark and adds the sidecar write inside the CLI)" |
| R5 | NIT (doc) | F4 paragraph | name the shared `LOWRES_TAIL` text, not only the tracked sidecars, as the byte-identity constraint |
| R6 | NIT | `parsePhaseStamp` + `splitStampedRep` | decide whether a negative stamped count should be fatal (now) or a v2 fallback (before); document the choice |
| R7 | operational | `LOCAL_BIN` default / v3 doc | name `LOCAL_BIN=tmp/build-android-phase-stamps/bin` in the v3 doc or make it the campaign default; otherwise the new harness line fires every rep |
| R8 | NIT | harness log | a failed pull now logs two lines per rep (`pull FAILED`, `MISSING/EMPTY`); harmless, but log volume doubles whenever stamps are absent (R7 in play) |

## What I could not test

* **The aarch64 CLI was never executed** (no device, no `qemu-aarch64` on this host). F1's runtime
  claim rests on the byte-exact body replay + the negative control + the static proof that the delta
  adds no output path + `strings` evidence that the shipped `.so` is post-fix.
* **Δ′ is still unmeasured** — the lag direction, the pull's contribution and the on-device mark
  timing all need a device session. My F2 evidence is the statement order, the exit-path enumeration
  and the executed proof that no `-e` is in force; the magnitude claim in the doc (R3) is reviewed,
  not measured.
* **The device-side silence of the `.so`** is inferred (0 old-warning strings, mtime, object file),
  not observed.
* **The perf-line branch of the F3 cross-check** cannot be exercised on campaign data: the captures
  contain no `llama_perf_context_print:` lines (the tool's own header says so), so only the manifest
  half of the check is reachable with real stems.
* **The round-1 hash of the phase-stamps build** cannot be recovered (build dir overwritten); the
  pristine `tmp/build-android` hashes match the brief exactly.

## Commands executed (read-only; scratch under /tmp/kalsa-flip-2a/)

```
# app side
git -C kalsa-ngram-spec status --porcelain ; git show --stat 708499f ; git log -1 --format=%B 708499f
git show 708499f -- docs/ENERGY-SCHEMA.md scripts/device-ngram-spec.sh scripts/energyPhaseSplit.mjs scripts/energyPhaseSplitHarness.mjs
node scripts/energySchemaHarness.mjs ; node scripts/energyPhaseSplitHarness.mjs ; node scripts/matrixParityHarness.mjs
node scripts/energyPhaseSplit.mjs /tmp/kalsa-flip-2a/v2run --counts-manifest scripts/fixtures/energy-counts/manifest.csv
for f in /tmp/kalsa-flip-2a/v2run/*.phases.csv; do cmp -s "$f" device-ngram-spec-out/$(basename $f); done   # 4/4
node scripts/energyPhaseSplit.mjs <case dirs: doctored, zero, huge, neg, pnzero, bound_ok, bound_over, noflag, noflags2>
python3 /tmp/kalsa-flip-2a/reintegrate.py <real stem> <synth stem> <decode_0sample> <decode_1sample>   # my own integrator
git show 522903c^:scripts/device-ngram-spec.sh | sed -n '/^clean_out()/,/^}/p'   # vs HEAD -> identical
git show 522903c:scripts/energyPhaseSplitHarness.mjs > … ; python3 …   # check-site delta 85->90, 0 removed
bash -c 'set -uo pipefail; source scripts/device-share-send.sh; adb(){ :; }; device_keepawake_begin; case $- in *e*) …'   # -e not active
bash /tmp/kalsa-flip-2a/f1_harness_replay.sh     # blog()/results.txt replay, 3 cases
# fork side
git -C kalsallama-wt-phase-stamps show --name-only --format="" 2998ad5d6
git -C … show ba33d8b | grep -n "stderr\|printf" ; grep -n "phase_stamps" tools/cli/cli-context.cpp
bash /tmp/kalsa-flip-2a/f1_gen.sh        # extract 456-479 verbatim, compile, assert 23/23 lines identical
./f1_replay <5 geometries>               # 0 B stdout, 0 B stderr, rc 0
bash /tmp/kalsa-flip-2a/f1_gen_parent.sh # negative control: parent body prints the warning
git -C … archive 67c73d26 | tar -x -C /tmp/kalsa-flip-2a/pinexport ; diff -rq pinexport kalsa-ngram-spec/tmp/kalsallama-pin   # 0 diffs / 3174 files
md5 -q tmp/build-android/bin/{llama-cli,libllama-cli-impl.so} ; md5 -q tmp/build-android-phase-stamps/bin/{llama-cli,libllama-cli-impl.so}
strings -a tmp/build-android-phase-stamps/bin/libllama-cli-impl.so | grep -c "continuing without phase stamps"   # 0
strings -a tmp/build-android-phase-stamps/bin/llama-cli | grep libllama-cli-impl.so                               # DT_NEEDED
```

## Final verdict

**SHIP.** The three head-line flips verify under my own execution: the stamp failure paths produce
**0 bytes on stderr and rc 0** (five forced geometries, with a negative control on the parent body
that still prints the warning), the harness reports the condition through `blog()` into
`results.txt` while `clean_out()` is untouched, the mark is written immediately after `llama-cli`
with the pull and the integrity check after it on every non-signal path (no `set -e`, executed
proof), and a doctored stamp now names both counts in the row warning while `0`, `-1` and `1e20`
counts are fatal with no sidecar. F6's targeted case publishes empty cells; F4/F5's corrections are
present and true. 77/0, 90/0 (0 removed, 0 reworded, 5 added), 4/4 byte-identical v2 sidecars, my
own integrator matching the tool on a real and a synthetic stem, pin tree and pristine binaries
unchanged, and a structurally coherent post-fix `.so` behind the unchanged `llama-cli`.

The four residuals worth a line before the first stamped campaign, in order: **R1** (add the flags
to the count cross-check — the only path that can still publish a wrong J/tok with no warning),
**R2** (one-sample decode bucket: emit empty cells as the doc already claims, and test it),
**R3** (correct the lag share in the doc: 0.07–15 %, not 0.1–2 %), **R7** (name the stamped
`LOCAL_BIN`, or the campaign silently produces a v2 dataset). None of them makes a published number
wrong on the documented invocation path (`--counts-manifest`, stamped binary), so the verdict is not
conditional on them.
