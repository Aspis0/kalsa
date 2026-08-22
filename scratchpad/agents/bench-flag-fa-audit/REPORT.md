# Audit: kalsa/kernel-s3-repack — 815b8edc2 + b5ef768af

STATUS: COMPLETE
Auditor: hostile read-only review. Repo: `BigMoeOnEdge/third_party/llama.cpp` @ `b5ef768af` (working tree clean).

## Targets
- `815b8edc2` tools/llama-bench/llama-bench.cpp (+27/-3) — `--no-extra-bufts`
- `b5ef768af` ggml/src/ggml-opencl/ggml-opencl.cpp (+16/-9) — FA supports_op gate

---

## Commit 1: 815b8edc2 (llama-bench)

### B1. Polarity inversion — REFUTED
`llama-bench.cpp:1202`: `mparams.use_extra_bufts = !no_extra_bufts;`
Default (no flag): `no_extra_bufts=false` (`:399`) → `use_extra_bufts=true` → upstream
behavior unchanged. Flag present → `use_extra_bufts=false`.
Semantically identical to common plumbing: `common/common.cpp:1566`
(`mparams.use_extra_bufts = !params.no_extra_bufts;`) and `common/common.h:583`
(default `false`). No polarity bug.

### B2. Cross-product / reset between permutations — CONFIRMED (minor wart), no reset bug
- Correctly a single global bool per instance, cross-producted via
  `for (const auto & nxb : params.no_extra_bufts)` (`:1292`). Since the flag is
  valueless, the vector can only ever hold `{true}`×N.
- Survives model reloads: reload gate is `inst.equal_mparams(*prev_inst)`
  (`:2307`), and `operator==` now compares `no_extra_bufts` (`:1250`), so a
  transition 0→1 forces `llama_model_load_from_file` with fresh mparams
  (`:2309`). mparams rebuilt per instance (`:2262`). No stale-flag reuse.
- **Wart:** each occurrence of `--no-extra-bufts` pushes another `true`
  (`:866`). Passing it twice yields `{true,true}` → every test permutation runs
  twice identically. This matches existing tool behavior for duplicated
  comma-values (no dedup anywhere), so it's consistency-preserving, but a
  valueless flag makes accidental duplication trivial (`scripts` appending
  flags). Fix if desired: guard with `if (params.no_extra_bufts.empty())`.

### B3. Output formats — REFUTED (all four covered)
- `csv_printer` (`:1704`), `json_printer` (`:1768`), `jsonl_printer` (`:1788`),
  `sql_printer` (`:2089-2105`) are all generic over `test::get_fields()` /
  `get_values()` — no per-printer hardcoded column lists to drift.
- Field/value order aligned: fields `:1555` ↔ values `:1648-1651`
  (…`no_host`, `no_extra_bufts`, `fit_target`…).
- `get_field_type`: BOOL registered (`:1573-1575`) → JSON `true/false`, SQL
  `INTEGER`. Markdown: width 14 (`:1848-1850`), conditional header
  `:1984-1986` (shown iff flag passed — correct since `{true} != {false}`).
- Nits (cosmetic): no abbreviated display name in `get_field_display_name`
  (precedent: `noh`, `nopo`); usage string `(default: disabled)` (`:473`) is
  ambiguous next to neighbors that print explicit values. Neither breaks
  parsing.

### B4. Model-load path — REFUTED (applied correctly)
`use_extra_bufts` consumed in `make_cpu_buft_list` at model construction
(`src/llama-model.cpp:1246`), i.e. at load time, before any repack decision.
llama-bench loads per-instance with `inst.to_llama_mparams()`. The
`do_fit` path overwrites only `n_gpu_layers`/`tensor_split`/overrides
(`:2283-2285`) — does not touch `use_extra_bufts`.

### B5. Naming divergence from common — CONFIRMED (minor)
common/arg.cpp exposes this control as `-nr/--no-repack` (`common/arg.cpp:2171`,
env `LLAMA_ARG_REPACK`); llama-bench invents `--no-extra-bufts`. Not a bug, but
the commit message claims "upstream-friendly"; upstream review will flag the
name mismatch. Suggest accepting `--no-repack` as alias or renaming.

### B6. Perimeter — REFUTED (clean)
Exactly one file touched (+27/-3 verified via `git diff --stat`). Struct field,
defaults initializer (`:399`), usage, parse+fallback (`:1134-1136`), instance
field, all three instance construction sites (`:1334/:1372/:1410`), test struct
(`:1456`,`:1495`), operator== all updated consistently. Positional
`cmd_params_defaults` initializer insertion matches struct order.

