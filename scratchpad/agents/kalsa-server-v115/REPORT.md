# kalsa-server v1.1.5 fix branch — REPORT

Branch: `fix/v1.1.5` in the local worktree `~/Projects/kalsallama-v115`
(branched from `main` = `61c909481` = tag `kalsa-server-v1.1.4`).
Nothing pushed, no tags, no CI triggered. Build logs and proof scripts in
`~/Projects/kalsallama-v115/proof-logs/`; the archive-shaped staging dir used
for the runtime proofs is `~/Projects/kalsallama-v115/proof-stage/kalsa-server-v1.1.5-local/`.

## Commits (one per item, in order)

| commit | item |
|---|---|
| `f7cadf7de` | 1 — release workflow: build macos arm64 with CPU variants (SIGILL blocker) |
| `b6f994fc3` | 2 — truncated seq state file → clean 400 instead of process abort |
| `122b25697` | 3 — shared-view state IO WARN once per source cache |
| `e8f279d25` | 5 — dead `b11010-merge` push trigger removed |
| `2a803734f` | 6 — cross-device MTP alias refused before graph reserve |
| `e636ee126` | 4 — slot file model identity trailer |

## Item 1 — SIGILL blocker (macos arm64 native libggml-cpu)

Root cause confirmed: with `GGML_NATIVE` defaulting ON, the macos-26 runner
probes i8mm and bakes it into a monolithic libggml-cpu (284 smmla/ummla
instructions vs 0 in v1.1.2). First CPU decode dies on an M1 Max
(`hw.optional.arm.FEAT_I8MM = 0`) in `ggml_gemm_q6_K_8x8_q8_K`.

Fix (`.github/workflows/kalsa-server.yml`, macos matrix entry):
```
-DCMAKE_OSX_DEPLOYMENT_TARGET=13.3 -DGGML_NATIVE=OFF -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON
```
The Verify artifacts step now fails when any of `libggml-cpu-apple_m1.so`,
`libggml-cpu-apple_m2_m3.so`, `libggml-cpu-apple_m4.so`, `libggml-metal.so`,
`libllama.dylib`, `libllama-common.dylib`, `libmtmd.dylib`, `libggml.dylib`,
`libggml-base.dylib`, `libllama-server-impl.dylib` is missing, when a plain
`libggml-cpu` sneaks in (variants mode never produces one), and when
`libllama-server-impl.dylib` is renamed or loses the `x-kalsa-slot` tag
(exact-line `strings | grep -Fqx`, per the desktop app's probe at
`crates/kalsa-runtime/src/inlet.rs:29`).

### Local proof (this Mac IS the M1 Max, clang 21)

Exact new defines, into `build-macvariants` (UI built first via `npm ci` +
`npm run build`, matching the job), `-j 6`:

- `CONFIGURE_EXIT=0`, `BUILD_EXIT=0` (`proof-logs/configure.log`, `build.log`)
- `--version`: `0.5.0-dev (build 11585, commit 61c909481)` → `VERSION_EXIT=0`

smmla/ummla counts per variant (`otool -tv | grep -c`):

| module | smmla/ummla |
|---|---|
| `libggml-cpu-apple_m1.so` | **0** (required) |
| `libggml-cpu-apple_m2_m3.so` | 284 |
| `libggml-cpu-apple_m4.so` | 284 |

(284 = the count the v1.1.4 monolithic lib carried; it now only ships in the
modules whose tier actually has i8mm.)

Runtime, from the archive-shaped staging dir (modules beside the exe):

- `-ngl 0` (pure CPU): boot OK, `lsof` shows exactly
  `libggml-cpu-apple_m1.so` mapped in the live process, short chat generation
  `GEN_EXIT=0`, 27 tokens, **no SIGILL** (`proof-logs/`, `n0-server.log`).
- `-ngl 99` (Metal): boot OK, `libggml-metal.so` mapped, generation `GEN_EXIT=0`
  ("Hi."), no SIGILL (`n99-server.log`).
- `--list-devices`: BLAS (Accelerate) + MTL0 (Apple M1 Max).
- Workflow dependency audit run locally on the staged archive: 40 Mach-O
  files, 256 deps, every `@rpath` resolvable inside the archive (`BAD=0`).

Archive top-dir file list the workflow will produce (50 entries, local build):
`archive-filelist-local.txt` beside this report. Highlights: `kalsa-server`
and `libllama-server-impl.dylib` (exact name, contains `x-kalsa-slot` ×1)
side by side at the top level; the three `libggml-cpu-apple_*.so` variants;
`libggml-metal.so`; versioned dylib triplets with their symlink aliases.

## Item 2 — truncated slot file aborted the server

