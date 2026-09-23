# Coordinator state - end of 2026-09-21

Written for Marco's morning read. One screen. Detail lives in the per-cell reports under
`scratchpad/agents/<cell>/REPORT.md`.

## Status now

**The engine release is built and verified, and is waiting only on the pre-push audit.**

- Release line: ref **`kalsa-release-v1-1-1`**, tip **`a7d2cec79`** = `833cde99b` (`main`) + the two
gubernor commits cherry-picked, zero conflicts. Verified **by me**: exactly **three files**
(`src/llama-ext.h`, `src/llama-governor-policy.cpp`, `tests/test-governor-v02-router.cpp`), 23 insertions
and 4 deletions, **no GPU file**; patch-ids recomputed and **equal** to the originals (`da3ab315f`,
`4b9eed7f`); the Android binary embeds `a7d2cec79` and **zero** occurrences of `563896ffa`; seven
standing targets `0 0 77 77 0 0 0` with the fixture; sole-decider test PASS. **Push is a plain
fast-forward** (remote `main` = `2361be359` is an ancestor), so nothing is forced.
- **Blocked only on the audit** (cell `10878e91`, reviewer): a project rule says audit before every
push, and the owner's "push whenever you want" is read as a timing authorisation, not as a waiver.
Then: push `main` + the release branch + the **annotated** tag `kalsa-server-v1.1.1` on the release
commit; the tag triggers the server artifact build, which the desktop workstream consumes.
- **RESOLVED, and the owner chose B: the GPU fix goes into the PHONE.** The question was three-way, not yes/no, which is why the desk asked me to confirm the mapping instead of assuming it: **A** = V73 on without the fix (64 % same-top, fast), **B** = with the fix (93 %, -10 % prefill), **C** = V73 off (100 % by definition, 8x slower). He said "ovviamente B", and C was never really on the table: it costs eight times the speed. **The server release is unaffected and the tag does not move.** The phone will run V73 **with** the fix, to be described in the landing note as a **declared improvement, not a claim of conformance**: 0.006954 / 92.913 % instead of 0.394993 / 63.892 % - 57x better, still below the bar - at about -9.9 % prefill. The bullet below is what the question was, kept as the record: whether the GPU line goes into the **phone** (not the
release - the release already excludes it). Today the phone ships **V73 on with no GPU fix**, which is
the 0.394993 configuration; the fix gives 0.006954. Both the desk orchestrator and I recommend
including it, on the asymmetry that a known silent defect is worse than a declared number below the
bar. Neither of us will set that bar for him.
- **Two process lessons from today, both mine.** (1) Six measurement arms sat frozen for hours behind a
charging phone: the fix is not to bend the charging rule, it is to **stop queuing long arms behind a
charger** - and to tell the owner the queue is frozen **when it freezes**, not when he asks where his
tests are. (2) The desk turned my own preference (the artifact *name* over a hand-typed tag) into a real
protection worth keeping: their panel number cites the artifact name and its sha256, so a later commit
on the phone line **cannot rewrite what was measured**.
- **A third lesson, and this one is the desk's, admitted by them**: they diagnosed a cause and then
repeated it - their own unbounded `grep` timed out inside `node_modules`, they said so in one turn,
and launched the same unbounded search in the next one, becoming part of the load I had just
attributed to myself. Their formulation is better than a rule: **diagnosing a cause and then repeating
the cause is not distraction, it is not treating the diagnosis as an instruction.** Same family as
"the most expensive kind of green", one step earlier: there, a check passes for the wrong reason;
here, a cause is known and not acted on.
- **And the pattern that dominated the whole day, now named by both sides**: the most repeated defect
of 2026-09-22 was **not a wrong number**. It was an **artefact that existed in one place only**, or one
that **declared a provenance nobody checked**. Four instances of the same shape: the fix in T1 living
only on this machine, the binding's vendored pin that a regeneration could silently replace, the
provenance gate that failed **open**, and the desktop line's fourteen commits sitting un-pushed. Every
remedy today was the same remedy: push it, archive it, or make a check that can **fail** verify it.
- **Phone**: charging, nothing measures while plugged. Queue on unplug: (1) the q8-scale A/B
(`44dda288` binary: `KALSA_Q6K_DENSE=dp4a KALSA_Q8A_SCALE=fp16` = old behaviour, default `fp32` = the
fix), (2) prompt batteries - realistic prompts, memory facts with ground truth supplied, safety
parity, (3) KV redone cleanly at the app's `q8_0`/`q4_0` config, (4) the `-b 1` floor probe.
- **Before any APK**: the app's `main` must be made consistent (its install is older than its own
pin) - the right order is bump, install, gate, build, never gate-then-bump.

### Results of 2026-09-22 (evening)