---

## Commit 2: b5ef768af (OpenCL FA rejection)

### F1. Crash-site coverage (attack 5) — REFUTED (both sites gated)
Parent-commit unguarded `.at()` sites confirmed at `~:15724-15728` (prefill:
`f32_f16_split.at` / `f32_f16.at` / `f16.at` / `f32.at`) and `~:16265-16272`
(split k_img path). Current-file enumeration of every `.at()` in
`ggml_cl_flash_attn` (`:15477-~16500`):
- Unguarded base-kernel `.at()` (`f32_q8_0_q1`, `f32_q4_0_q1`, `f32_f16_q1`,
  `f16_q1`, `f32_q1`, `f32_f16`, `f16`, `f32`) are all reachable **only** for
  type-combos whose base variant supports_op now force-compiles via
  `ggml_opencl_ensure_fa_variant` (`ggml-opencl.cpp:7835-7840`). Base-variant
  registration provably populates every consumed map: F16/F32 register `{k,kq1}`
  (`:5095-5106`), Q8_0/Q4_0 register `{q1,prefill}` with CL_CHECK
  (`:5343-5346` region), F32_F16 registers prefill+q1 (+optional vec variants).
- Fall-through hazard (e.g. is_q8_0 with failed compile landing in the
  `f32_q1.at`/`f32.at` else-branch) is unreachable post-fix: supports_op rejects
  when the base variant fails, so dispatch never sees the tensor.
- Split/k_img/q1_vec/local_tile/FD/merge `.at()` sites are all preceded by
  explicit `count(dk_dv) > 0` guards (verified exhaustively, dispatch
  `:15580-15605`, FD block `:15857-15990+`).
- Variant mapping supports_op↔dispatch checked for every admitted combo incl.
  asymmetric KV (`is_f32_asym` → FA_VARIANT_F32 → dispatch else-branch GPU
  dequant path). Type combos that would mismatch (q F16/op F32 etc.) are
  rejected earlier by `kv_combo_ok`. No gap found.

### F2. dk==512 exemption — REFUTED (sound)
`if (dk != 512 && !ensure(...))` skips the new gate, but supports_op separately
admits dk=512 **only** for `is_f32_f16 && n_q>1 && !INTEL` AND successful
`ggml_opencl_ensure_fa_f32_f16_prefill_512(false)` (`:7848-7860`), which is
exactly the kernel dispatch reads at `f32_f16.at(dk_dv)`. Decode (n_q==1),
Intel, and non-mixed 512 configs are rejected outright. The split-512 path is
count-guarded in dispatch. No surviving throw path at 512.

### F3. Lazily-compiled failure-after-accept (attack 6) — REFUTED as crash vector; one behavioral note
Acceptance now requires compile success (`build_program_from_source_ex` with
`fatal=false`; null program → return false → CPU fallback). Failure is
memoized via `fa.variant_attempted` (`:5008-5013`).
**NOTE (PLAUSIBLE, low):** negative memoization is permanent for process
lifetime — a *transient* compiler OOM at first-touch permanently relegates that
(dk,dv,variant) to CPU with no retry. Same class as the pre-existing `static
bool failed[]` in `ensure_fa_f32_f16_prefill_512` (`:4877`). Acceptable;
document it.
**NOTE:** `CL_CHECK(clCreateKernel(...))` inside registration means a program
that builds but lacks an entry point aborts the process — now reachable from
supports_op. Pre-existing pattern (dispatch did the same); build-bug class only.

### F4. False rejection regression (attack 7) — REFUTED
`g_opencl_fa_dims` keys (`fa_tune.h:12-18`): {40,64,80,96,112,128}²,
192×128, 192×192, 256×256, 512×512 — byte-equivalent set to the deleted
`supported_dims[]` (verified against diff hunk). The only new rejection
condition is compile failure, which previously reached dispatch and threw from
`map::at` — i.e., strictly converts crashes into CPU fallbacks. No previously-
working config lost.

### F5. A7X carve-out composition (attack 8) — REFUTED (untouched, composes correctly)
Diff touches only the dims-array removal and the inserted ensure block; the A7X
block (`:7810-7817`) is pure diff context, byte-identical. Order: A7X rejection
runs **before** the ensure call, so the SIGSEGV-prone mixed/quant programs are
never compiled from supports_op on A7X. New code cannot accept anything the
carve-out rejected (it returns false earlier). Double-rejection impossible
(earlier return short-circuits).

