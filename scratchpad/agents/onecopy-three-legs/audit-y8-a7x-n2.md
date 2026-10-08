# Audit — engine `e01a61cee`, `ggml_cl_mul_mat` f16 x f32 decode chain: the A7X `l4_y8` exclusion

Reviewer: n2. Read-only: nothing built, nothing edited, nothing committed, no device touched. One file written (this one).
Engine read: `~/Projects/kalsallama-gov-loadstep` at `e01a61cee2c9b1a4a30dc3d9f4888ba2444bb584` (detached HEAD, parent
`09a496d71`). Lab evidence read from `~/Projects/kalsa-moe-experiments` (PLAN.md, the QDC cell reports and their
`raw/` logs, the `step*-s23` greps) and `~/kalsa-qdc/`.

Shorthand used below, all quotes verbatim from the file as read:

| tag | path |
|---|---|
| `OC:<n>` | `ggml/src/ggml-opencl/ggml-opencl.cpp:<n>` (the engine, at `e01a61cee`) |
| `L4:<n>` | `ggml/src/ggml-opencl/kernels/mul_mv_f16_f32_l4.cl:<n>` |
| `GR:<n>` | `src/llama-graph.cpp:<n>` |
| `DIAG:<n>` | `scratchpad/agents/onecopy-three-legs/diagnose-gpu750-n2.md:<n>` |
| `PLAN:<n>` | `PLAN.md:<n>` |
| `C67:`, `C70:`, `C71:`, `C66:` | `scratchpad/agents/qdc-8g3-gpu750-dump-67/`, `.../qdc-8g3-gpu750-y8-70/`, `.../qdc-8g3-onecopy-legs-71/`, `.../qdc-8elite-onecopy-legs-66/` |

**Bottom line on the fix itself: the change is correct, and it is the first commit in this thread whose mechanism is
verified twice over.** The A7X fall-through lands on the same `l4_dr` statement the `FORCE_L4=1` A/B used, and the
device numbers prove they are the same computation: `C70:raw/L-l4a_sa881572.log:448` `kl_mean=0.000018 kl_max=0.000431`
vs `C71:raw/L-gpu_sa881613.log:448` `kl_mean=0.000018 kl_max=0.000431`, and the same identity in windows 1-3
(`0.000008/0.000062`, `0.000005/0.000036`, `0.000009/0.000156`, same `kl_max_row` 35/73/126 in both files) — the
post-fix A7X run on a 750 (`C71:raw/legs_report_sa881613.txt:37,47,57` all `mean=0.000010 max=0.000431 ... status=PASS`)
is bit-identical to the forced-`l4_dr` run and to nothing else. Everything below is about what the change does *not*
cover, what its comment claims and does not claim, and where the evidence chain is weaker than the commit implies.

---

## 1. Angle 1 — what the fall-through actually does

### 1.1 Which kernel, with which geometry (CONFIRMED)

`OC:27155` `} else if (can_multi_out && y8_allowed_on_gen &&` / `OC:27156`
`backend_ctx->kernel_mul_mat_f16_f32_l4_y8 != nullptr) {` is now skipped on A7X, and the next arm is `OC:27159`
`} else if (ne11 == 1) {` → `OC:27163` `kernel = backend_ctx->kernel_mul_mat_f16_f32_l4_dr;` with `OC:27164`
`nrows  = 1; // not used by this kernel`. `nrows` is indeed unused: the dispatch branch is selected by kernel identity,
`OC:28066` `if (kernel == backend_ctx->kernel_mul_mat_f16_f32_l4_dr) {`, `OC:28067` `const int NDST_DR = 4;`,
`OC:28068` `size_t global_work_size[] = {(size_t)CEIL_DIV(ne01, NDST_DR)*nth0, (size_t)nth1, (size_t)ne12*ne13};`,
`OC:28069` `size_t local_work_size[]  = {(size_t)nth0, (size_t)nth1, 1};`. `nth0`/`nth1` are the ADRENO values set above
this switch: `OC:27050` `} else if (backend_ctx->gpu_family == ADRENO) {`, `OC:27051` `nth0 = 64;`,
`OC:27052` `nth1 = 1;`.

So for the measured op (`src0` 768x64x8, `src1` 768x1x32, `dst` `ne=64,1,32,1` — `C67:raw/session1-dump-09a496d71.grep:114`
`node=cache_v_l2 (view) (permuted) op=PERMUTE type=f16 ne=768,64,8,1 sum=9.82402623 ...` and `:119`
`node=kqv-2 op=MUL_MAT type=f32 ne=64,1,32,1 ...`):