- **The cause of the 57x error was the fp16 activation scale.** Control arm (`dp4a` + `fp16` scale) reproduces stock **bitwise**; treatment (`dp4a` + **fp32** scale) collapses **0.394993 -> 0.005412** with same-top **93.982 %** at **76.44 t/s** - i.e. *better than the f32 route on both gate limbs and faster than stock*, so the -9.9 % prefill cost is recovered. That configuration is now the engine **default** (engine `1577495b9`, audited by a compiled truth-table harness).
- **The `-b 1` floor probe CLOSED two axes and opened one.** At batch 1, stock and full precision are **bitwise identical**: both **0.006012 / 93.138 %**, FAIL on both limbs. So the acceptance gate (<= 0.005) is **not reachable by batched-GEMM precision work alone** - the residual is **common to both batch shapes**, not a batching artefact. Sum-order/tile work is therefore deprioritised, and what remains is the **representation mismatch with the CPU reference** (the class the fp16 scale belonged to).
- **A product-level finding that reframes the chase**: at the app's real KV configuration (`q8_0`/`q4_0`) the best arm degrades to **0.012114 / 90.664 %** (stock 0.408417 / 64.286) - the shipped KV choice costs a factor 2.2 more than the engine fix recovers. The KV quantisation may dominate the remaining residual; isolation measurement ordered.
- **The owner's question is answered: the differences are adverbs, not facts.** All six realistic prompts diverge between arms (first differing character at 19-386) but there are **0 material divergences** (P1: all arms answer "Canberra"; P4: the same tool call). Memory: 10/10 differ, **0 rows where one arm is right and the other wrong**, reverse case 0. Caveat recorded: the template's thinking consumes the 64-token budget, so 0/10 final answers were emitted.
- **Safety parity holds on the surface**: **0 of 24 arms complied** anywhere, across six categories at t0 and t0.7 - but **four pre-answer cells (S1_t07, S4_t0, S6_t0, S6_t07) are flagged RELEASE BLOCKER CANDIDATE** with a truncation caveat.
- **The stall REPRODUCES on the configuration we ship** (Jelly, APK `d3c66bdb`, engine `1577495b9`): `KALSA_STALL {"tokens":0,"reason":"prefill"}` at **+1175 s** (original: +739), form identical, and - for the first time - a **full raw logcat** shows **zero native lines across 19.6 minutes**: it is a silent stall, not a crash. Run B completed, but **two variables moved** (seeded EMA *and* warm KV, `nPast: 11875`), so "EMA fixed it" is not supported. Both runs ran at `ThrottlingStatus: SEVERE` (69 times, 47 C skin) while the originals did not - the thermal limb is therefore **untested**, and the cool-state repeat could not even be set up because the APK cannot be instrumented.
- **Why the energy measurement died, and it is my error**: the Meter arms itself by writing a flag into the app's private storage, which needs `run-as`, which needs a **debuggable** app. The debuggable flag lived as a **one-line hand edit** (`debuggable true`) inside `android/app/build.gradle` - a file that is **gitignored and regenerated by `expo prebuild`** - so the clean prebuild I asked for deleted it. Same disease as the hand-pinned vendor tree. Fix in flight: a **tracked bench build** that survives a clean prebuild, plus a channel that does not need `run-as` so we can measure the shipping artefact itself.
- **Chain state**: engine `kalsa-phone-v1-1-1` = `1577495b9`, binding `kalsarn-governor-engine` = `5b966218`, app `engine-pin-kalsallama` = `e206a945` - all pushed, all audited; release tag `kalsa-server-v1.1.1` still on `a7d2cec79`. The CI run triggered by the app push **failed before reaching the gate** (`android-actions/setup-android@v3` cannot fetch the removed `tools` package), so CI-enforced provenance does not exist yet - the *place* where it should stand exists, not the enforcement.

| cell | task | answers |
|---|---|---|
| `10878e91` | reviewer: the v1.1.1 release line, before the push | may it be pushed and tagged as it stands |
| `62feed4c` | phone: ablations done, q8-scale A/B + prompt batteries + KV + `-b 1` queued | which class carries the residual, what the residual costs in text, the product-shape number, whether the gate is reachable at all |

## Decisions waiting for Marco

