# Audit — lab-only `GGML_OPENCL_TILE32_UNMEASURED` override (kalsallama-gov-onecopy `dbdeb628e`)

- Revision: `dbdeb628e` (parent `e2b8cc067`), files: `ggml-opencl-tile32-facts.{cpp,h}`, `-gate.cpp`,
  `-tile32.cpp`, `tests/test-tile32-opencl-gate.cpp`.
- Shipped tree read: `~/Projects/llama.rn-kalsa-onecopy` (`vendor/VERSIONS:8`, `vendor/llama.cpp/**`,
  `cpp/rn-legs-table.cpp`, `android/src/main/java/com/rnllama/RNLlama.java`, `bin/arm64-v8a/`).
- Method: read-only. Every finding below quotes the line I read. No file was edited, nothing committed.
- Commands run (disclosure, full): the allowed `ctest --test-dir build-host-tile32 -R test-tile32-opencl-gate`
  — as written it failed from the session cwd (`Failed to change working directory to
  "/Users/marco/Projects/kalsa/build-host-tile32"`), so I re-ran the same invocation inside the engine repo:
  `EXIT=0`, `1/1 Test #94: test-tile32-opencl-gate .......... Passed`. I additionally ran the already-built
  `build-host-tile32/bin/test-tile32-opencl-gate` directly (time 23:53:57, two minutes before the commit at
  23:55:37; it contains the new strings, so it is the reviewed code) to see its stderr. That extra run is
  reported because it produced F5's evidence; ctest hides it (`--output-on-failure` is not set, so the WARN
  never reaches the ctest log).

Goal check first: **no P0.** Today the shipped app cannot reach the override — the vendored engine is the
pre-override commit (`vendor/VERSIONS:8` `LLAMA_CPP_REF=5cb7e14a0c41134579a229184d734b64125acf87`, and
`vendor/llama.cpp/ggml/src/ggml-opencl/ggml-opencl-tile32-facts.h:26` still declares
`bool ggml_opencl_tile32_facts_ok(const struct ggml_opencl_tile32_facts * facts, size_t need_bytes, const char ** reason);`).
Everything below is about how thin that fence is.

---

## F1 (P1) — the waiver is an env-only device admission with no fence in code; the app has an explicit
precedent for refusing lab env pins, and this knob is not on it. Verdict: **CONFIRMED**

- `ggml/src/ggml-opencl/ggml-opencl-tile32-facts.cpp:90-91`
  `    const char * v = getenv("GGML_OPENCL_TILE32_UNMEASURED");`
  `    return v != NULL && strcmp(v, "1") == 0;`
  and `ggml-opencl-tile32-facts.h:35-36` `// True when GGML_OPENCL_TILE32_UNMEASURED=1 (exact): the lab-only switch behind the` / `// unmeasured_ok parameter above. Read on every call, never cached.`
- The only fence claimed is prose: `ggml-opencl-tile32-facts.h:30-31` `// Callers pass ggml_opencl_tile32_unmeasured_override(); the shipped app never sets it,`
  `// and an admit that only the waiver produced warns once per process.` "Never sets it" is a statement about
  the app's code, not a property the engine or the binding checks.
- The binding *does* fence lab env pins in one place, and only there —
  `~/Projects/llama.rn-kalsa-onecopy/cpp/rn-legs-table.cpp:89-96`:
  `// GGML_OPENCL_PLATFORM / GGML_OPENCL_DEVICE set the backend's selection` … `a lab pin, not a` /
  `// production phone - the reader refuses instead of second-guessing it` / `const char * envs[] = { "GGML_OPENCL_PLATFORM", "GGML_OPENCL_DEVICE" };` /
  `const char * value = std::getenv(env);`. So the project's own standard for a lab env pin is a code refusal;
  `GGML_OPENCL_TILE32_UNMEASURED` is absent from that list and from every other refusal.
- An app process setting env is not exotic here: the bridge already does it —
  `android/src/main/java/com/rnllama/RNLlama.java:181` `android.system.Os.setenv("GGML_HEXAGON_DEVICES", "1", true);`
  (plus `ADSP_LIBRARY_PATH:179`, `KALSA_HTP_FALLBACK:193`). Any embedder of this public binding can setenv
  before load; `adb shell setprop wrap.<pkg> "\`env GGML_OPENCL_TILE32_UNMEASURED=1\`"` is the debug-only route on
  a device. (A JS/TS API that passes env does not exist today — grepped `src/`, `lib/`: REFUTED as a current
  vector.)
