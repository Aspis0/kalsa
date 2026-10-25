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
| `df7b761da` | audit B1 — drop `grep -q` from piped verify gates under pipefail |
| `aa779173e` | audit — remove the tautological rename gate (presence loop guards the name) |
| `c1a238f37` | audit — refuse a slot file whose identity trailer has an unknown version |
| `d6d1f5ee5` | audit — correct the cross-device alias check comments |

## Audit-fix pass (post-pi audit, 2026-10-01)

Four commits on top of `e636ee126` (`61c909481..d6d1f5ee5`), one per audit
item. No push, no tag, no CI.

**B1 — the verify gate killed the release on a good archive.** All three
`producer | grep -q` gates now drain the producer instead of exiting at the
first match (`grep -Fx/-x/-E … >/dev/null`): the `strings | grep -Fqx
'x-kalsa-slot'` macOS gate (`:662`, `strings` on a multi-MB dylib died of
SIGPIPE under `pipefail` → 141 → step failed 5/5), the `tar -tzf | grep -qx`
manifest leg (`:1073`), and the `7z l -slt | tr | grep -Eq` Windows leg
(`:2434`). `file -b` (single line), `printf` producers and herestring greps
are single-write / no-pipe and stay as they were.

Proof of the fixed block, extracted verbatim from the workflow into a
`/tmp` script running `/bin/bash` 3.2.57 with `set -euo pipefail`:

```
run1 EXIT=0
run2 EXIT=0
run3 EXIT=0
run4 EXIT=0
run5 EXIT=0
stripped EXIT=1
libllama-server-impl.dylib does not carry the x-kalsa-slot inlet tag
```

against `proof-stage/kalsa-server-v1.1.5-local` (tag present ×1); the stripped
case is the same dylib with the tag's first byte flipped in place (valid
Mach-O, exact-line match gone).

**Unknown trailer version → clean 400.** `check_slot_identity` used to fold
KSID-with-unknown-version into the legacy path; now no-`KSID`-magic loads as
legacy and a `KSID` magic under any other version throws, mirroring
`load_slot_checkpoints`' refusal of an unknown appendix version.

**Server smoke** (rebuilt `build-macvariants/bin/llama-server`, `-j 4`,
`SERVER_BUILD_EXIT=0`; dummy models from the test fixture, CPU, port 8093;
transcript `proof-logs/auditfix-smoke-out.txt`):

| request | HTTP | note |
|---|---|---|
| save slot (gemma3-dense) | 200 | file = 124 bytes (state + 80-byte trailer) |
| restore, same model | **200** | |
| restore, KSID version patched 1→2 | **400** | `unsupported model identity trailer version 2, this server understands version 1` |
| restore, trailer stripped (legacy) | **200** | backward compat intact |
| restore, saved by gemma3 on an lfm2 server | **400** | `slot file was saved by a different model: saved gemma3 (…), this server loaded lfm2 (…)` |
| `/health` after all of the above | 200 | server kept serving |

(The gemma3/lfm2 dummy pair differs only in the arch string — same geometry —
which is also a live demonstration of the limit stated in item 4 above.)

**Targeted test** (`build-test`, `test-save-load-state` rebuilt `-j 4`,
`TEST_BUILD_EXIT=0`; `ctest -R 'test-generate-models|test-save-load-state'`):
fixture PASS, `test-save-load-state` **FAILED** — 127/128 PASS, one arch
failing the `rf` (restore-failure) column:

```
minimax-m3-moe.gguf  rf: E test_state_restore_failure: truncated: sequence not empty after failed restore
```

**Pre-existing, not from this pass**: the entire `src/` delta since
`e636ee126` is comments in `src/llama-kv-cache.cpp` (zero non-comment line
changes — the preprocessed translation unit is unchanged), and the test does
not link `tools/server`, so its binary is behaviorally identical to the
pre-audit-fix branch. The failure is item 2's `truncated` cleanup hole on that
arch, invisible until now because the earlier runs swept only 6 archs
(single-model repro: `proof-logs/auditfix-minimax-single.log`, `EXIT=1`).
Flagged to the coordinator; **not fixed here** (out of the brief).

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
`libllama-server-impl.dylib` loses the `x-kalsa-slot` tag (exact-line
`strings | grep`, drained with an explicit `>/dev/null` — a `grep -q` there
kills `strings` with SIGPIPE under `pipefail` and fails the step 5/5 on a
correct archive; fixed in `df7b761da`). A missing/renamed
`libllama-server-impl.dylib` is caught by the presence loop above the gate
(the tautological `basename` check that claimed to guard the name was removed
in `aa779173e`), per the desktop app's probe at
`crates/kalsa-runtime/src/inlet.rs:29`.

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
buffer type is host-visible (host memory is readable from any backend in
place; note this never applies to GPU memory — all three Metal buffer types
report `is_host == false`, and a CPU drafter over Metal-shared K/V works
because device selection does not depend on `-ngl`, so the drafter's device
list still contains the owning Metal device) or one of this model's devices
supports the buffer type (`ggml_backend_dev_supports_buft`; a meta device
accepts only its own buffer type with an identical wrapped device set, which
is exactly the tensor-split case — `model.devices` holds the one meta device
and the shared K/V buffers use its buffer type). Otherwise
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
from the already-loaded model — no hashing) and it catches every cross-geometry
restore: different arch, different geometry, different vocab, different
ctx-train.