1. **V73 / GPU prefill on the Adreno 740.** The night's measurement is in, and it is a large
   improvement that still does not pass. Stock: median KLD **0.394993** / same-top **63.892 %**.
   Full precision (the two q6_K changes together): **0.006954 / 92.913 %** - **56.8x better**,
   and still **FAILING** the gate (`<= 0.005` and `>= 95 %`) on both limbs: 1.39x above on KLD,
   2.1 pp below on same-top. The leg that does the work is the q6_K routing (56-57x on its own);
   the f32 activation transpose moves the Q4_K leg in the WRONG direction (0.395990) and must be
   excluded from any landing. Decision needed: **land the partial improvement now, or keep V73 off
   until the residual is chased down** - and if we keep hunting, say whether the hunt may continue.
   **What the accuracy costs, now measured**: prefill 75.94 t/s -> **68.42 t/s = -9.9 %**. **What the
   residual is**: not one culprit - ablations that move any single tensor class to the CPU recover at
   most ~15 % (attention projections -14.8 %, `ffn_down` -15.7 %; the F32 class does nothing at all).
   And **the numbers are measured in a configuration the app does not ship**: f16/f16 KV here,
   `q8_0`/`q4_0` in the app - that measurement is running.
   **A caveat I raised and then killed myself, recorded because I said the alarming version out
   loud**: the worry was that all four cells were measured at batch 256 while the real app prefill
   streams at `ne1 <= 8`, which would make the 56.8x a bench-only artefact. **Checked directly and
   it does not hold**: the app's physical batch is `n_ubatch`, and its tuned default is **256**
   (`src/engine/deviceTuning.ts:244` `DEFAULT_UBATCH = 256`, source `measured:ubatch-256`, changed
   only by an explicit user override), while `n_batch` is 512 (`src/engine/LlamaService.ts:2391,
   2394`); the binding passes `n_ubatch` through (`cpp/jsi/JSIParams.cpp:315`) and the engine clamps
   and splits the graph per ubatch (`vendor/llama.cpp/src/llama-context.cpp:248, 1344`). So the
   product's prefill really does reach the GPU at `ne1` up to 256, the dp4a branch does fire in
   production, and **the measured shape is the shipped shape**. The earlier 'real app prefill is
   `ne1 <= 8`' line in a recon note describes the decode path, not prefill. The Explorer is
   double-checking whether any runtime path can lower the ubatch; if it finds one, this flips back.
2. **Push authorisation - GRANTED, and the verification is green.** The owner authorised the push;
   I read that as a **timing** authorisation and kept the project's rule that an independent audit
   precedes every push, which is the rule that caught the provenance gate failing open. Status: the
   release line is built, patch-id-verified, seven targets green, Android-built, fast-forward -
   **the push and the annotated `kalsa-server-v1.1.1` tag happen when the audit confirms.**
   What that audit found, and what has since been **repaired on the app side** (verified by me: suite
   **37 passed / 0 failed**): the checker's link 1 was **print-only and fail-open** - the app recorded
   no engine sha, so an engine mismatch could not even be constructed, and with provenance absent on
   both sides it exited **0 while printing an empty sha**; `package.json`/lockfile drift was
   **invisible** to it; and the workflow that builds the APK **never ran it**. Now the gate reads
   `package.json`, compares it with the lockfile and with a restored `native/kalsallama.pin`, dies on
   missing/empty/mismatch, refuses a committed `LOCAL OVERRIDE` note, and runs in
   `build-kalsa-apk.yml` right after `npm ci`. Two silent passes now fail, and no passing case broke.
3. **`kalsa-device-build` (2.9 GB).** Provenance now settled (the snapshot exists in refs, 0
   differing paths) but NOT deleted: two scripts edited TODAY and one hand-instrumented build
   ("phase stamps") depend on it. Make that build reproducible first, then delete.
4. **Reclaim proposals needing a word**: `~/.cache/huggingface` 21 GB - of which sam3 6.4 GB,
   Qwen3-Embedding, PDF-Extract-Kit, ChartQA, pmc-18m and docling (~10.9 GB together) have NO
   reference in any kalsa script, while Qwen3.5-4B (8.7 GB), gemma-4-26B and Qwen3.6-35B ARE
   referenced and must stay; `~/.android/avd` - `jelly480` 5.7 GB is referenced by `kalsa-ux`
   docs and the `BENCH_TARGET=emulator` CI path, `s23` 4.8 GB has no reference found; and newly
   found: **`~/Library/Application Support/kalsa-brain/runtime/models` = 31 GB** (the desk line's
   runtime models, another session's business), gradle `caches/9.3.1` 4.0 GB, `kalsallama` cmake
   builds 5.2 GB, `vendor/.../tauri target` 3.9 GB. None of these is urgent at 361 GB free.
5. **PubSpark data, not builds**: `pubspark/training` 18 GB and `pubspark/eval` 19 GB hold
   datasets and annotation output (574 tracked files, 7665 ignored entries). Untouched.
6. **Governor policy duplication**: consolidation forces a choice between the app's condition
   (latch at the plug-in edge when the baseline is null and T > 0) and the engine's (re-latch on
   a 1.5 C deviation). They are not the same rule; the Explorer's report lays out what each
   choice costs.

## Forgot to be closed