| | pre-commit / A8X | post-commit / A7X (= `FORCE_L4=1`) |
|---|---|---|
| kernel | `kernel_mul_mat_f16_f32_l4_y8` (`OC:27157`) | `kernel_mul_mat_f16_f32_l4_dr` (`OC:27163`) |
| gws | `{ne01/8*nth0, 1, ne12*ne13}` = `{512, 1, 32}` (`OC:28049-28050`) | `{CEIL_DIV(ne01,4)*nth0, 1, ne12*ne13}` = `{1024, 1, 32}` (`OC:28068`) |
| lws | `{64, 1, 1}` (`OC:28051`) | `{64, 1, 1}` (`OC:28069`) |
| args | the shared 24-arg block `OC:27178-27201` | the same block, same values |

### 1.2 Is it exactly the path `FORCE_L4=1` took? (CONFIRMED, with one caveat)

`FORCE_L4=1` sets `OC:27123` `const bool can_multi_out = !mm_force_l4_on && ne11 == 1 && ne01 >= 64 && ne01 % 8 == 0;`
to false. `can_multi_out` is consulted by exactly five arms — `OC:27139`, `OC:27143`, `OC:27147`, `OC:27151`,
`OC:27155` — and the new gate removes only the fifth. For the measured shape none of the first four can match
(`OC:27139` needs `ne00 == 128`, `OC:27143`/`OC:27147` need `ne00 <= 256`, `OC:27151` needs `ne01 == 128`), so the two
routes coincide *for this shape*, which is also what the device shows (§0 numbers). It does **not** coincide in general:
on A7X with `GGML_OPENCL_MM_KQ_GQA`/`_KQ_PAIR`/`_KQV_GQA_IMG` set, the arms at `OC:27139`/`27143`/`27151` still fire
under the new gate where `FORCE_L4=1` would have forced `l4_dr`. The commit message's phrase "so those shapes fall
through to the existing ne11 == 1 l4_dr arm" is true for the arm it edits (a shape that took `y8` has `y8_gqa`'s
condition false by ordering, and `can_multi_out` implies `ne11 == 1`), but "same as the A/B" is a shape-specific
property, not a property of the patch. See F1.

### 1.3 Shapes that now fall to a kernel whose constraints they violate (none found)

* `ne00 % 4 == 0` is enforced by the enclosing arm, `OC:27119` `} else if (ne00 >= 128 && ne01 >= 8 && ne00%4 == 0) {`,
  which is the header both kernels' comment asks for: `L4:33` `// Assumes row size (ne00) is a multiple of 4`.
* `ne11 == 1` is enforced by `can_multi_out` for anything that could have taken `y8`, and `l4_dr` states the same
  assumption: `L4:98` `// Each subgroup produces DR_NDST outputs, assumes ne11 == 1`, `L4:99`
  `#define MUL_MAT_F16_F32_L4_DR_NDST 4`.
* `ne01 % 4`: not required — the kernel clamps (`L4:152` `int       r0c  = r0 < ne01 ? r0 : 0;`) and guards the store
  (`L4:178` `if (lid == 0 && r0 < ne01) {`), and the dispatch is `CEIL_DIV` (`OC:28068`). `r0c`-clamped reads of row 0 for
  out-of-range rows are the same trick `y8` used (`L4:522` `const int r0c = (r0 < ne01) ? r0 : 0;`).
* `r2`/`r3` handling is identical: `l4_dr` `L4:141` `const ulong offset_src1 = i12*nb12 + i13*nb13;` and
  `L4:147` `const ulong   k_head_off = (i12/r2)*nb02 + (i13/r3)*nb03;` vs `l4_y8` `L4:515`
  `const ulong offset_src1 = (i12) * nb12 + (i13) * nb13;` and `L4:523`
  `const ulong off = r0c * nb01 + (i12 / r2) * nb02 + (i13 / r3) * nb03;`. Same `i12 = im % ne12`, `i13 = im / ne12`
  (`L4:138-139` vs `L4:512-513`) and the same dim-2 grid (`ne12*ne13` in both dispatch branches).
* Both kernels read the activation row as a flat `float4` array of `ne00/4` (`L4:142` vs `L4:516`) and the weight rows as
  flat `half4` (`L4:154` vs `L4:524`), i.e. both need `nb10 == 4`, `nb00 == 2` and an 8-byte-aligned row base. The change
  introduces no new assumption here, but note that the assumption is unchecked for *both* (there is no `nb00`/`nb10`
  alignment test on this path; the `aligned8`/`aligned16` checks at `OC:27090-27092` guard only the mrow family). Not
  introduced by this commit — P3, listed as F8.
