# RECON — Vulkan MoE decode regression, kalsa-server v1.1.4 (READ-ONLY, report only)

Suspected: Ling-3.0-tiny (arch `bailingmoe3`: MoE + KDA linear attention), Vulkan, RTX 4050,
all layers GPU, ctx 64k, q8_0 KV → 63.99 tok/s vs 99.13 on the previous desktop build (-35% decode,
-7% prompt). Dense Gemma rows on Vulkan flat. Single pair, GPU may have throttled — unconfirmed.

Range analysed: `e8065c7cf..61c909481` in `~/Projects/kalsallama`.

## 0. Range composition (how the delta is built)

- `e8065c7cf` (2026-09-29) = our fork on top of upstream **b11010** (upstream merge inside it:
  `6b6d4a980 Merge tag 'b11010' into b11010-merge`).
- `61c909481` (2026-10-01) = our fork after `e3c43a9db Merge upstream tag b11304 (81ff93ea1) into main (kalsallama)`.
- Upstream delta: **294 commits** (`6b6d4a980..81ff93ea1`).
- Commits in the range touching the requested paths (ggml-vulkan, src/models/, llama-graph,
  llama-model, ggml.c): **50**; of those only the merge `e3c43a9db` is ours (see §2).
- First-parent chain `e8065c7cf..61c909481` = **23 commits**, all ours (governor/platform merge,
  tests, hexagon, CI). The upstream content enters through the single merge `e3c43a9db`.

## 1. Ranked suspects (one line each, sha + subject + file:line)

Ranked by fit to the observed signature (decode-only, MoE+KDA, dense flat).

