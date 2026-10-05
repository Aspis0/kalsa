# Hostile audit — Amendment I (`git diff 8ccc5ffae..24fb5b8d6`, 4 commits)

Repo `~/Projects/kalsallama-gov-onecopy`, branch `feat/governor-onecopy`.
Spec: `FABLE-DESIGN.md` § "Amendment I". Evidence: `step4b-s23/raw/session1-8ccc5ffae-proof.grep`
(the -38) and `step4b-s23/raw/session2-24fb5b8d6.grep` (3 imports, HOST self-check PASS, KLD 0.000934).

**Headline: the fix works and the diagnosis is right, but it buys a P0-grade guarantee (the CPU
compute buft is never claimed) at the price of a set of new fail-*open* paths it did not close, plus
one silent numerics change to the TILE32 GPU kernel that is not in the spec and not in the
evidence. 9 P2, 6 P3, 1 P0, 1 P1. Nothing here contradicts the two S23 logs; the logs are
consistent with all of it.**

---

## Ranked findings

### P0-1 — The fail-closed guarantee has a documented escape hatch: `-ot <name>=HTP0-HOST`
**CONFIRMED (mechanism) / PLAUSIBLE (reachability). P0.**

`common/arg.cpp:262-276` and `tools/llama-bench/llama-bench.cpp:956-971` build the nameable-buffert
map from the device buft, the device host buft and the device extra bufts:

```
common/arg.cpp:262             auto * host_buft = ggml_backend_dev_host_buffer_type(dev);
common/arg.cpp:266             // the device extra buffer types (e.g. HTP0-TILE32) are nameable in -ot too, via the same
common/arg.cpp:274                 while (extra_bufts && *extra_bufts) {
common/arg.cpp:275                     buft_list[ggml_backend_buft_name(*extra_bufts)] = *extra_bufts;
```

So `HTP0-HOST` stays a legal `-ot` target, and `HTP0-HOST-W` is now a second one. The whole
Amendment-I invariant ("the CPU's compute and output buffer is never a weights buffer") is enforced
**only** by the automatic placement probe. An explicit override bypasses it with no check, no log
and no audit signal:

- `src/llama-model-loader.cpp:1250-1251` `buft = overrides->buft;` — a manual buft skips
  `select_weight_buft` entirely, hence skips the identity test.
- `src/llama-model.cpp:1596-1605` — the C1 audit lumps both host bufts into one `host_bytes`
  counter (`ggml_backend_buft_is_host(buft)`), so a weight that landed in `HTP0-HOST` is reported as
  a healthy `HOST N bytes` line. See P2-4.
- `ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp:23` then refuses the buft, so the GPU leg
  declines the lm_head **silently** (no `TILE32 leg disabled` line, no ERROR) and the one-copy
  guarantee is gone with a green log.

**Failure scenario.** Operator re-runs step 4b with `-ot token_embd.weight=HTP0-HOST` (a plausible
"put the embedding back where it was" edit while debugging). Model loads. `shared weights: TILE32
1369571328 HOST 229376000 CPU 1044480 bytes` prints exactly as in session 1 line 1009. The GPU leg
declines the lm_head at `supports_op`, the HOST self-check never runs for `token_embd.weight`, KLD
degrades to the two-copy number, and every pass/fail grep in `run-step4b-correct.sh` still passes
because `imports >= 3` is satisfied by the two TILE32 blocks plus… nothing — `host_imp >= 1` would
fail. One grep saves it *this time*. Nothing in the design does.

**Fix direction.** Reject `buft == ggml_backend_dev_host_buffer_type(buft_dev)` in the override
path, or at minimum log it by name and count `HTP0-HOST` bytes separately from `HTP0-HOST-W` in
the C1 audit so a misplaced weight is visible in the one line the RAM measurements read.

---

### P1-2 — `ggml_cl_mul_mat` and `ggml_cl_mul`/`ggml_cl_ssm_conv` now cast a *host backend* extra in the new fail-open case; the new aborts cover only the TILE32 leg and only the weight slot
**CONFIRMED (code path). P1.**

Pre-Amendment-I, `ggml_opencl_in_host_leg_buffer` matched `HTP0-HOST`, so a `src0` in the CPU
compute buft took the HOST branch and hit `GGML_ASSERT(src0->type == GGML_TYPE_Q6_K …)`. After the
identity narrowing it does **not**:

```
ggml/src/ggml-opencl/ggml-opencl.cpp:25582     if (ggml_opencl_in_host_leg_buffer(src0)) {
ggml/src/ggml-opencl/ggml-opencl.cpp:25583         GGML_ASSERT(src0->type == GGML_TYPE_Q6_K && src0->ne[2] == 1 && src0->ne[3] == 1);
```

```
ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp:23     if (dev && buft == ggml_backend_dev_host_buffer_type(dev)) {
ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp:24         return false;
```

A `MUL_MAT` whose `src0` sits in `HTP0-HOST` now falls past 25582 into the generic SoA dispatch,
which reads `src0->extra` as a `ggml_tensor_extra_cl *` — but the bytes are
`ggml_hexagon_tensor_extra`. That is a *worse* outcome than the old assert: silent garbage, not a
named abort. The same holds for the two other substitution sites, which have no host guard at all
on the non-weight slots:

```
ggml/src/ggml-opencl/ggml-opencl.cpp:16016     ggml_tensor_extra_cl * extra0 = (ggml_tensor_extra_cl *)src0->extra;
ggml/src/ggml-opencl/ggml-opencl.cpp:16017     ggml_tensor_extra_cl * extra1 = (ggml_tensor_extra_cl *)src1->extra;
ggml/src/ggml-opencl/ggml-opencl.cpp:16675     ggml_tensor_extra_cl * extra0 = (ggml_tensor_extra_cl *)src0->extra;
ggml/src/ggml-opencl/ggml-opencl.cpp:16676     ggml_tensor_extra_cl * extra1 = (ggml_tensor_extra_cl *)src1->extra;
```

