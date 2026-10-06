# Hostile audit: OpenCL fusion and F32-only HOST-W fallback

**Target:** `kalsallama-gov-onecopy`, branch `feat/governor-onecopy`; commits `0ca7e1890` and `9eb7c54c7` (`9eb7c54c7` parent `0ca7e1890`, whose parent is `b7bd8bb13`).

**Scope:** Read-only source audit. I did not edit project files, build, run tests, touch adb, or launch device work. The only write was this report. Quotes below are from the checked-out target tree at these commits.

## Findings

### 1. The F32-only catch-all still captures F32 weights that the OpenCL HOST leg cannot read

**Verdict: CONFIRMED · Severity: P2**  
**Locations:** `src/llama-model-loader.cpp:1084-1089, 1233-1245, 1284-1286`; `ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp:122-168`; `src/llama-model.cpp:1718-1722`.

> `if (shared_host_f32_only && tensor->type != GGML_TYPE_F32 &&`
> `    ggml_backend_buft_is_host(cur_buft) && ggml_backend_buft_get_device(cur_buft) != nullptr &&`
> `    cur_dev != ggml_backend_buft_get_device(cur_buft)) {`

The rule selects by dtype only. `LLM_TENSOR_LAYER_OUTPUT` uses the same restricted layer/output list as repeating layers, so a non-tied F32 `output.weight` is eligible for the CPU-paired HOST-W catch-all. If the device candidates refuse it (for example, the configured Hexagon op filter rejects every candidate), the CPU probe accepts it and it is stored in HOST-W.

The OpenCL HOST leg does not admit that output matmul:

> `if (w->type != GGML_TYPE_Q6_K || w->ne[2] != 1 || w->ne[3] != 1) {`

Its other admitted weight forms are F32 `MUL` and `SSM_CONV`, not F32 `MUL_MAT`. It will leave the F32 output matrix to CPU execution, while that matrix still consumes space in the importable HOST-W buffers. A large F32 output matrix can therefore recreate the import-cap/chunk pressure this commit says the type gate removes. The same gap applies to other F32 layer/output weights whose loader op is outside the HOST leg's three admitted forms.

The placement test checks `output_norm.weight`, but its fixture does not create a non-tied `output.weight`; it therefore misses this case. A role/op predicate (or an explicit list of eligible tensor ops) is needed if the catch-all is intended to hold only weights the GPU leg reads in place.

### 2. Ordinary per-op dispatch has no equivalent HOST-W destination guard

**Verdict: PLAUSIBLE · Severity: P2**  
**Locations:** `ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp:50-52, 182-195`; `ggml/src/ggml-opencl/ggml-opencl.cpp:10135-10410, 16175-16196`.

> `return host_tensor(t) && !ggml_opencl_host_weights_tensor(t);`

> `ggml_opencl_reject_foreign_host(dst);`
> `ggml_tensor_extra_cl * extrad = (ggml_tensor_extra_cl *)dst->extra;`

The new fusion predicate checks every fused node's buffer and refuses any host destination. The ordinary per-op support path scans host *sources* via `ggml_opencl_host_leg_weight`; it does not reject `op->buffer` as a host buffer. In `ggml_cl_mul`, the compute-time check rejects only a *foreign* host tensor. A correctly tagged HOST-W tensor is not foreign, so a prebound HOST-W destination passes that check and is then cast as an OpenCL extra. The regular F32 `MUL` support switch can accept the operation because its source types are valid.

The same fail-closed gap exists for unsupported HOST-W source positions if a graph is forced directly into compute: ordinary support admission rejects those positions, but not every compute branch independently rejects HOST-W before its generic casts. Normal model loading uses HOST-W for read-only weight tensors, so a HOST-W destination is not the expected inference path; a custom/prebound graph or forced placement can still reach this invalid `cl_mem` cast. The fusion fix does not cover that per-op case.

### 3. The owner-pair test is a convention, not a sound HOST-W identity

**Verdict: PLAUSIBLE · Severity: P3**  
**Locations:** `src/llama-model-loader.cpp:1084-1087`; `src/llama-model.cpp:1093-1145, 1156-1191, 1201-1208, 1215-1259, 1708-1722`; `src/llama-model-loader.cpp:1256-1285`.

> `cur_dev != ggml_backend_buft_get_device(cur_buft)) {`