**What it does NOT catch — the identity check's limit, stated plainly.** The
fingerprint is shape-only, so anything with the same arch and the same five
numbers still restores silently:

- a **fine-tune** of the same model (same shape, different weights);
- an **IT vs base sibling** (same repo, different weights);
- **another quant of the same model** (identical fingerprint,
  dimension-compatible anyway);
- a **different `--lora` adapter** active at save vs restore;
- a **bit-flipped / corrupted payload** under a valid matching trailer — the
  audit measured 100 zeroed payload bytes restoring with HTTP 200 and a
  fluent-but-wrong answer, health 200, 0 aborts.

The trailer refuses cross-*geometry* swaps and nothing else. It is not a
payload checksum (bit-flips stay undetected — out of scope per the brief).
Also, `n_head_kv` does not discriminate MQA: it is 0 for MQA architectures
(measured 0 for LFM2.5), so for those the effective fingerprint is
arch + n_embd + n_layer + n_vocab + n_ctx_train — one of the five numbers is
inert there. It does catch every cross-model restore that matters for
same-family swaps of different sizes, which is the case that used to load
silently.

Backward compatibility, concretely: on restore the trailer check runs before
anything is read; if the last 80 bytes do not start with `KSID` (legacy save)
or the file is shorter than 80 bytes, the file loads exactly as before. A file
that does carry `KSID` under an unknown version is refused with a clean 400
(`unsupported model identity trailer version`, same policy as
`load_slot_checkpoints` for an unknown appendix version), so a file from a
future release never half-loads as a legacy save.
`load_slot_checkpoints` accepts the trailer both after an appendix and as the
only trailer when a save carried no checkpoints. On save the trailer is
appended after the appendix and before the atomic rename, so a failed write
leaves no committed file.

**Forward compatibility (fine for the app, worth a release note):** a v1.1.5
slot file is refused by a v1.1.4 server — the old loader only knows `SCKP`
there, so the restore 400s with a message about a checkpoint appendix the
v1.1.4 user never heard of ("unknown data after the state payload", or
"trailing bytes after the context checkpoint appendix" when the save carried
checkpoints). No crash, no silent misread; the desktop app ships engine and
models together, so this only bites a manual app rollback with slots saved by
the newer engine.

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

## Follow-up: the exception half of the seq-restore cleanup (commit 63a51b6d6)

The b6f994fc3 truncation refusal left a hole on the throwing path, exposed by
the new test-suite run: on minimax-m3-moe the `truncated` case of test 9
failed with `state_read_data: mismatched value type (1 != 256, layer 1)` ->
`failed to restore kv cache` -> `truncated: sequence not empty after failed
restore` (127/128). Root cause: multi-cache memories restore their caches one
after another and only the failing cache undoes itself — `llama_kv_cache_msa::
state_read` restores `kv_base` then `kv_idx` with no undo, so when the indexer
cache threw, `kv_base` kept the cells it had already restored for the target
sequence (`seq_pos_max` is checked on `kv_base`). `llama_kv_cache_iswa` and
`llama_memory_hybrid_iswa::state_read` have the same shape; only
`llama_memory_hybrid` undoes its attention part on a recurrent failure.

Fixed in one place (`src/llama-context.cpp`, `state_seq_read_data` — the
shared funnel of `state_seq_set_data`, backing `llama_state_seq_set_data` and
`..._set_data_ext`, and `state_seq_load_file`, backing
`llama_state_seq_load_file`): the catch drops the target sequence with
`memory->seq_rm(seq_id, -1, -1)` — same cleanup as the b6f994fc3 truncation
branch — before rethrowing. Full-range `seq_rm` is non-throwing and
assert-safe on kv-cache, msa, iswa, recurrent (`set_rs_idx` asserts bounds
already guaranteed by the restore itself) and hybrid memories. Whole-context
restores go through `state_read_data`, which does not share this helper —
untouched. The whole-context path is unaffected by the change.

Verified (logs under `proof-logs/`, prefix `fix-seqrm-`):

- `cmake --build build-test --target test-save-load-state -j 4` EXIT=0;
  `ctest -R 'test-generate-models|test-save-load-state'` EXIT=0 (2/2), and the
  binary directly: `main: summary: 128 passed, 0 failed (of 128)`,
  minimax-m3-moe row all PASS including `rf`;
- `cmake --build build-macvariants --target llama-server -j 4` EXIT=0, restaged
  into `proof-stage/kalsa-server-v1.1.5-local/`, trunc-proof2.sh rerun: restore
  of the payload-cut slot file **400**, `/v1/models` **200**, SERVER_EXIT=0,
  0 GGML_ASSERT, same engine line `state_seq_load_file: truncated sequence
  state file: state size 26943118, read 29936840`. No push, no tag, one commit.
