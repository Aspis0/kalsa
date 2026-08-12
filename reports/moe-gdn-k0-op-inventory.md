# K0 — Op inventory for GDN/hybrid GPU kernels (llama.cpp fork source audit)

Audited checkout: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge\third_party\llama.cpp`
(branch `kalsa/mmap-prefetch-opt`, HEAD `e5605f3bd`, upstream pin `5236140e5` + 3 fork commits).
All paths below are relative to that checkout unless stated otherwise. Parent repo:
`C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge` (engine in `core/`, docs in `docs/`).

---

## Q1 — Graph ops of the hybrid models

Architecture code: `src/models/qwen35moe.cpp` (MoE variant, 741 lines), `src/models/qwen35.cpp`
(dense variant). Both inherit the GDN core from `src/models/delta-net-base.cpp`
(`llm_build_delta_net_base`, delta-net-base.cpp:13) and the generic builders from
`src/llama-graph.cpp` (`llm_graph_context`). Layer classification:
`hparams.is_recr_impl[]` from GGUF key `attention.recurrent_layers`, else every 4th layer is full
attention (`(i+1) % full_attn_interval != 0`, full_attn_interval=4; qwen35moe.cpp:30-39, qwen35.cpp:21-25).

### (a) GDN / linear-attention layer (`build_layer_attn_linear`, qwen35moe.cpp:229-345; same helper shared from qwen35.cpp:338)

Emitted ops (graph order; decode: n_seq_tokens=1):

| op (GGML_OP_*) | emit site |
|---|---|
| `MUL_MAT` (wqkv → qkv_mixed, [2·key_dim+value_dim]) | qwen35moe.cpp:177 (`build_qkvz` 174-194) |
| `RESHAPE` (3D) qkv_mixed | qwen35moe.cpp:178 |
| `MUL_MAT` (wqkv_gate → z, [value_dim]) | qwen35moe.cpp:183 |
| `MUL_MAT` (ssm_beta), `RESHAPE` 4D, `SIGMOID` (beta) | qwen35moe.cpp:246-250 |
| `MUL_MAT` (ssm_alpha), `RESHAPE` 3D, `ADD` (+ssm_dt bias), `SOFTPLUS` (α) | qwen35moe.cpp:253-258 |
| `MUL` (softplus(α) × ssm_a → gate), `RESHAPE` 4D | qwen35moe.cpp:260-264 |
| `TRANSPOSE` qkv_mixed, `CONCAT` (conv state + token), `CPY` (conv-state writeback) | delta-net-base.cpp:269-400 (`build_conv_state`); qwen35moe.cpp:272-275 |
| `SSM_CONV` (conv1d over qkv) | qwen35moe.cpp:280 |
| `SILU` (conv output) | qwen35moe.cpp:282 |
| `VIEW` 4D ×3 (split q/k/v from conv output) | qwen35moe.cpp:292-315 |
| `L2_NORM` (q_conv, k_conv) | qwen35moe.cpp:318-319 |
| `REPEAT` 4D (only if n_v_heads ≠ n_k_heads and fused off) | qwen35moe.cpp:327-333 |
| GDN core (see below) | delta-net-base.cpp:227-267 (`build_delta_net`) |
| `RMS_NORM` (ssm_norm), `SILU` (z gate), `MUL` (gated norm) | qwen35moe.cpp:196-203 (`build_norm_gated`) |
| `RESHAPE` 3D, `MUL_MAT` (ssm_out), `RESHAPE` 2D | qwen35moe.cpp:341-345 |

GDN core dispatch (`build_delta_net`, delta-net-base.cpp:227-241):
- decode, fused on: **`GATED_DELTA_NET` (K=1)** — `build_delta_net_fused`, delta-net-base.cpp:219-252 (`ggml_gated_delta_net` at 230; op enum `GGML_OP_GATED_DELTA_NET`, ggml/include/ggml.h:572).
- decode, fused off: composite autoregressive path (`build_delta_net_autoregressive`, delta-net-base.cpp:143-218): `SCALE`, `PERMUTE`, `RESHAPE` 4D, `EXP`, `MUL` (s·g), `MUL` (s·k), `SUM_ROWS`, `SUB` (v−skᵀ), `MUL` (d·b), `TRANSPOSE`, `REPEAT` (k→s), `MUL` (k·dᵀ), `ADD` (s+kd), `MUL` (s·q), `SUM_ROWS`, `PERMUTE`.
- prefill (n_seq_tokens>1), fused off: composite chunked path (`build_delta_net_chunking`, delta-net-base.cpp:76-141): `SCALE`, `PERMUTE`, `PAD`, `MUL`, `RESHAPE` 4D, `TRANSPOSE`/`CONT`, `CUMSUM` (g_cs), `SUB`, `TRI` (decay mask), `EXP`, `REPEAT` 4D, `MUL_MAT` (kb/kq), `FILL` (identity diag), `DIAG`, `ADD`, `NEG`, **`SOLVE_TRI`** (triangular solve, delta-net-base.cpp:119), `SET` (`ggml_set_inplace` per chunk, delta-net-base.cpp:132-134; impl ggml.c:3452), `VIEW` 4D/2D, `SUM_ROWS`, `MUL_MAT` (v·attn, kg·s, s·qg, kgv).
- prefill/rollback, fused on: **`GATED_DELTA_NET` (K = n_rs_seq+1)** — `build_recurrent_attn` rollback branch, delta-net-base.cpp:523-571 (op at 538).

### (b) Full-attention layer (`build_layer_attn`, qwen35moe.cpp:205-268; MTP block same shape, qwen35moe.cpp:397-580)

| op | emit site |
|---|---|
| `MUL_MAT` (wq, [2·n_embd_head·n_head] joint QG), `VIEW` 3D, `RMS_NORM` (q_norm) | qwen35moe.cpp:213-222 |
| `MUL_MAT` (wk), `MUL_MAT` (wv), `RESHAPE` 3D, `RMS_NORM` (k_norm) | qwen35moe.cpp:224-235 |
| `VIEW` 3D + `CONT` 2D (gate) | qwen35moe.cpp:236-240 |
| `ROPE` (`ggml_rope_multi`, IM-RoPE; enum `GGML_OP_ROPE`, ggml.h:534; IMROPE ggml.h:254) on Q and K | qwen35moe.cpp:242-256 |
| attention: `build_attn` (llama-graph.cpp:2544) → `build_attn_mha` (llama-graph.cpp:2384): **flash**: `FLASH_ATTN_EXT` (llama-graph.cpp:2424); **non-flash**: `MUL_MAT` (k·q), `SOFT_MAX` (ext), `MUL_MAT` (v·kq) | llama-graph.cpp:2424 / 2466-2493 |
| `SIGMOID` (gate), `MUL` (gated attn), `MUL_MAT` (wo) | qwen35moe.cpp:256-266 |
| MTP extras: `GET_ROWS` (embd), `RMS_NORM` ×2, `CONCAT` (dim 0), `MUL_MAT` (eh_proj) | qwen35moe.cpp:441-464 |

### (c) MoE FFN (`build_moe_ffn`, llama-graph.cpp:1755-2143; called from qwen35moe.cpp:351-371)

| op | emit site |
|---|---|
| `MUL_MAT` (gate_inp → logits, [n_expert]) | llama-graph.cpp:1831 |
| `SOFT_MAX` (probs) | llama-graph.cpp:1848 |
| `ARGSORT` (top-k experts; `ggml_argsort_top_k` → GGML_OP_ARGSORT) | llama-graph.cpp:1915 |
| `GET_ROWS` (weights from probs) | llama-graph.cpp:1936 |
| `RESHAPE` 3D (cur → [n_embd,1,n_tokens]) | llama-graph.cpp:1971 |
| **`MUL_MAT_ID`** (fused gate+up: `build_lora_mm_id` → ggml_mul_mat_id, llama-graph.cpp:1413-1443, emit at 1977) | llama-graph.cpp:1977 |
| `VIEW` 3D ×2 (gate/up split) | llama-graph.cpp:1989-1994 |
| `GLU` (`ggml_swiglu_split`, op GGML_OP_GLU) | llama-graph.cpp:2027 (LLM_FFN_SILU with gate) |
| **`MUL_MAT_ID`** (down_exps) | llama-graph.cpp:2098 |
| `MUL` (× weights), `VIEW` 2D per expert, `ADD` (aggregate) | llama-graph.cpp:2101-2143 |
| shared expert (`build_ffn`, llama-graph.cpp:1564-1754; called qwen35moe.cpp:374-380): `MUL_MAT` up, `MUL_MAT` gate (PAR), `GLU` (swiglu_split), `MUL_MAT` down, `MUL`/`ADD`; shared gate: `MUL_MAT` (ffn_gate_inp_shexp) + `SIGMOID` + `MUL` | qwen35moe.cpp:374-392 |

### (d) Dense FFN (qwen35 2B/4B, `build_ffn`, qwen35.cpp:476, 613; LLM_FFN_SILU + LLM_FFN_PAR)

`MUL_MAT` up (llama-graph.cpp:1587), `MUL_MAT` gate PAR (1603), `GLU` swiglu_split (1640), `MUL` (1642), `MUL_MAT` down (1732). Same as the shared-expert FFN above.

**Full op vocabulary (union):** MUL_MAT, MUL_MAT_ID, GET_ROWS, SET, CPY, CONT, RESHAPE, VIEW, PERMUTE, TRANSPOSE, REPEAT, CONCAT, PAD, DIAG, FILL, TRI, ARGSORT, SOFT_MAX, CUMSUM, SUM_ROWS, SOLVE_TRI, L2_NORM, RMS_NORM, NORM, SCALE, ADD, SUB, MUL, DIV, CLAMP, ROPE, FLASH_ATTN_EXT, SSM_CONV, GATED_DELTA_NET, GLU, UNARY{SILU,SIGMOID,SOFTPLUS,EXP,NEG,RELU,CLAMP}, (MTP) CONCAT/GET_ROWS.

---

## Q2 — Recurrent state handling (hybrid KV/state memory)

- **Allocation.** Per layer, two tensors in the recurrent memory (llama-memory-recurrent.cpp:99-105):
  `cache_r_l%d` = conv states `[n_embd_r, mem_size·(1+n_rs_seq)]`, `cache_s_l%d` = SSM states
  `[n_embd_s, mem_size·(1+n_rs_seq)]`, both **F32** (llama-model.cpp:2123-2124; hybrid ctor 2133-2145).
  `n_embd_r = (ssm_d_conv−1)·(ssm_d_inner + 2·ssm_n_group·ssm_d_state)` (llama-hparams.cpp:196-199);
  `n_embd_s = ssm_d_state · ssm_d_inner` (llama-hparams.cpp:219).
  Buffers are placed on the layer's device when offloaded: `buft = ggml_backend_dev_buffer_type(model.dev_layer(i))` (llama-memory-recurrent.cpp:84-96). **→ with n_gpu_layers on OpenCL, the states live in OpenCL device buffers.**
- **Read per token.** `build_rs` (llama-graph.cpp:3103-3138): zero one slot (`SCALE` inplace ×0, 3119-3120), `GET_ROWS` per sequence (state copy main), `CPY` for extra sequences (3126-3133). Returns a contiguous slice.
- **In-place / writeback ops** (these decide GPU↔CPU sync):
  - conv state writeback: `ggml_cpy(conv_state_last, conv_state_update)` into `cache_r` (delta-net-base.cpp:352-354 single-seq; 388-390 rollback `n_rs_seq>0` loop).
  - SSM state writeback: `ggml_cpy(new_state, view_2d(cache_s, …))` (delta-net-base.cpp:484-487); rollback variant writes K snapshot views via `ggml_cpy(src, dst)` (delta-net-base.cpp:552-571).
  - chunked prefill: `ggml_set_inplace` per chunk into a scratch `v` (delta-net-base.cpp:132-134; op GGML_OP_SET).
  - fused GDN op: reads `state` and packs output + K state snapshots into one result tensor (ggml.h:2555-2571 doc comment); snapshots are then `CPY`'d into `cache_s` (delta-net-base.cpp:552-571).
- **Host-set graph inputs per token:** `s_copy`/`s_copy_extra` I32 index vectors (llama-graph.cpp:3139-3161), K/V cache idxs + masks + positions for the attention part (`build_attn_inp_kv_impl`, referenced from `build_inp_mem_hybrid`, llama-graph.cpp:3240-3251). These are set via `llama_graph_input::apply` each token.
- **Sync implication:** state mutation is *not* in-place on the cache; every decode step emits `CPY` ops that rewrite `cache_r`/`cache_s` slices. If the GDN compute ops ran on CPU while the states sit in OpenCL buffers, the scheduler would insert buffer copies of the *whole per-layer state slice* (conv `n_embd_r` + ssm `n_embd_s` F32 floats) CPU↔GPU **per token per layer** — the dominant sync cost. If GDN ops run on GPU (this fork supports them, see Q3), the only per-token host traffic is the small index/mask inputs.

---

## Q3 — OpenCL backend coverage in THIS fork

Backend file: `ggml/src/ggml-opencl/ggml-opencl.cpp` (22,851 lines; kernels in `ggml/src/ggml-opencl/kernels/`).
Supported-op table: `ggml_opencl_supports_op` at ggml-opencl.cpp:6480-6868 (registered at 10092-10094).
Adreno-specific kernels are compiled in by default: `GGML_OPENCL_USE_ADRENO_KERNELS` default ON
(ggml/CMakeLists.txt:266, ggml-opencl/CMakeLists.txt:20-23); MoE routing helper
`use_adreno_moe_kernels` ggml-opencl.cpp:6437-6441.

Per-op status for the Q1 vocabulary (all at ggml-opencl.cpp unless noted):

| op | OpenCL status | line |
|---|---|---|
| `MUL_MAT` | **SUPPORTED**: src0 F16/BF16 (any rhs); F32↔F32; Q1_0, Q4_0, Q8_0; Q4_1/Q5_0/Q5_1/MXFP4/IQ4_NL/**Q4_K/Q5_K/Q6_K** (contig src0+src1, F32 rhs) | 6664-6686 |
| `MUL_MAT_ID` | **PARTIAL**: Q4_0/Q8_0/MXFP4 general; **Q4_K/Q5_K/Q6_K/Q4_1/Q5_0/Q5_1 only if `GGML_OPENCL_USE_ADRENO_KERNELS` AND `use_adreno_moe_kernels()`** (tensor name contains "ffn"+"exps" or "as", ne01%32==0, contig; helper at 6437-6441) — else false | 6688-6717 |
| `GET_ROWS` | **SUPPORTED** F32/F16 (+Q4_0 non-SOA); **quantized embd tables other than Q4_0 → false** | 6492-6502 |
| `SET` (set_inplace) | SUPPORTED F32/I32 same-type | 6555-6559 |
| `CPY`/`DUP`/`CONT` | SUPPORTED F32↔F16, I32 | 6525-6554 |
| `RESHAPE`/`VIEW`/`PERMUTE`/`TRANSPOSE` | SUPPORTED | 6718-6721 |
| `REPEAT` | SUPPORTED F32→F32 | 6629-6630 |
| `CONCAT` | SUPPORTED F32 | 6658-6662 |
| `PAD` | SUPPORTED F32 (no circular) | 6631-6635 |
| `DIAG` | SUPPORTED | 6719-6720 |
| `FILL` | SUPPORTED F32 contig | 6618-6619 |
| `TRI` | SUPPORTED F32 contig | 6616-6617 |
| `ARGSORT` | SUPPORTED F32, cols (padded to 2^k) ≤ max workgroup size | 6747-6759 |
| `SOFT_MAX` | SUPPORTED | 6622-6624 |
| `CUMSUM` | SUPPORTED F32 contig | 6761-6763 |
| `SUM_ROWS` | SUPPORTED F32 contig | 6760 |
| `SOLVE_TRI` | SUPPORTED F32 contig (kernel `solve_tri.cl`) | 6743-6745 |
| `L2_NORM` | SUPPORTED contig rows (kernel `l2_norm.cl`) | 6627-6628 |
| `RMS_NORM` | SUPPORTED ne[0]%4==0, contig rows | 6625-6626 |
| `NORM` | SUPPORTED | 6623 |
| `SCALE` | SUPPORTED F32 contig | 6560-6561 |
| `ADD`/`SUB`/`MUL`/`DIV` | SUPPORTED F32/F16 same-type | 6562-6575 |
| `ADD_ID` | SUPPORTED F32 | 6576-6577 |
| `CLAMP` | SUPPORTED F32 | 6620-6621 |
| `ROPE` | SUPPORTED (mrope/IMRoPE only F32/F16) | 6723-6742 |
| `FLASH_ATTN_EXT` | **SUPPORTED** dk=dv ∈ {40,64,80,96,112,128,192,256,512} for f32/f16 KV; Q8_0/Q4_0 KV (dk,dv%32==0); **DK=512 decode declined** (CPU); f16 KV needs `f32_f16` kernel | 6765-6827 |
| `SSM_CONV` | **SUPPORTED** F32 (kernel `ssm_conv.cl`) | 6647-6648 |
| `GATED_DELTA_NET` | **SUPPORTED** F32→F32, **S_v ∈ {16,32,64,128}** (kernel `gated_delta_net.cl`; mirrors Vulkan) | 6649-6657 |
| `GLU` (swiglu_split) | SUPPORTED F32/F16 contig src0 (kernel `glu.cl`) | 6604-6615 |
| UNARY SILU/RELU/GELU* | SUPPORTED F32 contig | 6582-6603 |
| UNARY SIGMOID | SUPPORTED contig (any type) | 6604-6605 |
| UNARY SOFTPLUS | SUPPORTED F32/F16 | 6608-6609 |
| UNARY EXP / TANH / NEG / EXPM1 | SUPPORTED **F32 only** ("Adreno F16 exp overflow") | 6605-6608 |
| `MEAN` | SUPPORTED F32 | 6764 |

Kernels present for the GDN family: `gated_delta_net.cl`, `ssm_conv.cl`, `solve_tri.cl`, `cumsum.cl`,
`l2_norm.cl`, `softplus.cl`, `tri.cl`, `diag.cl`, `fill.cl`, plus Adreno MoE
`gemm_moe_q4_k/q5_k/q6_k_f32_ns.cl` + `gemv_moe_q4_k/q5_k/q6_k_f32_ns.cl` and flat variants
(kernels/ directory listing).

---

## Q4 — The gap list

**Main finding: on this fork, the GDN/linear-attention op set is already covered by the OpenCL
backend** (upstream added `OP_GATED_DELTA_NET` in 8ad8aef44, `SSM_CONV`, Adreno MoE q4_K/q5_K/q6_K
in b28a2f372/0f3cb3fc8). The genuine gaps for the Qwen3.5 family:

| # | op / condition | OpenCL status | CPU ref | decode-shape implication |
|---|---|---|---|---|
| G1 | `GATED_DELTA_NET` with **S_v ∉ {16,32,64,128}** or non-F32 | UNSUPPORTED → CPU fallback | `ggml_compute_forward_gated_delta_net_f32` ops.cpp:10824 (dispatch 10865); one_chunk ops.cpp:10670 | per-layer per-token state slice CPU↔GPU |
| G2 | `MUL_MAT_ID` Q4_K/Q5_K/Q6_K on **non-Adreno builds** (macro off) or name/shape heuristic fails (ne01%32≠0) | UNSUPPORTED → CPU fallback of the *whole MoE layer* | `ggml_compute_forward_mul_mat_id` (ggml-cpu.c:1545; one_chunk 1474; expert-ready hook in the expert loop at ggml-cpu.c:1666-1669) | expert weights stream per token |
| G3 | `MUL_MAT_ID` Q4_K with `use_adreno_moe_kernels` false (e.g. renamed tensors) | PARTIAL (Adreno only) | same as G2 | same as G2 |
| G4 | `GET_ROWS` on quantized embedding/output (Q4_K tok_embd) | UNSUPPORTED (only F32/F16/Q4_0) | `ggml_compute_forward_get_rows` ops.cpp:4954 (F32 path 4913) | embedding lookup per token |
| G5 | `FLASH_ATTN_EXT` with KV types outside F16/F32/Q4_0/Q8_0, or dk=512 decode | UNSUPPORTED → CPU (declined) | `ggml_compute_forward_flash_attn_ext` ops.cpp:9137 | full-attn layers (every 4th) |
| G6 | non-flash attn path when flash off: forced CPU `kqv` only if `!cparams.offload_kqv` (default **true**, llama-context.cpp:3448) | — (config) | build_attn_mha llama-graph.cpp:2509-2511 | N/A by default |
| G7 | `UNARY EXP` on F16 | UNSUPPORTED (F32 only) | `ggml_compute_forward_unary` (unary-ops.cpp) | GDN graphs emit EXP on F32 → OK |
| G8 | chunked prefill GDN (fused off): CUMSUM/TRI/FILL/DIAG/SOLVE_TRI/SET | all SUPPORTED F32 (Q3) | cumsum_f32 ops.cpp:1410 (dispatch 1440); tri ops.cpp:2328; fill ops.cpp:2272; diag ops.cpp:5239 (dispatch 5279); solve_tri_f32 ops.cpp:10599 (dispatch 10658) | prefill only |
| G9 | composite AR GDN (fused off): SCALE/PERMUTE/EXP/MUL/SUM_ROWS/SUB/TRANSPOSE/REPEAT/ADD | all SUPPORTED F32 | generic ops.cpp | decode only; slow but GPU-able |

**Decode shapes (batch=1, n_seqs=1, n_seq_tokens=1).** Derived from code (qwen35moe.cpp:229-345,
llama-hparams.cpp:196-219, llama-model.cpp:506-535). S_v = head_v_dim = `ssm_d_state`,
H_k = `ssm_n_group`, H_v = `ssm_dt_rank`; key_dim = ssm_d_state·ssm_n_group,
value_dim = ssm_d_state·ssm_dt_rank = ssm_d_inner; conv_channels = ssm_d_inner + 2·key_dim.

- qkv_mixed `[2·key_dim+value_dim, 1, 1]`; z `[value_dim, 1]`; beta `[1, H_v, 1, 1]`; alpha/gate `[1, H_v, 1, 1]`
- conv input `[ssm_d_conv, conv_channels, 1]`; conv output `[conv_channels, 1, 1]`
- q/k (post l2-norm) `[S_v, H_k, 1, 1]`; v `[S_v, H_v, 1, 1]`
- **state `[S_v, S_v, H_v, 1]`** = `[ssm_d_state, ssm_d_state, ssm_dt_rank, 1]` (qwen35moe.cpp:276-278)
- GDN output `[S_v, H_v, 1, 1]` + K state snapshots `[S_v·S_v·H_v]` each (ggml.h:2555-2571)
- attn proj: Q `[n_embd_head, n_head, 1]`; K/V `[n_embd_head, n_head_kv, 1]`; MoE: logits `[n_expert, 1]`, gate_up `[2·n_ff_exp, n_expert_used, 1]`, down `[n_embd, n_expert_used, 1]`

**Exact ssm_d_conv / ssm_d_inner / ssm_d_state / ssm_dt_rank / ssm_n_group values for the 2B/4B/35B
GGFs are NOT hardcoded in this checkout** — they are read from GGUF keys `ssm.conv_kernel`,
`ssm.inner_size`, `ssm.state_size`, `ssm.time_step_rank`, `ssm.group_count` (qwen35moe.cpp:14-25;
keys in src/llama-arch.cpp LLM_KV_SSM_*). Documented 35B facts (parent repo): `qwen35moe` 40 trunk
layers + 1 MTP block (`n_layer=40` → `LLM_TYPE_35B_A3B`, qwen35moe.cpp:41-47), 256 experts top-8
(docs/bench-data/2026-07-24-desktop-qwen36/findings.md:14, CHANGELOG.md:876-877), MTP at blk.40
(docs/mtp.md:106). The GGUF reader requires those SSM keys (`get_key` non-optional), so any valid
2B/4B/35B GGUF carries them; the concrete numbers must be read from the model file, not the source.
Kernel sizing must therefore be driven by S_v at runtime (S_v=16/32/64/128 already the OpenCL gate).

---

## Q5 — Backend scheduling (GPU↔CPU split)

Scheduler: `ggml_backend_sched` in `ggml/src/ggml-backend.cpp` (struct 774-835; API `ggml_backend_sched_split_graph` 1014-1388; compute 1404+; `supports_op` gate 623-625, 455-457).

- Backends are ordered by priority; **CPU is always the lowest-priority last backend** (comment ggml-backend.cpp:1063-1066).
- Assignment passes: P1 assigns nodes with pre-placed tensors (`ggml_backend_sched_set_tensor_backend` — e.g. llama-graph.cpp:2509-2511 forces kqv onto CPU when `!offload_kqv`); P2 expands GPU assignments up/down over *supported* neighbors, skipping ops the GPU can't run (ggml-backend.cpp:1059-1149); P3 assigns remaining nodes to the backend with most supported inputs, and upgrades nodes to higher-priority backends with compatible bufts (1154-1211); P4 assigns sources from dest/view (1213-1266); P5 splits the graph where backend changes (1268-1386).
- **Yes: single ops/layers can fall back to CPU** with the rest of the layer on GPU. Unsupported ops (e.g. GDN S_v∉{16,32,64,128}, MUL_MAT_ID non-Adreno) end up on CPU because P3's "most supported inputs" favours the backend where their inputs live, and inputs are forced to the CPU by the state/cache placement or the P4 "assign from dst" rule.
- **Boundary copies:** for each split, inputs whose source backend differs and whose buft is unsupported get `ggml_dup_tensor_layout` copies in the split's backend; `node->src[j]` is rewritten (ggml-backend.cpp:1335-1374); copies are executed by `ggml_backend_sched_compute` before each split. There is no async copy for OpenCL (`.cpy_tensor_async = NULL`, ggml-opencl.cpp:6871-6887) → every boundary crossing is a synchronous buffer copy + `synchronize`.
- **Per-token crossings for Qwen3.5 at decode:** with all GDN/attn ops GPU-supported, the only crossings are the small host-set inputs (`s_copy`, K/V idxs, masks, positions) — set once per token, ~KBs. If any per-layer op falls back (G1/G2), the crossing per token per layer becomes: conv state slice `n_embd_r` F32 floats + SSM state slice `n_embd_s` F32 floats GPU→CPU, and the rewritten state back CPU→GPU (both via the CPY writebacks of Q2), plus for G2 the expert weight rows streamed to CPU (which is exactly what the fork's expert-streaming hook assumes, see Q7). With n_layer≈40 and (e.g.) n_embd_s≈1-2M floats for a 35B-class model, that is tens of MB per token if GDN fell back — unacceptable; keeping GDN on GPU is the point of the fused op.

---

## Q6 — Quant formats on the mul_mat path

- Prior campaign models are Q4_K_M (`docs/bench-data/*/findings.md`, e.g. qwen35moe Qwen3.6-35B-A3B-**Q4_K_M** at docs/bench-data/2026-07-24-desktop-qwen36/findings.md:14, docs/mtp.md:123).
- OpenCL `MUL_MAT`: Q4_K/Q5_K/Q6_K **supported** (contiguous src0/src1, F32 rhs) — ggml-opencl.cpp:6690-6697.
- OpenCL `MUL_MAT_ID` (experts): Q4_K/Q5_K/Q6_K **supported only on Adreno builds** (macro ON by default, ggml/CMakeLists.txt:266) via `use_adreno_moe_kernels` (name "ffn…exps"/"as", ne01%32==0, contig) — ggml-opencl.cpp:6699-6721; kernels `gemm_moe_q4_k_f32_ns.cl` / `gemv_moe_q4_k_f32_ns.cl` (and q5_k/q6_k). Dense/attn projections (MUL_MAT, not _ID) run the `gemm_noshuffle_q{4,5,6}_k_f32.cl` + `gemv_noshuffle_q{4,5,6}_k_f32.cl` kernels.
- So for the Qwen3.5 family at Q4_K/Q5_K/Q6_K, the GPU path exists in this fork **on Adreno**; the heuristics and the ne01%32==0 constraint are the things to verify per tensor (all standard Qwen FFN dims satisfy %32).

---

## Q7 — Fork deltas (must not break)

Fork = upstream pin + exactly 3 commits (`git log HEAD ^master` → e5605f3bd, 206a8fe7f, 5236140e5;
local `master` label is a stale older upstream point, merge-base 90e0f5cfc — not fork work):

1. **5236140e5 "ggml-cpu: add expert-ready hook for mul_mat_id (expert streaming)"** —
   `ggml_cpu_set_expert_ready_hook` (ggml/include/ggml-cpu.h:147-151) invoked per expert inside the
   CPU `mul_mat_id` loop right before reading the expert rows (ggml/src/ggml-cpu/ggml-cpu.c:1666-1669).
   **Consumed by the parent engine**: `core/src/moe/expert_stream_source.cpp:1375`
   (`ggml_cpu_set_expert_ready_hook(&ExpertStreamSource::c_expert_ready, this)`), the mmap expert
   streaming engine (docs/moe-streaming.md). ⚠ **This hook fires only on the CPU path.** If the MoE
   `MUL_MAT_ID` runs on the OpenCL backend (Adreno MoE kernels, Q3/Q6), the hook never fires and the
   streaming engine's prefetch/blocking logic is bypassed — the engine must either be made aware of
   GPU expert execution or the GPU MoE path must be gated. This is the single most important
   integration constraint for the kernel work.
2. **206a8fe7f "mmap: add llama_model_params.mmap_prefetch"** — `mmap_prefetch` tri-state in
   `llama_model_params` (include/llama.h:333), consumed at llama-model.cpp:1506
   (`ml.init_mappings(params.mmap_prefetch >= 0, …)`); default 0 = auto (llama-model.cpp:2320).
3. **e5605f3bd "mmap: fix ABI compatibility of mmap_prefetch (tri-state int32_t)"** — same files,
   ABI fix.

No fork commit touches the graph build (`src/models/*`, `src/llama-graph.*`), the backend scheduler
(`ggml/src/ggml-backend.cpp`), or the OpenCL backend; `cache-mb`, `drop-cold`, router-hook and
`--overlap` live in the parent engine (`core/`, cli flags per docs/cache-sizing.md, docs/expert-dropping.md)
on top of the expert-ready hook — they do not modify llama.cpp graph code. The OpenCL Adreno work
(q4_K/q5_K/q6_K MoE, GDN, SSM_CONV) is **upstream**, already in the pin.

---

## Summary table: op → needed by → OpenCL status → CPU ref → decode shape

| op | needed by | OpenCL status (this fork) | CPU ref (ops.cpp unless noted) | decode shape (batch=1) |
|---|---|---|---|---|
| `MUL_MAT` | all layers (QKV, z, beta, alpha, ssm_out, FFN dense, gate_inp, wo, …) | SUPPORTED incl. Q4_K/Q5_K/Q6_K (ggml-opencl.cpp:6680-6698) | ggml_compute_forward_mul_mat (ggml-cpu.c:1265) | [M,1], M=embd/proj dims |
| `MUL_MAT_ID` | MoE experts (gate_up fused, down) | PARTIAL — Adreno-only for Q4_K/Q5_K/Q6_K (6699-6721) | ggml_compute_forward_mul_mat_id (ggml-cpu.c:1545; hook 1666) | [2·n_ff_exp / n_embd, n_expert_used, 1] |
| `GATED_DELTA_NET` | GDN layers decode+prefill (fused) | SUPPORTED F32, S_v∈{16,32,64,128} (6658-6667) | gated_delta_net_f32 10824; one_chunk 10670 (dispatch ggml-cpu.c:2076) | [S_v,H_v,1,1] + K·[S_v²·H_v] snapshots |
| `SSM_CONV` | GDN layers | SUPPORTED F32 (6657) | ssm_conv_f32 9492 (dispatch 9545) | [conv_channels,1,1] |
| `SOLVE_TRI` | GDN chunked prefill | SUPPORTED F32 (6745) | solve_tri_f32 10599 (10658) | [CS,CS,n_chunks,…] |
| `CUMSUM` | GDN chunked prefill | SUPPORTED F32 (6731) | cumsum_f32 1410 (1440) | [CS,…] |
| `TRI` | GDN chunked prefill | SUPPORTED F32 (6618) | tri 2328 | [CS,CS,…] |
| `FILL` / `DIAG` | GDN chunked prefill | SUPPORTED F32 (6619, 6726) | fill 2272 / diag 5239 | [CS,CS,…] |
| `L2_NORM` | GDN q/k heads | SUPPORTED contig (6626) | l2_norm_f32 4174 (4222) | [S_v,H_k,1,1] |
| `FLASH_ATTN_EXT` | full-attn layers (every 4th) + MTP | SUPPORTED dk≤256 (f32/f16 KV); dk=512 decode → CPU (6760-6827) | flash_attn_ext (ops.cpp:9137) | [dk,1,ctx_len,1] |
| `SOFT_MAX` | MoE probs, attn | SUPPORTED (6623) | soft_max (ops.cpp:5499) | [n_expert,1] |
| `ARGSORT` | MoE top-k | SUPPORTED F32 (6747) | argsort (ops.cpp:8319) | [n_expert_used,1] |
| `GET_ROWS` | token embd, MoE weights | SUPPORTED F32/F16/Q4_0 (6488-6502); quantized others → CPU | get_rows (ops.cpp:4954) | [n_embd,1] |
| `ROPE` (IM-RoPE multi) | full-attn + MTP | SUPPORTED F32/F16 (6727-6743) | rope (ops.cpp:6032) | [n_embd_head,n_head,1] |
| `GLU` (swiglu) | FFN gate/up | SUPPORTED F32/F16 (6614) | glu (ops.cpp:9916 unary/glu dispatch; ggml-cpu.c:2016+ GLU case) | [n_ff,1] |
| `RMS_NORM` | all norms | SUPPORTED ne0%4==0 (6624) | rms_norm (ops.cpp:3860) | [n_embd,1] |
| `UNARY` SILU/SIGMOID/SOFTPLUS/EXP | GDN + FFN + attn gates | SUPPORTED (EXP F32-only, 6598-6610) | unary (unary-ops.cpp) | elementwise |
| `CPY`/`SET`/`SCALE`/`REPEAT`/`CONCAT`/`PAD`/`VIEW`/`PERMUTE`/`TRANSPOSE`/`RESHAPE`/`ADD`/`SUB`/`MUL`/`SUM_ROWS` | graph glue + state writeback | SUPPORTED F32 (6523-6732) | ops.cpp / ggml-cpu.c | per Q2 |
| `CLAMP` | MoE weight norm | SUPPORTED F32 (6621) | clamp (ops.cpp:5697) | [1,1] |
| `DIV` | MoE weight norm | SUPPORTED F32 (6550) | div (binary-ops.cpp) | [n_expert_used,1] |

Bottom line: the kernel gap for the Qwen3.5 hybrid family on this fork is not the GDN core (already
OpenCL-backed) but (1) enforcing the Adreno MoE `MUL_MAT_ID` path + its heuristic gate, (2) covering
`S_v` values outside {16,32,64,128} (35B-class state dims — verify from GGUF), (3) `GET_ROWS` on
quantized embedding tables if used, and (4) wiring the fork's expert-ready hook semantics into
whatever GPU expert path replaces the CPU streaming path.

DONE