The intended layer/output lists currently make the appended catch-all the deliberate mismatch: `(cpu_dev, weight_host_buft)`. The other entries created by these helpers are normally paired with their owner: GPU split/extra/default bufts with that GPU; ACCEL bufts with their ACCEL device; the first device HOST buft with that device; CPU extras with CPU; and the plain CPU buft with CPU (its buft owner may be null, which the condition excludes). The appended CPU fallback list keeps those pairings. In multi-device mode, the one resolved `weight_host_buft` is appended to every GPU list with the CPU pair.

The input list also deliberately has `(cpu_dev, weight_host_buft)`, but `LLM_TENSOR_LAYER_INPUT` sets `shared_host_f32_only = false`, so the exemption works. A CPU `-ot` override probes `cpu_buft_list`, which does not contain the appended layer catch-all; its normal entries keep their owner pairings. A non-CPU `-ot` override assigns `overrides->buft` directly and bypasses this gate. Metal/CUDA device host bufts normally pair with their own device and do not match; any backend/plugin list that pairs a host buft under a different device would match, even if it is not `weight_host_buft`. Because the flag is passed for layer/output selection even when no shared provider exists, such a cross-paired entry could also change a two-copy load.

Conversely, a resolved shared buft with a null owner or an owner equal to `cpu_dev` would not match the predicate. The resolver currently does not validate that its returned extra buft has a non-CPU owner. Thus the pair shape can both catch unrelated cross-owned host bufts and miss the actual shared buft on a backend with different ownership metadata. Passing the resolved `weight_host_buft` (and checking that exact pointer) into selection is simpler and safer. On the current Hexagon list shape, I found no ordinary CPU, ACCEL, OpenCL, or device-owned host entry that collides with the deliberate pair; this is a portability/identity weakness, not a demonstrated collision in this checkout.

### 4. The placement test's “F16 stays on CPU” result is specific to its mock, not Hexagon's advertised support

**Verdict: PLAUSIBLE · Severity: P2**  
**Locations:** `tests/test-tile32-shared-weight-placement.cpp:190-214, 363-372`; `src/llama-model.cpp:1242-1251`; `ggml/src/ggml-hexagon/ggml-hexagon.cpp:5998-6036, 8152-8159`.

> `return w && w->buffer && w->view_src == nullptr && w->type == GGML_TYPE_Q4_0 && w->ne[0] % 32 == 0 &&`
> `    ggml_backend_buft_weight_layout(w->buffer->buft) == GGML_WEIGHT_LAYOUT_Q4_0_TILE32;`

The mock rejects every operation over HOST-W, while the real Hexagon device advertises both its own HOST-W buft and F16 `MUL_MAT` support for shapes that pass its precompute checks. The new filter only skips a host candidate when the paired device differs from the buft owner. Hexagon's own HOST-W extra is paired with Hexagon, so it is tested before the CPU-paired catch-all and is not filtered. A supported F16 matrix can therefore be accepted into that same-owner HOST-W entry instead of reaching the catch-all and falling back to CPU. The test's unconditional expectation that `ffn_gate` lands in the plain CPU buffer does not model that real candidate ordering/support combination. Q6_K likewise has a same-owner device candidate and can be accepted for supported shapes.

This does not invalidate the narrower guarantee that the *CPU-paired catch-all* skips non-F32 types. It does invalidate the broader test/comment claim that non-F32 weights generally stay out of HOST-W, and it leaves the test unable to prove the actual Hexagon placement result. A realistic backend support fixture or a test specifically asserting the cross-paired catch-all decision would make that boundary clear.

### 5. The fusion test exercises the real predicate, but not its callers or the patched launches

**Verdict: CONFIRMED · Severity: P3**  
**Locations:** `tests/CMakeLists.txt:492-495`; `tests/test-tile32-fuse-operands.cpp:1-13, 100-149`; `ggml/src/ggml-opencl/ggml-opencl.cpp:8882-9062, 9291-9390`.

> `llama_build_and_test(test-tile32-fuse-operands.cpp ${PROJECT_SOURCE_DIR}/ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp)`

This compiles and calls the actual `ggml_opencl_fuse_operands_ok` implementation, so the predicate itself is not reimplemented. The placement test also goes through the actual loader selection and reads the actual model tensor map; its mock replaces device behavior, not `select_weight_buft`.