* `ne12 % ne02 == 0` is not tested on this path (`r2 = ne12/ne02` is integer division at `OC:25898`), but that is true of
  every arm in the ladder including the two it replaces; `ggml_can_mul_mat` is asserted by `ggml_mul_mat` upstream —
  not a new exposure.

### 1.4 The measured shape really is this route, and the gate is not dead code here (CONFIRMED)

The KQV image arm cannot take this op, twice over: `OC:25950` `if (ne01 >= 64 && ne1 >= 32 && ne00 >= 16 &&` — the
measured `dst` has `ne1 = 1` (`C67:...:119` `ne=64,1,32,1`) — and even inside that block the KQV arm asks for a
non-contiguous src0, `OC:26001` `if (!ggml_is_contiguous(src0) && ggml_is_contiguous(src1) &&`, which the one-copy leg's
contiguous V view fails (that is the whole point of the "kv size == n_kv" trick, `PLAN:2210`
"the one-copy leg's KV size (768) equals n_kv, so the permuted V view is contiguous and skips the Adreno kq/kqv arm").
The KQ image arm's default-on `..._x8_gqa4_img` needs `ne00 == 128` (`OC:26019`), and this model's K source is
`ne=64,8,768,1` (`C67:...:115` `node=cache_k_l2 (view) op=VIEW type=f16 ne=64,8,768,1`), so its KQ (`C67:...:117`
`node=kq-2 op=MUL_MAT type=f32 ne=768,1,32,1`) never enters the block either. The gate is therefore live for the op it
targets, and `OC:25845-25862` (dequant-to-f16 recursion) is a second, unreported entry to the same ladder.

---

## 2. Angle 2 — coverage of the same structure elsewhere on A7X

`can_multi_out` is one flag over five arms, and only the last one is gated. What A7X still runs:

| arm / kernel | still reachable on A7X | by what |
|---|---|---|
| `l4_x8_gqa4` (`OC:27141`) | yes, if `GGML_OPENCL_MM_KQ_GQA` set | `OC:27139-27140`, `ne00 == 128 && r2 == 8 && r3 == 1` |
| `l4_x8_pair` (`OC:27145`) | yes, if `GGML_OPENCL_MM_KQ_PAIR` set | `OC:27143-27144`, `ne00 <= 256` |
| `l4_x8` (`OC:27149`) | **yes, by default** | `OC:27147-27148`, `ne00 <= 256` |
| `l4_y8_gqa` (`OC:27153`) | yes, if `GGML_OPENCL_MM_KQV_GQA` set | `OC:27151-27152`, `ne01 == 128 && r2 == 8 && r3 == 1` — the arm that is *not* gated |
| `l4_y8` (`OC:27157`) | no | `OC:27155`, the new gate |
| `l4_x8_gqa4_img` (`OC:26018`) | **yes, by default** | `OC:26009` `static const bool mm_kq_gqa_img_on = (mm_kq_gqa_img_env == nullptr || mm_kq_gqa_img_env[0] != '0');` |
| `mrow_r2/r4/h8/h8r2` (`OC:27102-27105`) | yes whenever `GGML_OPENCL_F16_MROW_RPT` is set | defaults `OC:714` `bool f16_mrow = true;` / `OC:715` `int  f16_mrow_rpt = 1;` |

Two observations that matter:

1. **`l4_y8_gqa` is the closest sibling and it is not gated.** It keeps eight `half4` row pointers and a
   `float[8][8]` accumulator (`L4:787-796` `global half4 * x4_o[N_DV_ROWS_Y8GQA];` / `float sum[N_DV_ROWS_Y8GQA][GQA_RATIO_Y8GQA] = { {0.0f} };`)
   — strictly more register pressure than the kernel that was measured wrong. It is off by default in the lab's runs
   (`C70:run-legs.sh:12-14` sets no `GGML_OPENCL_MM_*` flag), so the *shipped* default is not exposed; but a single env
   in a tuning profile re-enables a 64-accumulator variant of the kernel this commit says is miscompiled on that
   compiler. Verdict on "the gate is in the right place": for the measured shape, yes; as a statement about the
   *family*, no.