Mechanism: the buffered `llama_file` reader clamps reads at EOF
(`read_raw_unsafe`: `to_read = min(len, size - curr_off)`, silent no-op at
exact EOF), so a half-truncated state read "succeeds" with zero-filled
buffers, the restore applies the cell metadata, and the load walks into
`GGML_ASSERT(nread <= state_size)` at `src/llama-context.cpp:3359` (exit −6,
inside the server's try/catch which only sees exceptions). Upstream master
has no fix (`git log upstream/master -S 'nread <= state_size'` → only #6341
and the #10902 refactor), so no cherry-pick.

Fix: refuse the short state through the API's error path (`return 0` → C API
catch → server 400) and drop the half-restored sequence
(`memory->seq_rm(seq_id, -1, -1)`) so the failed restore leaves the sequence
empty like the other failure paths.

Tests: new `truncated` case in `test_state_restore_failure`
(`tests/test-save-load-state.cpp`, test 9): save, cut 10 % off the tail (keeps
cell metadata + per-layer headers intact so the cut lands in the bulk tensor
data), expect clean 0.

- Pre-fix (stash): exit 134, `llama-context.cpp:3359: GGML_ASSERT(nread <=
  state_size) failed` — the exact evidence signature (`proof-logs/test9-prefix.log`).
- Post-fix: exit 0, all 9 tests PASS (`test9-postfix.log`), and a 6-arch sweep
  passes: qwen-dense, llama-dense, gemma3-dense, granite_swa-dense,
  llama4-moe, kimi-linear-moe (`sweep-*.log`).

Server-level proof (gemma-4-12B + MTP drafter, Metal):
- 50 % truncation → HTTP 400 "Unable to restore slot…", server keeps serving,
  0 GGML_ASSERTs. On that file the cut landed where a parse error refuses
  first (still clean).
- Payload-anchored cut (appendix `SCKP` header found at 29 937 216; file kept
  to 26 943 494 = 90 % of the payload) → **the engine's own line fires**:
  `state_seq_load_file: truncated sequence state file: state size 26943118,
  read 29936840`, HTTP 400, `/v1/models` 200 afterwards, 0 asserts
  (`proof-logs/trunc-proof2-result.log`).

Note: the server slot file has no model identity and no payload checksum. A
bit-flipped or other-model file loads silently. Item 4 below fixes the model
identity half; a payload checksum was not added (not trivial, out of scope).

## Item 3 — shared-view state_write WARN spam

Both sites (`llama_kv_cache::state_write` and `::state_read_sinfo`,
`src/llama-kv-cache.cpp`) warned once per aliased view per call; one
save/restore printed the same line 12–18×. Now: first occurrence per **source
cache and direction** warns, repeats go to debug (`mutable
state_shared_write_warned / state_shared_read_warned` on the source the view
points at).

Proof (gemma-4-12B + MTP drafter, the v1.1.4 evidence shape): two saves →
**1** write WARN total (evidence: 18 per save); a prompt-cache eviction +
restore cycle (`cache_n` 17 of 21) → **1** read WARN; a second save/restore
server → 2 write warns for its whole life (two distinct source caches, first
occurrence each) vs 12–18 per event before.

## Item 5 — dead push trigger

`push: branches: [b11010-merge]` removed from `.github/workflows/kalsa-server.yml`;
only `kalsa-server-*` tag pushes run the workflow. YAML validated.

## Item 6 — cross-device MTP alias abort

Evidence confirmed on this Mac at
`~/lab/spec/lenovo-mtp/lab2/results/du-12b-ts55-n3-drRTX-probe.server.log:2215`:
`pre-allocated tensor (cache_k_l46) in a buffer (Vulkan1) that cannot run the
operation (NONE)`. Cause: the gemma4-assistant drafter aliases the target's
K/V (`share` callback in `llama_kv_cache`'s ctor); a drafter pinned with
`--spec-draft-device` to Vulkan0 has no backend for the Vulkan1 buffer, and
the sched's `ggml_backend_sched_backend_from_buffer` hard-aborts
(`ggml/src/ggml-backend.cpp:941`) during the load-time graph reserve.

Fix, at the aliasing site (`src/llama-kv-cache.cpp`, `share && other` branch,
before any tensor is wired): for each shared K/V tensor with an allocated
buffer, the scheduler must be able to keep it where it is — allowed iff the
buffer type is host-visible (the CPU backend claims host buffers; that is why
a CPU drafter over Metal-shared K/V works on Apple silicon) or one of this
model's devices supports the buffer type (`ggml_backend_dev_supports_buft`,
which also answers correctly for the split machinery's meta device). Otherwise
throw with both device names before graph reserve. The evidence scenario hits
the check because the drafter was pinned with `--spec-draft-device` (= the
drRTX runs): a single-device drafter gets no meta wrapper
(`common/speculative.cpp:2464`), so `model.devices` = [Vulkan0] and the
non-host Vulkan1 buffer is refused.

Behaviour on failure = **the server refuses to start**, matching how it
already handles a drafter failure: `llama_init_from_model` catches the throw
(`failed to initialize the context: …`), `common_speculative_init_result`
logs `failed to create MTP context`, and the server's load path errors with
`failed to create MTP context` and `return false` — the same refusal a drafter
model that fails to load already gets (`tools/server/server-context.cpp:1125`).

Local reproduction status, plainly: **the abort could not be reproduced on
this Mac.** Three configurations tried with the pre-fix binaries — CPU drafter
over Metal-shared K/V, CPU drafter over Metal-*private* K/V
(`GGML_METAL_SHARED_BUFFERS_DISABLE=1`), and normal Metal-everywhere — all
booted and generated with ~90 % draft acceptance, because on this Mac the
drafter's `model.devices` always includes Metal (device auto-detection is
independent of `--n-gpu-layers`) and Metal buffers are host-visible. The
check's predicate is exactly the aborting condition, so on the Windows
configuration (drafter device set = Vulkan0, non-host Vulkan1 buffer) it
throws before reserve with e.g. `cannot share KV cells: layer 3 would alias
the shared K tensor, which lives in a Vulkan1 buffer on device Vulkan1, but
this context runs on Vulkan0 - …`. Multi-GPU verification needs the desktop
team's Windows box.

No-false-positive proofs on this Mac (post-fix): CPU-drafter/Metal-target
boots and generates (draft acceptance logged), normal all-Metal path boots and
generates (`proof-logs/final-proofs-result.log`).

## Item 4 — slot file model identity

80-byte trailer at the very end of the slot file, after the checkpoint
appendix: magic `KSID`, version 1, `general.architecture` (48 bytes, NUL
padded), then `n_embd`, `n_layer`, `n_head_kv`, `n_vocab`, `n_ctx_train`, one
reserved u32. Chosen because it is free at save/restore time (all values read
from the already-loaded model — no hashing) and it catches every cross-model
restore that matters: different arch, different geometry, different vocab,
different ctx-train. It does NOT catch another quant of the same model
(identical fingerprint, dimension-compatible anyway) and it is not a payload
checksum (bit-flips stay undetected — out of scope per the brief).

Backward compatibility, concretely: on restore the trailer check runs before
anything is read; if the last 80 bytes do not carry `KSID` v1 (legacy save) or
the file is shorter than 80 bytes, the file loads exactly as before.
`load_slot_checkpoints` accepts the trailer both after an appendix and as the
only trailer when a save carried no checkpoints. On save the trailer is
appended after the appendix and before the atomic rename, so a failed write
leaves no committed file.

Proof results (`proof-logs/final-proofs-result.log`, `byte-id*.log`):

- same-model, same argv (Metal drafter): the new save's payload + appendix are
  **byte-for-byte identical** to the pre-item-4 `mtp-conv.bin`
  (0 differing bytes over all 39 114 668); the file is exactly 80 bytes
  longer and the trailer parses as `KSID` v1 with the gemma4 fingerprint
  (arch gemma4, n_embd 3840, n_layer 48, n_head_kv 8, n_vocab 262144,
  n_ctx_train 131072). Two saves from the same binary are byte-identical
  (deterministic). Caveat learned on the way: the appendix carries drafter
  state blobs, so a save with the drafter on a different device (CPU vs
  Metal) differs in those low bits — expected, unrelated to the format.
  (Note: BSD `cmp -n` rejected the flag and `-s` hid it; the comparison is
  done in python.)
- the pre-item-4 file `mtp-conv2.bin` (no trailer) restores **200** on the
  new build — the legacy path is intact;
- the 12B-saved file restored on a gemma-4-E4B server → **400** naming both
  fingerprints: `slot file was saved by a different model: saved gemma4
  (n_embd 3840, n_layer 48, n_head_kv 8, …), this server loaded gemma4
  (n_embd 2560, n_layer 42, n_head_kv 2, …)`; `/v1/models` answers 200
  afterwards, 0 aborts. (Same-arch different-size is exactly the case that
  used to load silently.)

## Verification discipline

Targeted only: `cmake --build` for the server + the two test targets,
`ctest`-registered `test-save-load-state` run directly over 6 dummy archs,
server-level curls for everything else. No full suite, no CI. All commands
logged with real exit codes under `proof-logs/`.