The fusion test does not link or call `ggml-opencl.cpp`'s `ggml_opencl_can_fuse` functions, graph-compute fusion loop, `ggml_opencl_fused_src`, or any kernel launch. It uses one RMS_NORM+MUL graph and checks a final host dst; it cannot detect a missing guard at another fusion entry point, an intermediate-only host buffer, a bad substitution offset, or a kernel argument-order error. The source audit found each current fusion caller guarded, and the patched norm launches keep the kernel's existing source order. The mutation claim for placement is plausible from the mock: without the new condition, four normal-mode Q6_K/F16 assertions plus six opfilter Q4_0/Q6_K/F16 assertions change. I did not execute the mutation. Neither test sets or unsets environment variables; the placement test resets its process-local refusal flag on every `load_model` call, so there is no env save/restore defect.

## Cross-checks

- **Fusion guard reachability:** all graph-compute fusion arms are covered: the four norm-family arms end in `ggml_opencl_can_fuse`; the special Q4_K MM+GLU arm has its own check; MoE combine, bias+GLU, and bias+combine each check their whole fused range. Bias+combine also delegates to the guarded combine tail. No unguarded fused dispatch was found.
- **HOST-W source paths:** the OpenCL HOST leg admits only F32 `MUL` with the weight in `src1`, F32 `SSM_CONV` with the weight in `src1`, and flat Q6_K `MUL_MAT` with the weight in `src0`. `GET_ROWS`, `SET_ROWS`, `CPY`, `CONCAT`, `MUL_MAT_ID`, and other source slots are refused by the host-leg admission before normal scheduler dispatch. The Q6_K AoS route substitutes `src0` before the generic SoA cast and adds no `view_offs` to the imported address. The ordinary native operands retain `extra->offset + view_offs`.
- **Fusion offsets/arguments:** `ggml_opencl_host_view` returns `w->data - imported_base`; the HOST weight must be plain for the admitted op and the import offset already includes its view position. `ggml_opencl_fused_src` returns that offset unchanged for substituted host operands and `extra->offset + view_offs` for native operands. The RMS_NORM+MUL, RMS_NORM+MUL+ADD, NORM+MUL+ADD, and GROUP_NORM+MUL+ADD launch argument order matches their kernel signatures.
- **Input/output and override roles:** a legal-width Q6_K `token_embd` remains eligible for HOST-W through the input list's explicit exemption; GET_ROWS itself stays on CPU, while a tied output duplicate can reuse that host tensor for the Q6_K matvec. `output_norm` uses the restricted output list and reaches the F32 catch-all as intended. A non-tied output weight uses that same output list; see finding 1 for the untested F32 matmul case. Direct non-CPU overrides bypass selection by design; CPU overrides use the CPU list rather than the appended layer catch-all.
- **Removed behavior:** compared with `b7bd8bb13`, `9eb7c54c7` intentionally removes the CPU-paired HOST-W fallback for non-F32 tensors the device candidates refuse; selection continues through the prior CPU fallback list. It does not alter two-copy placement for the current list builders because those lists contain no cross-owned host pair when no shared catch-all is appended. Compared with `6106d4997`, the layer/output HOST-W fallback itself was introduced by `b7bd8bb13`; `0ca7e1890` fixes the fused norm corruption in that new path. The `0ca7e1890` checks also intentionally decline fusions containing host operands/dsts the fused kernel cannot substitute, leaving per-op execution.
- **Comments/reuse/dead code:** `select_weight_buft`'s “f32-only” comment overstates what the dtype check guarantees: it is not an op/role filter, and it only applies to a cross-paired entry. The owner-pair identity comment is also too strong (finding 3). `ggml_opencl_fused_src` and the `substitutes` flag are used by the current norm fusion arms; no dead code from either commit was found. The two test files have distinct responsibilities and are registered in the existing Tile32 test block.

## One-line findings summary

- **P2 · CONFIRMED:** F32-only placement still sends unsupported F32 output/layer matmuls through HOST-W when device candidates refuse them.
- **P2 · PLAUSIBLE:** Per-op compute can cast a HOST-W destination as `cl_mem` because only fused gates reject all host dsts.
- **P3 · PLAUSIBLE:** Owner-pair shape is not a stable buft identity; it can match unrelated cross-owned host entries or miss a shared buft with null/same-owner metadata.
- **P2 · PLAUSIBLE:** The mock's F16/Q6_K CPU expectations do not model Hexagon's same-owner HOST-W candidate and support rules.
- **P3 · CONFIRMED:** The fusion test covers the real predicate but not can-fuse callers, substitutions, offsets, or kernel launches.
