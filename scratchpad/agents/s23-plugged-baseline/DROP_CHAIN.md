# S23 day-1 drop-chain — executed

Owner approval was received. Target device is the exact quoted serial `adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp`. Items #1 and #2 were retained; items #3–#13 were deleted exactly as listed, with every documented KEEP exception preserved. See `RUN_LOG.md` for every `rm` path and byte count.

## Required payload

| payload | PC path | bytes | PC SHA-256 |
|---|---|---:|---|
| OLMoE-1B-7B Q4_K_M | `models\OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf` (no exact file found under `models_staging/` or `results/`) | 4,213,513,024 | `3bd9ec48045f526508956ef663c5c11dbb3ef791a06f4e10a6be88379c40e1fe` |
| Marco1c-KEXP | `models\Marco-Mini-Instruct-KEXP.gguf` (canonical PC copy; no exact file found under `models_staging/` or `results/`) | 6,385,238,848 | `2f921958540115384879eff2eeabfc7087597b245d32b0f515d9ce7b7414d777` |
| barrier-safe test backend | recorded PC build path in `results\barrier_verify_s23\pc_sha256.txt` | 10,182,432 | `9a3fd4b07dd2edce2723ce2d17503f76d2b6bea0d254d616e3de199456b587bc` |
| llama-bench + impl | recorded PC build path in `results\barrier_verify_s23\pc_sha256.txt` | 4,260,760 | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` / `8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807` |

The exact OLMoE target is already present at `/data/local/tmp/s3oracle/` by size+mtime policy. The exact Marco target is not present on the device. Required new model bytes are therefore primarily the 6,385,238,848-byte Marco file; current free space is 8.0G decimal-rounded by `df`.

The test-backend direct dependency slice is approximately 30 MB (`test-backend-ops` plus the ggml shared libraries); the exact pinned copy is already in `s3oracle`. `llama-bench` plus `libllama-bench-impl.so` is 4,260,760 bytes, with its shared dependencies likewise already present in the pinned directory.

## Ordered candidates

| order | device path / group | size | disposition | PC copy / verification | reason |
|---:|---|---:|---|---|---|
| 1 | `/data/local/tmp/Marco-Mini-Instruct.i1-Q4_K_M.gguf` | 10,505,424,704 | KEEP | Marco PC copy exists, but target is 6,385,238,848 bytes; device GGUF hash intentionally not recorded | owner-approved retained Marco file |
| 2 | `/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf` | 6,509,642,624 | KEEP | Marco PC target exists, size differs by 124,403,776 bytes; no device GGUF hash by policy | owner-approved retained Marco file |
| 3 | `/data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf` | 3,928,037,856 | DROP-CANDIDATE | PC Q4_K_M target exists; size differs; no exact Q4_0 PC archive located | old quant superseded by pinned Q4_K_M |
| 4 | `/data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf` | 3,580,407,296 | DROP-CANDIDATE | no exact PC copy located in the searched archives | historical from-source experiment |
| 5 | `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf` | 3,326,160,384 | DROP-CANDIDATE | PC `models\LFM2.5-8B-A1B-KEXP.gguf`, same size 3,326,160,384, PC SHA `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4`; device GGUF hash not recorded | historical, not a Phase 1 model |
| 6 | `/data/local/tmp/kalsahtp/Qwen3.5-4B-Q4_0.gguf` | 2,583,221,408 | DROP-CANDIDATE | PC `models\draft\Qwen3.5-4B-Q4_0.gguf`, same size; PC SHA `298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb` | historical HTP/NPU model, not Phase 1 |
| 7 | non-model, non-pinned remainder of `/data/local/tmp/kalsahtp/` | 154,809,300 | DROP-CANDIDATE | no exact runtime archive match claimed; exact `libc++_shared.so`/`libomp.so` excluded | old HTP runtime/scripts/logs after the Qwen model decision |
| 8 | non-pinned files in `/data/local/tmp/kalsahtp_f2b/` | 139,862,688 | DROP-CANDIDATE | no exact live PC archive in the named roots; exact `libc++_shared.so`/`libomp.so` excluded | historical HTP F2b payload |
| 9 | `/data/local/tmp/q53_v73_npu_correctness/` | 131,862,222 | DROP-CANDIDATE | logs only; no device/runtime pin | historical v73 evidence; retain on PC before any approval if needed |
| 10 | `/data/local/tmp/bmoe/` (recursive) | 124,821,922 | DROP-CANDIDATE | device `bmoe-cli` is 6,242,576 bytes / `ae9a...`; PC ship runtime is 6,362,168 bytes / `0ac612...`: mismatch | stale product payload; PC copy exists but is not byte-identical |
| 11 | non-pinned files in `/data/local/tmp/s15vk/` | 191,794,219 | DROP-CANDIDATE | no exact current PC pin claimed; exact `libc++_shared.so`/`libomp.so` excluded | historical Vulkan payload; exact shared runtime pins are KEEP |
| 12 | non-pinned files in `/data/local/tmp/k22` and `/data/local/tmp/k2ref` | 25,273,629 + 25,075,528 | DROP-CANDIDATE | old test-backend hashes differ from current barrier-safe record; exact `libc++_shared.so` and `libomp.so` are KEEP | historical K2 test binaries/libs; together ~48.2 MiB |
| 13 | non-pinned files in `/data/local/tmp/s3base`, `s3fix`, `s3printf` | 147,586,344 + 147,585,176 + 147,659,640 | DROP-CANDIDATE | no current PC archive match; exact `libc++_shared.so`/`libomp.so` in each are KEEP | historical S3 variants; together ~422.1 MiB |

The original candidate pool above was **31,669,224,940 bytes (about 29.49 GiB)**. The approved deletion removed 14,654,157,612 bytes across 166 files. The two Marco files in orders #1/#2 remain.

## Mandatory KEEP rules

KEEP `/data/local/tmp/s3oracle/` in full, including the OLMoE target and all current runtime files. Never propose deleting any `ship_runtime_*` binary/library, any current/pinned kalsakernel `.so`, `q56_thermal_watchdog`, `_gguf_keep`, or any Termux path/artifact. Keep exact `libc++_shared.so` and `libomp.so` duplicates in historical groups unless the orchestrator separately authorizes a file-level cleanup.