### F6. State/order/threading (attack 9) — PLAUSIBLE (low)
- New code dereferences `backend_ctx` unconditionally (`:7838-7839`) while the
  A7X check 20 lines up guards `backend_ctx &&` (`:7810`) — inconsistent
  nullability contract. `dev_ctx->backend_ctx` is nullptr until
  `ggml_cl_init` (`:430`, `:5970-5976`). In practice every supports_op caller
  goes through a backend created by `ggml_backend_opencl_device_init` (which
  calls `ggml_cl_init`), and pre-existing cases (ARGSORT `:7541`) already deref
  unguarded — so not a live bug, but the new code widens the trap. Exact fix
  below if desired.
- supports_op now mutates `backend_ctx->fa` maps (compilation side effect).
  Scheduler invokes supports_op single-threaded per graph build and each device
  owns its context; no concurrency exposure found in-tree. Adding compilation
  inside a "query" interface remains a design smell (first-call latency spike
  inside sched split).

### F7. Perimeter (attack 10) — REFUTED (clean, builds substantiated)
- Each commit touches exactly one file (`git diff --stat` above). No MoE K
  kernel, K2/trans4, barrier-port, or harness files touched (those live in
  sibling commits 9a4112106 etc.).
- Build evidence verified, not taken on faith:
  - PC: `build-llama-pc/bin/llama-bench-impl.dll` (2026-08-21 19:56) contains
    the literal `no-extra-bufts`/`no_extra_bufts` (grep -a hit). Note the
    driver `llama-bench.exe` itself doesn't embed tool strings — impl DLL does;
    naive string-checking of the .exe gives a false stale verdict.
  - Android: `build-android-opencl-s3oracle/bin/libggml-opencl.so` rebuilt
    20:05:24 > commit time 20:03:20; `libllama-bench-impl.so` (20:07) contains
    `no_extra_bufts`; object `llama-bench.cpp.o` (20:07:34) contains it ×2.
    (`build-android-opencl-smoke` tree is stale Aug 19 — unused, irrelevant.)

---

## Verdict summary

| # | Finding | Verdict |
|---|---------|---------|
| B1 | Polarity inversion | REFUTED |
| B2 | Duplicate-permutation on repeated flag | CONFIRMED (minor, consistent w/ existing dedup-less design) |
| B3 | Output-format column break | REFUTED |
| B4 | Flag not applied at load / lost across reloads | REFUTED |
| B5 | Flag name diverges from common `--no-repack` | CONFIRMED (minor) |
| F1 | supports_op predicate ≠ dispatch map keys | REFUTED (coverage complete) |
| F2 | dk=512 exemption leaves crash path | REFUTED |
| F3 | Compile-fail-after-accept | REFUTED (crash); permanent negative memoization = PLAUSIBLE note |
| F4 | Regression on working head sizes | REFUTED |
| F5 | A7X carve-out broken/composed wrong | REFUTED |
| F6 | Null backend_ctx / side-effecting supports_op | PLAUSIBLE (low, latent) |
| F7 | Perimeter/build claims false | REFUTED (builds substantiated) |

No CONFIRMED correctness bug in either commit. Both commits do what they claim;
the OpenCL fix's coverage enumeration holds under exhaustive .at()-site audit.

Recommended (non-blocking) fixes:
1. `llama-bench.cpp:866` — `if (params.no_extra_bufts.empty()) params.no_extra_bufts.push_back(true);`
2. Consider aliasing `--no-repack` in llama-bench for naming parity with common/arg.cpp.
3. Optional hardening: early `if (!backend_ctx) return false;` at top of the
   FLASH_ATTN_EXT case (or rely on it and delete the redundant `backend_ctx &&`
   in the A7X check — pick one contract).

## Final: BANK

---

# c77fe1354 re-verify

Follow-up commit `c77fe1354` "llama-bench/opencl: align no-repack and guard FA"
(ggml-opencl.cpp 1 line; llama-bench.cpp 25+/23-). Working tree clean.

## (a) Rename completeness + hidden alias — PASS
- Parse (`llama-bench.cpp:865-870`): `arg == "-nr" || arg == "--no-repack" ||
  arg == "--no-extra-bufts"`. All three spellings accepted.
- Help (`:473`): shows `-nr, --no-repack (default: disabled)` only; alias
  **not** advertised ✓.