and in the Q6_K branch, `src1`/`dst` are cast with no check at all while the commit added three
checks for the *TILE32* leg:

```
ggml/src/ggml-opencl/ggml-opencl-tile32-matvec.cpp:86      if (ggml_backend_buffer_get_usage(src0->buffer) != GGML_BACKEND_BUFFER_USAGE_WEIGHTS) {
ggml/src/ggml-opencl/ggml-opencl-tile32-matvec.cpp:91      if (src1->buffer && ggml_backend_buffer_is_host(src1->buffer)) {
ggml/src/ggml-opencl/ggml-opencl-tile32-matvec.cpp:95      if (dst->buffer && ggml_backend_buffer_is_host(dst->buffer)) {
```
vs
```
ggml/src/ggml-opencl/ggml-opencl.cpp:25592     ggml_tensor_extra_cl * extra1 = (ggml_tensor_extra_cl *)src1->extra;
ggml/src/ggml-opencl/ggml-opencl.cpp:25593     ggml_tensor_extra_cl * extrad = (ggml_tensor_extra_cl *)dst->extra;
```

**Failure scenario.** The aborts are justified by the G10 threat model ("ggml_backend_sched_set_tensor_backend
can pin this op without asking supports_op", matvec.cpp:72-73). Under that threat model the HOST
leg is now *less* safe than before for `src0 ∈ HTP0-HOST`, and no safer at all for `src1`/`dst` on
any of the three compute sites. In-tree reachability is low — `src/llama-context.cpp:2686` re-checks
`ggml_backend_supports_op` before pinning and `src/llama-graph.cpp:2748` pins to the CPU — but the
commit explicitly claims to cover G10 and does not.

---

### P2-3 — Silent numerics change: the v4 TILE32 kernel is now built with fast-math
**CONFIRMED. P2.**

```
ggml/src/ggml-opencl/ggml-opencl.cpp:9853  static void ggml_opencl_tile32_env_fill(ggml_backend_opencl_context * backend_ctx, struct ggml_opencl_tile32_env * env) {
ggml/src/ggml-opencl/ggml-opencl.cpp:9859      load_cl_kernels(backend_ctx);
ggml/src/ggml-opencl/ggml-opencl.cpp:9873      env->kernel_compile_opts   = backend_ctx->kernel_compile_opts.c_str();
```
```
ggml/src/ggml-opencl/ggml-opencl.cpp:1644  std::string compile_opts = std::string("-cl-std=") + opencl_c_std +
ggml/src/ggml-opencl/ggml-opencl.cpp:1645                             " -cl-mad-enable -cl-unsafe-math-optimizations"
ggml/src/ggml-opencl/ggml-opencl.cpp:1646                             " -cl-finite-math-only -cl-fast-relaxed-math";
ggml/src/ggml-opencl/ggml-opencl.cpp:1652  backend_ctx->kernel_compile_opts = compile_opts;
```
```
ggml/src/ggml-opencl/ggml-opencl-tile32-matvec.cpp:51      env->kernel_compile_opts ? env->kernel_compile_opts : "");
```

Before the commit `env_fill` ran before any `load_cl_kernels`, so the v4 program was always built
with the **empty string** — no `-cl-std`, no fast-math. Now it gets `-cl-std=CL3.0 -cl-mad-enable
-cl-unsafe-math-optimizations -cl-finite-math-only -cl-fast-relaxed-math` and possibly
`-qcom-enable-large-buffer` (`ggml-opencl.cpp:1648-1650`). The kernel's epilogue is an explicitly
ordered fp32 reduction:

```
ggml/src/ggml-opencl/kernels/mul_mv_q4_0_f32_tiled_v4.cl:126  for (int c = 0; c < 16; c++) {
ggml/src/ggml-opencl/kernels/mul_mv_q4_0_f32_tiled_v4.cl:127      t0 += vload4(w0 + 0, lred) + vload4(w1 + 0, lred);
```

`-cl-fast-relaxed-math` permits reassociation of that sum; `-cl-mad-enable` permits contraction. The
self-check (`ggml_opencl_tile32_self_check_locked`) re-runs the *actual* built kernel so it will
still pass, so nothing in the log betrays the change.

**Failure scenario.** `meanKLD=0.000934` in `session2-24fb5b8d6.grep` was measured with the new
options. The step-E/F/G KLD numbers it is meant to be compared against were measured with the empty
string. Any cross-step KLD or A/B comparison across this commit is invalid, and no log line records
that the v4 build options changed. The spec does not mention it at all — the commit message calls
it a side effect ("*also* gives the v4 program the engine's general compile options (Amendment E2)").
Either it is intended and belongs in Amendment I with a re-baseline, or the v4 program should keep
its own option string.

---

### P2-4 — The C1 audit cannot distinguish the one buft a weight must never land in
**CONFIRMED. P2.**

```
src/llama-model.cpp:1596              if (ggml_backend_buft_weight_layout(buft) == GGML_WEIGHT_LAYOUT_Q4_0_TILE32) {
src/llama-model.cpp:1597                  tile32_bytes += size;
src/llama-model.cpp:1598              } else if (buft_is_cpu_host(buft)) {
src/llama-model.cpp:1599                  cpu_bytes += size;
src/llama-model.cpp:1600              } else if (ggml_backend_buft_is_host(buft)) {
src/llama-model.cpp:1601                  host_bytes += size;
src/llama-model.cpp:1609              LLAMA_LOG_INFO("shared weights: TILE32 %zu HOST %zu CPU %zu bytes\n", tile32_bytes, host_bytes, cpu_bytes);
```

The diff's own comment admits the lumping:

```
src/llama-model.cpp:1581  // TILE32, a weights HOST buft (Amendment I: the device's HOST-W object; the is_host branch below
src/llama-model.cpp:1582  // takes HOST and HOST-W alike) or a CPU buft.
```

Amendment I turns one of those two indistinguishable cases into a **forbidden** placement. The audit
is the instrument the whole binding reads (`step3-s23/env.sh`: `HOST_MAX_MIB=16`, "anything bigger
means a duplicate or a matrix that missed TILE32"). It now has one fewer bit of resolution exactly
where the new invariant lives. It is also the line quoted as evidence in `session1` (line 1009) and
`session2`.

**Failure scenario.** A placement regression that sends the f32 norms to `HTP0-HOST` instead of
`HTP0-HOST-W` is reported as `HOST 229376000`, i.e. indistinguishable from correct. Combined with
P0-1 the invariant is enforced in one place (the probe) and observable in none.

---

### P2-5 — `HTP0-HOST` is still offered as a weight placement candidate, now unreachable but silently shadowed
**CONFIRMED. P2.**

```
src/llama-model.cpp:1111      if (!no_host) {
src/llama-model.cpp:1112          for (const auto & dev : devices) {
src/llama-model.cpp:1113              ggml_backend_buffer_type_t buft = ggml_backend_dev_host_buffer_type(dev.dev);
src/llama-model.cpp:1114              if (buft) {
src/llama-model.cpp:1115                  buft_list.emplace_back(dev.dev, buft);
src/llama-model.cpp:1116                  break;
```

The main weight list is therefore
`[gpu extras of dev 0 = TILE32, HOST-W, HTP0-device] ++ [HTP0-HOST] ++ [CPU extras] ++ [CPU]`
(`src/llama-model.cpp:1234-1252` builds the first part from the *device's* registry; the last from
the *CPU* registry at `src/llama-model.cpp:1128-1137` — a source split worth noting in its own right).
Because `HOST` and `HOST-W` share one `iface` (`ggml/src/ggml-hexagon/ggml-hexagon.cpp:2441-2450`),
`weight_buft_supported` gives the identical answer for both, so `HOST` is dead weight in the list.
Nothing says so. The moment the two objects differ in any probe-visible fact (`get_alloc_size`,
`get_max_size` = `opt_mbuf`, `get_alignment`), the probe starts selecting `HTP0-HOST` for the norms
and the C1 audit (P2-4) will not notice.

**Failure scenario.** A future "cap HOST-W at the S23 import limit" change to
`ggml_backend_hexagon_host_buffer_type_get_max_size` makes the probe decline `HOST-W` for a big
norm and accept `HOST`; the norm lands in the CPU compute buffer; the GPU leg declines it via the
identity test; the load-time audit prints a normal-looking `HOST N bytes`. Three independent
mechanisms, zero diagnostics.

---

### P2-6 — The 0-byte placement-probe exemption is not mirrored in the compute predicate
**CONFIRMED (inconsistency). P2.**

```
ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp:38      // llama's weight_buft_supported allocates a 0-byte dummy buffer: no data, usage still ANY
ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp:39      return ggml_backend_buffer_get_size(t->buffer) == 0 ||
ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp:40             ggml_backend_buffer_get_usage(t->buffer) == GGML_BACKEND_BUFFER_USAGE_WEIGHTS;
```
```
ggml/src/ggml-opencl/ggml-opencl.cpp:9899      if (ggml_backend_buffer_get_usage(t->buffer) != GGML_BACKEND_BUFFER_USAGE_WEIGHTS) {
ggml/src/ggml-opencl/ggml-opencl.cpp:9900          GGML_ABORT("ggml-opencl: %s is in host buffer %s with usage %d, the HOST leg addresses weights only",
```

Admission accepts *any* 0-byte host buffer whatever its usage; compute aborts on *any* non-WEIGHTS
usage whatever its size. The two disagree on the 0-byte ∧ non-WEIGHTS corner, in the direction
"abort".

Answering the brief's question directly — can a **real** non-weight tensor have a 0-size buffer?
Yes, two producers exist in-tree:
- `src/llama-model.cpp:2007` `buf = ggml_backend_buft_alloc_buffer(buft, /*size =*/ 0); // dummy buffer`
  for the whole `no_alloc` memory-fit pass, which then sets WEIGHTS at `:2032` (so benign);
- `ggml_gallocr` will materialise a 0-size buffer for a graph containing a zero-`ne` tensor
  (empty bias / `n_expert == 0` / deepstack), with usage ANY or COMPUTE.

Neither currently lands in `HTP0-HOST-W` (the KV cache uses `ggml_backend_dev_buffer_type(dev)`,
`src/llama-kv-cache.cpp:317`; the compute buffer uses the device host buft,
`src/llama-context.cpp:416-419`; the output buffer, `src/llama-context.cpp:2246-2252`), so reachability
needs an override. But the predicate pair is self-inconsistent and the test asserts only the
admission half:

```
tests/test-tile32-host-ops.cpp:219      ggml_backend_buffer_t probe_buf = ggml_backend_buft_alloc_buffer(&mock_host_w_buft, 0);
tests/test-tile32-host-ops.cpp:222      check(ggml_opencl_host_weights_tensor(t_probe), "a 0-byte placement probe of the weights buft is accepted");
```

**Fix direction.** One predicate, used by both, with the 0-byte rule expressed as "no data yet"
(`size == 0 || usage == WEIGHTS` in *both* places), or drop the exemption and let the probe be
answered by the gate alone at `ggml-opencl.cpp:9995`.

---

### P2-7 — `supports_op`'s "a host tensor anywhere else declines the op" (F4) is now reachable only when a *weights* host src is present
**CONFIRMED (regression in the guard). P2.**

```
ggml/src/ggml-opencl/ggml-opencl.cpp:9971      // enforces: a host tensor anywhere else declines the op (F4).
ggml/src/ggml-opencl/ggml-opencl.cpp:9972      for (int i = 0; i < GGML_MAX_SRC; i++) {
ggml/src/ggml-opencl/ggml-opencl.cpp:9973          const ggml_tensor * src = op->src[i];
ggml/src/ggml-opencl/ggml-opencl.cpp:9974          if (!src || !ggml_opencl_host_weights_tensor(src)) {
ggml/src/ggml-opencl/ggml-opencl.cpp:9975              continue;
```

The whole F4 rule (the inner `j` loop at `:9980-9990`, which is the *only* implementation of
"a src in plain CPU memory declines the op") is nested inside this loop. Pre-commit the guard was
`ggml_opencl_in_host_leg_buffer(src)` — every importable host buft, no usage test. The commit's
message says "A COMPUTE-usage host tensor is declined there"; the code says it is *not recognised*
there, i.e. the op falls through to the generic switch at `:10005` and is judged with no host
awareness at all. If the only host src of the op is a `HOST-W` tensor with COMPUTE usage, the op is
accepted, and the failure surfaces as the new process abort at `:9899`, not as a decline.

This inverts the stated G2 rule ("decline before placement, never abort after unless impossible").
Same for the TILE32 branch, which returns at `:9962` after looking at `src[0]` only:

```
ggml/src/ggml-opencl/ggml-opencl.cpp:9943          const ggml_tensor * w = op->src[0];
ggml/src/ggml-opencl/ggml-opencl.cpp:9945          const bool mul_mat_ok = op->op == GGML_OP_MUL_MAT && op->type == GGML_TYPE_F32 &&
...
ggml/src/ggml-opencl/ggml-opencl.cpp:9962          return ggml_opencl_tile32_weight_ready(&env, w);
```

`src[2]` (the fused-attention K tensor) is never examined, so a KV tensor in a host buffer the
OpenCL device cannot claim would be admitted here. The only reason this has not fired is that
`ggml_backend_sched` inserts a copy for it
(`ggml/src/ggml-backend.cpp:1405` → `ggml_backend_sched_buffer_supported` → `:1084`
`ggml_backend_supports_buft`) — i.e. the guarantee is now provided by the scheduler, not by
`supports_op`, and the commit does not say so.

---

### P2-8 — `load_cl_kernels` is now reachable from `supports_buft`/`supports_op`/compute with no lock, and can `GGML_ASSERT(0)` mid-reserve
**CONFIRMED. P2.**

```
ggml/src/ggml-opencl/ggml-opencl.cpp:1633  static void load_cl_kernels(ggml_backend_opencl_context *backend_ctx) {
ggml/src/ggml-opencl/ggml-opencl.cpp:1634      if (backend_ctx->kernels_loaded || backend_ctx->kernel_build_failed) {
ggml/src/ggml-opencl/ggml-opencl.cpp:1635          return;
```
```
ggml/src/ggml-opencl/ggml-opencl.cpp:71  #define CL_CHECK(err)                                               \
ggml/src/ggml-opencl/ggml-opencl.cpp:76          GGML_ASSERT(0);                                         \
```

Cheap after the first call, so "cost on every `supports_op`" is a non-issue (REFUTED). Two real
residuals:

1. **Unlocked.** `load_cl_kernels` mutates `kernels_loaded`, `kernel_build_failed` and reassigns
   the `std::string kernel_compile_opts` (`:1652`) with no mutex; `env->kernel_compile_opts` is a
   borrowed `c_str()` captured at `:9873`. `ggml_cl_init` is likewise unlocked
   (`ggml/src/ggml-opencl/ggml-opencl.cpp:5888+`). Two schedulers sharing one OpenCL device (or one
   scheduler driven from two threads) race. In practice llama drives one graph per thread, so this
   is latent — but the commit *added* call sites rather than hoisting the load into `ggml_cl_init`
   under a lock.
2. **New abort surface, earlier.** `supports_buft(TILE32|HOST-W)` (`:15079`, `:15097`) is called from
   `weight_buft_supported` during model load, so a `clCreateKernel` failure now kills the process at
   model-load time. Before, it died at the first OpenCL buffer allocation. Same phase, so the
   exposure is roughly unchanged — but the failure mode is `GGML_ASSERT(0)`, not the
   "poison the (device, driver) pair, fall back to CPU" policy the rest of this code implements
   (`:1475-1479`). The commit deliberately moved `kernel_build_failed` *after* `env_fill` so the
   claim fails closed, but `build_program_from_source` already sets that flag; only the
   `clCreateKernel` tail is unguarded.

**Side effects on non-leg devices: REFUTED.** `env_fill` has exactly six call sites, all inside
`ggml-opencl.cpp` and all in TILE32/HOST-leg code paths (`:9905`, `:9958`, `:9992`, `:15079`,
`:15097`, `:25569`). `ggml-opencl-tile32-gate.cpp` takes only a `const env *` and reads no globals,
so the gate is not a viable alternative site — `env_fill` is the right place.

**`kernel_build_failed` handling: PARTLY REFUTED.** The claim "a failed kernel build fails the
claim atomically" holds, but `ggml_opencl_supports_op` reads the flag at `:9923` *before* the
`env_fill` that sets it, so on the very first call a build failure surfaces as the new
"the Q6_K kernel is not loaded" message (`ggml-opencl-tile32.cpp:296-299`) rather than as a build
failure — the same class of ambiguity the commit set out to remove, one level down.

---

### P2-9 — `device_weight_host_buft` resolves the extra bufts from a different registry than `make_cpu_buft_list`
**CONFIRMED (divergence). P2.**

```
src/llama-model.cpp:1157      ggml_backend_reg_t reg = ggml_backend_dev_backend_reg(dev);
src/llama-model.cpp:1161      auto get_extra_bufts = (ggml_backend_dev_get_extra_bufts_t)
src/llama-model.cpp:1162          ggml_backend_reg_get_proc_address(reg, "ggml_backend_dev_get_extra_bufts");
src/llama-model.cpp:1166      ggml_backend_buffer_type_t dev_host = ggml_backend_dev_host_buffer_type(dev);
src/llama-model.cpp:1167      ggml_backend_buffer_type_t * bufts = get_extra_bufts(dev);
```
vs.
```
src/llama-model.cpp:1128          auto cpu_reg = ggml_backend_dev_backend_reg(cpu_dev);
src/llama-model.cpp:1130              ggml_backend_reg_get_proc_address(cpu_reg, "ggml_backend_dev_get_extra_bufts");
src/llama-model.cpp:1132          ggml_backend_buffer_type_t * extra_bufts = ggml_backend_dev_get_extra_bufts_fn(cpu_dev);
```

The old `make_shared_input_buft_list` asked `ggml_backend_dev_host_buffer_type(dev)` — one device,
one buft, no list. The new code walks a list and picks "the first host entry that is not the device
host buft". For Hexagon both resolve to the same registry and the same `{TILE32, HOST-W}`, so the
placement in the log (`load_tensors:  HTP0-HOST-W model buffer size =   218.75 MiB`) is explained
(`TILE32` fails `ggml_backend_buft_is_host`, `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2427`, so
`HOST-W` is picked). But the two sources are unrelated, and the CPU registry's list is
AMX/KleidiAI/CPU_REPACK only (`ggml/src/ggml-cpu/ggml-cpu.cpp:43-75`), so the *placement* list and the
*input-role* list are now derived from two different notions of "extra bufts". A device offering two
host extra bufts gets an arbitrary pick with no diagnostic.

There is also a **new cross-backend coupling**: `device_weight_host_buft` and
`ggml_opencl_host_weights_buft` both call into the *Hexagon device's* `get_host_buffer_type`, which
reads the mutable global `opt_hostbuf`:

```
ggml/src/ggml-hexagon/ggml-hexagon.cpp:7765  static ggml_backend_buffer_type_t ggml_backend_hexagon_device_get_host_buffer_type(ggml_backend_dev_t dev) {
ggml/src/ggml-hexagon/ggml-hexagon.cpp:7766      if (!opt_hostbuf) {
ggml/src/ggml-hexagon/ggml-hexagon.cpp:7767          return NULL;
```
```
ggml/src/ggml-hexagon/ggml-hexagon.cpp:8451  opt_hostbuf_repack = shared_weights->enabled;
ggml/src/ggml-hexagon/ggml-hexagon.cpp:8452  opt_hostbuf        = shared_weights->enabled;
```

Flipping `opt_hostbuf` off while buffers are alive would make `get_host_buffer_type` return NULL, the
identity test stop firing, and OpenCL start claiming the very buft llama is about to hand the CPU.
`set_shared_weights` guards this with `shared_bufs_live` (`:8446-8450`), and the new HOST-W counting
is correct for it:

```
ggml/src/ggml-hexagon/ggml-hexagon.cpp:830      if (buffer->buft->iface.is_host(buffer->buft) || buffer->buft->iface.get_weight_layout != NULL) {
ggml/src/ggml-hexagon/ggml-hexagon.cpp:831          shared_bufs_live.fetch_sub(1, std::memory_order_release);
```
(symmetric with the `fetch_add` at `:2330`, which both host bufts share because they share
`ggml_backend_hexagon_host_buffer_type_alloc_buffer` at `:2314`.) So the guard holds — but OpenCL
admission now silently depends on a Hexagon global that a third party can flip through a proc
address. P3 on its own; reported here because it is the mechanism behind the identity test.

---

### P2-10 — `ggml_cl_mul_mat_tile32`'s three new aborts fire *after* the caller has already cast and dereferenced the foreign extras
**CONFIRMED. P2.**

```
ggml/src/ggml-opencl/ggml-opencl.cpp:25565      if (ggml_backend_tensor_weight_layout(src0) == GGML_WEIGHT_LAYOUT_Q4_0_TILE32) {
ggml/src/ggml-opencl/ggml-opencl.cpp:25566          ggml_tensor_extra_cl * extra1 = (ggml_tensor_extra_cl *)src1->extra;
ggml/src/ggml-opencl/ggml-opencl.cpp:25567          ggml_tensor_extra_cl * extrad = (ggml_tensor_extra_cl *)dst->extra;
ggml/src/ggml-opencl/ggml-opencl.cpp:25570          ggml_cl_mul_mat_tile32(&env, src0, src1, dst,
ggml/src/ggml-opencl/ggml-opencl.cpp:25571                                 extra1->data_device, extra1->offset + src1->view_offs,
ggml/src/ggml-opencl/ggml-opencl.cpp:25572                                 extrad->data_device, extrad->offset + dst->view_offs);
```
```
ggml/src/ggml-opencl/ggml-opencl-tile32-matvec.cpp:91      if (src1->buffer && ggml_backend_buffer_is_host(src1->buffer)) {
ggml/src/ggml-opencl/ggml-opencl-tile32-matvec.cpp:92          GGML_ABORT("ggml-opencl-tile32: activation %s is in host buffer %s, the leg needs an OpenCL buffer",
```

The guard lives in the callee; the two out-of-struct loads (`extra1->data_device`,
`extrad->data_device`) happen in the caller's argument list, i.e. **before** the guard runs. It is
only "just" safe because the read is from a live heap object of a different type — no fault, then
abort. Move the three checks into `ggml_cl_mul_mat` (or before the cast at 25566) and the fail-closed
becomes real. Note also that these three checks are unreachable in the intended configuration:
`ggml_backend_sched` already guarantees `src1`/`dst` are in OpenCL buffers because
`ggml_backend_opencl_device_supports_buft` refuses the CPU buft at
`ggml/src/ggml-opencl/ggml-opencl.cpp:15105-15108`. So the cost (three predicate calls per
TILE32 mat-vec, on the hot decode path) buys nothing that is currently reachable, while the site
that *is* reachable — the HOST leg's `src1`/`dst` (P1-2) — got no check.

Also note the `src0` usage abort at `matvec.cpp:86` is redundant with
`ggml-opencl.cpp:25565` and fires on a TILE32 buffer whose usage is WEIGHTS by construction
(`src/llama-model.cpp:2032`).

---

### P3-11 — The identity test is not fail-closed when a device reports no host buft
**CONFIRMED. P3.**

```
ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp:22      ggml_backend_dev_t dev = ggml_backend_buft_get_device(buft);
ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp:23      if (dev && buft == ggml_backend_dev_host_buffer_type(dev)) {
ggml/src/ggml-opencl/ggml-opencl-tile32-host.cpp:24          return false;
```

If `ggml_backend_dev_host_buffer_type(dev)` returns NULL — which is exactly what Hexagon does when
`!opt_hostbuf` (`ggml-hexagon.cpp:7766-7768`) and what every device without
`get_host_buffer_type` does (`ggml/src/ggml-backend.cpp:644-646`; the CPU device sets it NULL at
`ggml/src/ggml-cpu/ggml-cpu.cpp:511`) — the `buft == NULL` comparison is false and the identity test
does not fire. Today the only thing keeping the plain CPU buft out is the *accessor* test at
`:26-28`, i.e. a proc address the CPU registry happens not to export. The guarantee rests on two
independent coincidences (the device's honesty about its host buft, and the absence of a generic
dmabuf accessor in other registries) rather than on one explicit fact. Today it is safe; the
predicate's comment (`:20-21`) claims a stronger property than the code has.

---

### P3-12 — `g_program` / `g_kernel` are process-global, not per-context, and `release_imports` does not clear them
**CONFIRMED (pre-existing, worsened in reach). P3.**

```
ggml/src/ggml-opencl/ggml-opencl-tile32-matvec.cpp:35  cl_program g_program = nullptr;
ggml/src/ggml-opencl/ggml-opencl-tile32-matvec.cpp:36  cl_kernel  g_kernel  = nullptr;
ggml/src/ggml-opencl/ggml-opencl-tile32-matvec.cpp:40  cl_kernel ggml_opencl_tile32_kernel_locked(const ggml_opencl_tile32_env * env) {
ggml/src/ggml-opencl/ggml-opencl-tile32-matvec.cpp:41      if (g_kernel) {
ggml/src/ggml-opencl/ggml-opencl-tile32-matvec.cpp:42          return g_kernel;
```
```
ggml/src/ggml-opencl/ggml-opencl-tile32.cpp:404      g_imports.clear();
```

A second OpenCL device (or a second context after a device reset) reuses the first context's
`cl_program`; `clSetKernelArg` on a kernel from another context is invalid. `release_imports` drops
the imports but leaves `g_program`/`g_kernel` dangling. Not introduced here, but the commit makes it
more reachable by moving kernel construction from "first compute" to "first `supports_buft`",
i.e. into a phase where a probe can build the program for a context that is later replaced.

---

### P3-13 — `ggml_hexagon_tensor_is_host` is dead code, and the commit's comment implies it is not
**CONFIRMED. P3.**

```
ggml/src/ggml-hexagon/ggml-hexagon.cpp:5947  static bool ggml_hexagon_tensor_is_host(const struct ggml_hexagon_session * sess, const ggml_tensor * t) {
ggml/src/ggml-hexagon/ggml-hexagon.cpp:5948      return t && t->buffer && ggml_backend_buft_is_host(t->buffer->buft);
```
Only this definition matches anywhere in the tree. The first commit's message says "every other
site that recognises a host weights buffer does so through `is_host` and needs no change (…,
`ggml_hexagon_tensor_is_host`, …)" — a claim about a function with zero call sites. Harmless, but it
is the kind of statement that makes a reviewer stop checking.

---

### P3-14 — The `HOST` vs `HOST-W` accounting in the load log cannot be read from the evidence
**CONFIRMED (observability). P3.**

`session2-24fb5b8d6.grep` proves placement moved
(`load_tensors:  HTP0-HOST-W model buffer size =   218.75 MiB`, same byte count as session 1's
`HTP0-HOST`) and that the C1 audit still runs. It does **not** prove the compute and output buffers
stayed in `HTP0-HOST` — the proof grep filters
`'TILE32 leg|ggml-opencl-tile32|HOST self-check|HOST import|model buffer size|graph splits'`
(`step4b-s23/run-step4b-correct.sh:31`), and `llama_context:  HTP0-HOST  output buffer size` /
`sched_reserve:  HTP0-HOST compute buffer size` only appear in the unfiltered tail of the second
capture. The one invariant the entire fix rests on — "llama still hands `HTP0-HOST` to the CPU for
compute and output" — has **no assertion anywhere**, in code or in the session script. Add the two
`model.devices[0]`-derived lines to the proof grep and assert on them; that is the cheapest possible
regression lock and it is missing.

---

### P3-15 — `load_cl_kernels` from `env_fill` also pulls the v4 build under the on-disk binary cache and under `adreno_use_large_buffer`
**CONFIRMED. P3.**

```
ggml/src/ggml-opencl/ggml-opencl.cpp:1467      cl_program p_cached = cl_program_cache_try_load(
ggml/src/ggml-opencl/ggml-opencl.cpp:1468          backend_ctx->program_cache, ctx, dev, program_buffer, compile_opts);
```
```
ggml/src/ggml-opencl/ggml-opencl.cpp:1648      if (backend_ctx->adreno_use_large_buffer) {
ggml/src/ggml-opencl/ggml-opencl.cpp:1649          compile_opts += " -qcom-enable-large-buffer ";
```

With the empty option string the v4 program had its own cache key; now it shares the general-kernel
option string, and inherits a device-level allocation-mode flag that has nothing to do with a
1-D image mat-vec. Also note `build_program_from_binary` (`:1487-1508`) still `exit(1)`s on failure —
so a cache hit for the v4 program that fails to build kills the process, bypassing the
`kernel_build_failed` policy entirely. Pre-existing, but now reachable for the v4 program.

---

### P3-16 — Diagnostic message overlap in the split self-check preconditions
**CONFIRMED. P3.**

```
ggml/src/ggml-opencl/ggml-opencl-tile32-gate.cpp:229      if (K <= 0 || K % bs != 0) {
ggml/src/ggml-opencl/ggml-opencl-tile32-gate.cpp:230          GGML_LOG_WARN("ggml-opencl: HOST self-check for %s: K %lld is not a positive multiple of the Q6_K block size %lld\n",
```

`K <= 0` and `K % 256 != 0` are two different preconditions sharing one message; a zero-`ne0`
weight would be reported as a block-size problem. The control flow is unchanged from the combined
condition (same disjunction, same `return false`), so the split is behaviour-preserving — only the
wording folds two cases into one. Fine as a first pass; the brief asked for "each precondition logs
which one failed", and this one does not.

---

## Explicitly REFUTED (checked, not wrong)

1. **"NPU leg placement or performance changes."** REFUTED. Every NPU-side decision is by
   interface-function-pointer identity or `is_host`, never by buft object identity:
   `ggml_backend_buffer_is_hexagon` via `get_alignment` (`:2469-2471`), the shared-buffer counter
   via `iface.is_host(...)` (`:830`) symmetric with `fetch_add` at `:2330`,
   `ggml_hexagon_op_htp_only` via `is_hexagon && !is_host` (`:7883-7884`),
   `ggml_hexagon_is_raw_weight` via `is_hexagon && usage == WEIGHTS && !REPACK` (`:2477-2483`),
   `mmap_tensor` via `usage == WEIGHTS` → `opt_dma64` extension (`:4161-4166`), the HOSTBUF
   flush ioctl via `opt_hostbuf_flush` in the shared host `set_tensor` (`:2184-2200`),
   the dmabuf accessor via `iface.is_host == ggml_backend_hexagon_host_buffer_type_is_host`
   (`:8491`, which covers HOST-W for free), and `offload_op` via `htp_admit_*` (`:8162-8167`),
   which never sees a buft. `supports_buft` (`:8155-8156`) and `get_extra_bufts` (`:8464-8476`)
   are the only two identity sites and both were updated. Note the host `set_tensor` does **not**
   set `GGML_HEXAGON_TENSOR_WEIGHT` (`:2178-2200`, vs `:1902-1907` for the device buft) — but that
   was already true for `HTP0-HOST`, so no regression.
2. **"Two-copy mode changed."** REFUTED. `get_extra_bufts` returns the static `none[1]` unless
   `opt_hostbuf_repack` (`:8465-8468`) and adds `HOST-W` only under `opt_hostbuf` (`:8472-8474`),
   and `device_weight_host_buft` over `{NULL}` returns null so
   `make_shared_input_buft_list` returns `cpu_list` verbatim (`src/llama-model.cpp:1199-1201`).
   `ml.shared_weights` requires a TILE32 buft in some list (`src/llama-model.cpp:1663-1666`), which
   requires Hexagon, so the new code is not even reached. `ggml_backend_hexagon_set_shared_weights`
   cannot be called with live buffers (`:8446-8450`) and the count is correct (P2-9).
3. **"CPU-only / OpenCL-only (no Hexagon) affected."** REFUTED — `device_weight_host_buft` is only
   called from `make_shared_input_buft_list`, gated on `ml.shared_weights`; `ggml_opencl_host_weights_buft`
   returns false at the accessor test for every non-Hexagon buft; the `env_fill` change is inert
   without a TILE32/HOST-W buft in play.
4. **"The `use_mmap` guard at `llama-model-loader.cpp:1272` is now bypassed and changes placement."**
   REFUTED, with a mechanism worth recording: the guard only fires when
   `buft == ggml_backend_dev_host_buffer_type(buft_dev)`, so pre-commit it *did* divert `HTP0-HOST`
   weights to the CPU buffer under mmap — which would have made the one-copy claim false in the
   default load mode. It never fired in practice because
   `src/llama-model.cpp:1624-1632` disables `ml.use_mmap` for the whole model when any device
   reports `!props.caps.mmap_support`, and Hexagon reports exactly that
   (`ggml/src/ggml-hexagon/ggml-hexagon.cpp` `get_props`, `/* .mmap_support = */ false`). So the
   guard is unreachable whenever Hexagon is a model device, and the log evidence
   (`HTP0-HOST-W = 218.75 MiB`) is consistent. **Side observation:** the guard is now doubly dead
   and should be deleted or amended rather than left to look load-bearing.
5. **"`load_cl_kernels` on every `supports_op` is expensive."** REFUTED — two loads and two
   compares (`:1634-1635`).
6. **"Test exercises copies of the predicates."** REFUTED — `tests/CMakeLists.txt:489-490` compiles
   the real `ggml-opencl-tile32-host.cpp` into the test binary; `ggml_opencl_host_weights_buft` /
   `_tensor` are called directly (`tests/test-tile32-host-ops.cpp:197-226`).
7. **"Test env save/restore is missing."** REFUTED / N/A — the only `getenv` in the tile32 tests is
   a read (`tests/test-tile32-cpu.cpp:190`); no `setenv` anywhere, so there is nothing to restore.
   `test-tile32-host-ops.cpp:224-226` does correctly null and restore
   `mock_reg.iface.get_proc_address`, and `ggml_backend_reg_get_proc_address` null-checks the hook
   (`ggml/src/ggml-backend.cpp:2711-2717`), so the "no accessor" case does not crash.
8. **`release_imports` semantics.** Sound. It `clFinish`es the leg queue before releasing
   (`ggml/src/ggml-opencl/ggml-opencl-tile32.cpp:388-404`) and the stale-key probe
   (`import_locked`, `:98-113`) detects a recycled `ggml_backend_buffer_t` even in release builds;
   only the explanatory `GGML_LOG_WARN` is `#ifndef NDEBUG` (`:107-112`). `g_imports` keys on the
   buffer pointer, so `HTP0-HOST` and `HTP0-HOST-W` buffers are distinct entries — correct.
   Caveat: nothing in this repo calls `ggml_backend_opencl_release_imports` (it is a proc address,
   `ggml-opencl.cpp:15164-15165`), and **no `released … imports` line appears in either session
   log**, so the release path is asserted by neither the code nor the evidence.
9. **"The new lifetime handling is wrong."** REFUTED. `host_w_buffer_type` is fully initialised
   (`ggml-hexagon.cpp:2448-2450`), destroyed in the dtor (`:2464`), points at its own
   `ggml_backend_hexagon_buffer_type_context`, and `extra_bufts` is a fixed `[3]` member array
   written before it is handed out (`:8470-8476`). The one borrowing hazard —
   `env->kernel_compile_opts = backend_ctx->kernel_compile_opts.c_str();` captured *after* the
   string is assigned (`:9873` after `:1652`) — is stable in practice because `std::string::operator=`
   on an already-large-enough buffer does not reallocate, and the header already documents the
   borrowed-pointer contract (`ggml-opencl-tile32.h:33`).

---

## Test-coverage gaps (angle 6)

- The **supports_op** guard change (P2-7) is **not** covered at all. `ggml_opencl_supports_op` lives
  in `ggml-opencl.cpp` and is not host-testable; the test covers `ggml_opencl_host_op_ok` only. The
  one line that changed semantics (`ggml-opencl.cpp:9974`) has no test.
- The **compute-side** usage abort (P2-6) has no test and no host-testable predicate; the test's
  0-byte case asserts only the admission half.
- The 39-check count is real but the new checks cover `ggml_opencl_host_weights_buft` /
  `_tensor` in isolation. There is **no test that the two predicates agree** on the corner
  (0-byte ∧ non-WEIGHTS), which is exactly where they do not.
- No test asserts that `get_extra_bufts` returns `{TILE32, HOST-W, NULL}` and never `{…, HOST, …}`.
  That is the single most load-bearing behaviour of commit 1 and it is untested (ggml-hexagon is not
  in the host build — acknowledged in the commit message, but it means a rename or a reordering of
  the two lines at `ggml-hexagon.cpp:8470-8474` is caught only on a phone).
- No test for `make_cpu_buft_list` / `device_weight_host_buft` / the audit line.

---

## Simplify / dead code (angle 7, last)

1. `src/llama-model.cpp:1111-1119` — the device **host buft** in the weight list is now unreachable
   (P2-5). Delete it or comment why it stays; today it is a silent shadow of `HOST-W`.
2. `ggml/src/ggml-hexagon/ggml-hexagon.cpp:5947-5950` — `ggml_hexagon_tensor_is_host` and
   `ggml_hexagon_tensor_is_non_host` (`:5952-5955`) have zero call sites. Pre-existing, but the
   commit's message cites the first one as a live site.
3. `ggml/src/ggml-opencl/ggml-opencl-tile32-matvec.cpp:86-90` — the `src0` usage assert duplicates
   `ggml-opencl.cpp:25565` and can never fire (TILE32 buffers are WEIGHTS by
   `src/llama-model.cpp:2032`).
4. `ggml/src/ggml-opencl/ggml-opencl-tile32-host.h:20` — `struct ggml_tensor;` forward declaration
   is now redundant (the header includes `ggml.h`).
5. The two predicates `ggml_opencl_in_host_leg_buffer` (`ggml-opencl.cpp:9882`) and
   `ggml_opencl_host_weights_tensor` (`host.cpp:31`) are deliberately different, and the difference
   is the whole fail-closed mechanism — but the names give no hint of it. `…_importable_host_tensor`
   vs `…_weights_tensor` would make the two-line comment at `:9878-9881` unnecessary.
6. `ggml-opencl-tile32.cpp:107-112` — the stale-import warning is inside `#ifndef NDEBUG`, i.e. off
   in exactly the Android build that runs the legs.

---

## Verdict

**CONFIRMED that Amendment I fixes the step-4b -38 by the right mechanism and that the two-copy,
CPU-only and NPU paths are unchanged; but it is NOT fail-closed** — P0-1 (a supported `-ot` target
defeats the whole guarantee silently), P1-2 (the narrowed identity test turns a named assert into a
silent extra cast on three compute sites), P2-3 (an undeclared fast-math rebuild of the TILE32 v4
kernel invalidates cross-step KLD comparisons), and P2-4 (the audit that is supposed to police the
new invariant cannot see the violation). Merge-blocking on P0-1 and P1-2; the rest should be
follow-ups with the spec updated to state the new numerics and the scheduler-as-arbiter assumption.