- Why P1 and not P3: the fork has a single shipping line and the pin is the only thing holding the code out —
  `~/Projects/kalsa/REPOS.md:43` `(`feat/governor-onecopy`) is merged into `main` (`e2b8cc067`) and the branch deleted;` and
  `REPOS.md:32` `The pin is a` (commit, not a branch). `scripts/assert-kalsa-vendor.sh` contains no reference to
  the tile32 files or this env name, so a pin bump that carries the override is caught by nothing.

## F2 (P2) — nothing else on the path refuses 750/830; the "other gates" all pass them or re-ask the widened
one. Verdict: **CONFIRMED**

- The J(1) fence (the codebase's own amendment-F step-6 F5, `src/llama-governor-legs.cpp:20-23` `// The J(1) fence (audit step-6 F5): a GPU context that exists is not proof the` … )
  is not an independent device check: `src/llama-governor-legs.cpp:42`
  `    return op != nullptr && ggml_backend_dev_supports_op(dev, op);` → `ggml_opencl_supports_op` →
  `ggml_opencl_host_weight_admitted` (`ggml-opencl.cpp:10144` `            return ggml_opencl_host_weight_admitted(backend_ctx, host_w);`) →
  the same facts gate. With the override on, the fence passes on a 750/830 and the one-copy load is built.
- `get_adreno_gpu_gen` does not refuse them, it *classifies* them: `ggml-opencl.cpp:308-314`
  `    if (strstr(device_name, "730") ||` / `strstr(device_name, "740") ||` / `strstr(device_name, "750")) { return ADRENO_GPU_GEN::A7X; }`
  and `ggml-opencl.cpp:328-331` (`    if (strstr(device_name, "810") ||` / `        strstr(device_name, "830") ||`) → `A8X`; used at `7181-7183`. So a 750 is routed through the A7X workarounds
  and an 830 through the A8X/X2E-adjacent branches; the 740 token was never what selected the code paths.
- Subgroup/wave size is a hard-coded assumption, not a query: `ggml-opencl.cpp:7272-7273`
  `// Use wave size of 64 for all Adreno GPUs.` / `        backend_ctx->adreno_wave_size = 64;` (same for the v4
  kernel's `lws = 64` and the AoS kernel's `HOST_Q6K_AOS_LOCAL_SIZE 128` / `Q6K_AOS_N_SIMDWIDTH (64)` in
  `ggml-opencl-tile32-host-q6k.cpp:34-37`). Nothing checks `CL_DEVICE_SUB_GROUP_SIZES` anywhere in this file;
  only the numeric self-checks below can catch a wrong wave.
- Image alignment is asserted, not declined: `ggml-opencl-tile32.cpp:198`
  `    GGML_ASSERT((align & (align - 1)) == 0);` over `env->mem_base_align`/`env->image_base_align`. On a device
  where the two-query max is not a power of two the widened gate turns a lab experiment into a `GGML_ASSERT`
  abort. max-alloc is checked twice (gate `need_bytes = 0`, import with the real block), image size against
  `CL_DEVICE_IMAGE_MAX_BUFFER_SIZE` — those two are honest runtime checks.
- The AoS Q6_K arm has no model gate either; it is admitted by building and then dropped by its self-check
  (`ggml-opencl-tile32-host-q6k.cpp:41-71`, dropped at `ggml-opencl-tile32.cpp:313-320`). Fine by design, but it is another
  place where "admitted" is decided by a single-tensor numeric check.
- So the *complete* set of checks left on an override-admitted 750/830 is: the residual facts clauses (adreno,
  both QCOM extensions, max_alloc), `views_canary` (`ggml-opencl-tile32-gate.cpp:32-65`), the dma-buf import and
  its cache-policy fallback (`ggml-opencl-tile32.cpp:132-152`), the 16-byte/region and image-size checks, and
  the two numeric self-checks (v4 TILE32 per tensor; Q6_K per tensor). No model or driver knowledge.
- Side note that the token waiver newly enables: with the token clause gone, `ADRENO_UNKNOWN` becomes reachable
  for the leg, and the engine's A7X assumptions are written as negations, so an unrecognised part falls on the
  *permissive* side — `ggml-opencl.cpp:9890-9892` `    // The size escape is not taken on the A7X since its compiler miscompiles the flat K-quant GEMV` /
  `        && (tensor->ne[0] >= 2048 || (backend_ctx->adreno_gen != ADRENO_GPU_GEN::A7X && ggml_nbytes(tensor) >= (256ull << 20)))`.
  That is allow-by-default, and the deleted 740 clause was the thing that kept unknown parts out of it.

## F3 (P2) — three HOST-W weight families run on the unmeasured device with no numeric evidence at all.
Verdict: **CONFIRMED**

- `ggml-opencl-tile32.cpp:293-295`
  `    if (w->type != GGML_TYPE_Q6_K) {` / `        v->check_ok = true;` / `        return true;` — every non-Q6_K
  HOST weight is "checked" by fiat; `ggml-opencl-tile32.cpp:283` `// step, so the coherent-only policy in import_locked is what guards those bytes.`
  is an argument about bytes, not about a device whose compiler/mapping behaviour was never measured.
- Which weights that covers: `ggml-opencl-tile32-host.cpp:122` (`ggml_opencl_host_op_ok`) admits `GGML_OP_MUL`
  f32 norm weights (`:137` `        case GGML_OP_MUL:`) and `GGML_OP_SSM_CONV` f32 weights (`:153` `        case GGML_OP_SSM_CONV:`);
  the fused norm-family path substitutes the same import addresses (`ggml-opencl.cpp:9050-9058`
  `    // The only arms that reach here are the norm families, whose fused kernels read every src` / `    // through ggml_opencl_fused_src, so an admitted HOST-W weight (the MUL's f32 norm weight)`, and
  `ggml-opencl.cpp:10055-10067`) and its operands are admitted through the same
  `ggml_opencl_host_weight_admitted`. The compute-side accessor runs no check either:
  `ggml-opencl.cpp:10042-10048` (`ggml_opencl_host_view` … `GGML_ABORT("ggml-opencl: HOST view failed for %s: %s"`), while
  `ggml_opencl_host_weight_ready` is the only caller that runs `host_checked_locked`.
- Net: on a 750/830 admitted by the override, the Q6_K lm_head and the TILE32 tiles are numerically guarded;
  norm MUL, SSM_CONV and the fused norm kernels are guarded by nothing but the import policy.

## F4 (P2) — where the leg is weakest the failure mode is a process abort, not a leg-off.
Verdict: **CONFIRMED** (path); likelihood on real 750/830 **PLAUSIBLE**

- `ggml-opencl.cpp:10032` `// on a HOST tensor is a compute-time failure after admission - the G10 rule applies, abort.`;
  `ggml-opencl.cpp:10023` `    GGML_ABORT("ggml-opencl: %s is in host buffer %s (usage %d, size %zu), the leg addresses admitted HOST-W weights only",`
  and `10048`. The G10 rule's premise is that admission (gate + import + views + self-check) is strong evidence
  compute will succeed. The override weakens exactly that premise on a device with no measurement behind it: the
  0-byte placement probes (`ggml-opencl.cpp:10081-10083`) can now hand weights to HOST-W bufts on such a device,
  and a later per-tensor view miss aborts the app instead of demoting the op.

## F5 (P2) — the "loud" warning can state a cause that is false, and it fires with the env unset.
Verdict: **CONFIRMED (observed)**

- `ggml-opencl-tile32-facts.cpp:74-80`
  `    if (unmeasured_admit) {` / `        // The override alone flipped this verdict to admit: say so loudly, once per process.` /
  `        static std::atomic<bool> warned{false};` / `        bool expected = false;` / `        if (warned.compare_exchange_strong(expected, true)) {` /
  `            GGML_LOG_WARN("TILE32 gate: GGML_OPENCL_TILE32_UNMEASURED=1 admits an unmeasured device (%s, %s, %s) - lab only\n",`
- The function cannot know why `unmeasured_ok` is true. The test passes it directly with the variable unset
  (`tests/test-tile32-opencl-gate.cpp:91` `    check(ggml_opencl_tile32_facts_ok(&unmeasured, 0, true, &reason),`), and running the
  built binary with `GGML_OPENCL_TILE32_UNMEASURED` absent from the environment printed, verbatim:
  `TILE32 gate: GGML_OPENCL_TILE32_UNMEASURED=1 admits an unmeasured device (QUALCOMM Adreno(TM), OpenCL 3.0 Adreno(TM) 750, E031.45.0) - lab only`
  Any lab log that greps for that string gets a false positive from a unit-test binary. The message should name
  the waiver ("unmeasured_ok"), not an env var the callee never read.
- "once per process" is one slot for the whole process, keyed on nothing: the gate is per device
  (`ggml-opencl-tile32-gate.cpp:96` `    gate_state & state = g_gates[env->device];`), so a second, different
  unmeasured device is admitted in silence, and a legitimate first warn can be consumed by a caller that passed
  `true` for its own reasons (which `facts.h:30` explicitly invites).
- The CAS itself is correct: `std::atomic<bool>`, function-local static (thread-safe init), `expected = false`.
  The "atomic CAS is buggy" hypothesis is **REFUTED**.

## F6 (P3) — "Read on every call, never cached" is false in effect, and the two call sites can disagree
mid-process. Verdict: **CONFIRMED**

- `ggml-opencl-tile32-facts.h:36` `// unmeasured_ok parameter above. Read on every call, never cached.` vs the gate's
  per-device verdict cache: `ggml-opencl-tile32-gate.cpp:96-104`
  `    if (state == GATE_UNTESTED) {` … `        state = ggml_opencl_tile32_facts_ok(&env->facts, 0, ggml_opencl_tile32_unmeasured_override(), &reason)` /
  `              && views_canary(env, &reason)` / `              ? GATE_OK : GATE_FAILED;`
- Env `1` → `0` after the gate went green: `ggml-opencl-tile32-gate.cpp:102` and `ggml-opencl-tile32.cpp:120`
  (`    if (!ggml_opencl_tile32_facts_ok(&env->facts, size, ggml_opencl_tile32_unmeasured_override(), &why)) {`)
  now disagree; the import refuses on the model clause, which reaches
  `ggml_opencl_tile32_disable_locked` (`ggml-opencl-tile32-gate.cpp:85` `void ggml_opencl_tile32_disable_locked(const char * reason) {`)
  and disables the leg for the process with a reason that blames the device ("has no 740 model token") while the
  gate had said OK.
- Env `0` → `1` later: nothing happens, the device's `GATE_FAILED` is cached for the life of the process. A lab
  harness that sets the variable after the first OpenCL touch silently gets no override.
- Both call sites today pass the same expression (`grep` over the engine: only these two, plus the test), so the
  "they already disagree today" hypothesis is **REFUTED**; the divergence is env-timing-only.

## F7 (P3) — getenv on hot paths, and `bool` is the wrong parameter type for a safety switch.
Verdict: **PLAUSIBLE**

- `ggml-opencl-tile32-facts.cpp:90` runs on every call; the callers sit under `supports_buft`
  (`ggml-opencl.cpp:15234` TILE32 and `:15252` HOST-W branches) and `supports_op`
  (`ggml-opencl.cpp:10144`, per node of every graph built). The gate verdict is cached, the getenv is not.
  Cost is small next to the map lookup + mutex there, so this is a smell, not a stall.
- `bool unmeasured_ok` (`ggml-opencl-tile32-facts.cpp:28`) next to pointer parameters: pointer→bool is an
  implicit conversion, so a future caller that passes a pointer by mistake (e.g. the reason out-param in the
  3rd slot) compiles and is *always true* — the override silently on. No current caller does this; an
  `enum class` would make the mistake a compile error.

## F8 (P3) — test hygiene: env restore is correct on every reachable path; the contract it pins is thinner than
the header claims. Verdict: **CONFIRMED** (gaps), non-vacuity **CONFIRMED ok**

- Restore: `tests/test-tile32-opencl-gate.cpp:109-121` is straight-line code; `check()` cannot return early
  (`tests/test-tile32-opencl-gate.cpp:21-26`), so there is no failing/early-return path that skips the restore.
  The one hole is allocation failure: `:111` `    char * saved_env = env_before ? strdup(env_before) : NULL;` — if
  `strdup` returns NULL for a *previously set* variable, `:120` `        unsetenv("GGML_OPENCL_TILE32_UNMEASURED");`
  erases it instead of restoring it ("byte-for-byte" in the `:109` comment holds only when strdup succeeds).
- `#ifndef _WIN32` (`:108`) skips the whole env contract on Windows, where the engine still compiles the
  `getenv` branch; the other CI target therefore never exercises it.
- The "exact" contract of `facts.h:35` is not pinned: `:112-115` only try `"1"` and `"0"`. An implementation
  `return v != NULL && v[0] == '1';` passes both checks and wrongly admits `"10"`, `"1x"`, `"1 true"`.
- Not covered with the override on: `need_bytes > max_alloc_size` (only the override-off case exists at `:78`),
  and `nullptr` facts. Low value, but the override-on path is the one that matters.
- The warn-once logic has no test at all, and cannot have one here as written: ctest without
  `--output-on-failure` discards the stderr the warning goes to (see the Commands note — the WARN is invisible
  in `/tmp/audit-gate.log`).
- Non-vacuity: **refuted as a concern**. A no-op override fails `:91`; an always-admit override fails `:96`
  (missing dmabuf) and `:103` (non-Adreno); a partial waiver (model only) also fails `:91`, because the driver
  clause at `ggml-opencl-tile32-facts.cpp:53` would still refuse `"E031.45.0"`. The two "override off" cases
  (`:87`, `:89`) duplicate earlier verdicts but pin the reason string, which is the point.

## F9 (P3, angle 3) — with the env unset the verdicts and reason strings are byte-identical to `e2b8cc067` for
every input. Verdict: **CONFIRMED** (proof by reading)

Parent (`git show e2b8cc067:ggml/src/ggml-opencl/ggml-opencl-tile32-facts.cpp`), clause order and literals:
`    if (!has_model_token(facts->device_name, "740") && !has_model_token(facts->device_version, "740")) {` → reason
`"CL_DEVICE_NAME/CL_DEVICE_VERSION has no 740 model token"`; then `    if (!strstr(facts->driver_version, "E031.41.")) {` →
`"CL_DRIVER_VERSION is not on the E031.41. line"`; then ext, then max-alloc; null-facts and non-Adreno first.
New code: same five refusals in the same order with the same literals, each guarded by `!unmeasured_ok &&`
(`:47`, `:53`). With `unmeasured_ok == false` the guard is a no-op, `unmeasured_admit` (`:61`
`    const bool unmeasured_admit = !model_ok || !driver_ok;`) can only be reached when both clauses passed, hence
is false, hence the warn block is unreachable: no log, no state change. The only semantic deltas are (a)
`driver_ok` is computed eagerly even when the model clause already failed — both operands are non-null by the
`:31-36` check, so nothing observable; (b) the signature change, which breaks out-of-tree C++ callers at compile
time (not silently) and changes nothing else. No input exists for which the unset-env answer differs.

## F10 (P3) — reuse/altitude: the flag bypasses the seam that exists for exactly this, and the lab recipe is
incomplete. Verdict: **CONFIRMED**

- The device-facts snapshot is `ggml_opencl_tile32_env`, filled once per ask in
  `ggml-opencl.cpp:9975-9999` (`static void ggml_opencl_tile32_env_fill(...)`, ending
  `env->host_q6k_aos = &backend_ctx->host_q6k_aos;`). A field there would have made the flag testable through
  the existing host tests that build env structs (e.g. `test-tile32-host-ops.cpp`) and would have removed the
  two independent getenv reads; instead the flag is read three levels below the snapshot, which is why the
  caching interaction in F6 is untestable.
- The neighbouring helper for value-parsed knobs already exists —
  `ggml-opencl-kalsa-diag.cpp:51-58` (`bool ggml_opencl_env_value_enabled(const char * name) {` … `if (e[0] == '0' && e[1] == '\0') { return false; }`)
  with `bool ggml_opencl_env_value_enabled(const char * name);` in `ggml-opencl-kalsa-diag.h:47`. Exact-match
  `"1"` is the safer choice for a permissive knob, but the inconsistency is undocumented and
  `GGML_OPENCL_TILE32_UNMEASURED=true` silently does nothing (see F8).
- No documentation anywhere: no `.md` in the engine or the lab names this variable (grep over `docs/`,
  `PLAN.md`, `docs/ALIVE.md`); the only record is the in-code comment. The name describes the *device*, not the
  effect; `GGML_OPENCL_TILE32_LAB_ADMIT_UNMEASURED` would read as the waiver it is.
- The commit message reads as if this alone unlocks the leg on a 750/830. It does not: the HOST-W buft only
  exists when the Hexagon side enabled it (`ggml-hexagon.cpp:8451-8452` `opt_hostbuf_repack = shared_weights->enabled;` /
  `opt_hostbuf        = shared_weights->enabled;`, or `ggml-hexagon.cpp:8740` `    opt_hostbuf   = str_hostbuf  ? atoi(str_hostbuf) != 0                 : opt_hostbuf;`),
  and the HTP device must register, which it will for those parts only because
  `ggml-hexagon.cpp:8692` `    static constexpr int skel_archs[] = {73, 75, 79, 81};` matches `ggml-hexagon/CMakeLists.txt:80-83`
  (`build_htp_skel(v73)` … `(v81)`) and the binding ships those skels (`bin/arm64-v8a/libggml-htp-v75.so`, `-v79.so`,
  `-v81.so`). The recipe the next session needs is the pair (this env + `GGML_HEXAGON_HOSTBUF=1` or
  `set_shared_weights`), not one variable.
- Plan cross-check: `~/Projects/kalsa-moe-experiments/PLAN.md:1484-1489` makes the R2 negative control part of
  this work item — `need a lab-only override of the OpenCL "740"/E031.41 gate (coding) before any` …
  `correctness run; heat/speed claims only unplugged` … `(b) engine gate override + release v75/v79 skels (coder), then the Xiaomi overnight, plugged = correctness only (KL, self-checks, fence, R2 in-app`
  `negative control on an untested Snapdragon)`. The commit delivers only the engine half, and F2 says the engine
  half can no longer carry that negative control: the app-side run must assert the table, not the gate —
  `~/Projects/llama.rn-kalsa-onecopy/cpp/rn-llama.cpp:442-443` (`const rn_hw_facts hw_facts = rn_read_hw_facts();` /
  `const rn_leg_set leg_set = rn_legs_for(hw_facts);`) plus the `one_copy:%d` field of the `KALSA_LEGS_TABLE` line,
  because a test that greps "TILE32 leg not available" will start failing (or worse, passing for the wrong
  reason) the moment the pin carries this commit. The row that does the refusing is
  `cpp/rn-legs-table.cpp:68` `    { "SM8550", "Hexagon v73", "Adreno", "740", "E031.41.",` — five independent facts,
  none of which the engine gate now enforces.

---

## Angle answers, compact

1. **Shipped-path reachability.** Today: no (F1's pin evidence; `vendor` facts header is the 3-arg version).
   After any pin bump past this commit: yes — a plain process env read, no build flag, no app-side refusal,
   reachable by any embedder and by `setprop wrap.`. **Other gates** that could still refuse 750/830: none do —
   the J(1) fence re-asks the same widened gate; `get_adreno_gpu_gen` classifies (750→A7X, 830→A8X) rather than
   refusing; the AoS Q6_K admission is per-build + self-check, not per-device; wave size is hard-coded 64 with no
   query; image alignment is a `GGML_ASSERT`, not a decline; max_alloc and `IMAGE_MAX_BUFFER_SIZE` are real
   runtime checks. **Unmeasured-GPU code that now runs without its own model check**: the dma-buf import and its
   cache-policy fallback, the sub-buffer/image view construction, the fused norm-family kernels, f32 norm MUL,
   SSM_CONV (F3), and the two self-checked families (v4 TILE32, Q6_K) whose checks are single-tensor samples.
2. **Bugs.** Warn-once CAS is correct (F5 **REFUTED** as a bug); the *message* is wrong and provably fireable
   with the env unset (F5 **CONFIRMED**); reason strings with the override on are correct for the clauses that
   still refuse, but after an env flip the import reports a false clause and disables the leg with it (F6);
   `ggml-opencl-tile32-gate.cpp:102` and `ggml-opencl-tile32.cpp:120` pass the same value today and can diverge
   only across an env flip within the process (F6); getenv on hot paths is per-op and uncached (F7).
3. **Removed behaviour.** Byte-identical verdicts and reason strings with the env unset, for every input (F9).
4. **Test hygiene.** Env is saved and restored on every reachable path; no early returns exist; the only
   non-restoring path is strdup failure (F8). Cases are non-vacuous — a no-op, an always-admit and a
   partial-waiver implementation each fail a specific check (F8). Gaps: exact-match contract, override-on
   max_alloc, Windows, the warn-once behaviour (F8).
5. **Reuse/simplify, altitude.** Put the flag in `ggml_opencl_tile32_env` (F10); reuse
   `ggml_opencl_env_value_enabled` or document the deviation (F10); warn from the caller that actually read the
   env, not from the pure check (F5); an `enum class` instead of `bool` (F7); document the knob and the
   `GGML_HEXAGON_HOSTBUF`/`set_shared_weights` precondition (F10); make the R2 negative control assert the
   binding table, not the engine gate (F10).

**Verdict summary:** no P0, one P1 (F1: no code fence for a new env-controlled device admission on the
shipping line), four P2 (F2 fences, F3 unguarded weight families, F4 abort-instead-of-demote, F5 false warn),
five P3 (F6 cached-effect contradiction, F7 hot-path/type safety, F8 test gaps, F9 (no regression), F10
design/docs).