- Field renamed to `no_repack` at every consumption point: struct `:353`,
  defaults `:399`, fallback `:1136-1138`, instance field `:1188`, operator==
  `:1252`, cross-product loop `:1292`, all three instance ctors
  (`:1337/:1375/:1413`), test struct `:1456/:1497`, `get_fields()` `:1557`,
  `get_field_type()` BOOL `:1576`, `get_values()` `:1653`, markdown width 9
  (`:1850-1852`, equals strlen("no_repack") ✓), markdown conditional header
  `:1986-1988`. csv/json/jsonl/sql are generic over get_fields/get_values, so
  the column is coherent across ALL five outputs. `grep no_extra_bufts` in
  llama-bench.cpp and ggml-opencl.cpp → zero hits.
- Polarity unchanged: `mparams.use_extra_bufts = !no_repack` (`:1204`);
  default `{false}` → repack ON with no flag. Matches common.cpp:1566.
- Binary spot-check: Android `libllama-bench-impl.so` (rebuilt 20:33) contains
  `--no-extra-bufts` ×1 (parse-only, absent from help string ✓) and
  `-nr/--no-repack` ×2 (help + parse). NOTE on the PC dll: byte-search finds no
  `--no-extra-bufts` literal, but this is a demonstrated MSVC compare-emission
  artifact, not evidence — the same search misses parse literals for
  unquestionably-working pre-existing flags (`--no-host`, `--flash-attn`,
  `--mmap` each appear once = help only, while `--no-op-offload` appears twice).
  Source-level presence plus the unoptimized clang/Android binary settle it.

## (b) Dedup — PASS
- Parse pushes only when vector is empty (`:867-869`); since only `true` can
  ever be pushed, `{true,true}` permutations are impossible. Cross-product loop
  iterates ≤ once.
- Single flag → `{true}` ✓. No flag → empty at end of parse → defaults fallback
  `{false}` (`:1136-1138`) ✓ (fallback runs after the push, so parsed state
  wins).
- Markdown header condition still fires correctly for single flag
  (`{true} != {false}` default).

## (c) backend_ctx guard — PASS
- `ggml-opencl.cpp:7837`:
  `if (dk != 512 && (!backend_ctx || !ggml_opencl_ensure_fa_variant(...)))`
  — null context now REJECTS (CPU fallback) instead of dereferencing; valid
  contexts short-circuit past `!backend_ctx` into the unchanged ensure call.
  Accept/reject semantics identical for every non-null context; dk=512
  exemption untouched.
- Style-consistent with the null-tolerant A7X guard family (`backend_ctx &&`,
  `:7810`). No new state reads added before init.

## (d) Perimeter — PASS
- `--numstat`: ggml-opencl.cpp exactly 1 line changed (the guard); llama-bench.cpp
  changes are exclusively the rename + dedup + help line — full diff reviewed,
  no stray hunks, no formatting churn beyond the renamed lines.
- Zero `no_extra_bufts` identifiers remain in either file; working tree clean;
  nothing else staged/modified.
- Binaries rebuilt post-commit: PC impl.dll 20:30:13, Android libggml-opencl.so
  20:31:29, libllama-bench-impl.so 20:33:15 (> commit 20:29:41); Android .so
  carries both the new field name and the hidden alias literal.

## Final: LOCK

## Follow-up: c77fe135456b878e78f2840555eeb4acda34dda8

The three minor findings were fixed in one local follow-up commit:

- The advertised llama-bench spelling is now the common-compatible `-nr/--no-repack`, and the reported parameter field is `no_repack`. I kept `--no-extra-bufts` as a hidden parse-only compatibility alias because the earlier campaign work and custom wrappers used that spelling; help output advertises only the canonical name.
- Repeated valueless flags are deduplicated by pushing `true` only when the `no_repack` vector is empty, preventing duplicate benchmark permutations.
- The Flash Attention `supports_op` gate now rejects a missing `backend_ctx` before calling `ggml_opencl_ensure_fa_variant`, while leaving the A7X carve-out and negative memoization behavior unchanged.

Verification on the committed tree:

- PC `build-llama-pc`: `llama-bench` passed with Ninja `-j 8`. `llama-bench --help` printed `-nr, --no-repack (default: disabled)`.
- Android `build-android-opencl-s3oracle`: `test-backend-ops ggml-opencl llama-bench -j 8` completed; the definitive incremental rerun returned `ninja: no work to do.` with exit code 0. The first foreground invocation exceeded the tool timeout while its Ninja/Clang children continued and completed.
- Device-only limits remain: these PC-side builds do not prove that an 8 GB ARM device avoids the reported repack/OOM power-off, nor do they exercise the device OpenCL compiler/driver path for every unsupported Flash Attention head size.