2. **`l4_y8` is only reachable when `ne00 > 256`** — `OC:27147` tests `ne00 <= 256` and takes `l4_x8` first, so the arm
   the commit edits is the "long-K" instance only. `l4_x8` differs structurally from `l4_y8` (one live row pointer per
   iteration and the activation staged in `__local`, `L4:442-446` `__local float4 q_loc[64];` / `q_loc[sgs_lid] = y4[sgs_lid];`
   / `barrier(CLK_LOCAL_MEM_FENCE);`), which is a real reason to expect it to be safe — but no run in the lab has
   exercised `l4_x8` on an A7X with a checked output: the QDC models' K side is `ne=64,8,768,1`
   (`C67:...:115`) so their KQ never enters the ladder, and the KQV always has `ne00 = kv size = 768`
   (`C70:run-legs.sh:3-4` "With kv size == n_kv (768) the V view is contiguous"). That is F2.

### `get_adreno_gpu_gen` and the gate's selector

`OC:322-326` is the mapping, verbatim:

```
    if (strstr(device_name, "730") ||
        strstr(device_name, "740") ||
        strstr(device_name, "750")) {
        return ADRENO_GPU_GEN::A7X;
    }
```

`OC:328-333` maps `810/830/840/850` to `A8X`, and `OC:343` `return ADRENO_GPU_GEN::ADRENO_UNKNOWN;` closes it.
Consequences:

* The 750 → A7X (CONFIRMED), the 740 → A7X (CONFIRMED, so the comment's "shares the generation" is literally true).
* **732 and 735 map to `ADRENO_UNKNOWN`** (their names contain neither "730"/"740"/"750" nor any A6X token), and the gate
  is `OC:27127` `const bool y8_allowed_on_gen = backend_ctx->adreno_gen != ADRENO_GPU_GEN::A7X;`, i.e. UNKNOWN is
  *allowed*. The 732 (7+ Gen 3) and 735 (8s Gen 3) are the same 7xx silicon family that the commit's own reasoning
  ("shares the generation and is untested, so it is excluded as well") says to exclude. The code does not. CONFIRMED
  inconsistency, F3.
* The selector is coarser than the evidence. The measured failure is on compiler `E031.45.02.06`
  (`C67:REPORT.md` device block: "`OpenCL 3.0 QUALCOMM build: commit unknown Compiler E031.45.02.06`"), the excluded
  part (740) is documented in this very tree as `E031.41` (`ggml/src/ggml-opencl/ggml-opencl-tile32-facts.h:5-6`
  "an Adreno 740 on the E031.41 driver line"), and the verified-clean part (830) is `E031.47.18.47`
  (`C66:REPORT.md` device block). The tree already parses the compiler version (`OC:346-387`
  `get_adreno_cl_compiler_version`) and already gates on it elsewhere (`OC:9427-9434`
  `static bool adreno_e17_compiler_quirks(const ggml_backend_opencl_context *backend_ctx) {`), and it names compiler
  revisions in comments it wrote itself: `OC:5278-5279`
  "// GPU name, so on the A7X parts where the E031.41.03.62 mask miscompile was" / "// measured the lookup returns
  nothing and this kernel stays null.", `OC:10535` "// A7X (Adreno 740, compiler E031.41) SIGSEGVs inside clBuildProgram".
  A generation gate where the evidence is a compiler/part pair will need a second edit for the next part, and it will
  silently keep the wrong kernel on any 7xx that the string table does not name.

---

## 3. Angle 3 — is the gate bypassed anywhere?

No. Enumerated, with the lines that rule each out:

* KQ/KQV image arm (`ggml_cl_mul_mat_kq_kqv_adreno`): `OC:26001` requires a non-contiguous `src0`; the leg's `src0` is
  contiguous (that is what `PLAN:2210-2212` records and what puts the op here). Also the whole block needs `ne1 >= 32`
  (`OC:25950`) while this op's `dst` is `ne=64,1,32,1`. CONFIRMED unreachable for this op.
* Dequant-to-f16 re-entry: `OC:25845` `if ((src0t == GGML_TYPE_Q4_0 || src0t == GGML_TYPE_Q8_0) &&` …
  `OC:25862` `ggml_cl_mul_mat(backend, &fake_src0, src1, dst);` — this *is* the same function recursively, so it passes
  through the same gate (good) but it is a second way for a quant-KV KQV to reach `l4_y8` that the comment's scope
  ("the one-copy GPU leg's KQV") does not mention.
* Kernel-selection cache: none for `mul_mat`. The only cache in the backend is the on-disk *program* cache
  (`ggml/src/ggml-opencl/cl-program-cache.h:1-4` "On-disk cache for OpenCL cl_program binaries. Lets a fresh process
  skip the expensive clBuildProgram-from-source step"), and `ggml_opencl_log_kernel_once` is instrumentation only
  (`ggml/src/ggml-opencl/ggml-opencl-kalsa-diag.cpp:29-34`, called from `OC:1248`). Every dispatch re-runs the ladder.
* flash-attn: `GR:2643` `const bool use_flash_attn = cparams.flash_attn && kq_b == nullptr;` — with FA on there is no
  KQV `MUL_MAT` at all, so the gate is irrelevant (and the FA kernels get no A7X analysis from this commit). The failing
  config is the non-FA path (`C67:...:119` is a `MUL_MAT` node). Worth stating in the comment; not a defect.
* The one-copy route itself is what the dump shows: `C67:...:113` `node=cache_v_l2 (view) op=VIEW type=f16 ne=768,8,64,1
  skip=noncontiguous` → `:114` `(permuted) ... ne=768,64,8,1` (contiguous, stats present) → `:119` the KQV node.

---

## 4. Angle 4 — is every statement in the added comment true?

`OC:27124-27126` verbatim:

```
                    // l4_y8 is wrong and run-to-run nondeterministic on the Adreno 750 (A7X) for
                    // the one-copy GPU leg's KQV (KL 0.04-0.18, QDC #67/#70); l4_dr is correct there.
                    // The 740 shares the generation and is untested, so it is excluded as well.
```

* "wrong and run-to-run nondeterministic … on the Adreno 750" — CONFIRMED, and the *inputs* being bit-identical is
  measured, not assumed: `C67:...:119` and `:131` are the same node in two runs with the same input hash
  (`in=13330` both) and different sums (`sum=0.297168073` vs `sum=0.27805565`); `C70:REPORT.md` result table
  `0.040665` vs `0.120420` on the same binary. The KL range is the cell #67 range
  (`0.041334`, `0.038273`, `0.176283`, `0.102176` in `C70`-style `kld` lines) — "0.04-0.18" matches.
* "QDC #67/#70" — resolvable, contrary to my first suspicion: `PLAN:2205` and `PLAN:2215` name both cells with their
  reports and raw greps. Not a defect; but the *engine* repo carries the bare cell ids, so anyone reading the code
  outside this lab has a comment they cannot resolve — P3, F6.
* "l4_dr is correct there" — CONFIRMED for the shape and the config measured (3/3 PASS at `0.000010`, identical to six
  digits, `C70:REPORT.md`), and now independently by the fixed binary (`C71:raw/legs_report_sa881613.txt:37,47,57`).
  Not a general claim about `l4_dr` on all A7X shapes; the comment reads as if it were.
* "The 740 shares the generation" — CONFIRMED (`OC:322-326`).
* "…and is untested" — IMPRECISE/PARTLY FALSE. The 740 is not an untested part in this lab: the TILE32 R2 device facts
  are *defined* around it (`ggml/src/ggml-opencl/ggml-opencl-tile32-facts.h:5-6` "an Adreno 740 on the E031.41 driver
  line"), and the S23 ran a KL-gated GPU-leg-alone arm on the one-copy bench:
  `step5-s23/raw/session3-localize-e6e3ed854.grep:26` `## gpu (--legs gpu): exit=1`, `:36`
  `kld arm=L ref=... tokens=256 ... mean=0.055268 max=0.398771 kld_max=0.010000 status=FAIL`. That session is
  confounded — the CPU leg failed too (`:14` `mean=0.047248 … status=FAIL`) — so it is not evidence about `y8`; but it
  means the honest statement is "no clean 740 measurement of this route exists", not "untested". F4.
* Missing from the comment: that `l4_y8` is upstream code (`PLAN:2218` "l4_y8 is upstream code (#25366); fixed in the
  fork only") and that this is a silent, permanent divergence on every future `git merge upstream/master`
  (`REPOS.md` engine section describes those merges as routine). A fork-only workaround with no upstream issue link and
  no upstream-shaped reproducer is a merge-conflict generator. F6.
* The commit message adds "The 740 shares the generation and is untested, so it is excluded too." plus a
  `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` trailer and an internal worktree tag in the subject
  ("- kalsallama, detached, HEAD 09a496d71"). The trailer and the tag carry no information upstream and the message
  cites no artifact path. Hygiene, P3.

---

## 5. Angle 5 — regression risk on A7X for shapes that legitimately used `l4_y8`

* **Can the app's two-copy GPU path on a 740 reach `l4_y8`? No.** Two-copy V views are non-contiguous (the lab's own
  statement: `C70:run-legs.sh:4-5` "the plain two-copy load (kv 2048, V view non-contiguous) passes"), and
  `OC:27058` `const bool adreno_noncontiguous_src0 =` / `OC:27069` `if (adreno_noncontiguous_src0) {` /
  `OC:27070` `kernel = backend_ctx->kernel_mul_mat_f16_f32;` fires *before* the x8/y8 ladder. Empirically: `A-gpu`
  PASSes both on the A8X (`C66:REPORT.md` table `mean=0.000010`) and on the fixed 750
  (`C71:raw/legs_report_sa881613.txt:72` `mean=0.000012 … status=PASS`). CONFIRMED — no two-copy exposure.
* **What is lost on A7X:** the 8-rows-per-WG decomposition for the one-copy leg's KQV (and any other contiguous-src0
  long-K f16 matmul). On the measured shape the cost is not visible in the lab's own numbers: window tps
  `C70:raw/L-gpu_sa881572.log:448-451` `22.704/23.447/23.458/24.117` (y8) vs `C70:raw/L-l4a_sa881572.log:448-451`
  `23.036/23.548/23.469/24.346` (forced dr) vs `C71:raw/L-gpu_sa881613.log:448-451` `22.959/23.531/23.618/24.307`
  (gated dr) — the dr route is 0-1.5 % *faster* here. So the perf objection does not apply to this shape. It is
  unmeasured for other A7X shapes (large `ne01`: dr issues `CEIL_DIV(ne01,4)` WGs vs `ne01/8`, twice the workgroups and
  half the per-WG work), and, because the gate ships with no env override, there is no way to compare the two routes on
  a 740 without a rebuild. F5 (perf, P3) and F7 (no knob, P3).
* **Correctness regression surface:** `l4_dr` is the arm the pre-`y8` tree used for these decode shapes
  (`OC:27160-27162` "Decode shapes that don't satisfy the x8/y8 row constraints (ne01 < 64 or ne01 % 8 != 0) fall back
  to upstream's 4-output _dr kernel."), so the change moves traffic back onto the longer-lived kernel rather than onto
  something new. That is the right direction; the only unverified corner is `l4_dr` on A7X with `ne00` values other than
  768 (e.g. 512, 4096), which was equally unverified before.

---

## 6. Angle 6 — other things wrong (including two outside the diff)

* **The lab's recorded diagnosis of the same KL range is now stale and contradicts the commit, and nobody reconciled
  them.** `DIAG:321-324` (written the same morning, 09:55, before the 15:49 commit) ranks
  "(H-A) an unvalidated run-time object in the v4 dispatch — the activation image and dst sub-buffer over pool offsets,
  unchecked by any self-check and layout-dependent, which matches both the nondeterminism and the "first GPU window
  worst, later windows better" decay; (H-B) CPU/GPU coherence of the cached rpcmem block on the E031.45 driver line".
  Its central argument for rejecting a constant per-token error is `DIAG:49-53`
  "**First GPU window of a run is the worst**, the second is 3-5x smaller" … "this *decay* needs a run-state mechanism,
  not a constant one." — but the QDC dumps show the route is *constant* per token (the first divergence is `kqv-2` at
  every token, `C67:...:69-73` `tok=0 … first divergence: node=kqv-2 …`, `tok=1 …`, `tok=2 …`), and the "decay" in cell
  #70's second baseline run is partly a metric artefact: `C70:raw/L-gpu2_sa881572.log:448`
  `kl_mean=0.125654 kl_max=0.681382 kl_max_row=5 kl_diverged=1` followed by `:449-451` `kl_mean=0.000000 kl_max=0.000000
  … kl_diverged=1`. So the decay does not discriminate between a constant kernel error and a run-state error, and the
  y8 hypothesis survives the objection — but the commit neither says so nor updates `DIAG`. Reader hazard, P3. F9.
* **The 830-clean premise is not backed by a logged kernel name anywhere in the lab.** "The Adreno 830 (A8X) runs
  `l4_y8` correctly" is an inference from identically-shaped arms: `C66:run-legs.sh:38`
  `run L-gpu   shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs gpu --logits-ref … --kld-max 0.01 -v` and
  `C70:run-legs.sh` the same, with `GGML_OPENCL_LOG_KERNELS` set nowhere in either script and no kernel name in either
  report — although the hook exists for exactly this (`ggml-opencl-kalsa-diag.cpp:29-34`, `OC:1248`). One env var on one
  re-run would turn the premise into evidence. F10.
* **`GGML_OPENCL_MM_F16_FORCE_L4` is presence-only while the tree's newer helper parses values.** `OC:27121-27122`
  `static const char * mm_force_l4_env = getenv("GGML_OPENCL_MM_F16_FORCE_L4");` /
  `static const bool mm_force_l4_on = (mm_force_l4_env != nullptr && mm_force_l4_env[0] != '0');` — so
  `GGML_OPENCL_MM_F16_FORCE_L4=false` means **on**. The sibling helper is value-parsed
  (`ggml-opencl-kalsa-diag.cpp:51-69`, and its own comment at `:48-50` records that some hooks "remain presence-only
  (see F4)"). The flag that validates this fix is one of the presence-only ones. Pre-existing, but it is the evidence
  path for this commit. F7.
* **No test, and the predicate is not host-testable.** `git show --stat e01a61cee` is one file, `5 insertions(+), 1
  deletion(-)`; the predicate is an inline `const bool` inside a 150-line ladder (`OC:27127`), and
  `grep -rln "l4_y8\|adreno_gen\|ADRENO_GPU_GEN" tests/` returns nothing. The tree's own convention for a device gate
  is a pure function with a host test (`ggml/src/ggml-opencl/ggml-opencl-tile32-facts.h:7-8`
  "Deliberately free of OpenCL types so the host build (GGML_OPENCL=OFF) can test the gate on fake facts"). F11.
* **No inverse knob.** `OC:26307` `// Override with GGML_OPENCL_A7X_F32_LM_BYPASS=0.` and `OC:10377`
  `static const bool   a7x_lmhead_cpu = (a7x_lmhead_env == nullptr || a7x_lmhead_env[0] != '0');` are the neighbours'
  pattern: an A7X carve-out that can be backed out in a shipped binary. The new one cannot (it is a bare enum compare at
  `OC:27127`), so the *next* A7X miscompile report cannot be A/B'd against the old route without a rebuild. F7.
* Cosmetic: the name `y8_allowed_on_gen` for `adreno_gen != A7X` reads as "the gen is allowed"; `y8_allowed_on_gen` is
  true on UNKNOWN (see F3), which is exactly the case that should have been decided deliberately.

---

## 7. Findings

| id | sev | verdict | finding |
|---|---|---|---|
| F1 | P2 | CONFIRMED | The gate is not equivalent to the A/B that justifies it: `FORCE_L4=1` clears all five `can_multi_out` arms (`OC:27139/27143/27147/27151/27155`); the patch clears only `l4_y8`, so with `MM_KQ_GQA`/`MM_KQ_PAIR`/`MM_KQV_GQA` set the other four arms still fire on A7X. The commit message's "so those shapes fall through to … l4_dr" is true only for shapes that took `y8`. |
| F2 | P2 | CONFIRMED | Coverage hole in the same ladder, default-on: `l4_x8` (`OC:27147-27149`, `ne00 <= 256`) and the image KQ kernel `l4_x8_gqa4_img` (`OC:26009` default-on, `OC:26017-26020`) still run on A7X. `l4_y8` is only reachable when `ne00 > 256`, so the arm fixed is the long-K instance of a family whose short-K instance is untouched and, for the lab's models (`C67:...:115` K is `ne=64,8,768,1`), never even entered. |
| F3 | P2 | CONFIRMED | `732`/`735` are not in `get_adreno_gpu_gen` (`OC:322-326`), resolve to `ADRENO_UNKNOWN` (`OC:343`), and pass the gate (`OC:27127`), although the commit's own reasoning ("shares the generation and is untested") would exclude them. The gate is a generation proxy while the evidence is a **compiler revision** (750 = `E031.45.02.06` per `C67:REPORT.md`; 740 = `E031.41` per `ggml-opencl-tile32-facts.h:5-6`), a variable this tree already parses (`OC:346-387`) and gates on (`OC:9427-9434`). |
| F4 | P3 | CONFIRMED | Comment text "The 740 shares the generation and is untested": the second clause is wrong as written — the 740 is this lab's measured TILE32 device and has a KL-gated one-copy GPU-leg arm on record (`step5-s23/raw/session3-localize-e6e3ed854.grep:26-36`, confounded by the CPU leg failing at `:14`). Say "no clean 740 measurement of this route". |
| F5 | P3 | CONFIRMED | The A7X perf cost of the change is unmeasured for every shape except the one measured here; for that shape it is nil-to-negative (`22.704-24.117` y8 vs `23.036-24.346` dr tps, §5). No number in the commit, no knob to re-measure. |
| F6 | P3 | CONFIRMED | The comment cites internal cell ids (`QDC #67/#70`, resolvable only in `PLAN:2205`, `PLAN:2215`) and does not say the kernel is upstream (`PLAN:2218` "l4_y8 is upstream code (#25366); fixed in the fork only") or that this is a fork-only divergence across `git merge upstream/master`. No artifact path, no upstream issue. Message hygiene: a `Co-Authored-By: Claude Haiku` trailer and a worktree tag in the subject. |
| F7 | P3 | CONFIRMED | No inverse knob for the new carve-out, against the neighbours' pattern (`OC:26307`, `OC:10377`); and the flag used to validate the fix is presence-only (`OC:27122`) so `…FORCE_L4=false` means **on** while the tree's newer parser (`ggml-opencl-kalsa-diag.cpp:51-69`) would read it as off. |
| F8 | P3 | CONFIRMED | The two kernels the decision chooses between both assume contiguous, 8-byte-aligned operand rows (`L4:142/154` vs `L4:516/524`) and neither the arm nor its caller checks `nb00 == 2`/`nb10 == 4`/alignment (the `aligned8`/`aligned16` tests at `OC:27090-27092` guard only the mrow family). Pre-existing, not introduced, but the gate now routes *more* traffic through `l4_dr`. |
| F9 | P3 | CONFIRMED | The lab's written diagnosis of the same KL range (`DIAG:321-324`, `DIAG:49-53`) is contradicted by the commit and was not reconciled; its "decay needs a run-state mechanism" argument is unsound anyway (the route is constant per token — `C67:...:69-73` — and cell #70's second baseline shows the decay as a post-divergence metric artefact, `C70:raw/L-gpu2_sa881572.log:448-451`). Two contradictory conclusions for the same numbers now sit in the same directory. |
| F10 | P3 | CONFIRMED | The "A8X runs `l4_y8` correctly" premise of the gate's scope is an inference from identical arm flags, not a logged dispatch: neither `C66:run-legs.sh` nor `C70:run-legs.sh` sets `GGML_OPENCL_LOG_KERNELS` and no report names a kernel. One env var on one re-run settles it. |
| F11 | P3 | CONFIRMED | No test and no host-testable predicate (`tests/` has no `adreno_gen`/`l4_y8` reference), against the tree's own convention for device gates (`ggml-opencl-tile32-facts.h:7-8`). The diff is 1 file, +5/-1. |

## 8. Answers to the six questions, in one line each

1. `l4_dr`, `nrows = 1` (unused), `gws {1024,1,32}`, `lws {64,1,1}`, the shared 24-arg block; it is the same statement
   `FORCE_L4=1` reached, and the device proves it digit-for-digit; no shape in the ladder violates the new kernel's
   constraints (`ne00 % 4` and `ne11 == 1` still enforced, `ne01` guarded in-kernel).
2. Other A7X routes into the same structure survive: `l4_x8` (default), `l4_x8_gqa4_img` (default), `l4_x8_pair`,
   `l4_x8_gqa4`, the ungated `l4_y8_gqa`, and `mrow_r*` under `GGML_OPENCL_F16_MROW_RPT`; the gate is in the right place
   for the arm it edits and in the wrong place for a family claim; 750 → A7X, 740 → A7X, 732/735 → UNKNOWN (so they keep
   `y8`).
3. Nothing bypasses it: the kq/kqv arm needs `!ggml_is_contiguous(src0)` **and** `ne1 >= 32`, the leg fails both, there
   is no kernel-selection cache, the only other entry is the dequant recursion which re-enters the same function, and FA
   removes the op entirely.
4. All three comment lines are supported except "untested" for the 740 (imprecise) and the leg-specific scope that the
   code does not implement; the cell ids are resolvable in `PLAN`, not in the engine repo.
5. The two-copy path cannot reach `l4_y8` (non-contiguous V → `OC:27069-27071`; `A-gpu` PASSes on 830 and on the fixed
   750), so no correctness regression there; the only loss is the 8-row decomposition on A7X, unmeasured except on the
   one shape where it is free.
6. Two live hazards outside the diff: the stale, contradictory lab diagnosis (F9) and the unlogged 830-clean premise
   (F10); plus one un-reconciled process debt (fork-only fix of upstream `#25366` with no upgrade path, F6).
