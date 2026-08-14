# Kalsa Kernel — day-zero playbook (K-N)

This is the kit README. The deliverable is the runnable kit, not this
file. Definition of done: a new architecture goes from an HF drop to
"measured + fast-or-triaged" by one engineer in ≤2 days using only what
is in this repo.

Contracts and budgets: [kernel-contracts.md](kernel-contracts.md).
Product definition: the library in `core/kernel/` (plan v2 §1).

Do not patch `third_party/llama.cpp` in-tree. A new kernel that cannot
live behind the public API is a discussion, then a 1-commit fork branch
on `Helldez/llama.cpp`, never a dirty submodule.

## 0. Build the kit

Host (this is a shared PC — keep `-j` modest):

```
git submodule update --init --recursive
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j 4
ctest --test-dir build --output-on-failure
```

Windows: `ggml.dll` / `llama.dll` live in `build/bin`. `ctest` prepends that
directory via `ENVIRONMENT_MODIFICATION`, and `tests/kernel_ci/run.py`
prepends the binary's dir + `build/bin` to `PATH` before spawning. A
fresh-shell `ctest --test-dir build` should just work. Invoking a binary
by hand still needs `build/bin` on `PATH`:

```
# pwsh
$env:PATH = "$(Resolve-Path build/bin);$env:PATH"
```

Android CLI: `pwsh scripts/build-android.ps1` (NDK). Never reuse another
campaign's install directory.

Gates that must stay green: `config_validate`, `ngram_draft`,
`chat_parse`, `think_control`, `kernel_dispatch`, `moe_gates_*`.

## 1. Convert + smoke

We have already done a first-ever safetensors→GGUF of an lfm2moe REAP in
one night. The path:

```
# upstream converter (submodule). Architecture-specific; read its --help.
python third_party/llama.cpp/convert_hf_to_gguf.py /path/to/hf --outfile model.gguf --outtype q8_0
# then quantize if the drop is not already the product quant
# build/bin/llama-quantize   (only if you built llama.cpp tools)

# engine smoke — tiny first if the arch is new
python scripts/make-tiny-moe.py --arch qwen3moe --out build/tiny-moe-qwen3moe.gguf
build/cli/bmoe-cli -m build/tiny-moe-qwen3moe.gguf -n 16 -t 4
```

New MoE family: add a recipe row in `core/src/moe/arch_registry.cpp` and
a tiny-model arch in `scripts/make-tiny-moe.py`, then extend
`tests/CMakeLists.txt` so `moe_gates_<arch>` runs. Walkthrough:
[adding-a-model.md](adding-a-model.md). `--list-archs` prints what the
binary already knows.

If `--list-archs` does not name the family, **stop**. Do not hardcode
expert counts in the streaming path.

## 2. Bench the fallbacks

Find where the new arch runs a slow path. Two existing assets, one
keyed runner:

```
# S3b matrix (built by this repo): host vec_dot vs CPU_REPACK on the
# Mellum-class ID/GEMV shapes. Edit the `cases[]` table in
# tests/test-s3-repack-bench.cpp to add the new op's shapes.
build/tests/test-s3-repack-bench -t 2

# S2 / backend-ops oracle. Built only if you turn llama.cpp tests on
# (this repo leaves LLAMA_BUILD_TESTS=OFF). On an S2 pin:
#   test-backend-ops test -b CPU -o MOE_SWIGLU_ID     # 7/7
# On the stock pin the fused op does not exist; the runner probes
# --list-ops and falls back to MUL_MAT_ID. A run that executes 0 tests
# is a hard fail (never a green record).

python tests/kernel_ci/run.py --build build --out results/kernel_ci
```

The runner writes `kernel_ci.csv` + `kernel_ci.json` keyed by
`(model, quant, shape, device, temperature, commit)`. Schema:
`kalsa-kernel-ci/v1`. Keep the raw logs next to them.

On a phone: UNPLUGGED, battery floor 45%, abort 43 °C, cold `fadvise`
between timed cells, **screen Awake** (`dumpsys power` /
`mWakefulness`). Dozing numbers are not product numbers. Record the
column. See [benchmark-method.md](benchmark-method.md).

Honesty gate before writing a kernel: if the alternative path's
token-model delta is < ~10% of the contract floor for that device
(0.0148 s/tok of the S23 Mellum 0.148), stop. S3 closed on that rule.

## 3. Write the missing kernels (S2 discipline)

Only after step 2 names a real hole.

- Geometry from tensors at runtime. No `64` / `8` / `896` / `2304` / `28`
  in the kernel. The S2 matcher is the template (predicates listed in
  [kernel-contracts.md](kernel-contracts.md)).
