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
(`93ade4886`, checkpoint, not yet verified). Heat on the same weights (S23, `onecopy-hmx-numerics/REPORT.md`
"Decode heat per token on one copy", n = 2 per arm, descriptive only): in the speed-matched A pair (12.27 vs
12.21 tok/s) one-copy DSP decode was ~35 % lower skin area and ~13 % lower battery area per token than one-copy
CPU; the A+B means (-45 % / -33 %) mix unequal speeds (CPU-B 9.60 tok/s). The area includes load, warmup and a
120 s idle tail (54-77 % of the skin area), so it is not active-decode-only heat; baselines rose through the
session. Two copies lowest per token (0.28 skin C·s/tok at 21.5 tok/s). Hostile review of these results:
`onecopy-hmx-numerics/REPORT.md` "Hostile review 2026-09-30".
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
  (steps 1-4 done: engine, binding, app, heat arms). Design, steps and degrade rules:
  `scratchpad/agents/governor-npu-prefill/DESIGN.md` (commit `2ac99cd5`).

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