1. **`5c200e0c8` vulkan: Tune GDN kernel, fix Intel performance (#29476)** — the only
   `gated_delta_net`/KDA change in the range (shader `vulkan-shaders/gated_delta_net.comp`
   untouched; host launch config only). New branch
   `ggml/src/ggml-vulkan/ggml-vulkan.cpp:3681-3683`: `else if (S_V >= 128u && device->subgroup_clustered) { lanes_per_column = std::max(1u, gdn_subgroup_size / 8u); }`
   — old code hard-coded `lanes_per_column = 8u` there, so on NVIDIA (sg32) lanes go 8→4 and
   `cols_per_wg` 4→8 (`:3724`, pipeline specialization `{S_V, kda, subgroup, lanes}` at `:3730`).
   Ling-3.0-tiny is 18 KDA + 6 MLA layers (`reports/research-ling3tiny.md:43`), `head_dim` 128
   (`:44`) → S_v = 128 selects `pipeline_gated_delta_net[3][kda]` (`ggml-vulkan.cpp:3660`
   `gdn_sizes[] = {16,32,64,128}`, dispatch `:9120-9131`). GDN runs every decode token, exists
   only on linear-attention models → matches "decode -35%, dense Gemma flat" best.
   Caveat: the commit comment claims the new rule is the "measured optimum (Ampere sg32->4)"
   — unverified for Ada and for the KDA (`kda=1`) variant; and **first verify the GGUF's
   `kda_head_dim`**: if <128 the changed branch does not apply and this suspect dies.
2. **`526247161` vulkan: fix wrong results when a mul_mat reads a slice of a larger cache (#28956)**
   — rewrites batch-stride and descriptor-range handling for tensors read *in place* (i.e. KV-cache
   views, q8_0 included). Helper `ggml-vulkan.cpp:6018 ggml_vk_batch_stride()`; decode-relevant
   hunks `:6796-6797` (mul_mat_vec strides), `:7836-7837` (mul_mat_vec_id strides); PP-side range
   rework `:6514-6515` and `:7636-7638` (x_range/y_range from `ggml_nbytes`, review switched the
   matrix path to `ggml_vk_subbuffer` "spans to the end of the buffer"). Ling's MLA kv views
   (`src/models/bailingmoe3.cpp` kv_all row_size view) are exactly the "strided view" case Gemma's
   plain cache may not hit. Correctness fix, expected neutral — but the binding-range rewrite is
   the kind of change that moves NVIDIA perf either way.
3. **`0bc845d35` vulkan : reuse descriptor sets when bindings are constant (#29280)** — touches
   *every* dispatch. Read site `ggml-vulkan.cpp:4899 device->disable_descriptor_reuse = getenv("GGML_VK_DISABLE_DESCRIPTOR_REUSE") != nullptr;`,
   logic `ggml-vulkan-common.h:271-285` (compare `buffer/offset/range`, skip the write).
   Expected win; must still be A/B'd (toggle in §4).
4. **Prompt-side MoE cluster (best fit for the -7% prompt, not the -35% decode):**
   - `94a0ae3e7` vulkan: MOE aware mat_mul_id tile selection (#29182) — `ggml-vulkan.cpp:7420-7424`
     (`n_per_expert = CEIL_DIV(nei0 * nei1, n_as)` now feeds align/`aligned`/pipeline pick).
     Upstream evidence (§3): +14.6% pp on RTX 5070 Ti, **-10.6% pp on RX 6900 XT, decode flat** —
     on NVIDIA measured as a pp *gain*, so unlikely our decode culprit.
   - `5c53396b8` vulkan: raise the hoisted row-id limit for mul_mat_id from 256 to 512 experts (#28501)
     — `vulkan-shaders/count_experts.comp:36-40` shared arrays now `MAX_EXPERTS 1024`
     (3×1024×4 = 12 KiB vs 3 KiB before; occupancy cost for that dispatch), host gate
     `ggml-vulkan.cpp:7329` (`hoist_row_ids = n_as <= 1024 ...`).
   - `7490357f2` vulkan: skip unneeded MoE work in mul_mm coopmat1 path (#25483) —
     `vulkan-shaders/mul_mm.comp:317-318` (`required_work_items`/`required_warp_c`), guards at
     `:370` and `:390`. PP/matrix path only (decode takes the vec path:
     `ggml-vulkan.cpp:7908 return (src2->ne[1] <= 8) && ...` → `mul_mat_vec_id` for ≤8 tokens).
5. **`83dd71f86` vulkan : Load F32 A matrix 2 at a time when its 2-aligned (#29254)** —
   `vulkan-shaders/mul_mat_vec.comp:145-149` adds `a_offset % 4 == 0` to `is_aligned_nonquant`,
   `dequant_funcs.glsl:18-21` switches to packed64 loads. Author (Matt Corallo) explicitly writes
   "I assume might be slower on other platforms". Hits all f32-A matvecs → Gemma-flat argues
   partially against, but it is on the decode hot path.
6. **Checked and downgraded (evidence of neutrality on NVIDIA):**
   - `cea74625f` vulkan: fix argsort kernel selection for Adreno (#29469) — `ggml-vulkan.cpp:11208`
     `max_wg_log2 = min(max_workgroup_size_log2, num_argsort_pipelines - 1)`; with
     `num_argsort_pipelines = 11` (`ggml-vulkan-types.h:500`) and NVIDIA wg log2 = 8 the value is
     unchanged (8), and supports_op at `:15688` keeps the same 256 limit → router/top-k neutral.
   - `70c4e1582` int8 coopmat1 for AMD RDNA3/RDNA4 (#27952) — gated
     `ggml-vulkan.cpp:1878-1879 use_cm1_int = ... (architecture == AMD_RDNA3 || AMD_RDNA4)` →
     never active on RTX 4050 (this is the commit blamed in upstream issue #29410, §3).
   - `81ff93ea1` llama: properly handle KV on training (#28520) — `src/llama-graph.cpp` hunks all
     behind `cparams.training`; inference path unchanged.
   - `f830688e9` model : add Ling 3.0 VL support (#29151) — `src/models/bailingmoe3.cpp:238,334-341`
     and `src/llama-model.cpp:3167-3169` (`BAILINGMOE3` returns MROPE only `if use_mrope()`).
     Text-only GGUF without `rope_dimension_sections` keeps NORM rope → no change. **Verify** the
     GGUF lacks `rope_dimension_sections`; if present, rope type changed NORM→MROPE (small, but real).
   - `f172be756` split buffers/debug into separate files (#28732) — checked `add_rms_fusion`,
     `GGML_OP_MUL_MAT_ID`, `can_fuse` occurrences: pure relocation of struct fields/functions,
     no semantic delta found.
   - `b5cf8ce02` (assert in `ggml_set_input`, ggml.c:7995), `bced4595b` (ubsan pointer workaround
     in `ggml_graph_nbytes`), `c21284cdf` (permute int→int64, only >2^31 dims) — neutral.
   - `03a667aa3` qwen4exp hc_post fusion (#29520) — pattern needs qwen4exp's `dsv4_hc_post`, not
     present in bailingmoe3. `4ceb17191` (Intel Xe FA), `3423f940e` (Adreno), `6b790a9c2`/`05f2dcfdb`
     (conv2d/im2col), `b1ff4ca23` (IQ4_XS; `mul_mat_vecq.comp` hunk is IQ4_XS/IQ1 K_PER_ITER only),
     `08b1d2aea` (symbol visibility) — not on this model/path.
   - `e9f824d8c` llama_prec_policy + W4A4 (#24364) — `src/llama-graph.cpp:1526-1527,1562-1563`
     only acts if the GGUF carries precision metadata (`llama-model.cpp:1240 prec_policy.load`);
     verify the Ling GGUF doesn't.
   - MMVQ-vs-DMMV heuristic unchanged for NVIDIA (`git log -S ggml_vk_should_use_mmvq` empty in
     range; diff shows only `IQ4_XS`→Intel and a new `VK_VENDOR_ID_QUALCOMM` arm; NVIDIA switch
     at `ggml-vulkan.cpp:6565+` untouched).

## 2. Did OUR (non-upstream) commits touch these paths?

**No — with one exception.** Loop over every commit in `e8065c7cf..61c909481` tested with
`git merge-base --is-ancestor $c upstream/master`; the only non-upstream commit touching
`ggml/src/ggml-vulkan | src/models/ | src/llama-graph.cpp | src/llama-model.cpp | ggml/src/ggml.c`
is the merge itself:

- `e3c43a9db` conflict resolution vs the upstream tip changes **only `src/llama-model.cpp`
  (+74/-3)**: `has_mtp_weights()` block, `mem_other` guards in `create_memory`, and
  `llama-model.cpp:1812 ml.init_mappings(params.mmap_prefetch >= 0, ...)` (upstream had `true`).
  Load-time/memory-sharing code, not on the decode path.

All other our commits in the range touch governor, kv-cache *warnings*, tests, hexagon, opencl,
ggml-alloc (`4d46cb61c`, `34fca920f`, `722c07078`, `599a5f820` — reserve-time only), CI.

Adjacent risk outside the requested paths (flag, not blame): the merge
`5de9fa2fc Merge branch 'feat/governor-platform-status'` landed immediately *before* the b11304
merge, and the governor selects the decode engine — `src/llama-governor-runtime.cpp:180-183
int32_t llama_governor::select_decode()` / `stats_.decode_engine`. Before believing a -35%
Vulkan regression, read the governor stats from the 63.99 run and confirm `decode_engine` = GPU
and that the `/bench route dev hook` (`src/llama-governor-policy.h:112`) was in the expected mode.

## 3. Upstream reports (github.com/ggml-org/llama.cpp, last ~6 weeks)

- **#29410 (open, 2026-09-25)** "RX 7800 XT Vulkan decode and MTP slower on 84e76d8a2 than
  c77ae695c; #27952 prefill gain not seen" — Windows + AMD proprietary, Qwen3.5/3.6-35B-A3B MoE:
  tg32 42.4→36.1 (-15%), MTP 55.8→25.8 t/s, pp flat. Both commits fall *inside* our new build but
  after our old build (`84e76d8a2` verified: ancestor of 61c909481, not of e8065c7cf). The author
  blames #27952, but that path is RDNA-gated (`ggml-vulkan.cpp:1878-1879`); maintainer `0cc4m`
  answers that the Windows 32 KiB shared-memory limit forces a smaller tile and he has no Windows
  box to tune. **Open, no fix.** Closest published analog to our case (Windows, discrete GPU, MoE,
  decode down / dense fine).
- **PR #29182 (tile selection) comment thread** — `SG-Amadeus` 2026-09-25: RTX 5070 Ti,
  Qwen3-16B-A3B pp128 **+14.6%, decode flat**; `Clarck1` 2026-10-01: RX 6900 XT pp512 **-10.6%**,
  tg unchanged, and posts a device-specific fix diff (not merged as of 2026-10-01). So #29182 is
  documented *good* on discrete NVIDIA and *bad* on discrete AMD.
- **#29513 (open, 2026-09-27)** — hybrid GDN models (Qwen3.5-4B): first request after load is
  extremely slow on both CUDA and Vulkan (Vulkan 1st: 6.4/15.4 t/s vs 3rd+: 84/47). GDN-layer
  warmup question, not a steady-state decode regression, but it shows GDN layers carry
  one-time/graph-init costs worth ruling out (send one warm-up request before timing).
- **#28752 (open)** prompt-processing drop after b10780 on RDNA3 — pre-dates our old build.
- No issue found reporting Ling/bailing (bailingmoe3) Vulkan decode performance, and **no issue
  yet on #29476 (GDN tune)** (merged 2026-09-26, no reports).
- **Fix landed after b11304? No.** GitHub API
  `repos/ggml-org/llama.cpp/commits?path=ggml/src/ggml-vulkan&since=2026-09-29` → newest is
  `90c908d06` (already inside b11304). Locally `git log 81ff93ea1..upstream/master -- ggml/src/ggml-vulkan`
  is empty. Open Vulkan PRs created after 2026-09-30: **#29794** (pipeline-compile logging) and
  **#29791** (fp8/scaled matmul) — neither is a perf fix. No PR/commit re-tunes the GDN kernel
  or reverts #29182/#29280/#28956 yet.

## 4. Cheapest bisect plan (Windows/Vulkan box)

Cheapest first — each step only splits, never narrows blindly:

- **B1 — split ours vs upstream:** build `5de9fa2fc` (our main immediately before the b11304
  merge; same fork, no upstream content). Fast ⇒ culprit ∈ upstream b11304 content; slow ⇒ look
  at our governor/platform merge instead and stop bisecting Vulkan.
- **B2 — confirm:** build `61c909481` (or reuse the v1.1.4 binary) and re-run interleaved with B1
  (lock clocks; project rule: never benchmark while charging). Expect ~99 vs ~64.
- **B3 — isolate the Vulkan directory in one build:** on a scratch worktree of `61c909481` run
  `git checkout 5de9fa2fc -- ggml/src/ggml-vulkan` and build (host code + shaders revert together;
  the two-line `ggml.c` upstream change stays, harmless). Fast ⇒ culprit ∈ ggml-vulkan ⇒ go to B4.
  Slow ⇒ culprit is model/graph side (then: `git checkout 5de9fa2fc -- src/models/bailingmoe3.cpp src/llama-model.cpp`,
  i.e. test `f830688e9`).
- **B4 — GDN tune alone:** `git revert -n 5c200e0c8` on `61c909481`, build. Fast ⇒ suspect #1
  confirmed (no upstream fix exists yet → carry the revert).
- **B5 — (if B4 fast) KV-stride + descriptor reuse:** `git revert -n 526247161 0bc845d35`, build;
  if still slow, `git revert -n 94a0ae3e7 5c53396b8 7490357f2` (prompt-side cluster) and
  `git revert -n 83dd71f86`.

Runtime toggles — no rebuild (all read sites quoted from `61c909481`):

| Env var | Read at | What it tests |
|---|---|---|
| `GGML_VK_PERF_LOGGER` (+ `GGML_VK_PERF_LOGGER_FREQUENCY`) | `ggml-vulkan.cpp:5244`, `:5252` | per-op ms — attribute the -35% *first*: compare `gated_delta_net` vs `mul_mat_vec_id` vs attention between builds |
| `GGML_VK_PIPELINE_STATS` | `ggml-vulkan.cpp:5248` | which matmul pipeline each op picked |
| `GGML_VK_DISABLE_DESCRIPTOR_REUSE` | `ggml-vulkan.cpp:4899`, consumed `ggml-vulkan-common.h:280` | suspect #3 (#29280) |
| `GGML_VK_DISABLE_FUSION` | `ggml-vulkan.cpp:4897` (`add_rms_fusion` `:4901`) | all Vulkan fusions incl. new #29520 chain |
| `GGML_VK_DISABLE_MMVQ` / `GGML_VK_FORCE_MMVQ` | `ggml-vulkan.cpp:4908` / `:4910` (heuristic `:6543`) | MMVQ vs DMMV vec-matvec path (MoE expert + KV matvec) |
| `GGML_VK_DISABLE_COOPMAT` / `GGML_VK_DISABLE_COOPMAT2` / `GGML_VK_DISABLE_COOPMAT2_DECODE_VECTOR` | `ggml-vulkan.cpp:4060` / `:4068` / `:4072` (re-read `:4954/:4959/:4963`) | coopmat matrix path, coopmat2, decode-vector path |
| `GGML_VK_DISABLE_ASYNC` / `GGML_VK_SERIALIZE_SUBMISSIONS` | `ggml-vulkan.cpp:4184` / `:4895` | host↔device sync behaviour (diagnostic) |
| `GGML_VK_MAX_NODES_PER_SUBMIT` | `ggml-vulkan.cpp:4263` | graph splitting per submit |
| `GGML_VK_DISABLE_GRAPH_OPTIMIZE` / `GGML_VK_DISABLE_F16` | `ggml-vulkan.cpp:4022` / `:4269` and `:4991` | graph optimize / f16 pipelines |
| `GGML_VK_FA_SPARSE_DISABLE` | `ggml-vulkan.cpp:8136` | sparse FA path |
| `GGML_OP_OFFLOAD_MIN_BATCH` | `ggml-vulkan.cpp:16111` (default 32) | op offload-to-CPU threshold |

Not runtime-toggleable (rebuild required): GDN lane config (`ggml-vulkan.cpp:3681-3683`),
mul_mat_id tile selection (`:7420-7424`), count_experts shared size
(`vulkan-shaders/count_experts.comp:36-40`), argsort selection (`:11208`),
mul_mat_vec f32 loads (`vulkan-shaders/mul_mat_vec.comp:145-149`).

## 5. Before spending any build time

1. Re-run the pair interleaved, ≥3 reps, clocks pinned — the -35% is a single pair and the GPU
   may have throttled (project rule: never benchmark while charging).
2. Read `GGML_VK_PERF_LOGGER` output from *both* binaries: if the extra time is not in
   `gated_delta_net`, drop suspect #1 without building anything.
3. Confirm on the GGUF: `kda_head_dim` (=128? gates suspect #1), absence of
   `rope_dimension_sections` (gates the `f830688e9` rope change), absence of precision-policy
   metadata (gates `e9f824d8c`).
4. Confirm the run's governor stats show `decode_engine = GPU` (§2).
