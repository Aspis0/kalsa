> Archived full history: archived/PLAN-2026-09-full.md (3162 lines, Italian, frozen 2026-09-20).

# Kalsa: PLAN (living)

Owner decision 2026-09-09 (recorded at `archived/PLAN-2026-09-full.md:1`): two living documents
only, this PLAN and `docs/ALIVE.md`. Everything older is frozen under `archived/`. This file
replaces the Italian PLAN as the living document;
the full history (the dated decision diary and the register of banked measurements) is in
`archived/PLAN-2026-09-full.md`.

## STANDING RULE (owner, 2026-09-21, permanent and absolute): NOTHING GOES UPSTREAM

Nothing goes upstream. Ever. No pull requests, no issues, no comments on issues or PRs, no reviews,
no patches, no discussion posts, no mailing list, no Discord, nothing.

Reading upstream is allowed and useful: `git fetch upstream`, `git log`, `git grep`, reading the
GitHub pages of issues and PRs for our own information. Writing anything upstream is forbidden, by
us and by any agent acting for us, whoever the account is. We do not contribute back, we do not
comment, we do not announce, we do not coordinate. The fork is ours and stays ours.

Where an earlier record says "push this as a PR", "comment on issue X" or "review patch on PR Y",
the fork-only equivalent applies: keep it in the branch, or delete it. The checkpoint-appendix work
that overlaps upstream PR #26004 is simply OUR code, kept as it is; we do not touch their PR.

This rule sits ABOVE the standing push/tag/release rule: push, tag and release additionally require
the owner's explicit OK.

## STANDING RULE (2026-09-23): A CODER'S REFSPEC IS A PROPOSAL, NOT A DECISION

The shipping line moves only when the audit's checklist is cleared, and the branch that holds a
candidate fix is a *different object* from the line that ships. A push command written against
`refs/heads/kalsa-phone-v1-1-1` (or any shipping ref) is a proposal for the owner, not an
instruction: on 2026-09-23 such a refspec appeared in a coder's push block
(`scratchpad/agents/cok-residual/REPORT.md` sec. 9, marked UNRUN), what was executed created
`kalsa-opencl-cok-korder` as a new ref instead, and `kalsa-phone-v1-1-1` was verified unmoved at
`1577495b9` afterwards (re-verified with `git ls-remote` while writing this line). This rule
recurs on every future fix: review the REFSPEC, not just the patch.

## What Kalsa is

Kalsa is an Android chat app that runs language models on the phone itself, with no server in
the loop. The standing goal (owner; recorded at `archived/PLAN-2026-09-full.md:9`) is a kernel
that uses NPU, GPU and CPU **per phase** according to temperature, battery and device profile,
optimised for Snapdragon and for MediaTek/Jelly where possible. The app already imports the
forked `llama.rn` binding (`src/engine/LlamaService.ts:13`,
`src/engine/EmbeddingService.ts:35`). What is not in use is the per-phase governor, which is off
by default; see "Governor" below.

The app is React Native. The engine is our fork of llama.cpp, consumed through our fork of the
`llama.rn` binding as a git dependency pinned by commit. Device measurements are the arbiter; the
lab repo holds the method, the raw evidence and the audits.

## The four live repos

The authoritative map, with the canonical role and status of each repository, is `REPOS.md` in
the app repo (`Aspis0/kalsa`, file `REPOS.md`). Defer to it; do not restate it here.

The four live checkouts named in the repo map exist on this Mac (checked with `ls -d`):

| repo | local checkout | role |
|---|---|---|
| `Aspis0/kalsa` | `~/Projects/kalsa` | the app |
| `Aspis0/kalsallama` | `~/Projects/kalsallama` | our llama.cpp fork: OpenCL MoE kernels, repack, governor |
| `Aspis0/llama.rn` | `~/Projects/llama.rn-kalsa` | the React Native binding fork, now on the `vendor/` layout |
| `Aspis0/kalsa-moe-experiments` | `~/Projects/kalsa-moe-experiments` | the lab: this repo, measurements and evidence |

One repository is archived read-only: `Aspis0/kalsa-forkbigmoeonedge`, kept as a submodule of
the lab for provenance of the PC campaign binary. `REPOS.md` records that status.

## The two-living-docs rule

`PLAN.md` and `docs/ALIVE.md` are the only two living documents. Two classes of live record sit
outside `archived/` on purpose: the dated findings and contracts under `analysis/`, and the
per-cell evidence under `scratchpad/agents/`. Every other `.md` is frozen, either under
`archived/` or in place where it was produced (the campaign material under `results/`,
`reports/`, `ops/` and `scratchpad/`). The count is whatever this command prints, so it cannot go
stale: `git ls-files '*.md' | rg -v '^(archived/|PLAN\.md$|docs/ALIVE\.md$)' | wc -l`. Preserved archive
blobs are byte-fidelity copies:
they keep their original language, Italian included, and are not translated. The rule exists
because duplicate living docs have twice cost real time: two files that both claim to be current
always drift, and a reader cannot tell which one is stale.

## Verified state, 2026-09-20

Each item in this section names the command or file that proves it. Run the command to get the
current value; values that move under concurrent work are not restated as if frozen, because a
reader cannot tell how old a copy is.

### The app and its engine pin

- `Aspis0/kalsa` `origin/main` is `5429799`. It pins the binding fork at
  `llama.rn@0f313bab` in `package.json:49`.
- The local `main` in `~/Projects/kalsa` is `745bf82`, one commit ahead of `origin/main` and
  unpushed (`git rev-list --left-right --count origin/main...HEAD` → `0  1`). Its parent is
  `5429799`. The commit adds a `CW_CORPUS` knob to `scripts/device-ciswire-cache.sh` (dense
  default, prose variant) for the char-vs-token device measurement.
- The app repo carries many local and remote branches, not one. The branch list is read with
  `git for-each-ref`; `REPOS.md` is the map.

### The engine fork and the `vendor/` layout

- The binding fork `Aspis0/kalsa.rn` (recorded as `Aspis0/llama.rn` in older notes) works on
  upstream's `vendor/` layout. The engine tree is
  `vendor/llama.cpp/`, and the pin lives in `vendor/VERSIONS`, not in the retired
  `native/kalsallama.pin`.
- At the shipped binding pin `0f313bab`, `vendor/VERSIONS` names
  `LLAMA_CPP_REPO=https://github.com/Aspis0/kalsallama` and
  `LLAMA_CPP_COMMIT=8537d097c32e7307d82540b6da8eb448d7e07107`. That commit was the tip of
  `b11010-merge` at that pin; the branch has since moved past it. The engine release tag points at
  `4ccef2f8`, and the current `origin/b11010-merge` tip is `916b8f0bcfcb829011f129b4dff8acfd01ab7814`
  (see "Engine release: current position and next steps").
- The migration away from the flattened `cpp/` tree and its symbol-rename scheme is recorded in
  `analysis/FORK-VENDOR-MIGRATION.md`, together with the measured upstream bump and the list of
  app-side consumers repaired with it.

### The q4_K MoE OpenCL fix is in the shipped engine

Earlier records said the fix was only on the `opencl-moe-masks` branch and therefore absent from
the shipped pin. That is wrong.

- The two fix commits are `2361be359` ("pass the get_scale_min_k4 masks as kernel args in the
  q4_K dp4a MoE GEMM") and `26c7affb7` (the same treatment for
  `kernel_gemv_moe_q4_k_f32_ns_wimg`).
- Both are ancestors of `8537d097c`: `git merge-base --is-ancestor 2361be359 8537d097c` exits 0,
  and so does the same command for `26c7affb7`.
- `b11010-merge` was created from `2361be359` on 2026-09-19 10:54:32 EDT and then had the
  `b11010` tag merged on top of it. The reflog records it:
  `2361be359 b11010-merge@{2026-09-19 10:54:32 -0400}: branch: Created from HEAD`.
- The vendored kernels in the shipped pin carry the mask-as-arguments form. At `0f313bab`,
  `vendor/llama.cpp/ggml/src/ggml-opencl/kernels/gemv_moe_q4_k_f32_ns.cl` calls
  `get_scale_min_k4(j, sc, &sv, &mn, mask_d6, mask_d4, mask_hi2)` at `:99` and `:219`; the same
  form appears in `gemm_moe_q4_k_q8_1_dp4a.cl` and `gemm_moe_q4_k_f32_ns.cl`.

Consequence: a standing claim that GPU+MoE with the governor dies at load on the shipped engine
is not supported by the shipped pin. Whether the governor path needs more than this kernel fix is
a separate question, and the governor numbers are under re-verification below.

### Governor

- The governor is off by default. `readGovernorEnabled()` reads the `kalsa.governor.enabled` key
  from `AsyncStorage` (`src/engine/governorRuntime.ts:15-21`) and returns false while the key is
  absent. The key is written only when the user flips the Settings toggle: `writeGovernorEnabled()`
  persists it with `AsyncStorage.setItem(GOVERNOR_ENABLED_KEY, …)` (`src/engine/governorRuntime.ts:27`),
  and `handleToggleGovernor` in the shipped Settings screen calls it
  (`src/screens/SettingsScreen.tsx:501`). A clean install is therefore off and stays off unless the
  toggle writes the key. The load path additionally requires `sensor_valid` before the governor is
  used (`src/engine/LlamaService.ts:2314`). Both facts are read from `origin/main` of the app.
- The device plan is `analysis/GOVERNOR-DEVICE-PLAN.md`, in English. The 2026-09-19 audit of the
  earlier Italian plan was re-read on the artefacts on 2026-09-20 and the plan was rewritten; the
  audited Italian body is archived byte-for-byte at
  `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md`, and the re-verification is
  `scratchpad/agents/governor-audit-recheck/REPORT.md`. The owner un-parked the device plan on
  2026-09-21 and brought its first three steps forward; see the owner decision below and
  `git log` commit `db49fe2e`. The analysis file's status header still reflects the earlier park.
- The rewritten plan states its own sourcing rule and applies it: every number carries an artefact
  citation or an explicit UNSOURCED label with what would settle it. The design
  shape (Rule 1: decisions contain no device identity; Rule 2: matrix as data; Rule 3: one
  selector; probes fail closed) survived the audit unchanged.

## Verified state, 2026-09-22

The numbers, the tables and the per-cell artefacts for the whole day are in `docs/ALIVE.md`,
"2026-09-22". This section says what the state IS and what stays open; nothing here is smoothed
over.

### Headline: a defect the user can trigger, in the regime no arm had measured

At `ne1` 2..8 all 148 q4_K dense tensors run through the `_cok` kernel - operands and
accumulator both in **half**, never fixed: **0.304543 median KLD / 66.198 % same-top**, against
0.005412 / 93.982 % at b256 and 0.006012 / 93.138 % at b1. Every arm before tonight ran at 1 or
256, so this path had **never been covered** (`scratchpad/agents/s23-kld-740-q4-0/REPORT.md`
sec. 31b, 34; the three-row table with its trigger column sits at the top of `docs/ALIVE.md`,
and no row can be read without its trigger). The trigger is arithmetic and reachable: the app's
ubatch is **256**, so any prefill whose final chunk is 2..8 tokens runs that whole last chunk
through the kernel - **31 of 606 archived real turn-records (5.1 %)** land there (ubatch 512:
3.8 %), clustered at prompt lengths 516-519, which a growing multi-turn chat produces
countlessly. Caveats as measured: record-level (deduped per-turn <= 5.1 %, not exactly
computable from those files), laboratory sessions not field traffic, assumes `llama_decode`'s
ubatch split. The fix-verification pair is pre-registered before the binary exists (sec. 35):
control must reproduce 0.304543 exactly or the pair is void; complete fix <= ~0.0065.

### The `_cok` tail fix: FIXED, AUDITED, NOT YET SHIPPABLE

Commit `319b539377605f6c572e234b28678b74bd78deb5` on branch `kalsa-opencl-cok-fp32`, one commit
above the shipping tip `1577495b9`: the `ne1` 2..8 `_cok` accumulator becomes `float8`, the
product `convert_float8(B) * (float)dq`, corrected behaviour the default, old behaviour behind
`KALSA_COK_ACC=fp16`. Phone pair (s23 sec. 35 pre-registered, 36.1 results): control reproduced
**0.304543 / 66.198 % exactly** (gate passed); treatment **0.006890 / 93.138 %** - 44x lower
KLD, +26.9 pp, **99.51 % of the b8-vs-b256 gap closed**, 0.00039 above the complete-fix line of
0.0065 -> recorded as **partial**, not rounded up. Price: **+8.3436 %** on a b8-only worst case,
**0 % in decode**, and the audit's *estimate* of ~0.235 % for a 3,080-token prefill (estimate,
not measurement). Old path fast-and-wrong (GPU ppl 32.55 vs reference 27.21), fixed
slower-and-correct (24.44).

**The audit refused shipment** (`scratchpad/agents/cok-accumulator-audit/REPORT.md`, 250 lines):
the numbers reproduce; 99.5059 % closure makes "partial" honest; selector and cache-key
protection check out; **two of the author's literal claims refuted** (one module-scope
declaration beyond the `_cok` body; the eager-both-variants cache explanation wrong); the
**+0.001478 residual is NOT VERIFIED as a floor**, with the **K-split accumulation order** as
the named next ablation; provenance established **by triangulation** because the promised WARN
line never appeared in the stderr captures. **Not shippable because** the pair used a model, KV
configuration and attention setting different from the app's (`q8_0`/`q4_0` KV, flash `auto`).
Shipping checklist as recorded: app-shaped accuracy + tail-speed + decode check -> explicit
decision on the partial threshold and the residual -> each pin verified against the exact
reviewed SHA -> APK built and hashed from that chain -> that APK installed -> its runtime arm
and cache identity captured with a measured result. The artefact to clear is the final APK, not
the separately measured `llama-perplexity`. Diary version: `docs/ALIVE.md`, Headline and the
2026-09-23 entry.

### The residual's next ablation: built, prediction on disk

`scratchpad/agents/cok-residual/REPORT.md`: the +0.001478 the audit left NOT VERIFIED has a named
candidate - the batch-256 kernel walks K **serially inside one work-item** (`:70`, accumulators
at `:61`, no K reduction in `:145-177`) while the `_cok` path **strides K across 8 subgroups**
(`:438`) and sums subgroup partials (`:494-505`) - effective order `[0,8,16,...]+[1,9,...]+...`
against `0,1,2,...`, and floating-point addition is not associative. Ablated behind
`KALSA_COK_KORDER` (default = serial = the b256 order; `split` = previous behaviour;
`KALSA_COK_ACC=fp16` still pins the shipped kernel, so the pre-registered control stays one env
value), dispatch, args and launch geometry untouched. Control evidence in the strongest form:
IR **byte-identical to the shipping `1577495b9`** with `KSPLIT`, and **byte-identical to
`319b53937`'s treatment kernel** with `fp16` (both `cmp -s` rc=0). Branch
`kalsa-opencl-cok-korder` (pushed as a NEW ref - standing rule above), commit `7965f43e0`, build
11203, binary sha256 `6ff4124b4c8a6449cca7e880556f94a3a2d90cb233151411d0439664e328c747`, seven
targets `0 0 77 77 0 0 0`. **Prediction timestamped before the build** (sec. 3, 03:25 EDT):
treatment at or below the ~0.0054 neighbourhood; if it sits on 0.006890, the residual is
something else and **we stop** - no third attempt.

### GPU numerics: the cause is found, the gate is still not reachable

- The 57x divergence was the **fp16 activation block scale**. A/B
  (`scratchpad/agents/s23-kld-740-q4-0/REPORT.md` sec. 22): fp16 control bitwise stock
  (0.394993 / 63.892 %), fp32 arm **0.005412 / 93.982 % at 76.44 t/s** - better on both gate limbs
  than the f32 route (0.006954 / 92.913 % at 68.42) and faster than stock, so the -9.9 % prefill
  cost is recovered. The shipped default with no env var reproduces it (sec. 23):
  **0.005412 / 93.982 % / 76.36 t/s**. Gate: still FAIL both limbs - the closest any arm has been.
- The `-b 1` floor probe (sec. 17) closed two axes: at batch 1, stock and full precision are
  **bitwise identical, 0.006012 / 93.138 %, FAIL both limbs**. The acceptance gate (<= 0.005) is
  **not reachable by batched-GEMM precision work**: the residual is common to both batch shapes,
  not a batching artefact.
- The activation-quantiser reading of that common residual was **refuted** today
  (`scratchpad/agents/quant-alignment/REPORT.md`): at batch 1 the quantiser never executes (all
  seven dispatch sites closed; the b1 GEMVs are f32 end to end), and where it does run, removing
  it costs +0.001542. New lead: **weight-side fp16 in the K-quant kernels** - the fp16 `half4
  dequantized_weights` (`gemm_noshuffle_q4_k_f32.cl:63`) and the gemv `d*sv` half sub-scale,
  present in both batch shapes and never measured on q4_K/q6_K anywhere. The reference-side Q8_K
  floor is the other survivor.
- **Two zero-build probes are running** (instrumented `-b 1` enqueue counters; the env-only q4_K
  dp4a forcing probe at b256). The falsifiers are pre-registered in that report's section 3 and
  are the record of how to read the results: `quant_a=0` at b1; the forcing probe >= ~0.0085 under
  the old hypothesis, < +0.002 kills it; a Q8_K-matched build must move >= -0.0005 (<= -0.0002
  falsifies it); a b1 arm with harness-proven CPU-matched activation codes staying >= 0.0055
  falsifies the floor and hands the lead to the weight side. Two anomalies stay open: b1 and b256
  were scored against different references (PPL 27.0660 vs 27.2114), and the +0.001542 where the
  f32 route is worse than the int8 route is unexplained. The pattern the day keeps: **a hypothesis
  is only useful if the number that would kill it is written before the measurement.**

### The Z2 attribution matrix: VOID by its own gate

The pre-registered gating control had to reproduce **5.103422 / 12.373 %** and read **5.635640 /
9.280 %** - deviation, so the cross-binary matrix is VOID as designed; the corrected control
(criteria written before it ran) read **0.005454 / 94.488 %**, far outside the salvage band, so
**the matrix stays VOID and that is the finding** (`s23-kld-740-q4-0/REPORT.md` sec. 32).
Mechanism: `e64352ac1` moved the UNSET default at the q4_K site to fp32, so the new binary can
no longer reach the state Z2 measured. What survives within one binary: 0.005454-0.005615
(ship-default neighbourhood), a **-99.9 % collapse** (5.635640 -> 0.005615), with a byte-equal
companion replication (0.005615 / 94.263 %). Honest summary of that path: **fp16 `da` at the
q4_K site is the destroyer, fp16 `sa` adds about half on top, and with both gone the numbers
are ordinary.** Still open on this thread: the forced config's speed (not ordered).

### The KV term: measured, magnitude OPEN

At the app's shipped KV configuration (`q8_0` key / `q4_0` value, `-fa on`) the shipped engine
reads **0.010268 / 92.126 %** full corpus and **0.011096 / 92.717 %** reduced corpus
(`scratchpad/agents/s23-kld-740-q4-0/REPORT.md` sec. 24, 26) - about **twice** the kernel-side
error (0.005412). The isolated term is **+0.0015 to +0.0048** depending on reference orientation
(reduced vs full corpus disagree by 3.2x), so the magnitude is **not yet settled**; the
full-corpus matched reference is queued. The pure flash-attention term is small: **+0.0009**
(matched, reduced corpus).

### The product question is answered; the safety marking stays a marking

Six realistic prompts all diverge textually with **zero material divergences**; memory facts differ
**10/10** with **zero rows where one arm is right and the other wrong** (reverse: 0); safety
**0/24 complied** across six categories at t0 and t0.7, with **four pre-answer cells flagged
RELEASE BLOCKER CANDIDATE** (S1_t07, S4_t0, S6_t0, S6_t07) and the truncation caveat attached: the
reasoning template consumes the token budget, so **0/10 final answers** (memory) were emitted.
Record: `scratchpad/agents/s23-kld-740-q4-0/REPORT.md` sec. 18-20. Acting on the flag needs a
budget-up re-run (n>=160) - owner's call.

### The stall reproduces on what we ship

`KALSA_STALL {"tokens":0,"reason":"prefill"}` at **+1175 s** (original +739 s) on APK `d3c66bdb`
(engine `1577495b9`), and a full raw logcat shows **zero native lines across 19.6 minutes** - a
silent stall, not a crash (`scratchpad/agents/jelly-rerun/REPORT.md` sec. 12). Run B completed
(+213.30 s, 75 tokens) but **two variables moved** (seeded EMA *and* warm KV), so "the EMA fixed
it" is not supported (sec. 13). Both runs ran at `ThrottlingStatus: SEVERE` where the originals
ran NONE - **the thermal limb is untested** (sec. 16).

### Governor trend: the question is CLOSED - inert at production cadence, unproven

Recorded as a conclusion, because the measurement was designed to end the question
(`scratchpad/agents/governor-trend/REPORT.md` round 4; harness `replay-wrongfire.cjs` +
`replay-out.txt` kept on disk). The estimator under test is the REAL `governorTrend.ts`
(sha256 `2769fc...afab63`); the decision side is an explicitly declared **re-implementation of
one rule** at the pin (`k_trend` L13, thresholds `h:45-52`, unplugged band `[38.5, 39.5)` from
L44, LOWBAT L128, trend line L140-143) - the engine never ran, and the report says so in its
first section; the TRUE/FALSE yardstick is the author's and is stated as his.

- Corpus: **75 sessions / 8871 rows loaded, 71 replayed**, named sources, named exclusions.
- Production cadence (the measured 280 s poll grid): **15 in-band opportunities, 0 flips**.
- Dense cadence: **122 opportunities, 2 flips, 1 classifiable - and that one was a FALSE fire**
  (38.6 C, trend 1.98, every gate passing; twelve seconds later 37.1 C; the absolute gate would
  still have arrived 1216 s later - against the at-most 40 s a trend fire can buy and the
  >= 600 s a wrong COOLMODE costs, the 200:1 asymmetry).

**Closing sentence: at the production cadence the feature is inert on the archived corpus, and
therefore unproven - not safe.** The methodological line kept beside it: **the file count is not
the sample** - the missing quantity is named as *in-band time at poll cadence with a recorded
outcome*. Consequences: (a) the trend producer is **not to be shipped as an escalation trigger**
on this evidence - the code is reviewed and honest, the value unproven; (b) the real lever
remains **a temperature feed at a higher rate on the poll path** (not the trace interval - the
1 Hz trace has no temperature column), and its cost is what the Meter experiment on the phone
is measuring; (c) the replay harness stays on disk so the question is re-asked when the corpus
grows, instead of being re-argued.

