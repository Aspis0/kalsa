# Kernel CI packaging

Keyed envelope around assets that already exist. No new kernel math.

## What it runs

| asset | binary | where it lives |
|---|---|---|
| S2 / backend-ops oracle | `test-backend-ops test -b CPU -o MOE_SWIGLU_ID` | llama.cpp tests (present on the S2 pin; stock pin probes `--list-ops` and falls back to `-o MUL_MAT_ID`). A log with `0 tests passed` is a hard fail — never a green record. |
| S3b microbench matrix | `test-s3-repack-bench` | `tests/test-s3-repack-bench.cpp` (source copied from `kalsa/kernel-s3-repack`; submodule left on the repo pin) |
| Dispatcher table | `bmoe_kernel_dispatch_test` | `ctest -R kernel_dispatch` (always, part of the normal gates) |

Results are keyed by `(model, quant, shape, device, temperature, commit)` as CSV + JSON.

## Run

From the repo root, after a host build:

```
python tests/kernel_ci/run.py --build build --out results/kernel_ci
```

`--threads N` / `--runs N` forward to the S3b bench. `--skip-ops` / `--skip-s3` drop a leg.

The runner prepends the found binary's directory and `build/bin` to `PATH`
before spawning, so a fresh Windows shell can resolve `ggml.dll` / `llama.dll`.
A nonzero rc with no parseable rows is a hard fail (readable message), not a
poisoned green record.

`test-backend-ops` is **not** built by this repo (llama.cpp tests stay off — they are heavy and the PC is shared). Build it from the submodule if you need the MOE_SWIGLU_ID 7/7 on a pin that has those cases. The runner finds it anywhere under `--build` or skips that leg. If the binary is present, the ops leg must actually run tests (`N tests passed` with N>0) or it fails.

The S3b binary **is** built (`test-s3-repack-bench` next to the other tests). It is not a ctest: it is a timed matrix, not a byte-identity gate.