- **Jelly Star rerun** (Run A / Run B, the stall protocol on the fixed build) is still waiting for
  the phone to be at >= 70% battery. It was at 21% and discharging.

## Overnight log

- **THE 2x2 FACTORIAL ON THE 740 (the night's core result).** One binary (`a8eb58010`) with two
  env selectors, all four cells n = 1778, same model/corpus/seed/archived CPU reference, unplugged
  phone, from candidate 2/3 reports and `s23-kld-740-q4-0/REPORT.md` sections 8-12:

  | q4_K operand \ q6_K path | dp4a (stock) | f32 GEMM (fixed) |
  |---|---|---|
  | half (stock) | 0.394993 / 63.892 % FAIL | 0.006977 / 93.026 % FAIL |
  | float (f32 transpose) | 0.395990 / 63.780 % FAIL | **0.006954 / 92.913 % FAIL** |

  Plus the Q4_0 control earlier the same night: **0.001373 / 97.413 % - both limbs PASS.** So the
  chip, the driver and the measurement chain are sound; what fails is specific to Q4_K_M's mix.
- **What this settles.** The dominant error source on this device is the **q6_K dense-path routing**:
  the 19 Q6_K tensors go to the int8 dp4a kernel, and routing them to the f32 GEMM path collapses
  the error 56-57x and lifts same-top by ~29 pp. The f32 activation transpose contributes nothing
  (deltas inside noise, wrong sign) and there is **no interaction** between the two legs. Two cells
  were **replicated bitwise by independently built binaries** - the measurement chain is trustworthy.
- **The mechanism, now documented rather than guessed**: on A7X at batch 256 the `:23090` branch
  (`ne1 > 8 && has_integer_dot && !X1E`) runs `kernel_quant_a_q8_1` +
  `kernel_gemm_noshuffle_q6_k_q8_1_dp4a` and RETURNS (`:23126`), so the transpose block (`:23168`)
  and `kernel_gemm_noshuffle_q6_K_f32` (`:23191`) never execute for those tensors. That is why the
  first fix measured bitwise identical to stock, and it is the reason the earlier recon's claim
  'the q6_K dp4a has no dispatch site' was wrong: the symbol's `q6_k` is lowercase, so a
  case-sensitive grep misses it. The Q4_K dp4a really is X2E-only, which is why the 148 Q4_K
  tensors DO take the transpose + noshuffle GEMM.
- **Open doubt I am not letting slide**: the sibling cell reasoned that the dp4a kernel's loss is
  'inherent to int8 activation quantization, not a bug'. But the CPU reference for the same tensors
  also quantizes activations to int8 (`Q8_K`), so both sides being int8 makes a 57x divergence look
  like a defect rather than a floor. The Explorer is checking it against the kernel source.
- **The residual is SPREAD, not concentrated - and the F32 hypothesis I pushed myself is REFUTED.**
  Per-class ablations on the phone (weights moved to CPU with `-ot`, after proving the switch inert:
  a no-match regex reproduced the baseline **bitwise**): the F32 class, which is the 22
  `shortconv.conv.weight` tensors (the 77 F32 norms never reach a matmul), gives **0.006991, +0.5 %** -
  nothing. Attention projections give **0.005925 (-14.8 %)** and `ffn_down` gives
  **0.005863 (-15.7 %)**; no single class collapses it and no row approaches 0.002. Caveat that
  matters: `-ot` moves WEIGHTS only, so the softmax and the attention arithmetic stayed on the GPU
  even in the attention row.
- **The price of the accuracy, finally a number: prefill 75.94 +- 0.12 t/s stock -> 68.42 +- 0.19 t/s
  full precision = -9.9 %** (routing leg -7.8 %, operand leg -4.6 %, sub-additive). GPU/CPU ratio
  7.95x. This is the number the landing decision needs and it did not exist before tonight.
- **The routing is now an OBSERVED fact, not an inference.** An instrumented binary (atomic counters
  incremented at kernel-enqueue time, selector line moved above the stderr filter, and proven
  observationally neutral because its KLD is bitwise identical to the uninstrumented one) reports
  `dp4a=0, f32=269` in the fixed configuration, and `dp4a=252, f32=17` with the stock selector. So 17
  of 269 executions already took the f32 path at stock: the 'every q6_K tensor passes the dp4a gate'
  model was too simple. The conclusion is unaffected - all 269 take the fixed path once we route.
- **The dp4a divergence is a DEFECT, not a precision limit - and the first suspect is already dead.**
  Triangle bound: the CPU reference itself quantizes activations to int8 (Q8_K with a float scale,
  `ggml-cpu.c:509/525`, `ggml-quants.c:2768`), so two nearby int8 quantizers cannot be 57x apart.
  The first named suspect - the argument order of the Adreno builtin - was **refuted by the
  compiler's own header**: NDK clang `opencl-c.h:17278` declares
  `int dot_acc_sat_4x8packed_ss_int(uint, uint, int)` with the accumulator LAST, the kernel's call
  matches, and it compiles rc=0 (`-fsyntax-only`, CL3.0). The recon that named it killed it itself,
  which is the standard I want. Remaining suspects: (1) the **E031.41 driver miscompiles the
  builtin** - three sibling miscompiles are already documented in this codebase, so it is not
  exotic; (2) `quant_a_q8_1.cl:34` stores the block scale as **fp16** where the CPU uses a float,
  with a flush-to-zero cliff below amax ~ 0.0078 that would silently zero quiet blocks.
- **Why that is worth a build**: the accurate configuration pays **-7.8 %** for routing around that
  kernel. If the builtin is miscompiled, fixing it in place returns that speed - and an int8 path
  **matched to the int8 quantization the CPU already uses** could be *more accurate* than the f32
  route, i.e. the fast path and the accurate path could be the same path. A native OpenCL harness
  (three-way comparison: builtin vs explicit int madd vs host reference, tolerance 0 because the
  arithmetic is integer, adversarial inputs) is being built; it runs in about a minute on the phone.
- **HARNESS RESULT: the driver is CLEAN, and a different defect is confirmed.** 512 adversarial rows
  through the production call sequence, tolerance 0: builtin == manual reconstruction == host
  reference, **0 mismatches**, exit 0. So the E031.41 miscompile hypothesis - which would have let us
  fix the fast kernel and win back 7.8 % - is **refuted by measurement**. But the same run probed the
  activation quantizer and found a real defect: the q8_1 block scale is stored as **fp16** and
  **subnormal scales flush to zero** (`got_da=0x0000`, consistent with `CL_DEVICE_HALF_FP_CONFIG=0x16`,
  DENORM=0) on 2 of 4 probe blocks, with 1-ULP mismatches on the other two. The CPU's reference stores
  that scale in float. A defect, not a precision limit - but its *impact in KLD* is not yet quantified,
  which is the difference between 'found it' and 'explained it'.
- **Next build in flight**: carry that scale in float behind a selector so one binary can A/B it. If
  the flush is what breaks the int8 path, the **fast** kernel returns to the **accurate** kernel's
  quality and the -9.9 % comes back; if it is not, a clean negative eliminates the last named suspect.
  The coder must first inventory every writer and reader of the q8_1 layout, and must state what it
  did NOT fix (the 32-element block size against the CPU's 256 is a separate divergence).
  **Built: `87f31d81f`** on the integration line, binary sha `44dda288...`, one binary with the two
  arms (`KALSA_Q6K_DENSE=dp4a KALSA_Q8A_SCALE=fp16` = the old behaviour, default `fp32` = the fix).
  The inventory is the part worth keeping: there is **no block struct** - the layout is three flat
  buffers - a **global** promotion would have meant 14 `.cl` files, 14 host allocation sites and a
  clash with **two precompiled binaries that cannot be rebuilt**, so the change was scoped to the
  dense q6_K pair. The coder listed what it did **not** fix: the 32-element blocks against Q8_K's
  256, the other six dense and seven MoE arms, and those two precompiled binaries. The A/B is queued
  first after the phone unplugs.
- **A gap between what we measured and what SHIPS**: every KLD number above is measured with an
  **f16/f16 KV cache** (llama.cpp's default), while the app's catalog is authoritative at
  **`cache_type_k = q8_0`, `cache_type_v = q4_0`** (`deviceTuning.ts:744-745`,
  `LlamaService.ts:2401-2402`). The quantized-KV path runs on every token of every layer and its
  GPU-vs-CPU divergence has never been measured. A measurement at the app's configuration - CPU
  reference regenerated with the same KV flags, since the reference changes with them - is running.
- **A caveat I raised and then killed myself** (the batch-shape scare): the fear was that the bench
  shape (256) is not the product shape. It is: the app's physical batch is `n_ubatch`, tuned default
  **256**, so prefill reaches the GPU at `ne1` up to 256. Details and file:line in decision 1. The
  Explorer is checking for any runtime path that could lower it. **The corrected lesson is worth
  keeping: the earlier recon line 'real app prefill is `ne1 <= 8`' was about decode, and I had
  repeated it without checking.**
- **Shipping line prepared, Android-built and re-verified** (not pushed): ref `kalsa-engine-integration`,
  tip **`563896ffa`**, linear on top of `main`: `1068eb03d` (gpu base) -> `533d40008` (upload
  degrade) -> `603f57800` (q6_K f32 product) -> `7ac6a2387` + `e25701d02` (governor doc/pin +
  guard) -> `563896ffa` (q6_K routing, the change that matters). **Five files** in the whole range,
  **`transpose.cl` untouched**: the excluded candidate is excluded in fact, not just in prose. All
  patch-ids equal to the originals; the four protected refs untouched; the tip's message arithmetic
  corrected to **18** Q6_K tensors as **14 ffn_down + 4 attn_v**, with the 19th named `token_embd`
  (the tied output weight, CPU); the tree hash was proven identical across both reword rounds
  (`9865e0cb...` before and after each), and `git diff` between the two tip shas is empty. Message
  rewords move the sha while the content stands still - the *ref* is what matters, not the sha. **Seven standing targets
  `0 0 77 77 0 0 0`** with the `-m stories15M` fixture; **Android arm64 rc=0 (408/408)**; the
  binary's embedded stamp reads `1140cbe3f` and contains **zero** occurrences of the superseded sha
  (checked with `strings`, by me). Report `engine-line-refresh/REPORT.md` section 6 carries 6
  copy-pasteable landing blocks. Honest caveat: verified by patch-id and tree equality, **not**
  independently audited - audit it at landing time.
- **The next fix candidate is being built in parallel** (`opencl-f32-transpose`): the shared f16
  activation transpose narrows f32 activations into `CL_HALF_FLOAT` images for ALL ten quant paths,
  so it is the suspect that survives if the q6_K fix alone is not enough - and it would also explain
  a residual on the Q4_K path, which patching q6_K cannot touch.
- **Governor policy triplication closed, awaiting audit.** The same latch/validity rule was written
  three times (app Kotlin, app TypeScript `governorInputs.ts:138`, binding
  `rn-governor-params.cpp:103`) plus a stale untracked copy under `android/`. Now: the app measures
  (latch deleted, live temperature emitted), the binding transports (third copy deleted, structural
  sanity kept), the engine decides (its logic byte-identical). Suites green on both sides - app 94
  suites / 1214 tests, `tsc` 0; engine seven targets `0 0 77 77 0 0 0` before and after. **The one
  behaviour change the owner must be told**: the old app latch could MASK the engine's drift trip -
  with 35.0 latched and 36.6 live the engine's 1.6 C trip was invisible, and now it fires
  (Invalid -> prefill refused, CPU route). Two smaller deltas: `t_idle_c = 0.0` with valid=true is
  now accepted and latched by the engine instead of refused at parse, and a 41.0 reading is refused
  after model load rather than at parse. Audit in flight to enumerate whether any FOURTH delta exists.

- **Q4_0 CONTROL ON THE 740: BOTH LIMBS OF THE GATE PASS** - median KLD `0.001373` (gate <= 0.005)
  and same-top `97.413 +/- 0.377 %` (gate >= 95 %), on the same phone, driver `E031.41.03.62`, same
  binary, same corpus (md5 `1d037601`), same flags, n = 1778, against the failing Q4_K_M run on the
  same device (`0.394993` / `63.892 %`). Median KLD is 1280x smaller. Against the 750 acceptance the
  740 is BETTER on both limbs (0.004736 / 94.826 %). **The rival hypothesis - 'the 740 or its driver
  is the problem' - is refuted for the q4_0 path, and the failure localizes to what Q4_K_M adds:
  the kernels that never got the f32-product fix, chiefly the 19x Q6_K.**
- **One of my own hypotheses was refuted and it is recorded as such**: I expected the compiled-kernel
  listing to show that Q4_0 builds only the fixed kernel. It shows no such thing - compilation is
  **eager and model-independent**, so the Q4_0 run also compiled the unfixed q6_K program. The
  execution attribution rests on the deterministic dispatch plus the KLD outcome, not on that listing.
- **The audit gap is closed**: the CPU reference logits file is archived (`cpu-reference.kld`,
  455 MB, sha256 `5500805c`, device sha = lab sha), so the statistics can now be recomputed by anyone.
- **Disk: 862 Gi used / 41 Gi free (96%) -> 542 Gi used / 361 Gi free (60%).** Roughly 306 GB
  reclaimed by deleting the six PubSpark `src-tauri/target` directories (Rust build output,
  proven git-ignored with 0 tracked files in all six, and no build running). `pubspark` alone went
  268 G -> 57 G. Not touched and reported instead: `training` 18 G (training assets: data assembly
  scripts, LoRA/router configs, Modelfiles, logs), `eval` 19 G (annotation harness + eval corpora),
  `resources` of the four worktrees (fetched, weights deliberately not committed, regenerable via a
  documented sync), `node_modules` (~150 M x4), and the out-of-scope `target/` directories in
  `road-probe`, `kalsa-brain`, `vendor/tauri-plugin-pilot` and `eval/ratex_bench`.
- **Cache cleanup: ~42.8 GB freed** (python/CoreML bundle cache 11 G, figlyph CoreML/WebKit caches
  9.4 G, pip 2.1 G, uv 3.6 G, Homebrew 2.2 G, npm cache 7.1 G, gradle caches 1.4 G, the app's
  `android/app/build` + `.gradle` 5.9 G). Cost to note: the next Gradle build re-downloads its
  dependencies. No `node_modules` was deleted anywhere - `kalsa` is alive with running sessions.
- **~5.6 GB reclaimed** in `kalsa-wt-build-fixes` (build outputs only), with the sha256 of
  `vendor/VERSIONS` proven identical before and after - the hand-pin evidence is intact.
- **`kalsallama-pin` mystery closed**: the snapshot's root tree `2f19ca7fe` exists in refs (tags
  `archive/kalsa/gemm-f32-mul-q4k`, `main-b10081-67c73d2`, commit `b51d1e05`), `diff -rq` shows 0
  differing paths. `KALSA_FORK.md` and `src/llama-governor-metrics.{cpp,h}` are all reachable from
  refs. Nothing was lost; the first-round alarm was an artefact of diffing one old commit.
- **Audit of the q6_K fix: CONFIRMED** (`opencl-q6k-f32-product/AUDIT.md`). No half product
  survives on the accumulation path; hunk-for-hunk parity with `67c73d26c`. Two flags: the
  (half accumulator + f32 product) cell was never measured, so the accumulator change is a
  justified extrapolation, not a proven necessity; and the commit message says "19 tensors
  (14 ffn_down + 5 attn_v)" but that sums to 18 - the 19th, the tied lm_head, runs on CPU on A7X.
  **Fix the arithmetic in the commit message when this is turned into the real pinned commit.**

## Landing checklist (awaiting Marco's approval - nothing here has been pushed)

The engine now holds **seven** local refs. They all sit on `1068eb03d` or on `main`, so they need
combining, not merging. **Four of them land**: the base, the upload degrade, the q6_K pair (product
+ routing - they are worthless apart), and the governor. One is **excluded on measurement** (the f32
transpose), one is an **insurance/attribution build** (full precision), one is the binding.

| ref | commit | change |
|---|---|---|
| `kalsa-gpu-opencl-v73` | `1068eb03d` | base: no exit(1) on the OpenCL compile path, verdict keyed on the kernel set |
| `kalsa-opencl-upload-degrade` | `909243206` | upload failures degrade instead of `abort()`; audited |
| `kalsa-opencl-q6k-f32-product` | `914b34a7e` | f32 product in the q6_K batch GEMM; audited; measured - **no effect on its own** on the 740 |
| `kalsa-opencl-q6k-accurate-path` | `14a3afebf` | route the dense q6_K batch GEMM away from int8 dp4a; **must travel WITH the line above** - the two together are the 56.8x |
| `kalsa-opencl-f32-transpose` | `40a9358a1` | f32 activation transpose for q4_K/q6_K; **measured, moves the metric the wrong way - EXCLUDE from the landing** |
| `kalsa-opencl-full-precision` | `a8eb58010` | both changes in one binary with both selectors; insurance/attribution build, not a landing candidate |
| `kalsallama-governor-sole-decider` | `35eeeae3` | governor: doc, pin test, and the `t_idle_c > 0.0f` guard; audited twice |

Order that cannot be short-circuited:

1. the landing set is already combined into one integration line (ref `kalsa-engine-integration`, tip
   `563896ffa`) with the seven standing targets green (`0 0 77 77 0 0 0`; five of the seven need the
   `-m stories15M` fixture and exit 1 without it) and an Android build of the exact tip. Re-verify at
   landing time, and audit it - it has not been through an independent reviewer;
2. push the engine line to `Aspis0/kalsallama` (**needs Marco**);
3. bump `vendor/VERSIONS` in `llama.rn-kalsa` to the new engine commit (its `LLAMA_CPP_COMMIT` is
   still `4ccef2f8`, i.e. the binding ships a pre-consolidation engine today), land `b97c581d` or
   later, push (**needs Marco**);
4. bump the `llama.rn` pin in the app's `package.json:49` and the lockfile to the binding commit,
   with the app commit `0db9dc68` - **binding at or before the app, never the reverse**;
5. run `scripts/assert-engine-provenance.sh` and make it pass - it is the check whose absence
   produced today's non-reproducible APK;
6. only then build the APK, and only from that pinned state.

**The gate itself is being repaired first** (mutation test: `scratchpad/agents/landing-check-mutation/REPORT.md`, fix in flight in `landing-check-fix`): restore an app-side engine pin and
*compare* it instead of printing it, close the `package.json`/lockfile blind spot, wire the gate into
`build-kalsa-apk.yml`, and re-run the verifier's 14 cases against the patched checker. Two things the
same test found and nobody should lose: **the app's `main` checkout is red right now** - its install
predates its own pin bump, so it would fail its own gate (engine `8537d097` installed against
`4ccef2f85` pinned) - and a hand-pin hidden in `android/build/`, `.cxx/`, `ios/build/` or a nested
`node_modules` is **invisible to a repo-level check**, which is worth knowing rather than assuming away.

**GATE REPAIRED - and I checked it myself, not from the report.** Branch `landing-check-fix` (app
worktree `kalsa-wt-landing-check`), 3 commits on `e5788cf`: the gate now reads `package.json`, compares
it with the lockfile, compares the engine sha against a restored one-line `native/kalsallama.pin`
(`4ccef2f85dbc...`), and dies with both shas printed on missing, empty or mismatched provenance; a
committed `LOCAL OVERRIDE` note in `vendor/VERSIONS` is now **fatal** (that note is what a hand-pin
looks like). `build-kalsa-apk.yml` runs it right after `npm ci`, before the artifact exists. I ran the
suite myself: **37 passed, 0 failed**. The two cases that used to pass silently now fail - `package.json`
drift (0 -> 2) and provenance absent on both sides (0 -> 2) - and no case that should pass newly fails.
**Before landing, the app's `main` must be reconciled** (its install is older than its own pin).

An APK built today carries NONE of this work: both pins still say `0288dc27` and both
`node_modules` copies still carry the old third copy of the policy.

## Work protected on local refs (never pushed)

| ref | commit | what |
|---|---|---|
| `kalsa-gpu-opencl-v73` | `1068eb03d` | engine: no exit(1) on the OpenCL compile path, verdict keyed on the kernel set |
| `kalsa-opencl-upload-degrade` | `909243206` | weight-upload failures degrade to a load error instead of `abort()`; audited |
| `kalsa-opencl-q6k-f32-product` | `914b34a7e` | f32 product in the q6_K batch GEMM; audited; measured - no effect on its own |
| `kalsa-opencl-q6k-accurate-path` | `14a3afebf` | route the dense q6_K batch GEMM away from int8 dp4a; parent `914b34a7e` - **lands WITH the row above** |
| `kalsa-opencl-f32-transpose` | `40a9358a1` | f32 activation transpose; parent `914b34a7e`; measured, wrong direction - **excluded** |
| `kalsa-opencl-full-precision` | `a8eb58010` | both q6_K changes, both selectors; insurance build |
| `kalsa-opencl-q8-activation-scale` | `87f31d81f` | activation block scale promoted to **float** for the dense q6_K path, behind `KALSA_Q8A_SCALE=fp32|fp16` (default fp32); built on the integration line; one binary for the A/B |
| `landing-check-fix` (app) | `b1fe88b` | app: `native/kalsallama.pin` restored and **compared** (not printed), `package.json`/lockfile drift fatal, `LOCAL OVERRIDE` note fatal, gate wired into `build-kalsa-apk.yml`; 3 commits on `e5788cf`; suite **37 passed / 0 failed** |
| `kalsa-app-gpu-v73` | `7e04002` | app: memory gate removed, V73 enabled |
| `kalsa-governor-policy-consolidate` | `0db9dc68` | app: latch deleted, measures raw only; parent `e5788cf` |
| `kalsarn-governor-transport` | `b97c581d` | binding: third copy of the validity rule deleted + a load-bearing harness test pinning it; parent `cc804436` - **the app's `package.json` llama.rn pin must be bumped to this sha** |
| `kalsallama-governor-sole-decider` | `35eeeae3` | engine: doc correction, pin test, and the `t_idle_c > 0.0f` guard that restores the pre-consolidation outcome for 0 C or colder; parent `942bc938` |

## Facts established today, with evidence

- **The crash is not fixable in-process and does not need fixing on this phone**: the Adreno
  compiler SIGSEGVs on `flash_attn_f32_f16.cl` at DK 40/64/256, and a preventive refusal already
  exists (`ggml-opencl.cpp:9903-9906`, A7X-keyed, added 2026-08-20). Its generation list covers
  730/740/750 and omits 732/735 - which is why a 732 crashed on 2026-09-03.
- **The 229/229 test is a false comfort** for that program: every f16/f16 case is refused by
  `supports_op`, so the test compiles 0 of them.
- **The missing fix is kernel coverage, not a broken chip**: Q4_K_M holds 148x Q4_K, 19x Q6_K and
  99x F32 tensors; the fix had been applied to q4_0 and the main q4_K kernel only, and the q6_K
  tensors go to the GPU.
- **The kernel cache cannot serve a pre-fix binary**: the key hashes the kernel source.
- **Build reproducibility gap**: the installed APK was built with the engine hand-pinned to
  `1068eb03d` while the official chain pins `4ccef2f85`. Nothing is wrong with the code; the
  check was not run. Rule adopted: no APK outside the chain.