Supporting record: two attacks landed first - the post-hoc review (arithmetic confirmed, the
gap-anchoring defect refuted, mutation killed 7 of 13 tests;
`governor-trend-audit/REPORT.md`) and the numeric review (`governor-trend-numeric/REPORT.md`,
586 lines, including the replay that verified the coder's fail-before evidence): real poll gaps
**280.65 / 292.33 / 274.77 s** = about two samples per five-minute window; a 60 s burst diluted
by **4.7x** the threshold; a session whose battery rose **7.2 C** never reported above **0.75
C/min**; the engine consults the field only in a **1.0 C band** - the field is effectively inert
at the current cadence, which fails safe. Producer commits `7921719` + `ed55f7d` (app-only,
95 suites / 1243 tests), push UNRUN (open item 13).

### The Meter decision: rule, bar, pre-registration, soundness

- **Owner's rule** (`s23-kld-740-q4-0/REPORT.md` sec. 30): nearly zero consumption -> release
  APK, governor leans on it; real consumption -> development builds only.
- **The bar** (`governor-meter-recon/REPORT.md`, THE RANKING item 2), against the measured turn
  draw of **1,045 mA**: **1 % = ~10.5 mA (0.17 mAh/min) is cheap enough; 5 % = ~52 mA is
  self-defeating.** No measurement of the Kotlin sampler's own consumption exists on disk - it
  is the number the phone is measuring.
- **Pre-registered on disk before the measurement** (s23 sec. 30): **<= +5 % per turn =
  release-ready** (and within 3x the std-dev of the matched idle windows); **>= +15 % =
  dev-only** (between = dev); **> 10 % divergence between the CSV and the phone's charge counter
  = a finding that outranks the queue**.
- **Soundness** (`governor-meter-recon/REPORT.md` sec. 5): energy helps as post-hoc evidence, as
  a session budget and for residency, and is **unsound as within-turn control** - it lags the
  decision it would guide.

### The instrument lesson, twice - one disease: work that exists in exactly one place

1. The Meter arms itself through `run-as`, which needs a **debuggable** app; that flag was a
   one-line hand edit (`debuggable true`) in the gitignored, `expo prebuild`-regenerated
   `android/app/build.gradle`, and a clean prebuild deleted it along with the ability to measure
   energy on the release artefact. A **tracked bench build** is in flight, plus a channel that
   does not need `run-as` (`scratchpad/COORDINATOR-STATE.md`, "Results of 2026-09-22").
2. An APK whose hash was cited in a report (`fbfe131f...`) was deleted by the 2026-09-21 cache
   cleanup and exists nowhere on this Mac (`scratchpad/agents/jelly-rerun/REPORT.md` sec. 3, 8).
   Standing rule adopted: **an artefact whose hash is cited must be archived before any cleanup
   touches build output.**

### Overnight corrections and traps

- **Measurement rule: every timing ratio must state the screen state of both arms.** Screen ON
  (`mWakefulness=Awake`): shipped default **76.39 +/- 0.17 t/s** (inside the dozing band,
  confirmed equal), f32 route **71.98 +/- 0.07** = **+5.2 %** over the published 68.42; the
  default-vs-f32 gap narrows from **-11.7 %** (both dozing) to **-6.1 %** (both awake). The
  device's `screen_off_timeout` is 30000 ms - why every earlier timing was dozing
  (`s23-kld-740-q4-0/REPORT.md` sec. 33). Brackets now carry `mWakefulness`; older timings are
  marked "screen state not recorded", not retro-fitted.
- **Trap (a): symlinked `node_modules` - the day's disease in a new place.** In
  `kalsa-wt-gov-trend` the directory was a symlink to another checkout, and the provenance gate
  reads `node_modules/llama.rn` **through it** - the gate would have verified a different tree's
  installation, invisibly (the "most expensive kind of green";
  `scratchpad/COORDINATOR-STATE.md`, sixth lesson). Fixed by a real copy from the tree with the
  same pin, and re-verified in this pass by running the gate: `lockfile pins
  Aspis0/kalsa.rn@5b966218eadb`, `1119 files match`, `engine inside it:
  kalsallama@1577495b9209 == native/kalsallama.pin`, exit 0, tree clean afterwards.
- **Trap (b): a dirty tree that is not what it looks like.** The shared checkout's uncommitted
  files are **byte-identical to commit `1068eb03d`** (`git diff --quiet 1068eb03d -- .` empty
  for tracked files - `build-with-fixes/REPORT.md` sec. 2.4): nothing at risk, but a reader of
  that tree sees line numbers matching a commit that is neither `main` nor the shipped line;
  `shared-term/REPORT.md` sec. 0 therefore cites every line number from a `git show HEAD:` blob.
  The desk's lesson: attribution is two-part - **which commit AND which tree** - with a third
  verdict for numbers with neither: NOT ATTRIBUTABLE (`COORDINATOR-STATE.md`, seventh lesson).

### The delivery chain, verified end to end for the first time

- Release tag `kalsa-server-v1.1.1` on engine `a7d2cec79` (= `main` + the governor pair), artifact
  published to R2 with a manifest that names the tag object (`0f1b3bec...`) and the commit.
- Binding `kalsarn-governor-engine` = `5b966218`: the vendored tree is byte-identical to the engine
  archive plus the repo's 20 patches, by comparison (`scratchpad/agents/binding-prep/REPORT.md`
  round 2).
- App branch `engine-pin-kalsallama` = `e206a945`: provenance gate enforced and now **able to
  fail** - breaking the pin exits 2 with both shas printed (`scratchpad/agents/landing-check-fix/REPORT.md`,
  suite 37 passed / 0 failed).
- Caveats, kept honest: the CI run triggered by that push **failed before reaching the gate**
  (`android-actions/setup-android@v3` cannot fetch the removed `tools` package), so CI-enforced
  provenance does not exist yet - only the place where it should stand; and jest is dead in the
  binding's environment (12/12 pre-existing failures), so that layer has no test net.

### Desk panel number (other workstream)

Two devices decoding on one `kalsa-server-v1.1.1` engine, attributed to the release artefact by
its published sha (`exe_sha256` matched against the manifest row, `release.status = matched`).
The desk's answer to the figure discrepancy: **not a transcription - three different runs of the
same measurement**, all three registered:

| run | commit | per device | aggregate | A2/A | load floor |
|---|---|---|---|---|---|
| 1 | `5b9b98f` | 0.7546 (69.17 alone / 52.20 each t/s) | 1.5093 | 1.0105 | ~4-6 |
| 2 | `fe14e78` | 0.7302 | 1.4604 | 0.9982 | ~2 |
| 3 | `34de14f` | 0.7336 | 1.4672 | 1.0037 | 4.08 |

- **The panel row is run 3** - not for recency: the tightest drift control (1.0037 against
  1.0105), and its provenance travels as fields inside `results.json` rather than prose (a debt
  the desk declared, the following session paid).
- **Path-plus-commit rule:** run 3 overwrote `dev/results/concurrency-two-devices/results.json`,
  so run 1's artefact survives only in git history at `5b9b98f`. Cite the commit wherever the
  path is cited - two figures on one path otherwise read as a transcription error.
- **Not a constant:** the three runs agree within 3 % (1.4604 / 1.4672 / 1.5093), per-device
  0.73-0.75 - the spread is the floor, not the measurement. Read the figure with its artefact
  label and load alongside.

Record: the three commits above, `kalsa-brain` `dev/results/concurrency-two-devices/`, and
`kalsa-brain/docs/HANDOFF-2026-09-22.md` sec. 4.

### Desktop numbers: provenance verdict (CLOSED, not open)

Sweep: **228 REPORT.md files, 87 carrying speed lines - 4 desktop, 83 device or third-party** -
plus `analysis/`, `PLAN.md` and `docs/ALIVE.md` line by line
(`scratchpad/agents/governor-desktop-net/REPORT.md` sec. 3). Verdicts, with the three words kept
distinct (GPU-capable / CPU-only / NOT ATTRIBUTABLE):

- **Panel numbers** (69.17 / 52.20 / 1.5093 ...): **fully attributable** - the manifest ties tag
  -> commit `a7d2cec79` -> `exe_sha256 327fb363`, with `backend: metal` and a CI build:
  **contains the fix, GPU-capable**.
- **Slot-save** (1495.0 tok/s prefill, 71.33 decode): the dylib is Metal-capable (verified by
  `otool` on that exact artefact: one Metal reference), but the command line records **no
  `--n-gpu-layers`** - **the lane is not attributable**; labelled, not guessed.
- **A/B fork arm** (7.853 / 14.552 ms/token): a **CPU-only build**, confirmed by the CMake cache
  and by `otool` today, and its binary's mtime (15:23) predates the 15:24-15:29 dirty edits - the
  set survives **by luck, not by construction**; it needs a **CPU-only label rather than
  withdrawal**.
- **A/B release arm** (0.490): GPU-capable by its own single-flag control, but its **artefact
  path and tree are NOT ATTRIBUTABLE**.
- **Apple-silicon figure (0.94 / 0.61)**: upstream commit `e02b477` - **third-party, NOT
  ATTRIBUTABLE**.

One-sentence verdict, as recorded: **none of our published desktop numbers except the A/B fork
arm was measured on a CPU-only build; that pair already carries the explanation and needs a
CPU-only label rather than withdrawal; and the two unknowns are written NOT ATTRIBUTABLE rather
than guessed.** Finding on our own records: only the A/B and the panel record their **load
condition**, so the load-follows signature cannot be applied retroactively - **numbers we
publish should carry their load condition, or they cannot be re-examined later** (standing
caution in `docs/ALIVE.md`).

### Desktop net: a test-only matrix over the profile-validity gate