- Same contract header: `core/kernel/contract_mul_mat_id.h`. Add a shape
  row if the new op is still `mul_mat_id`; add a new
  `core/kernel/contract_<op>.h` if it is not.
- Oracle: NMSE ≤ 5e-4 vs `use_ref`. `test-backend-ops` case for the op.
- Greedy determinism: ON==ON, OFF==OFF. `ON!=OFF` is a documented
  `DETERMINISTIC_REORDER` class, not a silent pass — n=256, not n=32.
  Reorder-class impls also need a PPL gate.
- Fallback is always stock `vec_dot` / the unfused graph.
- Matcher review is adversarial (siblings, shape change, external uses
  of the fused span). `ggml_can_fuse` is not enough for MoE FFN.

This repo's engine does not patch llama.cpp. A CPU kernel that has to
live in ggml goes on a named fork branch and is consumed here only via
the public API plus, if unavoidable, the existing expert-ready hook
pattern ([seam.md](seam.md) §3).

## 4. Autotune probe

The dispatcher **is** the autotune. Static table first, probe later.

```
# apply the measured U-curve (default OFF). On a PC this resolves to
# the same defaults as a run without the flag (t=4, model k, drop off).
# User/env flags win over the table. A k/drop row prints a WARNING —
# those knobs change model output.
build/cli/bmoe-cli -m model.gguf -n 32 --kernel-dispatch
# stderr:
#   bmoe: kernel-dispatch ON  key=host/*  soc=host  ...
```

U-curve seed (do not "fix" from a spec sheet):

| SoC | threads | extra |
|---|---:|---|
| S23 / SM8550 / 8 Gen 2 | 2 | Mellum geometry → k=6 drop=1.0 |
| Xiaomi 14 / SM8650 | 4 | t4 > t5 > t6 |
| Jelly / MT6789 / G99 | 2 | LFM geometry → k=4 |

The CLI peeks GGUF metadata before load so those geometry extras actually
fire (arch + expert/embd/ffn dims). `-t 8 --kernel-dispatch` keeps 8
threads.

First-launch micro-bench: interface + stub in
`core/kernel/dispatch.h` (`run_autobench_stub`, cache path
`kalsa-kernel/dispatch-v1.json`). **Not implemented.** When it is, the
CLI will pass a cache directory (core/ never calls `getenv`). Until
then the static table is the whole probe.

`DeviceProfile.ram_mb` is detected and logged but **not consulted**.
Tiers are compute-class × measured RAM, not the spec sheet — but the
table cannot express a RAM tier until the probe exists, so the static
U-curve row wins today (including `sd8gen2/mellum`). Do not encode
"this SoC is flagship" as a `ram_mb` cutoff.

## 5. Upstream what generalizes

Precedent: the Q6_K OpenCL dispatch fix (greedy token-identical where
upstream was garbage, plus a regression test). S1+S2+matcher is the
next PR-shaped artefact — on the fork, not as an in-tree diff here.

A day-zero kernel that is really "our layout + our hook" stays here,
behind the contract. A day-zero kernel that is "ggml was missing a
shape" goes upstream so the next submodule bump does not fork-drift.

## File map

| path | role |
|---|---|
| `core/kernel/contract_mul_mat_id.h` | kernel #1 ABI: shapes, NMSE, determinism, budgets |
| `core/kernel/dispatch.{h,cpp}` | SoC/RAM/geometry → {t, k, drop, impl} + autobench stub |
| `core/src/moe/probe_geometry.cpp` | GGUF peek → `ModelGeometry` (llama adapter) |
| `cli/main.cpp` | `--kernel-dispatch` (default off; user flags win) |
| `tests/kernel_dispatch_test.cpp` | table + contract constants (`ctest -R kernel_dispatch`) |
| `tests/test-s3-repack-bench.cpp` | S3b matrix (copied source; submodule untouched) |
| `tests/kernel_ci/run.py` | keyed CSV/JSON envelope |
| `scripts/make-tiny-moe.py` | convert-smoke fixture |
| `core/src/moe/arch_registry.cpp` | new-arch recipe rows |

## What this kit will not do

It will not make S23 big-tier ≥7 tok/s. Measured floor is 0.148 s/tok
compute → ~6.75 even with flash at zero; k6d10 t2 wall is 5.151. Owner
decision 2026-08-14: S23-class big-tier = 5–6 tok/s. The 7–9 ambition
moved to flagship/residency. Self-speculation is the only candidate
that could reopen that, and it is not a kernel.