`test_profile_validity_matrix()` inside the existing `tests/test-governor-v02-router.cpp`
(`governor-desktop-net/REPORT.md` sec. 2): **11 rows asserting validity AND state AND lane AND
the admission consequence**, +37 check call sites, no new test file. **Proven to bite:** removing
the gate line produces **13 failures, ten of them from the new matrix** (the other three are the
fix's own pins), green again with the code right (ctest 1/1). **Test-only - it does not move the
tagged release; it hardens the next one** (worktree at `a7d2cec79`, only the test file
modified). Four surprises its author reported instead of smoothing: invalid means admission is
**closed**, not merely not-rationed (Abort at policy level, permanent `fail()` at runtime);
NaN and infinity were **already covered before the fix**; at realistic temperatures pre-fix and
post-fix admission outcomes coincide, so the Abort assertions alone would not catch a
regression; and **41.9 C gives Wait while 42.0 gives Abort** - two refusals a tenth of a degree
apart.

### Build provenance: the tree state is stamped into the artefact (pushed)

Branch `kalsa-build-provenance` at `91ac75c35` (release-line base; **pushed**, re-verified by
this cell with `git ls-remote`) - `scratchpad/agents/build-provenance/REPORT.md`. At build time,
**twice** (into the binary so `strings` reads it, plus a JSON for the publisher to fold into the
manifest): full commit, ref or literal `detached`, **`dirty` with the touched-path list** (cap
50, `dirty_paths_omitted` counts the rest), **`source_sha256` of `git archive HEAD`**, build
number, UTC timestamp, toolchain line. Cost **+0.25 s per build**; three states tested; **no
git -> every field `unknown` and the build still succeeds**. Two formulations kept with the
field: **every duplication needs its own coherence check, or the duplication is the defect**
(the `JSON == BINARY` agreement over five alternating touch/restore flips is what earns the
double write); **a declared limit is not a missed limit** (the cap carries the count of what it
dropped). Stated limit: the stamp says whether the tree was clean at a commit, **not** that the
sources correspond byte-for-byte to the linked binary - a stale `target/` is invisible to it,
and **the build id in `--version` remains the other half**.

## Verified state, 2026-09-25

Numbers and records: `docs/ALIVE.md`, "2026-09-24/25", and `scratchpad/COORDINATOR-STATE.md`.

- **Delivery chain (pushed):** engine `kalsa-phone-v1-1-8` `f25f0c1c5` (pause 43 / kill 44, critical =
  kill), binding `88b2b57e`, app `main` `0509f8c8`, APK sha256 `855c89de...5c91e7` (CI 36171227792).
- **Governor research status (superseded 2026-09-28: the heat tables have since been measured,
  see "Verified state, 2026-09-28" below):** as of 2026-09-25 the per-backend (CPU/GPU/NPU) heat
  tables were unmeasured (n = 0); the admission deltas `{1.9, 3.25, 3.25, 5.15}` remain NPU-only
  S23 numbers. NPU-as-verifier is killed on
  v79 speed; CPU speculative decoding with a draft-probability gate is the new lane (CPU verifies K=4 for
  1.24x one step on the ship model).
- **Owner decision (2026-09-25): mmproj models stay OUT of the governor until the governor has a
  vision lane** (engine + binding + app; the binding throws on `initMultimodal` under the governor,
  `cpp/rn-llama.cpp:1140`, and the engine governor has no vision path). No lazy-mmproj workaround.
  It matters again soon: the LFM VLM head (LFM2.5-VL) follows. Heat arms run on LFM2.5-2.6B (no mmproj).
  Note: with the governor switch off (default) Android is CPU-only for every model
  (`deviceTuning.ts:397` `gpu-fit-gate-blind`).
- **Devices:** S23 DSP spin likely fixed by `setprop persist.traced.enable 0` (check it before every S23
  session). QDC second account `aspis.launcher@gmail.com`; each Paseo browser tab has its own cookies;
  QDC bills the full requested cap.
- **Next, in order (2026-09-25 list; superseded 2026-09-28 by the owner order below — items 1
  and 2 have since run: the mmproj decision landed 25/09 and both heat programs produced their
  tables):** (1) the mmproj decision, then QDC heat arms (QRD8650 4 pairs, QRD7675 2 pairs);
  (2) S23: NPU Step 0 on v73, then the S23 heat arms; (3) CPU speculative decoding with a confidence
  gate; (4) only then the thermal routing design (per device AND per model, from the tables).

## Verified state, 2026-09-28

### The governor runs on the S23 — and its blind spot is measured

- **Engaged and working in the app:** `KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit"}` on load; three
  smoke turns with `engine_prefill=GPU`, `engine_decode=CPU`, `route_push=applied`,
  `route_mismatch=null`, per-chunk `actual:"gpu"`, commit in milliseconds (`commit_ms` 5.388 /
  6.01 / 10.65). Record: `scratchpad/agents/s23-governor-lfm-long/REPORT.md` (commit
  `8c0e38e0`), "Manual governor smoke", raw `raw/manual-smoke/`.
- **The blind spot, measured on one long turn:** turn 3 (`prompt_n=981`, a 587-word prompt) drove
  battery **33.6 → 41.6 °C** and Android thermal status **0 → 3 (SEVERE)** while the governor
  kept logging `thermal_state:"FAST"` (same REPORT, table rows 1-3 and "the Governor's logged
  state remained FAST"). Cause: the classifier reads the battery only (`kalsallama
  llama-governor-policy.cpp`, `classify` at `:83-94`, temperature from `batt_temp_tenths_c`);
  the platform status is not an engine input.
- The campaign defects the 27/09 baseline exposed (no screen-ON per turn, status-3 abort, no
  readiness gate) are fixed in the harness — see `docs/ALIVE.md`, "2026-09-26/28".

### Heat per backend: measured (this supersedes the 2026-09-25 "n = 0")

| cell | lab commit | headline |
|---|---|---|
| `scratchpad/agents/s23-heat-arms-engine/` | `147b0351` | S23: battery-area prefill per 1k tokens: NPU **6.45**, GPU **24.17**, CPU **44.59 °C·s**; NPU is 73.3 % below OpenCL and 85.5 % below CPU; median prefill 1,470.99 / 6,948.76 / 9,905.57 ms (NPU/GPU/CPU); fewer decode threads show **no clear thermal benefit** (battery-area medians overlap by 1-3 %, skin area rises as threads fall) |
| `scratchpad/agents/qdc-8elite-heat-arms/` | `335fc965` | 8 Elite: skin area NPU **21.2** vs GPU 45.5 vs CPU 52.3 °C·s — NPU coolest in every triple |
| `scratchpad/agents/qdc-8elite-hopping-heat/` | `a6ec6507` | 8 Elite skin area per prefill NPU/GPU/CPU **23/79/75 °C·s**; NPU decode **0.229** vs CPU **0.315** vs GPU **0.326 °C·s/token**, at **29.1/39.0/30.3 tok/s** (NPU/CPU/GPU); **no NPU skin crossover through 12 back-to-back prefills** |

- **CPU prefill is never cooler**: on both chips CPU is the worst of the three on the heat-area
  axis (S23 battery-area rows P-*; 8 Elite skin-area 52.3 vs 45.5/21.2). `s23-backend-hopping-heat/REPORT.md` (28/09):
  S23 tg256 decode CPU 22.13 / OpenCL 14.03 / HTP 22.09 tok/s, battery 0.20 / 0.43 / 0.14 C·s per token (medians);
  CPU and HTP ranges overlap, so "HTP decode cooler than CPU" is a direction, not a proven gap.
- **The GPU table (the one the owner kept)**, for the routing design:

  | chip | prefill CPU | prefill GPU | prefill NPU | decode CPU | decode GPU | decode NPU |
  |---|---|---|---|---|---|---|
  | 8 Gen 2 (S23) ms / tok-s | 9,905.57 / 97.12 | 6,948.76 / 138.44 | **1,470.99 / 653.98** | 22.41 tok/s (D-t5; CPU-only lane) | — | — |
  | 8 Elite ms / tok-s | 4,861 / 197.9 | 3,317 / 290.0 | **919 / 1,046.4** | 39.0 | 30.3 (0.326 °C·s/tok) | **29.1 (0.229, coolest)** |

  Prefill rows from the two heat tables; decode rows from `qdc-8elite-hopping-heat/REPORT.md`
  §B and `s23-heat-arms-engine/REPORT.md` rows D-*. Owner note attached: the GPU still matters
  where it is the only accelerator we ship for — iPhone (Metal) and the Mali phone (whose Mali
  path is currently NOT MEASURED / failing, `archive-gpu-cells/REPORT.md:510-512,757`). No claim
  is made about Adreno 830 kernel tuning: no such measurement exists in the lab.

### Engine: one line + upstream (owner, 2026-09-30 night)

The fork exists to take upstream easily, but two lines had diverged: `feat/governor-platform-status` (phone app pin
`d07d0181b`, 50 commits not in main) and `main` (desktop v1.1.3, Gemma MTP, vcredist; 26 not in feat). Owner:
`main` is the ONLY engine line for app and desktop. Step A: merge feat into main. Step B: merge upstream b11304
(301 commits; trial: 8 files / 28 hunks, none in Hexagon on this line); conflicts are resolved by taking upstream's
file and replaying our commits onto it, not by hand-blending. Each step: host + Android (docker) build, governor
tests with the ship GGUF, one audit by another model. Then binding vendor bump -> app pin -> APK -> S23 regression;
desktop v1.1.4 when the fork's CI is back. The one-copy spike keeps its base until its ABBA is measured. Fork
already pruned to 3 branches (REPOS.md); feat/* becomes an archive tag after step A lands. Making the fork public
is PARKED (owner); the recon was stopped before any verdict.
Landed 2026-10-01: engine main pushed to `61c909481` (single line + b11304 + test fixes + Hexagon runtime net);
`feat/governor-platform-status` -> tag `archive/feat/governor-platform-status`; fork has 2 branches. Release tag
`kalsa-server-v1.1.4` (a34fcc615 -> 61c909481) pushed 12:55 UTC, run 36865080892 (v1.1.3 never published, skipped).
PUBLISHED 2026-10-01: run 36865080892 all jobs green; R2 dl.kalsa.io/kalsa-server/v1.1.4 (3 archives, HTTP 200) + HF
Kalsa-ai/kalsa-server tag kalsa-server-v1.1.4; manifest commit 61c909481, digests match the HF LFS oids. Pins sent
to kalsa-brain d4e57ba1. **v1.1.4 BUG (kalsa-brain, confirmed 2026-10-01):** the macos-arm64 CPU path SIGILLs on M1
(no i8mm) in ggml_gemm_q6_K_8x8_q8_K: libggml-cpu has 284 smmla/ummla (v1.1.2: 0); GGML_NATIVE=ON on the macos-26
runner now probes i8mm OK and bakes it in. Fix v1.1.5 (GLM d669dc8d, branch fix/v1.1.5 local): mac NATIVE=OFF +
BACKEND_DL + CPU_ALL_VARIANTS (apple_m1/m2_m3/m4), proven on the local M1 Max first; plus truncated slot file ->
400 not abort, shared-view WARN once. Owner 2026-10-01: batch EVERY desktop fix into v1.1.5 (one macOS CI run,
10x minutes). Added: other-model slot file -> 400 (model identity), MTP drafter on another device than the aliased
target KV -> clean refusal instead of abort (Lenovo multi-GPU), dead b11010-merge trigger removed. TAG HELD for the
suspected Vulkan decode regression on Ling-3.0-tiny (MoE + KDA): 64 vs 99 tok/s on e8065c7cf, single pair, RTX
throttling; Lenovo interleaved re-check queued by kalsa-brain; recon luna 6c1a252d
(`scratchpad/agents/vulkan-moe-decode-regression/`). Also check Qwen3.6-35B-A3B on Vulkan. CPU tiled k-quant prefill
helps on AVX2 (+15-25 %), keep. Per-request speculative.n_max stays deferred (owner). Ling re-check (5 interleaved
pairs, cool gate): v1.1.4 median 81.6 vs 88.7 tok/s, inside a 69-104 same-build spread; Vulkan perf logger: GPU time
per graph new/old 0.89, no op slower (GDN 0.75) -> NO revert; toggles + Qwen3.6 pair still running.
fix/v1.1.5 (GLM d669dc8d, 6 commits f7cadf7de..e636ee126): M1 proven by me (same model, -ngl 0: v1.1.4 EXIT=132
SIGILL, v1.1.5 EXIT=0 98 tok/s; apple_m1 variant 0 smmla). Audit (space-bunny 6d6c2fd2, `kalsa-server-v115/AUDIT.md`)
FIX FIRST: B1 `strings | grep -Fqx` under pipefail fails 5/5 on a good archive (SIGPIPE 141) - would have killed the
release run; tautological basename check; unknown KSID version ignored while the appendix hard-fails; two comments
teach the wrong mechanism. Identity check limit: same-shape different weights restore silently. Fix round GLM
4ad9679f; then 63a51b6d6 (failed seq restores leave the sequence empty; minimax-m3 test). **v1.1.5 PUBLISHED
2026-10-01** on 63a51b6d6 (run 36923265662 green, R2 + HF tag; mac archive verified on the M1 Max: -ngl 0 exit 0,
124 tok/s). 5 upstream workflows the first sweep missed (gh workflow list truncates) were disabled; one had fired
on the tag and was cancelled. Manifest sent to kalsa-brain. Desktop repinned: kalsa-brain `05487d01` (branch brain, local; all 6 digests match the
manifest, cargo test 88/88, space-bunny audit clean); Kalsa.app auto-upgraded to v1.1.4 on the Mac.
Desktop on v1.1.5 (kalsa-brain report 2026-10-02): repin 43d996f7 audited; M1 Max `-ngl 0` E4B 23.1 tok/s clean exit.
**Lenovo cross-device MTP repro PASSES on v1.1.5**: drafter on Vulkan1 + shared K on Vulkan0 now refuses to start with
"cannot share KV cells ... the drafter and the shared K/V must be on the same device" (v1.1.4: abort 0xC0000409). App
pins one device from `--list-devices` (Vulkan order differs between the interactive and the SSH session on that
laptop). First-start tune on the Lenovo: RTX + MTP n=2, prompt 1,859 tok/s, decode 86.7 (MTP off 47.6), VRAM 3,800 MiB.
The fork's free Actions minutes were eaten by UPSTREAM scheduled workflows (Build Actions Cache ~9 Windows min x
~5/day, msys 68 Windows min weekly): owner approved disabling the 47 inherited workflows with `gh workflow disable`
(repo setting, no tree change); only kalsa-server.yml and check-vendor.yml stay enabled. Desktop side: new
kalsa-brain session `d4e57ba1` takes the v1.1.4 pins and its checklist after publish.
Step A landed locally as `5de9fa2fc` (clean merge, zero conflicts; audit running). test-governor-v0-shared-cells was
already red on old main: kalsa-brain decided 2026-09-30 (b) - KEEP `llama-memory-hybrid.cpp` shared_fence; the test
expects MIRROR semantics for plain/iSWA KV (Gemma-4 12B + NextN, the only desktop MTP model) and REFUSAL for hybrid
memory, chosen by the fixture's memory type. Lifting the hybrid fence is new behaviour, not for v1.1.4 (DSpark /
hybrid drafting gets its own lab + review). Test fix after step B. Upstream target is the TAG b11304 = `81ff93ea1`,
not master (master adds 4453b535f, which reorders the NextN rows our Gemma MTP reads).
Test-fix audit 2026-10-01: the shared-cells "mirror" half on a gemma-3 iSWA fixture decodes garbage
(aliased_tensors=0) - NOT a desktop bug: generic iSWA views get `share = nullptr` (cells only, own empty K/V);
only `LLM_ARCH_GEMMA4_ASSISTANT` passes a `share` callback (llama-model.cpp ~2879). kalsa-brain proved the real
pair aliases all 4 drafter layers (acceptance 0.568). The test now checks the real pair (env-gated) and calls the
gemma-3 half what it is. FOLLOW-UP (not v1.1.4): refuse an iSWA view with mem_other but no `share` instead of
decoding garbage silently - check Qwen MTP heads and DFlash first. test-governor-v0-devices was dead everywhere
(gpu_fit Unknown -> CPU route -> 0 commits); it now forces the GPU route and FAILS if the route regresses.

### Governor plan to follow (owner, 2026-09-30)

**The governor work follows `scratchpad/agents/governor-plan-fable/PLAN.md`** (Fable 5.1, built from our
measurements and code, lab commit `32d65d53`). Eight milestones, de-risking first: (1) does in-app battery
current separate NPU/GPU/CPU per turn on the S23 (pass: changes on >= 90 % of 1 Hz rows and per-phase mean differs
by > 3x idle std-dev; else no energy learning, heat priors only); (2) thermo push every 10 s during generation;
(3) three-rung ladder MODERATE/SEVERE/CRITICAL, no CPU prefill fallback on LOWBAT; (4) per-backend admission deltas
from the heat tables; (5) `getThermalHeadroom` probe; (6) energy-per-token learning (only if 1 passes); (7) mid-turn
NPU <-> CPU decode hop on one copy (needs the fast raw DSP decode); (8) AIMD pace lever for persistent SEVERE.
Each milestone: one coder, one hostile audit, one device check. It records five contradictions in today's code
(MODERATE/SEVERE collapsed, unmeasured uniform admission deltas, per-turn-only thermo cadence, CPU prefill on LOWBAT,
dead trend rule) and that the three governor engine lines diverge. Open owner decisions: decode tok/s floor, ranking
metric, exploratory turns, no-mmap in the app, merge order of the engine lines.

**Milestone 1 result (S23, 2026-09-30; partial GPU/CPU-prefill trace, `scratchpad/agents/governor-m1-current/REPORT.md`,
hostile audit `AUDIT.md` applied):** the in-app sampler changed on 99.7-100 % of valid adjacent readings (live at 1 Hz).
Across three GPU-prefill and three CPU-prefill turns the prefill mean-current difference was ~242 mA. No idle window was
captured (the sampler runs only during a turn), so the plan's 3x idle-sd test is UNTESTED; backend-current separation is
not established. The whole-phone prefill-window integral was ~54 vs ~224 J per 1k tokens (assumed mA scale), but it
includes screen and device load and largely follows the prefill durations (GPU 77-105 vs CPU 16-21 tok/s), so it does not
establish incremental backend energy and does not by itself justify energy learning. Decode was CPU in every turn; no NPU
arm (CPU-only CI APK). Next for this milestone: an idle window in the same trace (baseline sd) and incremental energy
(minus idle) per phase; NPU arm once the APK carries Hexagon.

### Owner direction (2026-09-28)

- CPU is out of prefill.
- NPU first; GPU when the NPU is hot.
- Decode hops CPU ↔ NPU ↔ GPU by heat.
- Never truncate reasoning silently.
- Persistent SEVERE (a hot climate) needs a **sustainable slow rate**, not a pause: the pause is
  only an **emergency brake** — the platform-pause implementation (app `19368426`) is therefore
  **held**, not shipped.

### The lever map, and the rung the heat data refuted

`scratchpad/agents/governor-thermal-ladder/LEVERS.md` (commit `3e00ccea`) maps each lever (what
to cut, mid-turn vs between turns, cost). Its row-2 proposal — **push the prefill route to CPU at
MODERATE** — is **REFUTED by the heat data**: CPU prefill is the hottest of the three on both
chips. The other half of that row (skip the background prewarm, cut our own steady load) stands.
The pause-as-last-resort rung with resume ≤1 and the 10-minute cap is built as the emergency
brake only (held app `19368426`).

### Scope (owner, 2026-09-29)

Focus now: DENSE models in Q4_0 (one-copy NPU prefill reader, governor). MoE and our own quantizations (KEXP, REAP, streamed experts) are later: the raw reader covers only `MUL_MAT` on Q4_0, not `MUL_MAT_ID` experts or other formats.

### Thermal plan approved by the owner (2026-09-29)

Trigger: one S23 turn went Android status 0 -> 3 while the governor logged FAST (battery-only
classifier, engine `45f097b74` `llama-governor-policy.cpp` `temperature_c`). The app must never
block after a turn; the first lever is moving work to the backend with the lowest heat per token,
not slowing down (sleep-pacing at full clock keeps total heat equal).

| Android status | governor response |
|---|---|
| 0-1 | normal |
| 2 MODERATE | hop to the cooler backend |
| 3 SEVERE | coolest backend only (NPU), no background work |
| 4 CRITICAL | emergency brake (exists) |

Steps, in order: (1) the classifier takes the platform status (engine, then binding parser, then
app feed from the existing `KalsaThermalModule`); (2) NPU prefill lane on after the step-5 soak;
(3) prefill GPU when NPU is hot, never CPU; (4) mid-turn decode hop CPU <-> NPU (today a decode
engine change needs a full context reload, `llama-governor-runtime.cpp` `select_decode`; one-copy
weights make three ready backends affordable); (5) a rate lever only if measured to lower heat per
token; (6) brake = the existing native CRITICAL only. Step 1a (engine) started 2026-09-29 on
`feat/governor-platform-status` from `45f097b74`.

**Agnostic ranking (owner, 2026-09-29):** "which backend is cooler" must not be hard-coded (S23 GPU
is hot; another phone may differ). Design: a per-SoC prior from lab tables, then the governor
learns energy per token per backend per phase from real turns (battery current x voltage,
unplugged only), with an occasional exploratory turn on another backend while cool. No install-time
calibration test. Gate before any build: an S23 run proving the battery current separates
NPU/GPU/CPU per turn above noise; the result goes back to the owner before design work. This step
sits between (1) and (4).
Ranking rule (owner, 2026-09-29): pick the backend with the least heat/energy per token among those
above a tok/s usability floor; a slower backend wins if it stays above the floor. 8 Elite NPU decode
(29.1 tok/s, 27 % cooler per token than CPU at 39.0) is a win; S23 NPU decode (22.09 vs CPU 22.13,
skin 0.17 vs 0.25 °C·s/token) is directionally lower but the ranges overlap: plausible, not a proven win.
Consequence for one-copy: decode must stay runnable on the NPU from the shared copy. S23 2026-09-30
(`onecopy-hmx-numerics/REPORT.md`, engine `spike/onecopy-hmx-raw`): raw Q4_0 decode on the DSP (HVX matvec)
measured 11.82 tok/s tg128 on `c5a218321` (an earlier tg2/tg4 smoke gave 0.13; not a controlled ratio); after
the audit fixes `cc9c541f2` the only sample is 10.98 +- 0.45 taken without cool-down, so clean post-audit
speed is unmeasured. Same aggregate KLD as two copies to printed precision (not a logit-by-logit check); two
copies 22.2, one-copy CPU 10.63. The raw->tile conversion is the likely cost (simulation, not separated on the
phone). A raw-row HVX matvec (Fable design `DESIGN-RAW-MATVEC-FABLE.md`, expected 19-23 tok/s) is in progress
(`93ade4886` + `974a31e79`): sim gate re-run by the coordinator (EXIT=0, 80 cases); S23 2026-09-30
(`onecopy-hmx-numerics/REPORT.md` "Raw-row matvec 974a31e79"): one-copy DSP decode **15.51 tok/s** (ABBA pair
mean, was 11.82) = 69 % of two copies (22.41), one-copy CPU 12.79; mean KLD 0.004608 vs two copies 0.005313 (better,
same top p). Design target 19-23 NOT met: the sim predicts raw-row compute ~equal to tiled (96 vs 86 Pcycles/tile at
K=2048, 70 vs 84 at K=10752), so the 1.45x gap on the phone is likely the memory path (rpcmem HOST buffer), not
compute - hypothesis, split pending. Hostile audit (`AUDIT-RAWROW-974a31e79.md`): FIX FIRST (F16/strided
activations, K<256 offload, VTCM sizing, repeated Q8 groups); fixed in `ceb89bedc` (Sonnet), sim gate re-run by the
coordinator EXIT=0 (main + edge + over-read, 8 negatives), NOT yet audited, NOT pushed, host/DSP wiring never run on a
phone. It carries env-gated probes for one S23 ABBA session: `GGML_HEXAGON_RAWROW_PROBE=1` (DMA only), `=2` (dot
only), `=4` (no activation l2fetch), `GGML_HEXAGON_RAW_LOCAL=1` (same kernel on a DSP-local raw copy), and
`GGML_HEXAGON_HOSTBUF_UNCACHED=1`. Heat on the same weights (S23, `onecopy-hmx-numerics/REPORT.md`
"Decode heat per token on one copy", n = 2 per arm, descriptive only): in the speed-matched A pair (12.27 vs
12.21 tok/s) one-copy DSP decode was ~35 % lower skin area and ~13 % lower battery area per token than one-copy
CPU; the A+B means (-45 % / -33 %) mix unequal speeds (CPU-B 9.60 tok/s). The area includes load, warmup and a
120 s idle tail (54-77 % of the skin area), so it is not active-decode-only heat; baselines rose through the
session. Two copies lowest per token (0.28 skin C·s/tok at 21.5 tok/s). Hostile review of these results:
`onecopy-hmx-numerics/REPORT.md` "Hostile review 2026-09-30".
Raw-row `ceb89bedc` audit (2026-09-30 evening, `AUDIT-ceb89bedc.md`): safe for PROBE=1|2|4 and HOSTBUF_UNCACHED;
RAW_LOCAL is a no-op, the probe value is not logged and the flat VTCM fallback keeps `pipeline`. Decision: fix these
gates first (coder on `spike/onecopy-hmx-raw`, then one audit by another model), push the new DSP .so with the host
lib, then ONE S23 ABBA session gated on the `hvx-rawrow` path tag. Lead hypothesis: raw DMA row stride 18*n_k not
128-B aligned on the ffn matvecs (38.6 of 54.7 ms/token).
**S23 ABBA result (2026-10-01, `s23-onecopy-abba-df538c50c/REPORT.md`):** T two copies 22.10, B one-copy 15.58,
P1 skip-dot 22.50, P2 no weight DMA 15.64, P4 no l2fetch 15.46, U uncached 15.57 tok/s (3 ABBA passes, gates OK,
hvx-rawrow on every one-copy matvec, 0 flat fallback). The DMA hypothesis is REFUTED: the whole gap (~19.8 of 64.2
ms/token) is the raw dot + its VTCM reads on 18-byte row strides; the simulator (raw ~= tiled compute) does not see
it. KLD unchanged (0.004608 vs two copies 0.005313). NEXT: kernel fix - relayout raw rows in VTCM for the dot during
the DMA (Exceptional Coder, spike branch). Side defect: `-p 32 -n 2` warmup ubatch -> `dsp-rsp INTERNAL-ERROR` abort.
VTCM relayout REFUTED in the simulator (Exceptional Coder 2026-10-01, `REPORT-vtcm-relayout.md`): convert-to-tile +
tiled dot 192, 32-row transpose + column dot 136.5 vs raw dot 69.9 Pcycles/tile. Instead on the spike (not pushed):
`6a6ec8678` fixes the -p 32 abort (host sized raw HMX chunks for a single-buffer layout, DSP forces double buffer),
`23178fb24` shares the scale multiply across two rows (bit-identical in sim; predicted ~17.9 tok/s only IF the
multiplier bounds it), `7e4945582` adds probes 16/32 (integer stage / float tail) and 8 (pre-fusion dot). Audit
running; S23 arms after the phone is charged.
Gates fixed in `df538c50c` (pushed; audit `AUDIT-df538c50c.md`). Coordinator ruling on that audit: RAW_LOCAL is
DROPPED from the session - the device and -HOST buffers are the same rpcmem system-heap allocation, so it cannot
split the memory path (its comment at ggml-hexagon.cpp ~2270 is false; fix in the next commit on the branch). The
teardown counters are a validity signal only (fallback > 0 = arm invalid), not a matvec count. ABBA arms: two copies,
one-copy base, RAWROW_PROBE=1, =2, =4, HOSTBUF_UNCACHED=1; gates: `hvx-rawrow` tag, init env line, no "ignoring
invalid", `--load-mode none`, host lib + DSP .so pushed together.
S23 adb route (2026-09-29): `cmd battery get current_now` changes only every ~30 s (median 30.14 s, 47 changes) -> per-turn separation NOT possible from adb. In-app test uses the EXISTING bench trace: AsyncStorage `kalsa.bench.energy_trace`=on (debuggable APK, run-as), native 1 Hz HandlerThread sampler (`native/GovernorBatteryModule.kt`), one CSV per turn at `files/energy/<ms>-t<turn>.csv`; the question is how often `current` changes there.

### NPU prefill: validated in the CLI, wired in code — NOT in any app APK yet

- **Validated equivalent to OpenCL:** `scratchpad/agents/governor-htp-prefill-spike/REPORT.md`
  (commit `e69ff684`) —
  three-prompt handoff verdict EQUIVALENT (HTP mean agreement 99.306 %, mean KLD 0.000853797
  inside OpenCL's prompt ranges 0.000706-0.000956), commit bytes identical per backend, 1,089
  `HTP0 execute-op MUL_MAT` dispatch lines.
- **Wired through the chain (all landed):**
  - engine `kalsallama` branch `feat/governor-npu-prefill`, commit `45f097b74` (pushed);
  - binding `kalsa.rn` branch `feat/governor-npu-prefill`: `4e0837f8`, then `3d2fff25` (the
    JSI lambda captured `ctx` implicitly, which failed the first device APK build — the fix
    copies the NPU fields before the closure); pushed;
  - app `origin/main`: `2fb5ee4a` (eligibility, **lane default OFF**,
    `kalsa.bench.npu_lane = auto | on | off`), then `335f9c8d` (pin bump, provenance gate
    exit 0, space-bunny SHIP). Device APK CI build `36434636903` is building.
- Status: **on `origin/main` at `335f9c8d`, default OFF, APK building; step-5 device soak pending**
- **2026-09-30: no CI APK has ever carried the Hexagon host backend.** App CI has no Hexagon SDK
  (run `36733967953` log: "Hexagon SDK not found — building CPU-only"); `librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so`
  has 0 Hexagon symbols while the DSP skels ship in `assets/ggml-hexagon/`; on the S23 the lane degrades with
  `npu_fallback: "htp-device-missing"`. The host build also needs QAIC stubs (binding `CMakeLists.txt:109-120`).
  Recon: `scratchpad/agents/app-ci-hexagon-recon/REPORT.md` (no retained APK among 11 scanned had it). Fix in
  progress: app CI gets the pinned SDK + host QAIC artifacts + an APK assertion (coder `a0a34d08`).
- **2026-09-30 evening: fix landed and pushed.** Binding `feat/governor-platform-status` `b4a13d9a` (lane OFF never
  sees HTP, prefill and decode lists, explicit lists too; `GGML_HEXAGON_DEVICES` 16 -> 1; host tests 10/10 re-run by the
  coordinator). App main `c26ba8bc`: pin `kalsa.rn#b4a13d9a` (provenance EXIT 0, 1121 files), CI downloads Hexagon SDK
  6.4.0.2 verified by sha256 `b4a57a77...` (GitHub asset digest), QAIC host stubs as the engine's `build_idl`,
  `persist-credentials: false`, and a post-build assertion that the hexagon lib really contains the backend. Hostile
  audit `app-ci-hexagon-recon/AUDIT.md` applied (its "lane-on throws" REFUTED: it read stale local node_modules).
  Debuggable APK run `36763920662` GREEN; the coordinator verified 137 `ggml-hex` strings in the hexagon lib (was 0).
  First APK ever with the NPU host backend; the S23 NPU-lane check is next.
  (steps 1-4 done: engine, binding, app, heat arms). Design, steps and degrade rules:
  `scratchpad/agents/governor-npu-prefill/DESIGN.md` (commit `2ac99cd5`).
- **2026-09-30 night: S23 check of APK c26ba8bc FAILED** (`scratchpad/agents/s23-npu-lane-c26ba8bc/REPORT.md`).
  Lane on: plan resolves (`npu_device HTP0`, `npu_fallback null`), then every load aborts in the governor ctor:
  `pre-allocated tensor (cache_v_l2 (view)) in a buffer (HTP0) that cannot run the operation (SET_ROWS)`. One
  lane-off route-gpu abort is claimed but not proven by a lane log line. Cold start: no regression, one FastRPC
  session. HTP prefill never ran; milestone-1 NPU arm not run. Diagnosis + fix delegated (binding
  `feat/governor-platform-status`); the lane stays default OFF and nothing ships until a device re-check passes.
- **Fix (2026-09-30 night):** binding `17446ac4` sets `no_kv_offload` on the HTP prefill context only (KV and the
  LFM2 r/s state on host; the abort class is closed, audit `AUDIT-17446ac4.md`) + `c8471449` (scope pin proven by a
  mutation, true comment); pushed. App main `f012dd1f` (pin c8471449; the fix itself is its parent 17446ac4) +
  `aea90427` (`npu_lane` = the REQUESTED pref on KALSA_GOVERNOR_PLAN; it is not proof native saw the lane - read
  `npu_device` for that), audit SHIP (`AUDIT-app-aea90427.md`), provenance EXIT 0, pushed; debuggable APK run
  `36786856764`. OPEN, device must measure: with KV on host the engine keeps all attention (FA, q4_0 V, ubatch
  256) on the CPU: ~60 splits/ubatch; HTP prefill may lose to OpenCL. The lab spike that won ran FA off, f16 KV,
  ubatch 512. Also: the provenance script comment "integrity hash is NOT a witness" is false (npm pack reproduces it).
- **S23 re-check of APK aea90427 (2026-10-01) FAILED differently:** no abort any more, but the lane-on load HANGS in
  the first HTP prefill (1,660-token KV prefix): `dspqueue wait_signal_locked ... signal 2, Error 0xc` every ~1 s
  forever (5,240 in 90 min, ~85 % CPU, ~13 %/h battery, no recovery), 2/2 cold launches; preceded by
  `remote_handle64_invoke failed 0x80000414, method 3` on the dspqueue handle. Lane off route gpu PASSES (prefill
  103 tok/s, 50.4 J/1k raw). Two defects: the DSP hang itself, and NO timeout/fallback in the lane (a user's phone
  would burn silently). Diagnosis + fix delegated.
- **Root cause CONFIRMED on the S23 (2026-10-01, `inapp-htp-dspqueue-hang/DIAGNOSIS.md` + `DEVICE-skel-swap.md`):
  host<->DSP-skel protocol skew.** The APK's DSP skels come from the binding's committed `bin/arm64-v8a/`
  (android/build.gradle:19; committed 2026-09-17 from a pre-flip source, sha f81f95e9) while the host carries
  upstream's batch-protocol change `eafe15a5e` (2026-09-11, in the pin). Same CLI host, only the skel swapped:
  matched skel pp64 511 tok/s twice; APK skel -> `GGML_ASSERT(rsp.seq == batch_rsp_seq + 1)` abort (small batch) /
  eternal 1 s dspqueue wait (the app's big prefill batch). `0x80000414 method 3` is benign (all arms). Unsigned-PD
  hypothesis REFUTED. FIX PLAN (after engine main lands): (1) skels rebuilt from the SAME tree as the host on every
  binding vendor bump, with a gate that fails when skel and host come from different engine commits; (2) engine:
  bounded wait in `flush_pending` (today `continue`s on the 1 s timeout forever) -> error -> governor GPU fallback
  via the existing KALSA_HTP_FALLBACK plumbing, no abort; (3) a real one-op HTP round-trip health check at lane
  init. The app has never run HTP in-app until this fix.
  Engine fix v1 `a493a436b`+`a48cc3e08` on main: S23 test 2026-10-01 (`DEVICE-fix-test.md`) - matched skel pp64
  532/526 tok/s; stale skel fails BOUNDED (EXIT=1 in 3-4 s, `batch response sequence mismatch`, no SIGABRT, no
  hang, also at -ub 512); health check PASS matched / FAIL stale after the 30 s deadline. Hostile audit FIX FIRST
  (`AUDIT-fix-engine.md`): event_synchronize still unbounded, get_tensor_async/dspqueue_write/release aborts,
  one 30 s knob for probe and batch, vacuous op-count check. Fix round 2 in progress (luna), then a short S23
  re-test, then push + binding (skels from the same tree + skew gate).
  Round 2 (`7d953dab0..643332f8f`) closed the r1 items but its audit (`AUDIT-fix-engine-r2.md`) found a process-wide
  mutex held across 30 s DSP waits and a heavy, ignored health-probe session. COORDINATOR DECISION 2026-10-01:
  simplify - the root cause is prevented at BUILD time in the binding (skels + host from one engine commit, CI
  gate); the engine keeps only the runtime net (bounded waits, exact req/rsp shape check, no aborts, error -> -3 ->
  GPU fallback). Health probe and global lock removed; the diff must shrink.
  Engine net fix final = `9f3c2e069` + `61c909481` (audit r3 SHIP; teardown join stays untimed, documented),
  engine main pushed to 61c909481 2026-10-01. Binding `0d49c6a7..1a47c48f` (vendor bump, rebuilt skels +
  manifest, skew gate, runtime fallback): audit FIX FIRST (`AUDIT-fix-binding.md`): the gate compared two
  hand-edited strings; the committed skels came from an out-of-repo script and binding CI rebuilds them with
  SDK 6.4.0.2/image v0.3 after the gate; the fallback blamed HTP for any governor failure (e.g. OpenCL KV-commit
  OOM); parallel_decoding "28/28" was 14 skips. COORDINATOR DESIGN: each skel embeds the vendored engine sha and
  the gate checks the binary; one committed reproducible recipe; fallback only on a real HTP failure. Fix in
  progress. NOT verified on the S23 yet (battery 20 %).
  Round 2 `f83e6cef..fa8d83ef` (GLM 6897be16: recipe, engine stamp, HTP-only fallback, npu_fallback on the log
  line, honest test skips, fuzz-0 patches): audit r2 FIX FIRST (luna b05f5929, `AUDIT-fix-binding-r2.md`): the
  stamp is the claimed pin, not a content fingerprint (an htp-ops.h edit under the same pin passed); raw-byte
  stamp grep; partial skel set passes; build-example-android.yml skips the gate; fallback pointer data race;
  dead retry under set -e; mutable image tag; 63 MB LFS per CI run. Coordinator verdict: fix all of these
  (forgery out of scope; rc=-3 attribution limits and the env race documented, not fixed). Fix round GLM
  029d15d7. App side, at the pin step: the app's APK workflow must run the binding's skel gate too.
  Round 3 `84dc71f3..6c9b16ed` (GLM 029d15d7: source fingerprint KALSA_HTP_SRC, ELF-symbol stamps, exact DSP
  set, gated example APK, image by digest, mutex fallback state, LFS cache). Audit r3 (space-bunny e651f039,
  `AUDIT-fix-binding-r3.md`) FIX FIRST; coordinator judged NOT blocking and PUSHED 6c9b16ed 2026-10-01: r2 items
  closed; open, follow-up round: android/src/main/rnllama/CMakeLists.txt (the host backend's real build file) is
  outside the fingerprint; governor_npu_device read unsynchronized (written at load only); v75<->v79 byte swap
  passes; two false comments ("editing any text file cannot satisfy the gate"); struct.error traceback on a
  truncated ELF; gate not wired into Gradle consumers (the app gets its own installed-package check). App pin +
  installed-skel check: GLM 2374d4b8; then debuggable APK and the S23 governor run (NPU/GPU/CPU prefill, lane off).
  App pinned + pushed `07476dae`, APK run 36900648095. **S23 governor run 2026-10-01 (GLM 432b11bf,
  `s23-governor-npu-gpu-cpu/REPORT.md`, not yet audited): all four arms PASS, first in-app HTP prefill under the
  governor, no hang/crash.** Prefill tok/s short/long: NPU 170.9/120.9, GPU 115.0/101.2, CPU 21.7/20.9; AUTO picks
  NPU 12/13. Every arm reaches thermal SEVERE in 1-5 turns on a warm phone (CPU worst, 49 mAh/short turn vs 17).
  Label != device with the lane on; in-app NPU only ~1.5x GPU (bench 4.7x) - next lever is the chunk/ubatch plan.
  **AUDITED 2026-10-01 (space-bunny 2138bb9c, `AUDIT-r1.md`; coordinator re-checked on disk): ordering NPU > GPU >
  CPU holds, the report does not.** gpu2-l3 reused a 1660-token prefix (`n_common=1660`) inside the GPU-long median;
  35 rows not 37 (cpu1-l1 has no kalsa extract, LOWBAT); dropbox 8 vs 5 lines, not byte-identical; per-chunk
  `"actual":"gpu"` 303x, never npu, on lane-on turns; end state had the launcher on top; `*-ui.xml` cited, absent.
  Report corrected (mimo b2962f18, medians re-checked by the coordinator): GPU long 103.3 (n=3), NPU/GPU prefill
  1.49x short / 1.17x long; AUTO picked NPU 9 of 10; per-turn HTP execution and crash sweep UNPROVEN. **Owner 2026-10-01, both yes:** (1) fix the governor route telemetry so it
  names the executing device (HTP) - recon luna 9f6a9d13, then a fix in the binding follow-up round; (2) queue an
  S23 session with per-turn HTP execution proof (not the single pre-campaign probe), phone charged first.
  Telemetry fix, engine step: 4dc4592bf (local, deepseek) audited by space-bunny 7518a6c3 -> FIX FIRST (dev_output()
  is the output layer, not the bulk; false offset comment; vacuous test); fix round deepseek a7f4c269 -> 5b596ce43
  (`layers_device` = majority device of the context's layers), re-audit 72616199 SHIP (crash-at-construction
  REFUTED; accepted lows: tensor-parallel Meta device name, MTP layers vote on exact ties). Engine main PUSHED
  5b596ce43 2026-10-01 (no ggml-hexagon change since 61c909481: skels unchanged). Binding PUSHED
  feat/governor-platform-status `b1c7ffc5` (fa4d2dac vendor 5b596ce43, 458cae4c JSON `layers_device`, b1c7ffc5 four
  skels rebuilt by the committed Docker recipe: only the 34-byte engine stamp differs); audit space-bunny 40458cb2
  SHIP. App PUSHED main `0125e403` (7bc8925b pin kalsa.rn b1c7ffc5 / engine 5b596ce43; 0125e403 benchRoute.ts keeps
  `layers_device` into KALSA_GOVERNOR; GLM ce3efc5b after two opencode-go 500s). Audit luna c8c346a8 asked FIX FIRST
  for dropping chunks from an older binding: coordinator overruled (provenance gate makes app+binding atomic; a
  dropped chunk yields route_mismatch null = honest "unverified"). Debuggable APK run 36940827456.
  **Next S23 session (queued, phone charged first):** per-turn HTP proof = every lane-on chunk `layers_device:"HTP0"`;
  any harness that classifies backend from `actual` (e.g. qdc-heat-per-backend/parse.sh:285) must read
  `layers_device` instead.
  **Side finding (verified on disk 2026-10-01): in-app HTP prefill runs ATTENTION ON THE CPU.** The binding sets
  `prefill_params.no_kv_offload = true` on the lane-on prefill context (`cpp/rn-llama.cpp:132`) and the engine pins
  every node between the KV store and the attention output to CPU when `!offload_kqv` (`src/llama-graph.cpp:2746`).
  Prime suspect for 128-token chunks slowing 0.57 -> 1.1 s with context and for in-app NPU only ~1.2-1.5x GPU.
  **Research 2026-10-01 (luna cdfd1ae5, key lines re-read by the coordinator): suspect WEAKENED, not refuted.** LFM2.5
  2.6B has only 8 full-attention layers of 30; the CPU-pinned attention core is ~2.7 % / 4.8 % of a 128-token chunk's
  FLOPs at 1.7k / 3.1k context - by FLOPs it covers only part of the +0.41 ms per context token growth (the rest:
  per-chunk host KV commit? unmeasured). Why KV is on the host: the app ships a **q4_0 V cache**, HTP SET_ROWS
  writes only F32/F16/Q8_0, and a pre-allocated dst cannot be rerouted (`ggml-backend.cpp:941` abort). HTP has
  FLASH_ATTN_EXT for F16/Q8_0 KV, head dim 64 fits. Cheapest split: bare prefill on an HTP device at fixed n_past
  (0/512/1.7k/3.1k), `no_kv_offload` on vs off with the SAME q8_0 KV, `GGML_HEXAGON_PROFILE=1`, per-chunk commit time.
  **MEASURED 2026-10-01 on QDC 8 Elite QRD8750 (v79, NOT the S23's v73), session 860914, Opus bd479ae6,
  `htp-kv-attention/REPORT-qdc-8elite.md`; coordinator re-read bench.tsv + profile-summary.txt): host KV IS the
  in-app NPU bottleneck - the FLOP estimate above was WRONG.** llama-bench pp128, LFM2.5-2.6B Q4_0 on HTP0, by
  depth 512 / 1700 / 3100: A (KV q8_0 on host, `FLASH_ATTN` on CPU) 543 / 245 / 138 tok/s; B (same KV on HTP,
  `FLASH_ATTN` on HTP0) 1263 / 1116 / 1053; C (app config, V q4_0, host) 504 / 208 / 116. Per-chunk growth per 1k
  context: A 248 ms, B 7.7 ms, C 313 ms. Open before it is a product lever: (1) S23 v73 + Xiaomi v75 repeat (tonight,
  owner gives both phones unplugged); (2) B correctness (no output/PPL comparison yet); (3) the app's q4_0 V cannot
  live on HTP -> V q8_0 (RAM cost) or an HTP q4_0 SET_ROWS kernel; (4) prefill->decode KV commit from an HTP buffer
  (decode is CPU). QDC: 8 Elite Gen 5 (SM8850) claimed 1000 free min 2026-10-01 (owner yes).
  **Night 2026-10-01/02, REPEATED on the owner's phones, unplugged (coordinator re-read each bench.tsv):**
  pp128 tok/s at depth 512 / 1700 / 3100 - A host KV, B KV on HTP, C app config (V q4_0, host):
  | device (DSP) | A | B | C | B/A @3100 |
  |---|---|---|---|---|
  | S23 (v73) `REPORT-s23-v73.md` | 296 / 145 / 76 | 686 / 630 / 583 | 297 / 132 / 64 | 7.7x |
  | Xiaomi 14 (v75) `REPORT-xiaomi-v75.md` | 362 / 179 / 100 | 754 / 710 / 659 | 345 / 167 / 103 | 6.6x |
  | QDC 8 Elite (v79) `REPORT-qdc-8elite.md` | 543 / 245 / 138 | 1263 / 1116 / 1053 | 504 / 208 / 116 | 7.6x |
  | QDC 8 Elite Gen 5 (SM8850) `REPORT-qdc-8elite-gen5.md`, session 860923 | 642 / 261 / 149 | 1476 / 1375 / 1309 | 625 / 247 / 132 | 8.8x |
  B ran clean on all three DSPs (no abort/hang); FLASH_ATTN on CPU in A, on HTP0 in B on all three.
  **S23 in-app per-turn HTP proof PASS** (`s23-layers-device-proof/REPORT.md`, GLM cd50da8b, APK run 36951238850 =
  app 101c2bdd): 46/46 lane-on chunks `layers_device:"HTP0"`, 21/21 lane-off GPU chunks `GPUOpenCL`; a lane-on
  route=gpu turn reports actual "gpu" but HTP0 at NPU speed (167 vs 102-112 tok/s). Label != device closed.
  **KV-on-HTP options (recon luna bd59d110, 2026-10-02; RAM re-checked on ModelRegistry.ts:287-294):** LFM2.5-2.6B KV =
  6,656 B/token (K q8_0 4,352 + V q4_0 2,304); V q8_0 adds 2,048 B/token per cache, and the governor keeps TWO caches:
  **+32 MiB at n_ctx 8,192** (S23/default), +64 MiB at 16,384 (phones reporting >= 7.5 GB). (The coordinator's earlier
  "+270 MB at 16k" was WRONG: it was the total of two q8 caches, not the delta.) Commit prefill->decode copies rows
  byte-for-byte via tensor_get/set at phase handoffs; HTP buffers are host-addressable rpcmem; there is NO q4<->q8
  conversion path (types must match). Ranked: (a) NPU lane uses V q8_0 in BOTH caches - binding + app only, no
  kernel/skel change - RECOMMENDED; (b) q8 prefill / q4 decode with conversion at commit - engine change; (c) one shared
  KV in rpcmem read by CPU decode - architecture change, CPU-on-rpcmem was -35 % for weights; (d) HTP q4_0 SET_ROWS +
  FLASH_ATTN kernels - weeks. Owner 2026-10-02: plan OK; (a) waits for the V q8 vs q4 quality result (luna 356da047).
  **Quality DONE 2026-10-02 (`htp-kv-attention/QUALITY-v-q8-vs-q4.md`, CPU, ctx 4096, vs f16 KV; coordinator re-read the
  IT logs): V q8_0 is better in all five languages** - mean KLD IT 0.0091 -> 0.0025 (EN 0.0080 -> 0.0022, ZH 0.0088
  -> 0.0025), same-top 95.5 % -> 97.5 %, PPL lower everywhere. Option (a) STARTED: binding step first.
  **Option (a) LANDED 2026-10-02 (not yet measured on a phone):** binding PUSHED `3d8fc84a` (b0035656: lane KV on
  HTP, HTP-unwritable K/V -> q8_0 in both contexts, KALSA_KV_TYPE_OVERRIDE, stats cache_type_k/v + prefill_kv;
  3d8fc84a: flash-attn explicitly off keeps host KV + caller types; GLM, audit luna 1d12cecb). App PUSHED main
  `cbddc1f2` from the detached worktree ~/Projects/kalsa-wt-gov (shared ~/Projects/kalsa main holds kalsa-brain's 3
  unpushed workers/report commits): b362ae10 pin 3d8fc84a, f25de109 + cbddc1f2 lane fit priced at the effective KV
  types (LFM lane 8,704 B/token; FA off prices f16 V), lane-off byte-identical (GLM, audit luna 3d6bfd75; bf16
  non-catalog input left as a known gap). Debuggable APK run 37011736047. NEXT on the S23 (charged, unplugged): in-app
  prefill short/long with prefill_kv "device", decode tok/s with V q8_0 vs the 101c2bdd baseline, answer correctness.
  **FUNCTIONAL PASS on the S23 2026-10-02** (owner: "serve vedere se apk funziona", speed not needed now; phone on the
  charger by owner OK). Debuggable APK run 37028997487 (app 0b7c5e71, binding 6b87db16), GLM 99af51c9, lab 3db078dc,
  verified on disk: KALSA_KV_TYPE_OVERRIDE V q4_0 -> q8_0, no abort/tombstone; 4 lane-on turns with prefill_kv
  "device", cache_type_k/v q8_0, 12/12 chunks HTP0; 391 / ZAFFIRO-42 needle in a 3,084-token prompt (16 s) /
  follow-up n_common=3192 -> 391 (NPU-prefilled KV read by CPU decode); DEBUG "awaiting trigger" 0 with 1,285 INFO
  lines; lane off -> Canberra, no override. Keys restored (route=gpu, npu_lane=off, devmodels absent, nativelog off,
  energy_trace=1, kvtranscript=1). Speed vs the 101c2bdd baseline still unmeasured.
  **SPEED MEASURED 2026-10-02 evening, S23 UNPLUGGED** (GLM f6febc48, `scratchpad/agents/s23-option-a-speed-7ec12eb0/`,
  lab 56d590db; per-turn rows re-read by me in raw/all-rows.tsv): app 7ec12eb0, baseline protocol of
  `s23-layers-device-proof` (101c2bdd). Lane-on prefill: short 1,735 tok **706.7 vs 177.5 tok/s (4.0x)**, long 3,145 tok
  **661.4 vs 120.2 (5.5x; 26.1 s -> 4.75 s)**, all chunks HTP0, KV q8_0/q8_0 on device. Decode unchanged within noise
  (short 10.6 vs 11.1, long 9.10 vs 8.65 tok/s): V q8_0 costs nothing measurable on CPU decode. Control = lane-off GPU
  (unchanged path) within +4 % of the baseline -> comparable conditions. 7/7 answers correct. Temps 29.6-39.7 C pre-turn,
  peak 41.0, never 43. Option (a) is DONE as engineering; turning the NPU lane on by default is the owner's call.
  **OWNER 2026-10-02: "Si vai" + "accendi tutto e provalo su qdc, su tutti i telefoni snapdragon facendo on vs off".**
  PUSHED app main `2a079bd2`: ac7a0a02 absent `kalsa.bench.npu_lane` = "auto" (gated: Android, no mmproj, HTP arch >= 73,
  not MoE, lane fit); ea3c8313 absent/unreadable `kalsa.governor.enabled` = ON (explicit "0"/"false" from Settings stays
  OFF; Settings switch shows ON when absent); 2a079bd2 my fix of audit luna d418d9ee P1: the enabled-but-not-loaded
  `n_gpu_layers = 0` fallback is now Android-only (it would have dropped Metal on every iOS load). Full jest 317/3376.
  Blast radius (audit): Mali/MediaTek/unknown SoC and iOS never load the governor (generation map); low-RAM phones are
  guarded only by the governor's estimate-based fit (two contexts priced) - device evidence pending; V75 enablement
  rests on one board. Next: debuggable APK run 37089802965 -> QDC on every available Snapdragon board, governor ON
  (default) vs OFF ("0"), interleaved.
  **QDC ON vs OFF DONE 2026-10-03 night** (Sonnet 5.5 fb102e57, APK run 37090151989 = app 1d51f196,
  `scratchpad/agents/qdc-governor-on-off-1d51f196/`; QRD8650 rows + 60 HTP0 chunks re-read by me). Available boards
  only (QRD7675, QRD8635, QRD8550, HDK8550 Unavailable all night). **QRD8650 (8 Gen 3, v75): ON prefill 884.6 / 858.7
  tok/s (short/long, HTP0) vs OFF 70.3 (CPU) = 12.6x; decode same (13-18 vs 17).** QRD8750 (8 Elite, v79): as
  provisioned ON = CPU because the rack battery is a stub fixed at 42.0 C (`temperature: 420` on every read) -> the
  plugged latch is 42.0 -> engine rule idle+1 < 42 refuses = correct for a real phone, a QDC artifact here; with
  `dumpsys battery unplug` the lane runs HTP0 at 1105.9 / 1032.4 tok/s (~10x). SM8850 (8 Elite Gen 5, v81): governor
  never loads - `gpu-prefill-incorrect-Unknown`: the app's generation map (governorInputs.ts:127-137) has no SM8850,
  and laneFit returns NoFit for Unknown (:190) - explains the "NoFit with 18.9 GB" the agent could not. 0 crashes, 0
  LMK beyond our force-stops; all completed answers correct. QDC skin HAL unreliable (two `skin` zones, one frozen;
  boards idle at 45-46 C) -> stop raised to 48.0 on QDC only (coordinator call), 44.0 stays for our phones.
  Minutes: SM8850 985->940, QRD8750 632->579, QRD8650 472->422. OPEN for the owner: add SM8850/v81 to the generation
  map (needs a GPU-prefill correctness check on v81 first, like V73/V75/V79 had).
  **S23 Expo-57 smoke BLOCKED 2026-10-02 ~04:00 EDT** (GLM 5e5aaf19, `s23-expo57-smoke/REPORT.md`, 0/7 run): a 5-s
  airplane-mode drill killed One UI's wireless-debugging adbd (re-checked by the coordinator: 192.168.1.152, announced
  port 45119 refused). Needs the owner: Developer options -> Wireless debugging OFF/ON. Left on the phone: bench keys
  npu_lane=on, route=auto, devmodels=1 (found: route=gpu, npu_lane=off, energy_trace=1, kvtranscript=1, nativelog=off)
  - restore them. Rerun item 4 WITHOUT cutting the network.
  **Expo-57 smoke RERUN DONE 2026-10-02** (GLM 3e241b0c, lab 36ca1f58, verified on disk; verdict sent to 818369e6):
  install/keys, load-unload x3, camera/picker+DKA, share-in PASS; thermal pause not triggered (no forcing); download
  FAIL-blocked (missing-model "Scarica" row is a non-interactive View); PDF/docx FAIL (page-render timeout then silent
  no-ops, pre-pdf.js-5.7 build). **Governor item from it (mine):** with the armed bench key npu_lane=on, after Qwen<->LFM
  switches, the S23 was memory-starved (123 MB free, 2.1 GB swap, `failed to mlock 223281152-byte buffer: Out of
  memory` x2; GOVERNOR_PLAN said Fit, 2998 MiB required vs 3458.93 available). The 1660-token prewarm took 75 s, then a
  3145-token `loadPrompt` never returned (>9 min, ~128 % CPU, 0 % iowait = zram thrash plausible, ZERO HTP dispatch,
  no watchdog fired, spinner forever). After a clean relaunch the same prompt PASSED on HTP0 x11 chunks. Two open
  questions: (1) does the lane's fit undercount (two contexts + HTP rpcmem + KV are not in the 2998)? (2) no watchdog
  covers a native prefill that never progresses - the user waits forever. Evidence: `s23-expo57-smoke/raw/rerun/
  i3-long-kalsa.txt`, `i3-long-hang-window.txt`. Bench keys still armed on the S23 (npu_lane=on, route=auto,
  devmodels=1): restore with the debuggable APK of run 37011736047 after the option-(a) measurement.
  **Root cause found + FIX PUSHED 2026-10-02** (recon luna b069f3e9 `npu-lane-hang-recon/RECON.md`, two of its claims
  corrected by me on the source): every memory-fit input of `initEngine` (lane fit, n_ctx clamp, expert streaming)
  read `getCachedDeviceProfile().availableMemoryBytes`, a PROCESS-LIFETIME cache -> after model switches the lane was
  "Fit" against the app-start 3458.93 MiB with 123 MB really free. The prefill deadline WAS armed (luna said not);
  it was ~10-12 min because the EMA's only sample was the starved 22 tok/s prewarm (5x rule). App main **2e7b4dfd**
  (GLM 5b3fc658 + my 2e7b4dfd after audit luna 4938cdc8, no stale-fit / reload-every-turn / race found): keep/replace
  skip decided on the active engine's own load-time value, then dispose, then a FRESH /proc/meminfo sample prices the
  new load; plan log adds `npu_fit`, `available_src` (fresh|cached|none) and prints the lane's real compared
  requirement (+219 MiB NPU extra). Open, owner's call: a stuck native call cannot be preempted (stopCompletion is
  polled between iterations); the 5x deadline after a starved sample is long. Not yet device-proven: repro = Qwen<->LFM
  switches with npu_lane=on, then a 3k prompt; expect NoFit/clamp instead of a thrash.
  **DEVICE-PROVEN 2026-10-02** (GLM a1b86702, debuggable APK run 37052344359, report
  `scratchpad/agents/s23-fresh-ram-fit-2e7b4dfd/`, lab e1757127; verified by me on raw/plan-watch.txt): 8/8 loads
  `available_src:"fresh"`, 0 cached, available_mib within ~10-21 MiB of MemAvailable read 0-1 s later; same-model turn
  kept KV (nPast 1801); Qwen<->LFM x4 in one process, then the 3434-token needle prefilled on HTP0 in 2.68 s, ZAFFIRO-42,
  no thrash. Keys restored (route=gpu, npu_lane=off). NEW, open: a turn-2 `set_thermo_profile: invalid thermal profile;
  accelerator admission is closed` -> `KALSA_GOVERNOR_FALLBACK reason:"prefill admission aborted"` -> attempt 2
  re-prefilled on CPU (25 s), losing the KV handoff (`raw/` 16:24:03). **Root cause (me, on the source; recon luna
  303b99cd said UNKNOWN):** app a855ab6c (2026-09-21) moved the plugged-baseline latch to the engine and sends the
  LIVE battery temp as `t_idle_c` every read, but engine `llama-governor-policy.cpp` (2026-09-03) still offsets plugged
  thresholds from `profile_.t_idle_c` (live: WARM unreachable while charging) and marks the profile Invalid when the live
  value drifts >1.5 C from its latch (phone was charging, battery warmed in turn 1). Latent until today because benches
  never run plugged. Engine fix dispatched (deepseek 8edbb524, `kalsallama-wt-thermo`): thresholds + hot_plugged from
  the latch, drift is a temperature not a fault. **ABANDONED after audit space-bunny 67cac407** (verdicts judged by
  me): the engine policy lives one per model load, so an engine latch re-latches HIGHER on every reload (a phone >= 39 C
  at a reload gets no WARM band below 42); live t_idle still trips the `idle+1<42` gate at 41 C = sticky abort 2 C
  below the 43 C pause; an invalid unplug read does not clear it. **Chosen fix: restore the app-side plug-edge latch**
  of e5788cfe in `GovernorBatteryModule.kt` (process lifetime -> survives reloads, cleared on any plugged=false read),
  engine unchanged; the engine's JS-free validity rule stays the sole decider. Dispatched deepseek de771c3d in
  `kalsa-wt-gov`. Follow-up for the next engine release: `llama-ext.h` comment (e3088932c) "t_idle_c ... forwarded raw
  by the client" becomes false - doc-only fix. Engine commit 5d8368a2d stays unpushed and is dropped.
  **PUSHED app main `7ec12eb0`** (deepseek f8f0c504 + my 7ec12eb0 after audit space-bunny fc66dc8e; full jest
  306/3278). Audit findings I judged as pre-existing DESIGN, not regressions (same as e5788cfe), open for the owner:
  (i) the latch is the first PLUGGED READ, not the plug-in edge (reads are on demand), so a phone that plugs in hot
  latches hot -> plugged warm/cool lines at min(latch+3/+4.5, 42) leave only the 44 C kill line + 43 C app pause as
  brakes, and a latch >= 37.5 C (hot_plugged) closes GPU_COOLMODE; (ii) a latch >= 41 C = profile Invalid for the
  whole plugged session (CPU); (iii) an unplugged read that is never pushed to the engine (reload race) then a replug
  > 1.5 C away -> engine drift Invalid until the next model load (self-heals on reload). Device check: debuggable APK
  run 37066820198 on 7ec12eb0, S23 PLUGGED, two turns + a model switch, expect no "invalid thermal profile".
  **DEVICE-PROVEN 2026-10-02** (GLM 00f064f5, `scratchpad/agents/s23-plugged-latch-7ec12eb0/`, lab 78038d14; counts
  re-run by me on raw/): plugged, battery 29.5 -> 37.0 C over 6 LFM turns + a Qwen load in one process; 0 "invalid
  thermal profile", 0 "prefill admission aborted", 0 GOVERNOR_FALLBACK; LFM turns 1-6 prefilled on NPU HTP0 with the KV
  held (the old build aborted turn 2 at +1.7 C). The Qwen load (new engine policy) at 37 C stayed valid = the latch
  survives a reload. Not run: the LFM switch-back (the charger physically dropped at 19:00, owner to re-seat it). Note:
  `KALSA_GOVERNOR_THERMO` only logs on an invalid profile, so "valid" is attested by the absence of failures + HTP0.
  Queued for the governor session: (a) S23 smoke of the Expo SDK 57 patch-line APK (iOS session 818369e6 lands it on
  app main, owner-approved 2026-10-02; Android change: expo-modules-core 57.0.10+ double-settled promise never settles,
  expo#46770) - baseline = tonight's 101c2bdd run; (b) next binding round folds in the iOS build fixes of
  `ios-readiness/BINDING-PATCHES.md` (FATTN_SMEM in the Metal overlay, arm/quants.c on x86_64, Podfile CXX20 flags,
  podspec ggml-cpu glob).
  **iOS 2026-10-02 (session 818369e6):** (1) Expo SDK 58 beta trial (owner "direi sdk58") on local `ios/first-build`
  `7c324067` over SDK 57 baseline `c67e2df1`: builds, launches, loads LFM2.5 on the iOS 27 simulator
  (`ios-readiness/SDK58-TRIAL.md`). NO-GO for main until RN 0.88 stable; audit `AUDIT-sdk58-trial.md` (space-bunny)
  adds blockers the report missed: 37 packages changed (17 documented), the lock carries 3 new peer conflicts
  (`@expo/ws-tunnel` wants ws ^8, lock pins 7.5.13 - `npm ci` likely breaks), jest 30->29 reverts `69a7662b`, SDK 58
  `@expo/fingerprint` "balanced" ignores node_modules edits, whisper.rn patch hides a runtime hazard. (2) pdf.js
  3.11.174 -> 5.7.284 legacy on local `expo57-bump` `749f3591` (GLM 99cb9854): no eval/new Function left in the shipped
  bundles (checked), CSP adds only 'wasm-unsafe-eval', SC cmaps + 14 standard fonts packed, +2.27 MB; audit running,
  then S23 PDF check, then push. (3) The owner-relayed iOS launch crash (UIScene check, 00:58 sim build) predates the
  `enableSceneSupport` fix already on main (app.config.js:153). Release run on Mac (Designed for iPad, Metal) delegated.
  **Owner 2026-10-02, PDF CJK scope:** pack Simplified + Traditional Chinese pdf.js cmaps (TC ~0.5 MB raw: CNS/UniCNS/
  B5/ETen/HKscs + Adobe-CNS1). NO Japanese/Korean now. FUTURE (remote, owner wants it remembered): JA+KO cmaps cost
  ~1.1 MB more (all 169 = ~1.6 MB raw, +1/3 as base64 per extraction); add them if Kalsa ever ships JA/KO or users send
  such PDFs. Until then those PDFs surface `cmapsMissing` instead of silently empty text.
  **iOS on Mac 2026-10-02 (`ios-readiness/MAC-RELEASE-RUN.md`, GLM 27645d01):** Release build (SDK 57 baseline c67e2df1,
  free Personal Team, push entitlement stripped on the command line) runs as "Designed for iPad" on the M1 Max: launches
  past the iOS 27 UIScene check (6 launches, no crash). Metal: `offloaded 31/31 layers`, recommendedMaxWorkingSetSize
  55,662.79 MB, load 314.72 ms warm. LFM2.5-2.6B generation: decode 31.22 tok/s (214 tok), prefill 17 tok only (not a
  prefill number). OPEN: 31 tok/s looks low for an M1 Max (memory bandwidth suggests far more) - check app settings
  (16k ctx, FA, threads) vs llama-bench before quoting it; os_proc_available_memory never logged (telemetry off).
  **pdf.js 5.7 S23 check FAILED 2026-10-02 (`pdfjs57-s23-check/REPORT.md`, GLM 112f925f):** on c39f105e every PDF
  import stalls silently - WebView destroyed ~0.3 s after `csp=true`, watchdog never fires; baseline 0b7c5e71 attaches
  zh/scanned/large PDFs in <=2 s. Does NOT land. Also pre-existing: baseline silently drops kalsa-smoke-12p.pdf. Main
  still ships pdf.js 3.11 unmitigated (mitigation-only commits 3eafa2f8/33812d0b on expo57-bump never device-checked).
  Diagnosis parked by the owner's priority (iOS first, 2026-10-02).
  **Owner 2026-10-02, iOS engine line:** llama.cpp (on Metal) stays the main iOS engine - same GGUF catalog, KV and
  governor as Android/PC; Apple Foundation Models = candidate extra "no download" option on Apple Intelligence devices;
  MLX only if our own measurement beats llama.cpp clearly. Measurement on the M1 Max delegated
  (`ios-engine-choice/BRIEF.md`, GLM 9088c720); iOS parity/desktop-link gap list delegated (luna c77e4209).
  **iOS LANDED on app main 2026-10-02: `d6d0f425`** = 7ec12eb0 + 6 iOS commits (first-build readiness, audit fixes,
  x86_64 sim exclusion, sim 0-fallback, truthful comments, `17c7e564`->`d6d0f425` zero-memory semantics scoped to iOS
  via zeroAvailableMemoryIsReal()). Audit `ios-readiness/AUDIT-ios-landing.md` (space-bunny): LAND yes, Android
  runtime unchanged, prebuilt android/ byte-identical. Verified before push on node 22: npm ci, provenance, tsc, jest
  engine/host/hooks/modules 177 suites/1714 tests, all 0. Built from the pin with ZERO node_modules patches (binding
  kalsa.rn 6b87db16): sim Debug + Mac Release, LFM2.5 31/31 on Metal. Known local trap: after an iOS pod install the
  34 generated ggml-metal-embed-*.s make assert-engine-provenance exit 1 on the Mac (npm ci fixes; CI unaffected).
  Follow-ups (thermal observer race, thermal call timeout, Mac* guard, dead RAM fallback, iPad-on-Mac memory) with
  Coder deepseek 8e331c83. Parity gaps (`PARITY-GAP.md`): iroh pairing (Android-only module), share-in extension,
  no battery current on iOS; TestFlight needs the $99 Apple Developer Program.
  **iOS engine measured 2026-10-02 (`ios-engine-choice/REPORT.md`, GLM 9088c720, M1 Max):** llama.cpp at the pin vs
  MLX 4-bit - LFM2.5-2.6B decode 128.6 vs 121.2 tok/s (llama.cpp +6%), Qwen3.5-2B 116.3 vs 146.2 (MLX +26%). Engine
  line confirmed: llama.cpp. The app's 31 tok/s is the catalog KV q8_0 K / q4_0 V on Metal flash-attn (-71%);
  coordinator cells: q8_0/q8_0 97.5, f16/f16 94.5 tok/s at 2k depth -> the MIXED K/V types are the cost. Fix candidate:
  q8_0/q8_0 on Apple GPUs. AFM not measurable here: Apple Intelligence disabled on this Mac (owner can enable it).
  **Owner rule 2026-10-02:** audits are triaged - fix P0/P1 and P2 that touch app/users/performance; the rest goes to
  `scratchpad/BACKLOG-LOW-PRIORITY.md` and work moves on (no audit loops on rare cases).
  **Owner rule 2026-10-02 (2):** ONE max-recall cross-file review per piece of work (parallel angles), not sequential
  rounds; then triage as above.
  **iOS KV default LANDED on app main `ee8b5f25`** (2026-10-02): iOS resolves any KV choice to q8_0/q8_0 (Metal decode
  ~3x at 2k, ~7.5x at 16k on the M1 Max; iPhone unmeasured); Android unchanged incl. Settings copy. Verified before
  push: npm ci, provenance, tsc, jest engine/host/hooks/screens/modules 192 suites/1846 tests, all 0. Android mixed-KV
  cost on the S23 CPU queued by 1d714246 (needs the phone unplugged).
  **iOS desktop link LANDED on app main `c4cd72ab`** (2026-10-02, owner "collegamento pc su iphone sicuro, tailscale e
  iroh"): Swift Expo bridge for native/kalsa-iroh-mobile (crate unchanged; XCFramework built at pod install by
  scripts/gen-iroh-xcframework.sh, stamped by input hash, nothing binary committed); sim proof: real nodeId through
  Rust->uniffi->Swift->JS. One max-recall review (space-bunny runtime + luna build, `ios-desktop-link/REVIEW-*.md`),
  P0-P2 fixed (Int64 trap, concurrent control + dedicated parked threads, node key excluded from backup +
  completeUntilFirstUserAuthentication, start/destroy race, NSLocalNetworkUsageDescription, LINKAGE/OTHER logging,
  script stale-output + --locked); P3 in BACKLOG. Release: iroh ~6.85 MiB of the binary, dead-strip on. Android
  prebuild byte-identical. Tailscale road needs no app change (HTTPS door/desk, ATS default OK). NOT verified:
  end-to-end pairing/chat with a Brain (asked kalsa-brain d4e57ba1 how to pair the sim with this Mac's Brain), and
  anything on a physical iPhone (Tailscale VPN, Local Network prompt, NAT, suspension).
  **iOS 2026-10-02 night:** (1) owner "accendi tutto" (governor + npu_lane default ON, 1d714246 2a079bd2) left a
  SECOND unguarded `n_gpu_layers = 0` in LlamaService -> every default iOS load ran 0/31 on CPU (M1 Max, Run 4).
  Fixed on app main `c7bee6db` (both sites Android-only, scope test checks every site): 31/31 on Metal. (2) Pairing:
  Marco's invite (v3, reachable 127.0.0.1, node, no tailnet) refused on the sim BEFORE the claim (code not consumed)
  by the phone's "set your computer's address" gate - same on Android (`ios-desktop-link/PAIRING-VALIDATE-DIAG.md`).
  Desktop contract (kalsa-brain d4e57ba1): an invite with `node` must pair with no door address, via iroh; keep the
  gate only for node-less invites. Fix on iOS+Android delegated (GLM f4537e6b). (3) AFM: Apple Intelligence enabled,
  model still downloading; probe ready (GLM cf5629bf, to be re-prompted when ready).
  **Doorless iroh pairing LANDED on app main `f4f3696c`** (2026-10-03, Android + iOS): a node-bearing invite pairs with
  no door address (claim/complete over the iroh desk lane; record doorUrl "" + pairedVia iroh); probe/chat/room
  resolve their base via doorRequestBase.ts (stand-in https://iroh.kalsa.invalid, refused by the network fetch before
  any socket); one shared predicate pairedIrohRoad(); door-bearing records unchanged. One max-recall review
  (`ios-desktop-link/REVIEW-doorless-*.md`, no P0), P1+key P2 fixed (f4f3696c). Verified before push: npm ci,
  provenance, tsc, jest 2236 tests, apk.yml harness block - all 0.
  **LIVE PASS 2026-10-03 11:00-11:03 EDT (iOS session, owner present):** iOS Simulator (iPhone 18 Pro, iOS 27, Debug
  app on f4f3696c via Metro) + Marco's Mac Brain. Fresh invite (v3, carried node 459c914b... and a loopback
  `reachable`) -> openurl -> claim over iroh -> owner pressed Allow -> "Paired with your computer". Then one chat on
  "Your computer": prompt "Rispondi solo con la parola: iroh" -> reply "iroh" (remote.brain.stream, model
  kalsa-remote-mac). Every KALSA_ROAD line road=iroh (desk dial 222 ms first, door dials 6-34 ms, one 1163 ms before
  the stream); zero https road lines. Not checked: the stored record (Keychain) - doorUrl/pairedVia inferred from the
  road log only. NEXT: one real Android phone on the same flow; Tailscale road only with owner OK.
  **iOS CPU threads: NO CHANGE (2026-10-03, measured).** iOS uses the fixed fallback of 4 threads
  (threadProfile.ts "fallback:non-android"). Mac M1 Max, build-metal llama-bench, LFM2.5-2.6B QAD-Q4_0, -ngl 99 -fa 1
  q8_0/q8_0: tg128 t1 118.5 / t2 123.3 / t4 122.3 tok/s (r=5); pp512 ~1227 at t2 and t4, 1196 at t8. With full Metal
  offload the thread count does not move decode or prefill, so no per-chip thread table. Unmeasured on an iPhone
  (A17 Pro = 2P+4E); recheck there only if a real device shows CPU-bound time.
  **OWNER DECISION 2026-10-03 (relayed by kalsa-brain via 1d714246): phone <-> PC media.** The phone sends images in
  1:1 chat with the PC over iroh, and images + videos in Room; the phone's own on-device model stays TEXT-ONLY until
  after alpha. Phone lane owner: iOS session (shared JS, Android + iOS). Contract: 1:1 = GET /props
  modalities.{vision,audio,video} gates the attach button (re-read after PC restart/model switch); OpenAI content
  parts with data:image/...;base64 only (http/file/raw base64 -> 400 media_source_refused, any video part -> 400
  media_kind_refused); phone compresses to long side <=1536 px, JPEG ~q0.8, re-encode strips EXIF/GPS; body <=16 MiB
  (413), oldest history images -> text placeholder to stay <=12 MiB; budget <=560 prompt tokens per image.
  Room = kalsa-brain docs/ROOM-PROTOCOL.md section 5b (73a92703): optional `media` on messages (old phones show
  [Image]/[Video]); upload POST /kalsa/room/media -> PUT .../{upload}/{index} 4 MiB chunks -> POST .../complete
  (sha256 + magic bytes; jpeg/png/webp/mp4); download GET /kalsa/room/media/{id} with Range, members only, post-join
  only; caps image 4 MiB, video 100 MiB, room 2 GiB (room_media_full); video compressed by the sender to ~720p H.264
  ~2 Mbps + AAC (react-native-compressor) with up to 4 still frames uploaded as images in `frames`.
  Order: after the iOS background fix lands: (1) 1:1 images, (2) Room images, (3) Room video.
  **Owner 2026-10-04: the phone has NO Room screen** (src/room/ is only the protocol layer P1-P4: api, stream, queue;
  nothing mounts it). Order approved: (1) finish 1:1 images, (2) phone Room screen TEXT-ONLY (join the PC's room,
  name yourself, members, messages, post; contract kalsa-brain docs/ROOM-PROTOCOL.md, desktop Room UI as prior art),
  (3) Room images, (4) Room video.
  **Phone 1:1 images LANDED on app main `3908f2a0`** (2026-10-04; 17b9f556 + 3908f2a0, Android + iOS shared JS).
  Remote turns carry JPEG parts only when the PC /props says vision (re-read at send, bounded, epoch-checked);
  long side 1536, q0.85, EXIF stripped by a fail-closed byte walk (re-encode, else refuse); 12 MiB phone budget,
  560 tokens per image; documents still refused remotely; on-device model stays text-only until after alpha.
  Reviewed once (luna), P0/P1 + user P2 fixed; Simulator re-test PASS with the owner; Jelly LIVE PASS 2026-10-05 (APK 3908f2a0, read "JELLY 42").
  Follow-up `ac457508` (2026-10-04): 3908f2a0 left notes/library-document attach rows ungated while remote and broke
  ci.yml (src/host/fileSize.test.ts: HostRoot 258>241). Fixed: one remote allow-list per attach row (pictures +
  templates only), notes never ride the desk (send rule + arm cleared on switch), document/PDF pages never ride
  the desk (current turn and history corpus), HostRoot back to 241 via hostVision.ts. Reviewed (luna 9aa0420c);
  full jest 331/3485 + harness green before push. Lesson: pre-push now includes fileSize.test.ts + ci.yml check.
  Decision (owner delegated to this session, 2026-10-04): earlier photos of the SAME conversation ride to the PC
  with its history, including ones attached while the phone model answered. Reason: the person sees the photo in
  the chat and expects the PC to know it; the text of those turns already goes; the PC is their own paired one;
  pictures ride only when the desk sees and always EXIF-stripped. Document/PDF pages never ride.
  **iOS performance track (owner 2026-10-04: smooth, low RAM, never crashes).** Recon luna bb728e4f ->
  scratchpad/agents/ios-perf/RECON.md. Batch 1 (Coder, branch ios/perf-1): memoryWarning -> release the idle local
  context (deferred while generating), mlock off on iOS only (pins GBs of wired memory = jetsam risk), root error
  boundary. LANDED on app main 2e5e13cd (2026-10-04; c269d7be+34745efc+2e5e13cd; review luna 977ec3c3, P2s fixed:
  poisoned dispose resets the hash, owed release honoured on native-work settle and never under a claimed send,
  idle embedder released too, boundary outermost; full jest 3519 green). Batch 2 after measuring: transcript is a
  non-virtualized ScrollView and the 33 ms coalescer re-renders
  it per token. Simulator/Mac numbers are not iPhone numbers; jetsam needs a real device (partner 15 Pro, ask).
  **iOS background generation LANDED on app main `30038004`** (2026-10-04; commits 523d104e, 0033f6b1, 30038004 on
  pin kalsa.rn 7c26e272). iOS forbids GPU work in background; a failed Metal command buffer latches ggml-metal
  `has_error` (reset only at context creation) so the context silently decodes nothing afterwards. Now on iOS:
  "background" with a local send in flight -> abort via the send's AbortController (partial kept, interrupted); any
  local native work / chat load in flight -> context marked poisoned (epoch); poisoned KV never saved
  (shouldSaveSession kv_poisoned); on "active" and in the ensure path a poisoned context is released and reloaded
  fresh; prewarm skips it; a fresh initEngine clears the mark. Android unchanged (plan gated on Platform.OS).
  Writer deepseek (Coder), reviews luna x2 (db7af22b, 9a5fa3ee); P1s fixed, rare cases in BACKLOG. Simulator check:
  background mid-answer stopped it, next local message answered "ok" (the Simulator may not enforce the GPU ban;
  the real Metal failure needs an iPhone). Pre-push: npm ci, provenance, harness block, targeted jest 106 - all 0.
  **Apple Foundation Models measured 2026-10-03 (M1 Max, macOS 26.6.2; `ios-engine-choice/REPORT.md` AFM section):**
  contextSize 4096 total; decode ~33-46 tok/s, TTFT 0.5-0.7 s short / ~7 s on long prompts; no refusals. Quality: IT
  and ES grammar slips, ZH code-switches to English, 3-turn chat degrades (hallucination), reasoning cell correct.
  Coordinator verdict: not a main engine (small context, multi-turn weak, no model id/version); at most an optional
  "no download" fallback, low priority. LFM2.5 on llama.cpp with q8_0/q8_0 KV: ~95 tok/s on the same Mac.
  **Phone log -> `POST kalsa.io/report` (owner decision 2026-10-02, relayed by kalsa-brain d4e57ba1):** one endpoint
  for desktop and phone (Worker `workers/report/`, app main de52fdf1; header `<version>/android/arm64`; 201 -> 8-char
  id). UX mirrors the desktop: upload only on the tester's press, crash prompt (Send / Not now) after an unclean exit,
  the report id shown after sending, the bold sentence "The log never contains your messages, Kalsa's answers, your
  files, or any code or key." in 5 languages. Privacy rules 1-6 from the desktop review rounds apply (no debug/slot
  knobs, drop parse-error/diff lines, 300-char clip, crash location only, JS errors name + first frame, URLs without
  query/fragment, no device labels/serials/IPs/home path, newest 4 MiB cut on a line). Governor session owns the phone
  side. Found before starting: (1) the phone has NO log file - only logcat and the 50-line in-memory native tail -
  so a collector (allow-listed ring buffer of our own lines) comes first; (2) BLOCKER: kalsa.rn
  `cpp/jsi/RNLlamaJSI.cpp:271-277` still forwards llama.cpp DEBUG to JS as "info", and the native tail keeps every
  level, so with tools on the `llama-grammar` "awaiting trigger ... (`%s`)" lines carry every sampled piece of the
  answer (memory native-log-mirror-puts-model-text-in-logcat). Fix in the binding (drop below INFO before JS) in the
  next binding round, before any phone upload exists. Binding 2ff449b7 (DEBUG/NONE dropped before JS) + 4f884d74 (iOS
  fixes of BINDING-PATCHES.md items 1-4 at their patch sources), GLM; hostile audit space-bunny 80f568a2 -> fix round
  (stderr gets the same level filter, thread_local CONT lineage, symmetric x86 guard, true comments, plugin strips the
  old OTHER_CPLUSPLUSFLAGS line; GLM 05853fd7) -> re-audit space-bunny 17adfb70: no correctness bug; test guard
  strengthened (gate before the stderr write). **Binding PUSHED `6b87db16`, app main PUSHED `0b7c5e71`** (pin; npm ci +
  provenance + tsc EXIT=0; debuggable APK run 37028997487 = first Android compile of it). Known residuals, deferred:
  toggleNativeLog(false) restores `llama_log_callback_default` (unfiltered stderr; the app toggles ON at init, and
  stderr->logcat on app processes is unproven); RN 0.88 batchedBridge -> bridgeless runtime access (needs an iOS
  build). **Collector design constraint from that audit:** level filtering is NOT enough -
  engine ERROR/WARN lines still carry user text and reach JS: `common/sampling.cpp:304` LOG_ERR prints the whole
  generation prompt when the grammar sampler fails to init, `common/chat.cpp:1513` LOG_WRN prints unparsed model
  output on every tool-call parse failure, `common/chat.cpp:317` tool names. So native lines enter the uploaded log
  only by allow-list (our KALSA_* structured lines + a fixed list of engine prefixes, each clipped), never free text;
  and the collector never reads logcat (`RNLLAMA_LOG_CONTENT` is ON by design in debuggable APKs: content goes to
  logcat tag RNLlama there).
  **Step 1 of 3 PUSHED on app main `25a72150` (2026-10-02):** `src/logReport/` = per-tag schema (19 tags: numbers,
  booleans, closed literals pinned to the emitters by a drift test, registry model ids), final normalizer, console +
  JS-error collector, app-private 4 MiB file (temp+move rotation). Design: luna 2a42d349 + my decisions
  (`phone-log-report/DESIGN.md`); GLM 363e302b -> audit space-bunny 437372b7 (no reachable leak; 2 latent holes +
  bugs) -> GLM f9597f12 -> re-audit luna bf567220 -> my schema update for npu_fit/available_src. Accepted residual: a
  crafted multi-line JS error message can forge a frame location with digits only. Nothing is sent yet: step 2 =
  sender + Settings panel (en/it strings from the desktop); step 3 = unclean-exit prompt (Android ApplicationExitInfo
  via kalsa-lifecycle).
  **Step 2 of 3 PUSHED on app main `d5097453` (2026-10-02):** `sendLog` (one POST to https://kalsa.io/report, 30 s
  abort, `credentials:"omit"`, `redirect:"error"` + final-URL check, exact Worker id alphabet, never rejects) +
  `sendLogOnce` session holder (one upload per app session, remounts join the in-flight send, failure re-arms) +
  `SendLogPanel` in Settings Diagnostics (en/it strings, polite live region). GLM 0f8c8742 -> audit 803044f9 -> GLM
  ab575461 -> audit luna 995a978c -> deepseek 3fcccba1 -> audit luna 50c1510d -> my d5097453; full jest 306/3277 green.
  Accepted residual (owner may override): RN follows redirects natively, so a 307/308 FROM kalsa.io would resend the
  body before JS sees it - only our own Worker over HTTPS can emit one. Tests can never reach the network (fetch spy
  rejects by default). Next: step 3 (unclean-exit prompt).
  **Mixed K/V decode on Snapdragon CPU, QDC 2026-10-02** (owner "puoi provarlo su qdc"; agent 792d456b, report
  `scratchpad/agents/qdc-kv-mixed-decode/`, lab ec943f0b; numbers re-read by me from raw/*.json): QRD8650 (8 Gen 3; both
  8 Gen 2 boards Unavailable), LFM2.5-2.6B Q4_0, static llama-bench f86fcfab4 (-march armv8.2-a+dotprod+i8mm, engine
  code = pin 5b596ce43), taskset f0 -t 4, FA on, tg128. **No mixed-type penalty on CPU**: depth 2048 A q8_0/q4_0 23.15,
  B q8_0/q8_0 22.98, C f16/f16 21.29, D q4_0/q4_0 22.45 tok/s (mean of 2 interleaved rounds); depth 0 within noise
  (cold first reps). So the Metal cliff (-70%, iOS) does NOT apply to Android CPU decode: keep the Android default
  q8_0/q4_0 (iOS moved to q8_0/q8_0 in `resolveKvCacheProfile`, 818369e6). Open: depth 8192 (A 14.04 one hot sample,
  B lost at session end) - the app's real depth is ~15.7k; a cold A/B pair there is the only remaining question. Note:
  quantized V needs FA on this engine (`-fa 0` with V q4_0/q8_0 refuses). Engine main CI fixes on the way:
  android-bench builds static for the app arch (e86ece391, 7d9db53b3 env-var input after the security review,
  f86fcfab4), libllama links libandroid on Android (1092e33a9; the binding already did). 40 QDC min billed.
  **Step 3 of 3 PUSHED on app main `37624f8e` (2026-10-02) - phone log feature COMPLETE:** `kalsa-lifecycle`
  `lastExitInfo()` (Android ApplicationExitInfo, newest record: closed reason literal + importance + timestamp only;
  never description/trace/processName/pid, source-guarded) -> `uncleanExit.ts` asks once per record iff crash /
  crash_native / anr, or low_memory / signaled / excessive_resource_usage with importance <= 200 (visible); a background
  OS kill, force-stop, update, exit_self never ask (my call, owner may override); consumed timestamp in AsyncStorage
  -> `UncleanExitPrompt` modal (title/body/privacy sentence, embeds SendLogPanel, Not now / back dismiss). iOS: no
  ask. deepseek 9be4a55e -> audit luna 1abe89cb (privacy + app-initiated-exit false asks REFUTED; no self-kill
  anywhere) -> my 48 dp Send button + rebase over the iOS kalsa-lifecycle change; full jest 314/3362. Accepted
  residuals: pid=0 query would also see a secondary process (none declared today); one sync binder call at launch;
  prompt not scroll-wrapped at huge font scales (unverified).
  **Binding r3 follow-up round CLOSED 2026-10-01** (GLM a833e1e5 + ab2525d3, audit luna 5b5ed90e r4): host CMake build
  definition (CMakeLists, rnllama-sources.cmake, rnllama-build-options.cmake) now in the skel source fingerprint;
  skels bound to their DSP version via ELF e_flags; governor_npu_device under its mutex; clean errors on malformed
  ELF; QAIC dir from the version list; false comments fixed. Coordinator judged OUT of scope and documented in the
  gate: Gradle-passed CMake args (not fingerprinted - every Gradle edit would force a 20-min rebuild) and hand-rewritten
  e_flags (deliberate tampering, like stamp forgery); the gate is a review control against accidental skew. Skels
  rebuilt twice by the Docker recipe, code bytes unchanged (only the KALSA_HTP_SRC stamp). Binding PUSHED `7c12bdc6`.
  Binding remote pruned to 2 branches + archive tags (REPOS.md). App PUSHED main `101c2bdd` (pin kalsa.rn 7c12bdc6,
  engine 5b596ce43, provenance gate EXIT=0). Debuggable APK for the queued S23 session: run 36951238850.

### Pairing: iroh and invite links

- Iroh pairing passed on Jelly with app commit `aba67977`; invite-by-link uses the existing v3
  QR payload, and desk-side Allow remains mandatory.
- The `kalsa-pair` Worker is live (version `5f5ea8c9`, deployed 2026-09-27), serving `/pair*` and
  `/.well-known/assetlinks.json`. Both endpoints returned HTTP 200 on 2026-09-28; commands and
  results are recorded in `scratchpad/agents/pair-worker-reachability/2026-09-28.txt`.
- **Beta debt (owner decision, 2026-09-28):** the owner accepts the `assetlinks.json` debug-key
  risk for the family-only alpha. Before beta, create our private release signing key (also needed
  for Play), publish its SHA-256 in the Worker's `assetlinks.json`, and add a CI gate that fails if
  the file names the public React Native debug key (`FA:C6:17:…:3B:9C`).
- **Beta debt (owner decision, 2026-09-28):** the device APK for `335f9c8d` is **179.8 MB**
  (SHA-256 `eee75d1f…47a5`). Coordinator `unzip -l` breakdown: seven CPU-feature engine variants,
  **83.3 MB** total (`librnllama*.so` about **10.7 MB** each; only one loads at runtime); dex
  **34.8 MB** (not minified); other native libraries **30.6 MB**; iroh **11.1 MB**; assets
  **7.3 MB**; Hexagon skels **2.8 MB**. Before beta, keep 2–3 engine variants, strip native debug
  symbols in user builds, enable R8 for release, and ship an Android App Bundle on Play. Target
  **under 70 MB** is an estimate, not measured.
- **iroh without Tailscale PASSED on the Jelly (2026-09-28, run by kalsa-brain `edd8034a`, desk
  `054db08e`, log `~/lab/jelly-logs/jelly-2026-09-28-pairing.log`):** invite link opened the app
  directly; iroh dial door 451 ms, desk 673 ms; "Paired phone 4 is pairing again." on one line;
  chat served by the Mac; Forget gives 401; re-pair after Forget works.
- Phone-side issues from that run (open, not scheduled):
  1. A failed chat showed "Could not reach your computer" with **no log line** (no `KALSA_ROAD`,
     no `remote.brain.*`), during repeated `Fabric View [-1] does not have SurfaceId` exceptions
     (react-native-keyboard-controller). A failed chat must log its reason; a stale error bubble
     from an earlier road must not look current.
  2. After a desk Forget the phone shows a raw "error 401" - needs plain copy (owner's call).
  3. "Connected to the Mac" is shown both before and after Allow - waiting-for-Allow is not
     distinguished from paired.
  4. Owner wants a success moment after Allow (no earlier record found; decision pending).
- **All four fixed on app main `815c5360` (2026-09-29, GLM `c3ecdac4`, audits luna `2b2cffea` +
  `69e3954a`, remaining findings judged by the coordinator):** `remote.brain.failure` log line with
  {road, stage, code} (codes allow-listed by shape, no URLs/tokens); failures before a completed
  pairing render as past, also in the open conversation; 401 on a paired desk -> "This computer no
  longer knows this phone. Pair again." (owner copy), 401 on a manual server -> "The computer
  refused this token. Check it in Settings."; the wait says "Allow on {computer}", paired only after
  the poll, superseded polls abort; success banner after Allow. Not device-tested yet (needs a CI
  APK: Actions minutes out). Accepted: wall-clock rollback can misclassify stale; pre-existing
  failures (no `failureSource`) stay unclassified. Main's full jest has 5 pre-existing failures
  (remoteEngine.lifecycle/Iroh/RoadFallback, overlayDoorRoutes) - separate fix owed.

### One-copy CPU + NPU: correct on S23, too slow as built on 8 Elite

The raw-Q4_0 HTP layout fix is **correct on the S23**: P5 mean KLD **0.002750**
(`hexagon-onecopy-rawq4`, device run on engine `c939a135d`, carrying layout-fix commit
`9a2fb2376`; governor design cross-check `4d606e4f`, `5a94d88c`, `df4a18d1`, `7ac42dec`). On the
8 Elite, QDC session **853723** / lab report `9ac6ebc7` measured 512-token
prefill at **1,782 tok/s** for two-copy HMX, **57.8** for two-copy flat, and **37.3** for one-copy.
Raw one-copy is flat-only because the DSP refuses raw weights on HMX. CPU decode at tg128 was
**38.3 tok/s** with repack, **34.6** without repack, and **22.6** with raw `-HOST` rpcmem weights.
One-copy used **1,526 MiB** versus **3,448 MiB** for the separate-process two-copy HTP + CPU models,
saving about **1.9 GiB**. The v79 flat kernel KLD was **0.0193** for both layouts; HMX KLD remains
unmeasured. The speed and KLD evidence is in `scratchpad/agents/qdc-8elite-onecopy-cost/REPORT.md`
(`9ac6ebc7`); it is 8 Elite-specific and does not transfer to the S23.

**Governor implementation remains gated on making one-copy fast.** Design commits are lab
`4d606e4f` / `5a94d88c` / `df4a18d1` / `7ac42dec`. Engine branch `feat/governor-onecopy` is not
pushed: S1 is `1d39fd0dd` + `49676fd7a`; S2 is `a11e03a1f` + `c889b4658` + `b39a45be7`. Host tests
pass with the ship GGUF; the Hexagon object has only been syntax-checked and device census is owed.
S3 and later lane steps are **ON HOLD** until one-copy is fast. Owner decision: retain the GPU lane
on every device, with its flag OFF where NPU is better.

The GPU one-copy spike (`spike/onecopy-gpu-rawq4`, base `133cef802`, four review fixes `5e6b66e86`;
lab `scratchpad/agents/onecopy-gpu/`) imports one dma-buf in OpenCL and runs raw-Q4_0 GEMM. Review says
**SHIP for an S23 correctness run after the four fixes**. S23 run 1 found no import route and a
failed probe allocation (fixed in `4ff4f729c`: `cl_qcom_dmabuf_host_ptr` route, `rpcmem_alloc`
fallback). S23 run 2: the probe imports and small shapes are correct; on the full model the GPU sat at 99%
with no output and was killed (normal-GPU control KLD 0.00095). Diagnosis (mimo, engine `0285aae40`,
lab `1ecbcbfe`): most likely **slow, not hung** - the raw GEMM measures **4.75 GFLOPS** vs about
**437** for the normal SoA path (~92x slower), so one 512-token pass takes ~9 min before perplexity
prints anything. The import did happen: the INFO line was hidden by `common/log.cpp` (ggml INFO maps
to TRACE, above the default threshold); the wrapper now passes `-v`. Overflow, loop bounds and
workgroup size were ruled out on paper. Next (correctness, plugged OK): rerun with the new
`--model-shapes` probe self-test and a 20-min wait on G1. Even if correct, the raw GPU GEMM needs a
real kernel before it is usable.

The HMX-on-raw reader works on the S23 (`scratchpad/agents/onecopy-hmx-numerics/REPORT.md`; engine
`spike/onecopy-hmx-raw`, pushed at `cc9c541f2`). Automatic placement (`4eb2618fb`, no `-ot`) with
`GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_RAW_HMX=1 --load-mode none -ngl 99 -dev HTP0`: pp512 **851.5**
tok/s one-copy vs **876.4** two-copy, KLD **0.000892**. Buffers: HTP0-HOST 1,306 MiB (shared with the
CPU), HTP0 220 MiB, CPU 205 MiB; `token_embd` lands on HTP, cause under recon. Guard `f8ee54d37` +
`e71421fd9`: under mmap the loader moves these weights to plain CPU memory; the backend now refuses
them instead of crashing, the loader warns once, and the run falls back to CPU (pp128 **37.9** vs
**622** without mmap). So one-copy needs no-mmap loading in the app: owner decision, RAM and
load-time numbers owed on the S23. Open: CPU decode on raw Q4_0 is **0.62-0.64** of the repacked path
on the S23 (tg128, interleaved); a multi-row raw gemv (`spike/onecopy-cpu-gemv` `1dd83c245`) moved it
only ~4 %, so the cause is being split on the Mac. Governor S3+ stays on hold until decode is fixed.

### One copy, three legs: integration (owner GO 2026-10-04)

Owner decisions, 2026-10-04: the governor is a three-legged surfer (CPU, NPU, GPU) and the GPU must be a leg;
ONE weight copy read by all three legs is fundamental (never a second or third copy); integrate with two hard
requirements - R1 it works on the tested phones (same CPU/GPU/NPU), R2 every leg is OFF on untested phones (they keep
today's loads). Late on 2026-10-04: CPU prefill on tiles (same as today's shipped CPU path, a third of repack) is
ACCEPTED for now; a GEMM over tiles is deferred to after the integration - recorded as open item. S23 is the
coordinator's overnight; the engine branch may be pushed to our fork (never upstream).

Design: the shared copy is the NPU's own 32x32 tiled Q4_0 layout (`scratchpad/agents/onecopy-three-legs/`:
`DESIGN.md`, `FABLE-DESIGN.md` + Amendment A by the Fable 5.1 architect session, `PLAN-INTEGRATION.md` revisions
1-3). Spikes on the S23: GPU mat-vec v4 reads it zero-copy at aggregate parity with the engine Adreno path, CPU
mat-vec 0.71-0.87 of repack (`REPORT.md`). Engine `feat/governor-onecopy` (`~/Projects/kalsallama-gov-onecopy`).

Steps (each: code -> verify on disk -> one hostile audit by a different model -> S23):
- **Gate G PASSED**: NPU from the shared tiled copy = two-copy speed (pp512 0.995, tg128 1.002, KLD identical).
- **Step 0 PASSED**: tile layout is a ggml contract (`ggml/src/ggml-q4_0-tile32.h`, `474ca75fe` + `cc777fd12`);
  S23 NPU unchanged (pp 0.998, tg 0.992).
- **Step 1 PASSED** (`REPORT.md` "Step 1 check"): tiles live in their own non-host buffer type `HTP0-TILE32`; the
  CPU reads them with a dotprod gemv (`53db71525`..`e9d7a9f45`). S23: NPU one-copy by automatic placement = two-copy
  (pp 0.991, tg 1.004, KLD equal); CPU decode on tiles +34 % (-t 1) / +21 % (-t 5) over shipped no-repack, 0.83-0.86
  of repack; CPU prefill on tiles 1.06x native at -t 1 but **0.88x at -t 5** (open, with the GEMM over tiles).
- **Step 2 measured** (`REPORT.md` "Step 2 check"): setter + `{TILE32, HOST}` placement (`80206f9b3`,
  `93fb3c097`); two-copy placement byte-identical; cap splits the tiles 827 + 479 MiB; RAM one copy 1.98 GB vs
  today's app ~3.70 GB (NPU model 1.96 + CPU model 1.74). NPU prefill 0.986 of two-copy but **decode 0.766**
  (17.0-17.4 vs 22.4-22.6 tok/s): LFM2's tied output (a duplicate of token_embd, Q6_K 205 MiB) lands in HOST and its
  lm_head runs on the CPU; today's two-copy NPU model keeps that duplicate on the HTP. **Owner decision pending**:
  205 MiB output duplicate on the HTP (keeps NPU decode) vs no duplicate (decode 0.77) vs engine work so the NPU reads
  the one copy. **Owner decision 2026-10-05: option 3** (the HTP reads the flat Q6_K tied output from HOST; one copy
  for all three legs) - Fable Amendment H requested. Fable Amendment D ranks: (1) token_embd to Q4_0 in TILE32, (2) accept the duplicate on HTP0,
  (3) HTP reads flat Q6_K from HOST (DSP work, est. ~0.95), (4) rejected. **Option 1 measured 2026-10-05**: speed
  = two-copy (SQ 896.4-896.9 / 23.1-23.5) but KLD 0.0366 NPU / 0.0336 CPU vs 0.0053 / 0.0013 (CPU same top p 89.8 %
  vs ~97 %) - a naive Q6_K->Q4_0 requant is a quality loss. Coordinator's reading: option 2 is the cheap correct
  one, option 3 the engine path to a true single copy; owner decides.
- **Step 3 PASSED** (`REPORT.md` "Step 3 check"): live-buffer pin, scheduler + CPU-compute guards (views included,
  thread-0 scan), loader reuse of a duplicated tensor from its host original, post-load audit line (`be1781cee`..
  `8ac5522d0`, GLM, luna audit + fixes). S23: tied output reused from the CPU copy, no HTP0 buffer, two-copy placement
  identical, A unchanged; one copy **1.75 GB**. Decode stays 0.75 until the tied-output decision.
- **Step 4 (coding)**: GPU leg per Fable Amendment E (OpenCL claims TILE32 by a lazy per-buffer dma-buf import, v4
  decode mat-vec, Adreno 740 gate with read-only self-check, explicit import release). GLM hit its 5-hour quota
  mid-task (2026-10-05 03:30); deepseek finished it (`777c1ac5c`..`a651191f4`). Luna audit: not mergeable (aborts
  after placement, stale import reuse, cache policy, image alignment, per-device gate). S23 first run: the R2 gate
  turned the leg OFF on the tested S23 ("740" is in CL_DEVICE_VERSION, not the name) and fell back cleanly to the CPU
  tile reader; the step-3 audit also refused a misplaced load by name. Fixes `d816d556c`..`0e7109fdf` (deepseek):
  on the S23 the leg is now ON and correct (2 imports, self-check 166/166) but **3.50 vs 11.51 tok/s** for today's
  two-copy OpenCL decode at -t 1: 197 graph splits per token, only the mat-vecs on the GPU. The leg needs norms,
  conv and attention on the GPU too. S23 stopped at 30 % battery.
  Fable Amendment G: no new kernel needed - import the HOST dma-buf like TILE32 (f32 norms/conv read in place),
  token_embd in HOST read by the existing plain Q6_K kernel (lm_head on the GPU), KV on OpenCL for the GPU-leg
  context; target <= 2 splits and >= 0.9 of 11.51 tok/s. Step 4b (HOST import, token_embd placement, Q6_K path)
  comes after the main merge; the KV move needs leg_devices (step 5). Amendment G also flips the tied-output ranking
  to option 3 (HTP reads flat Q6_K from HOST: one copy serves all three legs) over option 2 (205 MiB duplicate).
- **Main merge done and pushed** (`6a937f6db`, deepseek; luna audit: no lossy hunk): 5 conflicted files, host + Android builds, tile32 and
  governor host tests (incl. v0-hybrid with the ship GGUF) green; release skel changed (main moved 56 DSP files) -
  the NPU numbers of steps 1-3 must be re-measured on the merged build. HTP Q4_0 tiles still 576 B (TILE32 layout
  intact, static_assert kept). Audit leftovers in `scratchpad/BACKLOG-LOW-PRIORITY.md`.
- **Step 4b (code in `6ed31f68e`..`ee3dfde49`, GLM; audit running)**: HOST buffers imported like TILE32, native
  HOST tensors read in place by the existing OpenCL kernels, token_embd in HOST so the plain Q6_K kernel runs the
  lm_head on the GPU (Amendment G). The coder bypassed the A7X vocab-scale Q6_K guard (it protects the SoA kernels;
  the plain kernel is another) - the S23 KLD decides.
- **Option 3 (coding, 2026-10-05)**: Fable Amendment H (`FABLE-DESIGN.md`, committed): Q6_K raw rows DMA'd into VTCM
  and converted to the 896 B tiles there (the Q4_0 raw pattern), per-op host gate instead of `opt_mm_select == 1`
  (which would switch HMX off for the whole model), unaligned 1680 B row stride to probe on the S23 first, twin host
  test; gates pp512 >= 0.98, tg128 >= 0.95 of two-copy, KLD identical. GLM implements it in worktree
  `~/Projects/kalsallama-gov-q6raw` (branch `feat/governor-onecopy-q6raw` from `ee3dfde49`, local only) so it does
  not collide with the 4b fixes. Fable's Qwen claim that GATED_DELTA_NET is CPU-only was **wrong** (HTP
  `gated-delta-net-ops.c` and OpenCL `gated_delta_net.cl` exist; correction appended under H4). Qwen still needs:
  requant KLD vs Q4_K_M first, GDN placement at S23 shapes, hop commit bytes, 521 MB lm_head time.
- Step 4b audit: luna hit "model at capacity"; re-run on reviewer n2 (space-bunny).
- **Qwen (owner question 2026-10-05)**: the engine pieces are generic, but nothing is measured on Qwen. The local
  `Qwen3.5-4B-Q4_0-requant-from-q4km.gguf` (qwen35 hybrid) has 248 Q4_0 matrices (TILE32-able) and a tied Q6_K
  output of 2560 x 248320 (~500 MiB); one copy needs Q4_0 matrices (a Q4_K_M Qwen cannot use it; the requant's
  quality is unmeasured) and Qwen3.5-4B never runs under the governor today because it loads an mmproj (owner rule
  2026-09-25). To check on the S23: placement proofs, KLD and NPU speed one vs two copies.
- **Step 5 prerequisite** (Fable Amendment F): hop v1 lives on engine `main`, not on this branch (merge-base
  `45f097b74`, main +373 commits, branch +50): merge main into the branch before step 5.
- Next: step 5 (leg contexts + hop v2 in the one hop site), step 6 (binding table, one model
  load, R2 negative control on Jelly/untested Snapdragon).

Open: GEMM over tiles for CPU prefill (deferred, owner 2026-10-04); GPU leg may not rest the CPU (attention,
norms, lm_head stay on CPU) - step 4 measures it; RAM saving not measured yet (max RSS does not count dma-buf); the binding must call the step-2 setter before
anything reads the Hexagon buffer types (step 6); a sporadic hang of the CPU-repack KLD on the S23 (2026-10-05:
43 min spinning on the first pass, a re-run of both the step-0 and step-1 binaries finishes in 48 s with identical
KLD, so not a step-1 regression; watchdog now dumps thread stacks).

## Gates and dates (recovered 2026-09-21)

The concise rewrite of this file dropped the dated register. It is recovered here from
`archived/PLAN-2026-09-full.md:408-431` ("Primo modello: 9 settembre – 9 ottobre", its table) and
the timeline rows at `:69-71`. The dates are 2026 and were planning estimates subordinate to the
gates, not publication promises.

Critical path: **G0 baseline → G1 model → G2 complete chat → G3 correct profiles → G4 sustained
quality → M1**.

| date | gate or step | what it requires |
|---|---|---|
| 9 Sep, Wed | **G0** | a reproducible baseline, the real device matrix, schedulable slots; no booking in the dark |
| 10–11 Sep | — | MiniCPM entry; two comparable candidates |
| 14–15 Sep | **G1**, 15 Sep | the model chosen, and the baseline with absolute per-phone targets written BEFORE tuning |
| 16–18 Sep | — | authoritative session and restore contract; checkpoint on the 18th (correct recovery, observable reused tokens) |
| 21–23 Sep | **G2**, 23 Sep | complete chat on the CPU path, governor tests where the path is admitted, recovery without corruption |
| 24–25 Sep | — | profiles identified by artefact/driver, cache cost, measured static alternatives |
| 28–29 Sep | **G3**, 29 Sep | every phone has at least one correct path, and every ENABLED path passes its tests; NPU without evidence stays out |
| 30 Sep – 2 Oct | **G4**, 2 Oct | sustained quality and performance; consumption measured or measurement limits declared; regression causes explained |
| 5–6 Oct | — | candidate frozen on the 6th; no dependency on hidden debug flags |
| 7–8 Oct | — | M1 dossier with raw results, limits and reproduction instructions |
| 9 Oct, Fri | **M1** | the first model complete and banked on the three phones, or a precise list of the missing gates |
| 12–16 Oct | reserve | if a gate stays red, replan; never promote an incomplete build |

After M1: **M2** 30 Oct (the second dense model, on validated devices only, and it must add useful
capability rather than being the automatic loser of the first comparison), **M3** 20 Nov (the first
large MoE within the declared perimeter), reserve to 27 Nov. A separate gate on 12 Oct reopens the
MiniCPM5 fine-tuning decision, with the LFM licence revenue threshold as one input.

Two riders carried with the same table, because both were later misread:

- GPU/V75/q4_K, the other generations, the NPU and the governor are evidence-gated in the
  **24–29 Sep** window and are explicitly NOT "after M1" (`archived/PLAN-2026-09-full.md:1813`,
  `:1825`). Only the NPU was left as a time-boxed decision.
- Physical-device availability inside 14 Sep was a CALENDAR ASSUMPTION, not a confirmed
  connection: if the phones arrive late, code, corpus and CI advance while G1 and its dependent
  milestones move with them (`:431`).

### Where the schedule stands on 2026-09-21

- **G1 closed early, on 10 Sep**, with LFM2.5-2.6B (Q4_0 QAD) as the single main model; the
  MiniCPM5 arm was stopped (Xiaomi arm cancelled, S23 stopped at 16/24).
- **M1 is NOT done.** It is due **9 Oct** with a 16 Oct reserve, and it sits behind G2 (23 Sep),
  G3 (29 Sep) and G4 (2 Oct). Today is the first day of the G2 window.
- **G2 is not claimed.** The record that carries the G1 closure and the device sessions through
  mid-September ends with "G2 not claimed" (`archived/PLAN-2026-09-full.md:1965`, `:2003`,
  `:2045`, `:2488`) and the archived diary stops at 2026-09-20. No document records a G2 claim
  after that, so the answer to "is M1 finished?" is no by the gate it depends on.
- **2026-09-22 check:** still no G2 claim on disk, and the prefill stall now reproduces on the
  build we ship (`docs/ALIVE.md`, "2026-09-22"), so G2's long-session criterion stays blocked
  behind the governor exactly as the 2026-09-21 decision says.

### Owner decision 2026-09-21: bring the Governor forward

Owner, 2026-09-21: the Governor work is anticipated. The reason is a measurement
fact: after a certain number of CPU turns the phone enters Android's severe thermal mode and
everything stops, so the 20-30 turn sessions G2 asks for cannot be run at all until something
controls the thermals while the session runs.

What this changes:

- **G2's long-session criterion is unreachable as written.** It is not a test to re-run; it is a
test that cannot exist until the governor is in the loop. The first three steps of the governor
order of work (`analysis/GOVERNOR-DEVICE-PLAN.md`, Part 9: fixes 5.1/5.2/5.3, then the GPU probe,
then the runtime probe with `gpubusy`) move AHEAD of G2's closure.
- **The app-side energy measurement (the "consumption" item) and the governor are the same work.**
  Defect 5.2 IS the battery path: `GovernorBatteryModule.kt:62-66` sends `plugged` and
  `sensorValid` but not `t_idle_valid`, the parser defaults it to `false`, and with the cable
  plugged the profile is `Invalid` → `Abort`. The measurement cannot be built beside the governor;
  it is the governor's input.
- **The governor lives in the engine, so this is a cross-repo pipeline, not an app-only change:**
  engine commit → binding fork bump (`Aspis0/kalsa.rn`) → app pin → APK CI → device verification.
- The device plan itself is re-opened by this decision. It was parked per an earlier owner order
  (`analysis/GOVERNOR-DEVICE-PLAN.md`, "Governor"), and this is the un-park.

### Owner decision 2026-09-21: defect 5.2 is fixed by SUPPLYING the data, not by dropping the requirement

Asked whether the app should measure the missing `t_idle` reference or the engine should stop
requiring it on the `plugged` branch, the owner chose to MEASURE IT, with the reason stated:
users keep using the app while the phone is charging, so the plugged case is a real usage case
and not an error to be tolerated. Consequence: the app-side state reader must be able to fill
`t_idle_c` / `t_idle_valid` honestly; what those fields mean in the engine's terms and what the
app can observe to fill them is reconnaissance, not a guess, and is being mapped before any code
is written.

## Roadmap and next steps

**Accelerator order (owner, 2026-09-29):** Snapdragon first (everything that can be done: NPU, GPU,
one-copy, governor), then iPhone, then Exynos (Samsung Galaxy with Exynos 2200/2400/2500: AMD-based
Xclipse GPU, never mapped; route = Samsung Remote Test Lab, free 5 h/day, its decisive probe - push
and run a native ELF from /data/local/tmp - is still unproven, see `scratchpad/agents/samsung-rtl-recon/`),
then Mali, and Google Tensor last. Tensor route to assess, in
theory first: the Google Tensor SDK (https://developers.google.com/edge/tensor-sdk, beta behind a
sign-up form, 2026-09-29) runs models on the Pixel TPU through LiteRT AOT-compiled models. Open
questions before any work: whether it takes LLMs with int4 weights, whether a LiteRT model can share
weights with our GGUF engine (if not, it is a second copy and a second runtime, against one-copy and
one-kernel), and the sign-up terms. Note: Pixel's GPU is a Mali, so the Mali step already covers the
Tensor GPU.

**iPhone engine (owner, 2026-09-29):** llama.cpp (our fork) on Metal, through the binding - same
engine, same GGUF, same governor, one kernel. Apple's unified memory lets Metal use the weights
without a copy, so one-copy comes for free there. Core ML / the Apple Neural Engine is NOT the plan:
it needs its own model format and cannot share weights with the GGUF (a second copy and a second
runtime). It stays a later research lane for prefill only, and only if Metal prefill proves too hot
on a real iPhone. Today iOS runs llama.rn's prebuilt upstream Metal xcframework; the fork's iOS source
build (`RNLLAMA_BUILD_FROM_SOURCE=1`) has never been attempted. The Mac checks Metal correctness; speed,
heat and the iOS memory limit need a real iPhone.

### Kalsa model: a recent MoE fine-tuned as "Kalsa" (owner request 2026-09-29, PROPOSAL)

Goal: ship on PC first (phones later) a recent open-weights MoE, fine-tuned by us with a "Kalsa"
identity. Not LFM, not dense, nothing trained from scratch; dream size ~5-8B total, 2-3B active;
pruning allowed. Research (luna, 2026-09-29, sources in the agent report, key ones re-checked):

| candidate | total / active | licence | reach 5-8B | main problem |
|---|---|---|---|---|
| Qwen3.6-35B-A3B (2026-04) | 35B / 3B | Apache-2.0 | ~77 % expert pruning | pruning far beyond published evidence (REAP tests 25-50 %) |
| Moonlight-16B-A3B (2025-02) | 16B / 3B | MIT | ~50 % pruning | Italian unknown, older |
| Ling-mini-2.0 | 16.3B / 1.4B | MIT | ~51 % pruning | 1.4B active, Italian unknown |
| Phi-mini-MoE (2025-06) | 7.6B / 2.4B | MIT | none | 4K context, English-only by design, data cutoff 2023-10 |
| Trinity Nano Preview (2025-12) | 6B / 1B | Apache-2.0 | none | 1B active, preview |
| Granite-4.0-H-Tiny (2025) | 7B / 1B | Apache-2.0 | none | 1B active, hybrid runtime issues |

REAP evidence: at 50 % expert pruning, mean -1.2 % on non-agentic coding and -5.9 % on tool use
(arXiv 2510.13999, large models). Nothing published supports ~80 %.

**Owner decision 2026-09-29: base = Qwen3.6-35B-A3B** ("sappiamo benissimo che Qwen 3.6 35b vince su
tutti"; no smaller recent MoE exists). No phase 0.
Phases (each gated):
1. **Prune:** one REAP observation pass, then several ratios from the same saliency (25/50/65/75 %),
   each converted to GGUF and scored EN/IT vs the unpruned base; keep the smallest that holds.
   Prep (fork pin, calibration set, pod script, estimate) on the Mac first: `scratchpad/agents/kalsa-reap-prep/`.
   **2026-09-30 update (owner):** target narrowed to PC + 16 GB phones (LFM stays on 8 GB); want 2-3 B active, faster
   than dense Qwen3.5-4B, better than LFM2.5; the $15 REAP pod was dropped after the $0 Mac probe (REAP20 and
   unpruned Qwen3.6 beat LFM on bpb/GSM8K but decode 0.45x/0.39x LFM on Metal). Instead a one-shot **quality gate
   probe** on Runpod (owner cap $10; Fable reviews 1-3 in `kalsa-reap-prep/REVIEW-FABLE-*.md`): arms LFM ship,
   RAZOR-19B-A3B (arXiv 2609.30465), Qwen3.5-4B, Qwen3.6 unpruned top-k 4, top-k 4 + k2=16 renorm (arXiv 2609.04575,
   engine `spike/topk-k2-renorm` `a2f252fbd`), Qwen3.5-2B; results to the private HF dataset
   `Kalsa-ai/kalsa-gate-probe-results`. Speed on 16 GB is NOT measured by this probe. Status and launch lessons:
   `scratchpad/COORDINATOR-STATE.md` (2026-09-30 blocks).
   **RESULT 2026-10-01 (all 9 arms, $6.82, pod deleted; `results/gate_probe_a40_2026-10-01/REPORT.md`):** RAZOR-19
   lost Italian/Spanish/French (IT bpb 1.46 vs unpruned Qwen3.6 0.58, no better than LFM 1.48; EN 0.79 vs 0.59) - the
   RAZOR-19 prune is OUT for Kalsa (its card says multi-domain RazorCal calibration, language mix unstated). Unpruned Qwen3.6 beats LFM on bpb in every language (IT 0.58 vs 1.48).
   GSM8K is confounded by the 4096 cap (Qwen3.5-2B 161/200 cut) - re-score before reasoning claims. k4 costs RAZOR
   26 GSM8K points; k2=16 renorm recovers most (0.71/0.45/0.635). Script bug: `30_gate.sh:59` does not pass the arm's
   overrides to bpb, so the k4/k2 bpb rows are default-k. OWNER DECIDES the next lane: multilingual-calibrated prune
   vs unpruned Qwen3.6 with expert streaming on 16 GB. Rotate the HF probe token.
   **Cause probe 2026-10-01 (owner: "misura la causa"):** first run (luna f84325e4,
   `scratchpad/agents/razor-italian-loss/`) is INVALID - every expert counted exactly 32x per layer because the
   eval callback read the strided `ffn_moe_topk` view contiguously and reset its index per ubatch. Re-run with a fixed
   reader dispatched to GLM 6ed37888; audit by space-bunny before any number is quoted. RAZOR's keep-set is published
   per layer (`kept_expert_indices.json`, pinned d897617a).
   Run 2 (GLM 6ed37888, fixed reader): removed-mass share EN 45.9 / IT 51.4 / ES 56.3 / FR 66.9 / ZH 52.6 %. Hostile
   audit (space-bunny da2eab36, AUDIT-rerun.md): instrument CORRECT, design too weak - one unrelated Wikipedia article
   per language (FR window ends in a bibliography), IT p=0.43 and ZH p=0.12 vs a random-half null, RAZOR keeps 48.4%
   of IT mass vs 50.0 +/- 1.7 random, balanced keep-set score in-sample (+9.5 pp). So: routing frequency does NOT
   explain the IT loss on this evidence. Owner 2026-10-01: Kalsa languages are exactly IT/FR/ES/EN/ZH; a prune must
   remove something else. Next (GLM 2fde2e65, `scratchpad/agents/moe-expert-usage-v3/`): parallel corpus (topic
   controlled) for the 5 keep + DE/JA/KO/RU/AR sacrifice languages, plus code and math; held-out keep-set curve
   128..224, random null, CIs. Usage is a proxy; the prune verdict stays bpb/evals after pruning.
   v3 RESULT (audited, usable with caveats, `moe-expert-usage-v3/`): balanced 128 keep-set retains ~89 % of the five
   languages, CODE 70, MATH 75 (content-disjoint); RAZOR 49-58 % languages = a random half for IT/FR/ES; code experts
   are a distinct pool. Owner 2026-10-01: targets are 16 GB phones (resident or expert streaming) and 16 GB PCs; wants
   ~128/layer with code/math kept, aggressive quant OK. 128-average weighting + per-layer allocation analysis: GLM
   67143a4f (`moe-keepset-128/`). Design by Fable 5.1 xhigh (owner request, `kalsa-moe-design-fable/DESIGN.md`, 16 arXiv
   citations verified): REAP saliency (not routing mass) on a 7-domain calibration, 128 uniform, super-expert guard,
   experts Q4_0 + trunk Q5/Q6 (~10.7 GB PC) and IQ3_S (~8.7 GB phone); rival 160@IQ3_S and unpruned UD-IQ2_XXS at
   equal GB; stop rules (IT bpb > 0.75, HE+ < base-15, wrong-language > 5 %). 128-average analysis (GLM 67143a4f,
   `moe-keepset-128/`, content-disjoint, proxy): uniform 128 lang 86.7 / CODE 69.1 / MATH 74.7; 160 lang 92.4 /
   80.4 / 84.8; code/math weight w=2 at 128 -> 84.3 / 76.3 / 79.0 (ZH -4.2), w=4 -> 80.0 / 81.5 / 82.4 (ZH -11);
   per-layer allocation adds only 0.3-1.1 pp (mimo 65e08f45 audit: usable with caveats, numbers corrected in REPORT);
   128 never dominates 160.
   **Fable plan audit 2026-10-01** (`kalsa-moe-design-fable/AUDIT-PLAN-2026-10-01.md`, owner request after a r/LocalLLaMA
   thread: REAPs dumber than same-GB quants, loop in agentic use): approve with changes. 128 stays primary (the 8.7 GB phone
   arm forces it), 160@IQ3_S is the PC favourite; published 50 % prunes keep code and lose 10-22 pts of knowledge. Before
   any pod: B1-B4 gate fixes re-audited; templated `chat` calibration domain (thinking + tools, 5 languages); written
   Super-Expert rule; new stop rules S0 (harness sanity), S5 (BFCL v3 multi-turn loop rate), S6 (knowledge MC 5 langs);
   mass/MSAN keep-set arm; pruned MTP head export (keep MTP). Healing = conditional phase 2, cap $30 / stop $40.
   Public controls: crucible-labs REAP-48-v2, anik-jha coding-reap50 (cerebras has none for Qwen3.6). Realistic total
   $65-90 - NEEDS OWNER BUDGET OK. Owner rejected the hot/cold resident+streamed alternative (months of research).
   **PARKED by the owner 2026-10-01: good plan, costs more than expected; resume after the alpha if users are
   interested.** No Runpod spend. Resume checklist: `kalsa-moe-design-fable/PARKED.md`.
   Sizes (GGUF shapes): 128 = 18.6 B params,
   ~11.3 GB Q4_K_M / ~8.0 GB IQ3_S; 160 = 22.6 B, ~13.7 / ~9.7 GB. Cost: Mac phase $0, ONE A100 pod
   ~10-14 h $15-25 (cap $40), optional healing <= $20. NEEDS OWNER BUDGET OK.
   **2026-09-30 21:00 UTC retry (owner: all arms, no drop):** billed so far $0.57 (Runpod billing; the earlier
   "$1.5" was an estimate). L40 out of stock -> pod `nytgw2hjgsfz6e` A40 48 GB SECURE CA-MTL-1 at $0.49/h, 200 GB
   volume; hard stop 18.5 h, arm budget guard 17.5 h (max ~$9.6 total). Stages run one by one first; the full chain
   only after the LFM arm has written results. Rotate the HF probe token afterwards.
   **Owner constraint:** the Kalsa MoE must run on phones AND PCs with 8 GB and 16 GB of RAM. The pruning
   ratio is chosen against that: resident on 16 GB where it fits, and on 8 GB either a deep prune or our
   expert streaming (`--moe-stream`: Qwen3.6 KEXP already decodes on the 8 GB S23 at 5.70 tok/s).
   **Owner gate:** the pruned Kalsa must beat the shipped LFM2.5-2.6B by a wide margin ("stravincere"),
   otherwise it is not worth shipping. Benchmarks against LFM2.5-2.6B on the same devices: EN/IT quality,
   reasoning, tool calls, plus decode/prefill speed and RAM at the chosen quant.
   Pod: one-layer REAP observer smoke, then 50 % on RunPod; gate on
   held-out EN/IT + tool calls vs the unpruned base. Budget cap $40 floor / $120 soft / $150 stop.
2. **Kalsa SFT:** BF16 LoRA (Axolotl; Unsloth for Qwen3.5-MoE), router frozen, 2-5k curated EN/IT
   examples (identity, tone, refusals, tool calls) + 10-20 % general replay; one 4090/A100, a few hours.
3. **Export:** merge -> GGUF -> Q4_K_M and Q4_0 -> kalsa-server macOS/Windows checks (template, tool JSON).
4. **Decide:** ship on PC only if eval gates pass.
Apache/MIT allow the name "Kalsa" with licence and NOTICE kept and no implied endorsement.

The order is the owner's to set. The committed near-term work is:

1. Finish the device measurement of ciswire recall-after-eviction on Qwen (Xiaomi), using the
   `CW_CORPUS=prose` variant committed in `745bf82`. The dense filler trips the char-vs-token
   overflow and never reaches the slide point.
2. Governor plan: the numbers were re-verified against the artefacts on 2026-09-20 and the plan
   was rewritten in English; the rewritten plan is the reference for any governor code built from
   it.
3. Publish or drop the app's local `main` commit. `~/Projects/kalsa` `main` is `745bf82`, one
   commit ahead of `origin/main` (`5429799`) and unpushed; the commit is the `CW_CORPUS` knob and
   was rebased onto `origin/main` at 2026-09-20 08:23:03 EDT (`git reflog show main --date=iso`),
   so a push is a fast-forward. Whether to push it is the owner's.
4. Update the living docs and the record of each measurement in the same commit as the
   measurement.
5. GPU residual: run the two zero-build probes and read their numbers against the pre-registered
   falsifiers (`scratchpad/agents/quant-alignment/REPORT.md`, section 3) before building anything.
   The lead to test is weight-side fp16 in the K-quant kernels.
6. Rerun the Jelly stall cool (`ThrottlingStatus: NONE` at send time) and separate the seeded-EMA
   variable from warm KV - once the tracked bench build exists (see "Open items and debts").
7. The morning queue, in the owner's order (phone at **21 %**, unplugged - nothing starts until
   it charges): the **Meter** experiment first (rule and bar on disk, s23 sec. 30), then the
   **app-shaped verification** of the tail fix (s23 sec. 37: tail accuracy on the app's KV
   reference, decode zero at `-b 1`, tail speed in the app's configuration, b256 anchor for a
   derived real-prefill penalty), then the **K-split pair** on `kalsa-opencl-cok-korder` /
   `7965f43e0` (build 11203, binary sha256 `6ff4124b4c8a6449cca7e880556f94a3a2d90cb233151411d0439664e328c747`
   - prediction and stop rule already on disk, `cok-residual/REPORT.md` sec. 3). Sec. 37 pre-registers
   its own weakest assumption - the b8-equals-b256 reference identity is proven only at f16 with
   attention off, so at the app's configuration it is an assumption, and the first suspect if
   the control misbehaves. Nothing in the pin chain moves before the checklist in "The `_cok`
   tail fix" is walked.

## Engine release: current position and next steps

The engine binary ships inside the desktop app. The operational procedure and the manifest contract
are in `docs/ALIVE.md`, "Engine release pipeline". This section records where the path stands and
what is left.

### Position, 2026-09-25

- `kalsa-server-v1.1.2` published (tag `80d9f8b7`, commit `5102686dd` = fork `main` + the
  BACKEND_DL-safe bmoe hook): macos-arm64, and for the first time win-cpu-x64 and win-vulkan-x64
  (portable CPU variants). Digests in `docs/ALIVE.md`, "Published state, v1.1.2". kalsa-brain repins
  Mac + Windows and reruns the walks. Owner OK given directly 2026-09-25.
- Next: fix the `publish` input check (typed boolean), then consider extracting the duplicated
  workflow steps into a composite action. A Windows engine-side governor is deferred (owner, 25/09);
  a power-aware desktop tune is deferred too ("mettiamolo per dopo").

### Position, 2026-09-22

- Release line: ref `kalsa-release-v1-1-1`, tip `a7d2cec79` = `main` `833cde99b` + the two
  governor commits cherry-picked (patch-ids equal to the originals; seven standing targets
  `0 0 77 77 0 0 0`; independent audit 6/6 confirmed - `scratchpad/agents/release-prep/REPORT.md`,
  `scratchpad/agents/release-audit/REPORT.md`).
- CURRENT release `kalsa-server-v1.1.1`, annotated, tag object
  `0f1b3bec7342ddd5624dc474c760a0b38bc80b5b`, pointing at `a7d2cec79`, published by run
  `35762258094`; the manifest names the tag object and the commit (read back consumer-side in
  `kalsa-brain` `dev/results/concurrency-two-devices/results.json`). v1.1.0 and v1.0.0 stay
  published and unchanged. Published-state fields: `docs/ALIVE.md`, "Published state, v1.1.1".
- Phone line: ref `kalsa-phone-v1-1-1`, tip `1577495b9` = release tip + the four GPU picks
  (`cd213fff7`, `86f602f8a`, `5b6c5361c`, `d75422944`) + the q8-scale pick `e1cfb60f7` + the dp4a
  default flip; each pick patch-id-equal to its original, audited before push
  (`scratchpad/agents/phone-line-{prep,audit}/REPORT.md`,
  `phone-engine-v2{,-audit}/REPORT.md`). The GPU/numerics work is IN the phone build by the
  owner's decision of 2026-09-21 (option B); what ships is the fp32-activation-scale default
  (0.005412 / 93.982 % at stock speed), which superseded the f32 route (0.006954 / 92.913 % at
  -9.9 %) the same day it landed.
- Binding `kalsarn-governor-engine` = `5b966218` (vendored tree proven byte-identical to the
  engine archive plus the repo's 20 patches, by comparison - `scratchpad/agents/binding-prep/REPORT.md`
  round 2 sec. 2; the independent audit of round 1 is `binding-audit/REPORT.md`).
- App branch `engine-pin-kalsallama` = `e206a945`, pushed; its provenance gate is enforced and
  able to fail (exit 2, both shas printed). The CI run triggered by the push **failed before
  reaching the gate** (`android-actions/setup-android@v3` cannot fetch the removed `tools`
  package), so CI-enforced provenance does not exist yet.
- Distribution stays on Cloudflare R2 (`dl.kalsa.io`); the GitHub-release path is gone. The two
  measured consumer traps below still hold - and `exe_sha256` was confirmed version-invariant a
  third time (v1.1.1 carries the same launcher hash as v1.0.0/v1.1.0).

### Position, 2026-09-21 (history)

- Source of truth: `Aspis0/kalsallama` (private), integration branch `b11010-merge`, tip
  `2a290390d67311b580ef398fd545e6d060b39897` (`ci : drop the Metal packaging work from the
  kalsa-server release path`).
- CURRENT release `kalsa-server-v1.1.0`, annotated, tag object
  `c105c218236799f2f651517f5a0aeabcf4a8d8a1`, pointing at `2a290390d`. Published by run
  `35565687271` (`push on a tag`) and verified consumer-side from the CDN. It carries the
  `X-Kalsa-Slot` inlet. Immutable; never moved.
- PREVIOUS release `kalsa-server-v1.0.0` stays published and unchanged (tag object
  `d30c8d475d5eb47a544304ba592138d066bbc2e3`, commit `4ccef2f85dbc27e095e11ffcbad4628be9961790`,
  run `35549848243`).
- Distribution is on Cloudflare R2 (`dl.kalsa.io`); the GitHub-release path is gone. Published
  state, the manifest contract, the cache caveats and the two measured consumer traps
  (`exe_sha256` is the launcher and is version-invariant; the port header literal in the binary is
  lowercase) are in `docs/ALIVE.md`, "Engine release pipeline".
- The tagged commit's workflow is byte-identical (blob `26ce5d05a`) to the one that produced the
  published v1.0.0, which is why this tag's release path needed no new validation: it is the path
  already proven in production, plus the slot code in `tools/server/`.

### Position, 2026-09-20 (history)

- `origin/b11010-merge` tip was `916b8f0bcfcb829011f129b4dff8acfd01ab7814` and the only release was
  `kalsa-server-v1.0.0`, published by run `35549848243`.

### The Metal packaging half is OUT of v1.1.0, and why

The precompiled-metallib work (`c71977809` plus the Metal hunk of `ac9a09dc6`) is NOT part of the
v1.1.0 tag. It stays in the branch history and returns in its own tag.

What decided it was the first run of that work on a REAL macOS runner (run `35560962409`), not an
opinion: the METAL BUILD SUCCEEDED - the metallib was produced, the server loaded the model on the
MTL0 device and listened on its port - and the failure was in the new fail-closed health probe,
which could not classify the loader's real message and exited 1. Two defects must be fixed before
that half can be tagged:

1. The probe must classify the loader's ACTUAL message rather than an expected one, and on an
   unclassified message it must fail closed AND print the child's stderr tail, so the next person
   is not left with the same puzzle.
2. The probe model must be a committed fixture in the engine repo, not a Hugging Face fetch on the
   release path. Owner of the fixture: the engine repo (decided with the desktop on 2026-09-21),
   carried in the tar at a fixed relative path, named in the tar list the desktop receives; the
   desktop bundler FAILS ITS BUILD if the tag's tar does not contain it, and disables the runtime
   asset fetch for the probe model on the bundled path.

Splitting cost nothing in capability: v1.0.0 and v1.1.0 both ship Metal with the metallib embedded
in `libggml-metal`, and the archive keeps the v1.0.0 shape, so no consumer learns a new shape. The
reverted commit is `2a290390d`, a workflow-only revert (+4/-179, `tools/` untouched), audited
PUSH-SAFE 9/9 before it was pushed.

### Decisions

| decision | reason |
|---|---|
| Bundle the engine INSIDE the desktop app, exactly as the phone already bundles it in the APK | The app and the engine are coupled: `X-Kalsa-Cache-Salt` is a header the app must send and the engine must accept, so a runtime engine download creates a silent version-skew failure mode. Users download ONE app that contains the tested pair. For macOS, R2 is a BUILD-TIME source of the binary (fetch, verify size/sha256/exe_sha256, embed in the bundle), not a runtime download. |
| Keep the R2 runtime download for Windows/x64 and future backends | One executable cannot cover CUDA/Vulkan/CPU; the `assets.rs` rows still point at `dl.kalsa.io`. |
| Distribution on Cloudflare R2; the AI MODELS stay on Hugging Face | Models are gigabytes. |

The first-launch capability probe stays even for a bundled binary, because it decides whether the
engine can actually run on that machine.

### Cloudflare inventory

| item | identifier |
|---|---|
| Account id | `8a991014729a52a958cef2c5cbf0de50` |
| Zone `kalsa.io` | `3dbf75d1d2cf42e2e8c2dba0d950f3fa` |
| Bucket `kalsa-downloads` | public, served on custom domain `dl.kalsa.io`; the `r2.dev` URL is for testing only |
| R2 API token | scoped to that single bucket only (object read/head plus write, plus listing for the advisory check); NO repository permission; stored in the engine repo as `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` |
| Telemetry Worker `kalsa-telemetry` | Durable Object `TelemetryBuffer` + KV `DEDUPE_KV`, served on `telemetry.kalsa.io`; its `workers_dev` host is DISABLED because no released build ever used it |

Telemetry is ERROR/CRASH diagnostics only, explicitly OPT-IN with default OFF, no analytics, and
per its design document no chat or document content and no API keys in any form, not even hashed.
Nothing leaves the device unless the user opted in. The app's telemetry constant lives in
`src/telemetry/config.ts` in `Aspis0/kalsa`; the repo-side change is branch `telemetry-kalsa-io`,
commit `213850e1b617831586e9b9c18b0144ea74664efb` (pushed).

### Dead ends, so nobody repeats them

- A GitHub Release in the PRIVATE engine repo is unreachable for an unauthenticated client: the
  asset URL answers `404`. That is what forced distribution off GitHub.
- The account's Actions artifact storage quota (private repos, ~500 MB, enforced from usage GitHub
  RECALCULATES every 6-12 hours) blocked CI twice. About 4.8 GiB was freed by deleting 11 stale
  `pubvia-macos` artifacts (2.45 GiB) in the `PubVia` repo and 8 upstream CI caches in
  `kalsallama` (2.33 GiB). Enforcement stayed "full" until the recalculation: freeing space is not
  an immediate fix.
- The upstream reusable UI workflow hardcodes `runs-on: ubuntu-slim`, a HARD 15-minute job limit,
  and does not cache npm. One attempt spent 12m53s in the build step and was cancelled, which
  killed the whole pipeline because the macOS job depended on it. Building the UI inside the macOS
  job removed both the 15-minute ceiling and the artifact hand-off.
- `--clobber` on release assets was rejected outright: an immutable tag must never have its bytes
  replaced. The GitHub-release publishing path was removed entirely rather than patched.
- A `workflow_dispatch` input reaches shell and CLI arguments, so a tag beginning with a dash could
  act as an option (`--help`) instead of a value. Closed with a namespace allowlist
  `^kalsa-server-[A-Za-z0-9._-]+$` at read time AND immediately before use, plus an option
  terminator `--` before positional arguments.
- Three AWS/R2 traps, all encoded in the step as comments and guards: `aws s3 ls` exits NONZERO on
  an empty prefix (aws/aws-cli#5544), so with "any nonzero is fatal" it would block the first
  publish of every new version; a JMESPath `Contents[]` projection prints the literal string `None`
  for an empty result, which made an empty prefix look non-empty; and Cloudflare R2's `ListObjectsV2`
  omits `KeyCount`, unlike AWS. List-based existence checks are unusable here, so the decision comes
  from three `head-object` calls on the exact keys. The `None` trap is the bug that failed run
  `35544933700`, before any upload, leaving the bucket empty. Detail: `docs/ALIVE.md`, "Engine
  release pipeline".

### Open items and debts

Ordered next steps:

1. `kalsa-server-v1.1.0` is published and LIVE (run `35565687271`): slot inlet included, archive
   shape identical to v1.0.0, consumer verification in `docs/ALIVE.md`, "Published state". v1.0.0
   stays available. Remaining for this tag: nothing.
1a. `kalsa-server-v1.1.1` superseded it on 2026-09-22 (run `35762258094`, tag object `0f1b3bec...`,
   commit `a7d2cec79`, manifest read back consumer-side). Remaining for this tag: nothing.
1b. Metal packaging (the item above): fix the probe classifier and move the probe model into the
   repo as a fixture, then cut its own tag. Until then the Metal upgrade is not shippable - the
   embedded metallib of v1.0.0/v1.1.0 is what users run.
2. Bundle the engine into a signed, notarised macOS `.app`. This reintroduces the codesign
   obligation for the engine's dylibs (56 Mach-O in this build), same team and hardened runtime,
   with `@rpath` resolving inside the bundle. The runtime download was dodging that; if nothing is
   signed today it is a recorded debt.
3. Exercise the declared engine ship gates (none exercised yet): the full preset-backed
   `test_slot_save.py` (multimodal, legacy token list, erase, oversized media, no-mmproj);
   real-model recurrent/SWA and speculative save/restore; write fault-injection (short write,
   flush/close, file_size, rename, prior-file preservation); `fsync`/directory durability;
   cross-backend restore; the residual TOCTOU between the exclusive create and the core save
   reopening the temp; 32-bit portability of the `ckpt_read_buf` length conversion.
4. Phone chain as of 2026-09-22: engine `kalsa-phone-v1-1-1` = `1577495b9`, binding
   `kalsarn-governor-engine` = `5b966218`, app `engine-pin-kalsallama` = `e206a945` - all pushed;
   see "Position, 2026-09-22". The S23 repack timing run still waits for the device to be
   unplugged.
5. GPU residual and the acceptance gate: the new lead is weight-side fp16 in the K-quant kernels.
   The two zero-build probes (instrumented `-b 1` counters; q4_K dp4a forcing at b256) are
   running; the pre-registered falsifiers in `scratchpad/agents/quant-alignment/REPORT.md`
   section 3 are how their numbers get read. Blocked on: phone time, plus an owner GO for the
   builds (Q8_K-matched quantiser, CPU-matched b1 arm) if a probe points there.
   Overnight update: the `_cok` regime (headline above) is now the top of this line - the
   fix-verification pair RAN (s23 sec. 36.1) and closed 99.51 % of the gap as a registered
   **PARTIAL** (0.006890 / 93.138 %), and the independent audit refuses shipment pending the
   app-shaped verification (see "The `_cok` tail fix" above and Roadmap item 7); the Z2
   forcing-probe read was annulled by its own gate (matrix VOID, corrected control ordinary -
   closed with the registered verdict, not re-run); arm A (all 165 K-quant matmuls -> CPU) read
   **0.003546 / 96.513 %** - PASSES the gate, and is INCONCLUSIVE between the two named
   readings by its own pre-registered lines (neither falsifier hit), with ~65 % of the band
   surviving on the reference/shared side.
6. KV-term magnitude: OPEN - the two reference orientations disagree by 3.2x (+0.0015 vs
   +0.0048). The full-corpus matched reference (`cpu-f16faon`) is queued. Blocked on: the S23,
   unplugged, inside the battery rules (`scratchpad/agents/s23-kld-740-q4-0/REPORT.md` sec. 24,
   26 and its resume rule).
7. The stall: the thermal limb is untested and the EMA variable is not isolated. Next measurement
   is a cool-state repeat of Run A (`battery < 30 C`, `ThrottlingStatus: NONE` at send time) plus
   an arm separating seeded EMA from warm KV. Blocked on: the tracked bench build (item 8), the
   Jelly's battery/thermal state, and the owner's order.
8. Instrument debt: a **tracked bench build** (the debuggable flag lives in tracked config and
   survives a clean prebuild) plus a channel that does not need `run-as`, so energy can be
   measured on the shipping artefact itself. Standing rule in force: an artefact whose hash is
   cited must be archived before any cleanup touches build output. Owner of the build shape: the
   app workstream. The tracked mechanism itself was proven to exist at `e206a94`
   (`scratchpad/agents/bench-apk/REPORT.md`: the `KALSA_DEBUGGABLE` gate and
   `plugins/withDebuggableRelease.js` are in the commit tree and CI builds a debuggable release
   when the gate is 1; today's APK is non-debuggable because the gate was 0); what remains is
   the no-`run-as` pull path and the sampler-overhead A/B (item 14).
9. CI-enforced provenance: does not exist. The gate itself is repaired and can fail
   (`scratchpad/agents/landing-check-fix/REPORT.md`, 37 passed / 0 failed), but the workflow dies
   earlier at `android-actions/setup-android@v3`. Blocked on: fixing that action pin; the owner
   decides who.
10. Jest in the binding's environment: 12/12 suites fail, pre-existing on the pristine base
    (react-native 0.72 jest setup on node 26) - the binding's JS layer ships with no test net.
    Environment debt, not a defect of the line; nobody has booked the fix
    (`scratchpad/agents/binding-audit/REPORT.md` item 5).
11. Governor runtime and NPU lane: engagement is confirmed by the S23 app smoke, but its long-turn
    blind spot remains: Android reached SEVERE while the battery-only engine classifier reported
    FAST (`scratchpad/agents/s23-governor-lfm-long/REPORT.md`; see "Verified state, 2026-09-28").
    The NPU-prefill lane is on `origin/main` at app `335f9c8d`, **OFF by default**; device APK CI
    `36434636903` is building, and the step-5 device soak is pending. Do not enable by default
    before that soak.
12. Desk work (`kalsa-brain`): the four commits - panel row labelled with the release (`1f22bb7`),
    provenance fields inside the artefact (`fe14e78`), `Stopping` (`6efec90`) and the `Stopped`
    invariant with its proof (`f1df191`, `ae78761`, `f9d8861`) - were first recorded here as
    **local-only, pending an owner decision** (`origin/brain` at `cac9068`, handoff: "no push was
    authorized"), the fourth candidate of the day for work that exists in one place only. The
    doubt is kept visible; the correction is: **PUSHED 2026-09-22** - `cac9068..3660706
    brain -> brain`, exit 0, fast-forward re-verified an instant before pushing (0 behind / 14
    ahead), tree clean before and after, local `HEAD` = remote sha; `git ls-remote` reads
    `refs/heads/brain = 3660706793dad68f0ac85366ab09805cb6ddb733`. Closed as a debt; the
    correction stays written so the one-place window it closed is not lost.
13. Governor trend branch (app repo, worktree `kalsa-wt-gov-trend`, branch
    `kalsa-governor-trend`): commits `7921719` + `ed55f7d`
    (plus the no-code review rounds) are **local-only, push UNRUN** - blocked on the owner's
    approval and an audit, per the repo rule. What ships with them if approved: a producer and
    transport only, no threshold, no policy; and per the conclusion above it must NOT be wired
    as an escalation trigger regardless of the push.
14. The Meter sampler-overhead A/B: pre-registered on disk (`s23-kld-740-q4-0/REPORT.md`
    sec. 30) and **the result is pending** - it decides release-vs-dev under the owner's rule
    (item under "The Meter decision" above). Blocked on: the phone, in the same session as the
    energy work; the bar it must clear is 1 % of 1,045 mA, self-defeating at 5 %.

Cache caveats, standing (source of truth is the Cloudflare docs, not folklore):

- Cloudflare's cache stores HTTP 404 responses automatically for a domain with caching enabled, and
  an overwritten object keeps being served in its OLD form until TTL expiry or an explicit purge
  (`https://developers.cloudflare.com/r2/reference/consistency/`).
- Measured on `dl.kalsa.io`: a request to a not-yet-published path returns `cf-cache-status:
  DYNAMIC`, so the 404 is NOT cached and no path is poisoned today. The publish step checks the
  bucket through the S3 API, which bypasses the cache entirely; a client-side 404 must be
  re-checked with a cache-busting query before it is believed.

### Owner decision 2026-09-21: the app interface is redone FROM SCRATCH; only the palette survives

Owner, 2026-09-21, in correction of an earlier reading of the task that treated it as a restyle:
the whole app interface is redone from scratch, and the ONLY asset that carries over is the
PALETTE - the notebook colours already in the app's `src/theme/tokens.ts` (warm cream paper, deep
blue-grey chrome, blue-black ink, teal accent, with their dim and variant values).

What that disposes of: the current screens, the information architecture, the components, the
layout, the composer, the navigation, the presentation of a conversation, and where documents and
voice live. None of it is a constraint to preserve.

Consequences recorded with the decision:

- The structural refactor of the current monoliths (extracting presentation units with tests) is
  CANCELLED: extracting units from screens that are being replaced is work thrown away.
- `labbook-v2.css`, which `src/theme/tokens.ts:21-24` cites as the source the palette was
  converted from, DOES NOT EXIST: not on disk, not anywhere in the app repo's entire history
  (`git log --all`), not in the lab. It lived only in a chat. The values in `tokens.ts` are
  therefore the source of truth and the comment above them is wrong.
- The fixed contract for the new interface is what the app must DO (the flows in this PLAN and in
  `docs/ALIVE.md`) and the services it calls: the engine, the governor, the session/KV code, the
  pins and the Meter are NOT part of the redesign. The shell is replaced, not the machine.
- Two defects found while mapping the old interface become REQUIREMENTS of the new one rather
  than patches to the old: the composer showed "Fai una domanda..." while `editable` was false, so
  it invited typing and refused it silently (`AiChatPage.tsx:4337-4339`; same on the three composer
  chips at `:4196-4219`, including the document-library entry point); and the UI is barely
  automatable (`testID` appears 16 times in all of `src/`, and the accessibility dump of the Jelly
  shows an empty `resource-id` on every node), which is why the interface tests are fragile.
- The two real viewports the new design must serve, measured on the handsets: Jelly Star
  480x854 at 220 dpi = 349x621 dp on a 3-inch screen (the hard case, and the app area can shrink to
  480x447 px with the system bars), Galaxy S23 1080x2340 at 480 dpi = 360x780 dp. Design for the
  Jelly first: the logical width is nearly identical (349 against 360 dp), so a layout that breaks
  only on width looks fine on both and hides its bug, while the height and the physical legibility
  differ by far more.

## Open decisions

### Owner-suspended

These are owner-scope. No agent should act on them without a new owner decision:

- **Vision lazy loading.** The app loads the vision `mmproj` eagerly and mandatorily even for
  text chat, which can refuse a load on mid-RAM devices. The direction is lazy loading. Record:
  `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md`.
- **Ciswire window counted in characters, not tokens.** The window budget projects tokens as
  `chars/3`, so dense content overflows `n_ctx` without sliding. The direction is real token
  counting in the slide predicate. Same record as above.
- **Catalog gate threshold.** The prefill-cost admission threshold for the catalog is deferred
  (owner, 17/09). Record: memory `catalog-gate-threshold-deferred.md`; also
  `archived/PLAN-2026-09-full.md:682`, `:1660`, `:2634`.
- **S23 cable.** The owner was asked to unplug the S23 and keep it off the charger for the
  thermal runs (`archived/PLAN-2026-09-full.md:1659`). Owner-stated; no separate decision
  document exists on disk.

### Agent work

- The governor number re-verification cell, `scratchpad/agents/governor-audit-recheck/` (complete
  2026-09-20; nine entries: the seven audit findings plus the two formerly-unsourced values. All
  seven findings held, and the audit's own `cpu7 1824000` claim was refuted: the value has an
  archived narrative source).
- The Qwen ciswire recall measurement on the Xiaomi.
- Corrections to these two living docs, to the `analysis/` records and to the affected memories
  whenever a disk check contradicts them.

## Where the record lives

- `analysis/`: six documents by kind. Dated session records:
  `CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md` (S23/Jelly) and
  `XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` (Xiaomi/Qwen). Migration record:
  `FORK-VENDOR-MIGRATION.md`. Plan/audit document: `GOVERNOR-DEVICE-PLAN.md`. Standing references:
  `README-governor-kv-contract.md` (contract) and `README-qwen-think-replay.md` (procedure).
- `scratchpad/agents/<cell>/`: one folder per measurement cell, `PREREG.md` where relevant,
  driver scripts, `raw/`, `REPORT.md`.
- `archived/PLAN-2026-09-full.md`: the full Italian history to 2026-09-20.
- `docs/ALIVE.md`: the living measured state, with a pointer to the archived diary.
