# AUDIT — kalsa-server v1.1.5 (`fix/v1.1.5`, `61c909481..e636ee126`)

Auditor: pi (hostile pass). Worktree read-only; every experiment ran in
`/tmp/audit-v115` (a copy of `proof-stage/kalsa-server-v1.1.5-local` plus
crafted slot files), removed afterwards. No CI, no push, no tag, no edit in
`~/Projects/kalsallama-v115`.

## Verdict

**FIX FIRST.** One blocker, and it is in the release workflow, not the engine:
the new `x-kalsa-slot` gate in the macOS verify step **fails on a correct
archive** (SIGPIPE + `pipefail`), so `kalsa-server-v1.1.5` cannot be published
as written, and it fails with a message that accuses the engine of a missing
tag it actually carries. Everything else in the six commits holds up under the
tests I ran; the remaining findings are disclosure/robustness items, not
release blockers.

The one substantive gap worth putting in the release notes: the KSID trailer
catches cross-*geometry* model swaps and nothing else. A fine-tune, an
IT/non-IT sibling, a rope change or an adapter swap — same arch, same dims,
same vocab — is still accepted silently, and I showed a corrupted payload
restoring with HTTP 200 and a plausible-but-wrong answer.

---

## BLOCKERS

### B1 — the new verify gate kills the release on a good archive (SIGPIPE + pipefail)

`.github/workflows/kalsa-server.yml:662`

```bash
if ! strings "$BIN/libllama-server-impl.dylib" | grep -Fqx 'x-kalsa-slot'; then
  echo "libllama-server-impl.dylib does not carry the x-kalsa-slot inlet tag" >&2
  exit 1
fi
```

The step runs under `set -euo pipefail` (`.github/workflows/kalsa-server.yml:605`).
`grep -q` exits at the first match, the pipe buffer fills, `strings` dies of
SIGPIPE (141), and `pipefail` hands the pipeline that 141. `if ! <141>` is
true → `exit 1`.

Reproduced with the writer's own staged archive (the tag **is** present):

```
$ cd /tmp/audit-v115 && for i in 1 2 3 4 5; do bash sigpipe.sh > out.$i 2>&1; echo "run$i EXIT=$?"; done
run1 EXIT=1
run2 EXIT=1
run3 EXIT=1
run4 EXIT=1
run5 EXIT=1
$ tail -1 out.5
libllama-server-impl.dylib does not carry the x-kalsa-slot inlet tag

$ strings stage/libllama-server-impl.dylib | grep -Fqx 'x-kalsa-slot'; echo rc=$?   # no pipefail
0
$ set -o pipefail; strings stage/libllama-server-impl.dylib | grep -Fqx 'x-kalsa-slot'; echo rc=$?
141
$ set -o pipefail; strings stage/libllama-server-impl.dylib | grep -Fx 'x-kalsa-slot' > /dev/null; echo rc=$?
0
$ strings stage/libllama-server-impl.dylib | grep -c 'x-kalsa-slot'
1
```

5/5 deterministic, `/bin/bash` 3.2.57 (what a macOS runner uses).
**CONFIRMED — BLOCKER.** Fix: drop `-q` and redirect (`grep -Fx … > /dev/null`),
or capture `strings` output into a variable first. Same fragile shape also
exists at `.github/workflows/kalsa-server.yml:2434` (`7z l | tr | grep -Eq`,
Windows) — harmless there only because `7z -slt` output fits the pipe buffer;
it is one bigger listing away from failing.

The same block also contains a gate that cannot fail:

`.github/workflows/kalsa-server.yml:658`

```bash
if [ "$(basename "$BIN/libllama-server-impl.dylib")" != "libllama-server-impl.dylib" ]; then
```

`basename` of a literal path is a constant. Proven by renaming the library out
of the archive entirely:

```
$ bash rename.sh ; echo EXIT=$?
app would find libllama-server-impl.dylib: NO
after rename, app finds it: NO
RENAME-GATE: passed (library is gone from the archive)
EXIT=0
```

**CONFIRMED — NOT blocker** (the `for lib in …` presence loop at
`.github/workflows/kalsa-server.yml:641-649` is what really catches a rename),
but it is dead code that advertises a check it does not do, and it is the line
the report's "fails when renamed" claim leans on. Delete it or replace it with
a real `test -f` + `strings` check.

Note also that the writer's own proof (`proof-stage/…/byte-id.log`, and
`REPORT.md` "contains `x-kalsa-slot` ×1") used `strings | grep -c`, never the
workflow's exact line. "YAML validated" is not "step executed".

---

## Angle 1 — release workflow (macOS leg)

**Runtime discovery from a foreign cwd: works.** `ggml_backend_load_all`
searches the executable directory before the cwd
(`ggml/src/ggml-backend-reg.cpp:492-499`), and the exe carries `@loader_path`
from `-DCMAKE_INSTALL_RPATH='@loader_path' -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON`.

```
$ cd / && DYLD_PRINT_LIBRARIES=1 /tmp/audit-v115/stage/kalsa-server --list-devices
EXIT=0
/private/tmp/audit-v115/stage/libggml-cpu-apple_m1.so
/private/tmp/audit-v115/stage/libggml-cpu-apple_m2_m3.so
/private/tmp/audit-v115/stage/libggml-cpu-apple_m4.so
/private/tmp/audit-v115/stage/libggml-metal.so
/private/tmp/audit-v115/stage/libggml-blas.so
```

All five modules dlopened **from the archive dir with cwd=`/`** — that is the
desktop app's case. `--list-devices` from `/` and from `/tmp/audit-v115` under
`env -i` both print `BLAS: Accelerate` + `MTL0: Apple M1 Max`.
**REFUTED** (no defect).

**The SIGILL root cause is real and the fix is right.** This host is the M1 Max
in the report: `hw.optional.arm.FEAT_I8MM: 0`, `FEAT_SME: 0`.

```
$ for v in apple_m1 apple_m2_m3 apple_m4; do echo "$v $(otool -tv stage/libggml-cpu-$v.so | grep -c -E 'smmla|ummla')"; done
apple_m1 0
apple_m2_m3 284
apple_m4 284
```

`build-macvariants/CMakeCache.txt` matches the workflow's new `defines` line
exactly (`GGML_NATIVE=OFF`, `GGML_BACKEND_DL=ON`, `GGML_CPU_ALL_VARIANTS=ON`,
`GGML_METAL_EMBED_LIBRARY=ON`, `CMAKE_OSX_DEPLOYMENT_TARGET=13.3`, `Release`,
`LLAMA_BUILD_TESTS=OFF`), so the local proof is a faithful rehearsal of the CI
command line. `-DGGML_METAL_EMBED_LIBRARY=ON` is *not* in conflict with
`GGML_BACKEND_DL=ON`: the metal kernels are compiled into the module
(`ggml/src/ggml-metal/CMakeLists.txt:76-79`) and `libggml-metal.so` is produced
unversioned because of `ggml/src/CMakeLists.txt:409`
(`if (NOT (APPLE AND GGML_BACKEND_DL))`). Apple+DL modules are plain
`libggml-*.so`, which is why the verify list at
`.github/workflows/kalsa-server.yml:641-651` is the right name set.
**CONFIRMED — NOT blocker.**

**Verify list vs. archive:** all ten names exist in the staged archive; the
versioned dylib triplets resolve (0 broken symlinks, 41 files / 10 symlinks).
`-f` follows symlinks, so the `libllama.dylib` entries pass.
**REFUTED.**

**Archive layout / app contract:** `pack()` is untouched, the rename step is
untouched, `test -x "$BIN/kalsa-server"` and `test ! -e "$BIN/llama-server"`
are untouched, and the four new modules land at the top level beside the exe,
which is what `kalsa-brain` extracts wholesale. The app's probe is a byte
substring search for `x-kalsa-slot` in `libllama-server-impl.dylib`
(`~/Projects/kalsa-brain/crates/kalsa-runtime/src/inlet.rs:29,51`) — a *weaker*
test than the workflow's `grep -Fqx`, so a passing gate implies a passing app
probe. **REFUTED** as a layout break.

**Coordination item, not a server-repo defect:** the app pins
`file/exe_sha256/size_bytes/sha256` per release
(`~/Projects/kalsa-brain/crates/kalsa-runtime/src/assets.rs:186-193`, currently
v1.1.4). v1.1.5 needs a new row or the desktop app refuses to mount the new
engine. That belongs in the release checklist.

**Windows legs:** the diff touches nothing inside the `windows` job — no define,
no verify-list, no pack change. Only the push trigger changed, which is
platform-independent. **REFUTED** (no Windows regression from this branch).

**`e8f279d25` (drop `b11010-merge`):** the branch exists locally and on origin
but is empty relative to `main` (`git log --oneline main..b11010-merge | wc -l`
= 0, and `main..origin/b11010-merge` = 0), so the trigger was dead.
**CONFIRMED — safe.** But the removal leaves the file self-contradictory: with
`push: tags:` only, `github.ref_type` is always `tag`, so the entire
"branch push" version branch is unreachable while `.github/workflows/kalsa-server.yml:21`,
`:269-271` and `:1569-1571` still say "A branch push gives `<ref>-b<count>-<sha>`
… branch builds come from the push trigger". **NOT blocker**, doc rot + dead
code; either restore a branch trigger or delete the branch-build path.

---

## Angle 2 — truncated sequence state (`b6f994fc3`)

`src/llama-context.cpp:3359-3373`. The layout is
`[magic|version|n_tok|tokens…][state payload][SCKP appendix][KSID]`, so
`state_size = file.size() - file.tell()` is the payload *in the file that is on
disk* and `nread` is the payload *requested*
(`llama_io_read_file::read` does `size_read += size` unconditionally,
`src/llama-context.cpp:2819-2822`). A short file therefore trips
`nread > state_size` **before** the old
`GGML_ASSERT(nread + 12 + 4·n_tok == file.tell())`, which is the right ordering.

End-to-end, 12 crafted slot files through the real server (1.2B LFM2.5, staged
v1.1.5 binary, `/slots/0?action=restore`), every one leaving `/health` = 200 and
zero aborts:

| file | HTTP | message |
|---|---|---|
| `base` (untouched) | 200 | – |
| `legacy` (trailer stripped) | 200 | – (backward compat) |
| tail −1 byte | 400 | trailing bytes after the context checkpoint appendix |
| tail −6 bytes | 400 | trailing bytes after the context checkpoint appendix |
| tail −55000 | 400 | truncated or oversized context checkpoint appendix |
| cut inside the token array | 400 | No available space in KV cache or invalid slot save file |
| cut inside the payload | 400 | engine line fired, see below |
| legacy cut inside the payload | 400 | engine line fired |
| KSID arch patched to `gemma4` | 400 | slot file was saved by a different model: … |
| KSID valid, 100 payload bytes zeroed | **200** | – |
| KSID version → 2 | 400 | malformed model identity trailer |
| 80 bytes only (KSID + v1 + zeros) | 400 | saved ␣ (n_embd 0, n_layer 0, …) |
| 79 bytes | 400 | No available space in KV cache or invalid slot save file |
| last 100 bytes zeroed (full length) | 400 | malformed model identity trailer |

```
$ grep -m2 'truncated sequence state file' serverE.log
0.03.056.347 E state_seq_load_file: truncated sequence state file: state size 385620, read 385660
0.03.131.391 E state_seq_load_file: truncated sequence state file: state size 385620, read 385660
$ echo $((aborts))   # grep -c 'GGML_ABORT\|GGML_ASSERT' serverE.log
0
```

**CONFIRMED — NOT blocker.** The engine's new line fires, the error path is a
400, the server keeps serving.

Cleanliness of the sequence after a refusal: `memory->seq_rm(seq_id, -1, -1)`
(`src/llama-context.cpp:3368`) is correct and the comment's "like the other
failed-restore paths" is *accurate*, not sloppy — the sibling `if (!nread)`
path at `:3356` can only be reached when the arch check fails
(`state_read_data` returns 0 **before** touching the memory,
`src/llama-context.cpp:3451-3457`), so nothing has been restored there. It is
also redundant for the server, which wipes the sequence in its own catch
(`slot->prompt_clear()` → `mem.seq_rm(id, -1, -1)`,
`tools/server/server-context.cpp:298-304`); it matters for the other API
callers. **REFUTED** as a defect.

Other callers: `llama_state_seq_load_file` has exactly two callers — the server
and `tests/test-save-load-state.cpp:695,724`; the whole-context
`llama_state_load_file` path was already safe via its own
`n_read != n_state_size_cur` guard (`src/llama-context.cpp:3287`, used by
`tools/completion/completion.cpp:219` and the tests). The server ignores
`*n_token_count_out` when the return is 0
(`tools/server/server-context.cpp:2999-3003`). **REFUTED** (nothing broken).

The KV-type-mismatch restore I tried as a hostile case does *not* slip through:
`llama_kv_cache::state_read` throws (`src/llama-kv-cache.cpp:2361`) → caught at
`src/llama-context.cpp:4390` → 400, `mismatched key type (1 != 8, layer 2)` in
the log, health 200. **REFUTED.**

**Cosmetic finding (N1):** for a *v1.1.5-format* file, any tail truncation is
caught by the appendix/trailer parser, so the user gets "trailing bytes after
the context checkpoint appendix" — the engine's precise new message only ever
appears for legacy (pre-KSID) files. Two errors, one root cause, and the wrong
one shown. Cheap to improve by validating `end - nread == 0 || == SLOT_ID_SIZE`
before parsing.

---

## Angle 3 — KSID trailer (`e636ee126`)

`tools/server/server-context.cpp:2600-2720` (identity), `:2536-2545`
(trailer-only branch), `:2570-2590` (appendix + trailer), `:2939` (save),
`:2993` (restore).

**Backward compat: CONFIRMED.** `legacy` (trailer stripped) restores 200.
**Forward compat: clean refusal, misleading text.** A v1.1.5 file on a v1.1.4
server never loads — the old loader only accepts `SCKP` there
(`git show 61c909481:tools/server/server-context.cpp`, the pre-image of
`:2536`), so it throws either "unknown data after the state payload" (no
appendix) or "trailing bytes after the context checkpoint appendix" (with
appendix). No crash, no silent misread, but a user who rolls the app back sees
a message about a checkpoint appendix they never heard of. **NOT blocker**;
put it in the release notes.

**Version handling is inconsistent (N2, trap for the next release).**
`check_slot_identity` treats an unknown `SLOT_ID_VERSION` as "legacy, accept"
(`tools/server/server-context.cpp:2693-2696`) while `load_slot_checkpoints`
treats it as corruption and hard-fails (`:2541-2543`, measured above with
version 2 → 400 "malformed model identity trailer"). The first behaviour is the
right one: as written, the day someone bumps `SLOT_ID_VERSION`, every existing
v1.1.5 slot file becomes unreadable with an unrelated error. Make the loader
ignore unknown versions too.

**Parsing safety: CONFIRMED.** `check_slot_identity` bounds the seek with
`end < 0 || (uint64_t) end < SLOT_ID_SIZE` (`:2685-2689`), then does eight
explicit `ifs.read` calls with a single `if (!ifs)` after them (`:2700-2709`) —
no overflow, no read past EOF, no `tellg` misuse. The hostile 79/80-byte files
produced 400s, never a crash. The `arch` copy is bounded twice
(`strncpy(..., sizeof(arch)-1)` + explicit NUL, `:2632-2637`).

**Fingerprint quality — the honest gaps.**

* **N3 (the real one, not disclosed):** same-arch/same-geometry, *different
  weights* is still accepted silently — a fine-tune, an IT vs non-IT sibling, a
  different rope/YARN setting, or a different `--lora` adapter. `REPORT.md`
  discloses only "another quant of the same model"; the fine-tune/adapter case
  is the plausible user action. Verified consequence: 100 payload bytes zeroed
  under a valid matching trailer →
  ```
  restore corrupted-payload file: 200
  chat after corrupted restore: {"content":"Understood! I'm ready to assist you. What would"…}
  health=200   aborts=0
  ```
  i.e. garbage KV is accepted and answered with a fluent wrong answer. The
  server's save path is temp-file + rename, so a *torn* payload cannot occur in
  practice — the exposure is user-copied/edited/partial-sync files, which is
  exactly what item 2 was raised for. Given the brief excluded a checksum, this
  is **NOT blocker / disclose it**, but the report's phrasing understates it.
* **N4:** `n_head_kv` measured **0** for LFM2.5 (MQA), so one of the five
  discriminators is inert for MQA architectures; the effective fingerprint is
  arch + `n_embd` + `n_layer` + `n_vocab` + `n_ctx_train`.
* **N5:** `llama_vocab_n_tokens` in the fingerprint means a vocabulary-extended
  model with identical weights is correctly refused — good — but it also means a
  harmless metadata-only re-save is refused. Intended, just note it.
* **N6 (cosmetic):** the trailer-only branch returns `0` (`:2545`), so
  `res->n_bytes` on restore is 80 less than the file size while `save` reports
  the full size; the API's save/restore byte counts stop matching for saves
  without checkpoints.

**Coverage: the slot file is the only on-disk state**, so nothing is missed —
the prompt cache is RAM-only (`server_prompt_cache`, `cache_ram_mib`,
`tools/server/server-task.cpp:1689-1798`). **REFUTED** (no uncovered file
class). Ordering is right: the identity check runs before any state is read and
before `slot->prompt.clear()` (`:2993`), so a declined restore leaves the slot
untouched; the catch's `prompt_clear()` still runs, which is harmless.

---

## Angle 4 — cross-device alias refusal (`2a803734f`)

`src/llama-kv-cache.cpp:225-272`. The check lives in `llama_kv_cache`'s
constructor, and that is the right class: the gemma4-assistant drafter builds a
`llama_kv_cache_iswa`, which delegates to two inner `llama_kv_cache` instances
with the same `share` callback (`src/llama-kv-cache-iswa.cpp:100-110`).
**REFUTED** (I suspected the wrong constructor).

**The fix is live, reachable, and behaves.** I could not reproduce the original
multi-GPU abort, but I produced the *same predicate* on this single-GPU Mac:
`--spec-draft-device none` (the documented "don't offload" form; note
`--spec-draft-device CPU` is rejected outright at `common/arg.cpp:1128`)
gives the drafter an empty device list, so the aliased Metal K/V is
unsupportable:

```
$ cat cross2.out
SERVER_EXIT=1
$ tail -4 crossdev.log
E llama_init_from_model: failed to initialize the context: cannot share KV cells: layer 3 would alias the
  shared K tensor, which lives in a MTL0 buffer on device MTL0, but this context runs on CPU - the drafter
  and the shared K/V must be on the same device
E common_speculative_init_result: failed to create MTP context
E srv    load_model: failed to create MTP context
I srv  llama_server: exiting due to model loading error
$ grep -c 'GGML_ABORT\|GGML_ASSERT' crossdev.log   → 0
$ grep -c "listening on" crossdev.log             → 0
```

No half-started server, no port bound, nonzero exit, both model names in the
message. **CONFIRMED — NOT blocker.**

False-positive sweep, all reasoned against source:

* **CPU-only target / no offload:** the K/V buffer is the CPU buft → `is_host`
  → skipped at `src/llama-kv-cache.cpp:236`. **No false positive.**
* **`-ngl 0` drafter over a GPU target:** the drafter's `model.devices` still
  contains the GPU (device selection is independent of `-ngl`,
  `src/llama.cpp:222-301`), so `supports_buft` succeeds. The writer's
  no-false-positive run is consistent with this. **No false positive**, but see
  N7 — the *reason* is not the one the comment gives.
* **Host-visible buffers:** `ggml_backend_buft_is_host` is checked first
  (`:236`) and `ggml_backend_supports_buft` for CPU/BLAS only accepts their own
  bufts, so "is_host" can only ever *widen* acceptance. **No false positive.**
* **Tensor-split / meta device:** in `LLAMA_SPLIT_MODE_TENSOR` the KV buft *is*
  the meta buft (`src/llama-model.cpp:1598` returns the meta device, and
  `make_gpu_buft_list` yields `ggml_backend_dev_buffer_type(meta)`,
  `src/llama-model.cpp:1168`), so `supports_buft(meta, meta_buft)` compares two
  meta contexts with equal `simple_devs` and returns true
  (`ggml/src/ggml-backend-meta.cpp:161-176`). **No false positive.**
* **Predicate vs. the abort it replaces:** the sched aborts in
  `ggml_backend_sched_backend_from_buffer` when *no* sched backend supports the
  buft (`ggml/src/ggml-backend.cpp:888-908`, abort at `:941`); the sched's set
  is `model.devices` + every ACCEL backend + CPU
  (`src/llama-context.cpp:334-360`). The check iterates only `model.devices`,
  so it is marginally *stricter* — the missing members (CPU, BLAS) can never
  accept a non-host device buft, so the two agree. **Equivalent.**
* **Predicted behaviour on the reported Windows box** (`--spec-draft-device`
  pinning the drafter to Vulkan0, K/V in Vulkan1): a clean refusal where v1.1.4
  aborted. Untestable here; the report is honest about that.

**N7 — the comment teaches the wrong mechanism (CONFIRMED).**
`src/llama-kv-cache.cpp:231-233` says host-visible always pass "that is why a
CPU drafter over Metal-shared K/V works on Apple silicon". All three Metal
buffer types return `is_host == false`
(`ggml/src/ggml-metal/ggml-metal.cpp:285-289, 361-365, 437-441`). The
CPU-drafter-over-Metal case passes because the drafter's device list contains
MTL0, not because the buffer is host-visible. Same for
`src/llama-kv-cache.cpp:245-247`: `ggml_backend_meta_device_supports_buft`
returns true only for a **meta** buft with an identical device set, not "for
every device it wraps". Both are currently harmless; both will mislead the next
reader into "simplifying" the check into a false-positive generator.

**N8 — the predicate is about the device *list*, not about where tensors run.**
`-ngl 0` + default devices works; `--spec-draft-device none` is refused. Both
used to behave identically only because the second one aborted. Users who read
the docs ("none = don't offload") will meet a refusal. Worth a line in the
release notes / CLI help.

---

## Angle 5 — WARN once (`122b25697`)

`src/llama-kv-cache.h:324-325`, `src/llama-kv-cache.cpp:2204-2214`,
`:2296-2306`. Measured in the writer's own logs at the server's default
verbosity 3:

```
item6-cpudft.log: total 'shared view - skipping' lines = 1, WARN = 1, DEBUG = 0, verbosity = 3
```

The repeats go to `LLAMA_LOG_DEBUG`, which the server's default log level
hides, so the spam really is gone (not merely downgraded) at the shipped
default. **CONFIRMED — NOT blocker.**

N9 — **PLAUSIBLE, NOT**: `mutable bool` is a non-atomic write to an object
owned by the *source* cache, performed while the *view's* context state IO runs
(`llama_kv_cache.cpp:2205`, `:2297`). The two contexts take different mutexes.
Unreachable in the server (all state IO happens on the single task-processing
thread, so the write is effectively serialized) and in `llama-cli`, but it is
a data race as written. `std::atomic<bool>` with relaxed ordering, or a comment
saying why it is safe, would settle it.

N10 — **CONFIRMED, NOT**: the flags live on the source and are never reset, so
(a) a second view's *first* occurrence never warns — only the first view does —
and (b) a genuinely new condition later in the same process (a second drafter,
a re-created context) is silent for the process's lifetime. That is the stated
design ("once per source cache and direction"), and it is defensible; it should
just be a design note, not an accident.

---

## Angle 6 — tests

`tests/test-save-load-state.cpp:698-726` adds the `truncated` case. Its cut
(10 % off the tail of a bare `llama_state_seq_save_file`, no appendix) lands
inside the state payload, which is exactly the condition that used to trip
`GGML_ASSERT(nread <= state_size)`. The writer's logs are genuine runs, not
claims:

* `proof-logs/test9-prefix.log` → `src/llama-context.cpp:3359: GGML_ASSERT(nread
  <= state_size) failed` with a backtrace through
  `llama_context::state_seq_load_file` → `ggml_abort` (SIGABRT/134).
* `proof-logs/test9-postfix.log` → `state_seq_load_file: truncated sequence
  state file: state size 44543, read 49504` then `PASS`.

I did not rebuild pre/post (the build dir is shared and the instruction is
/tmp-only), so this is a code+log confirmation rather than an independent
re-execution; the layout argument above plus my live 400s make me confident.

N11 — **CONFIRMED, NOT**: no test covers items 3, 4 or 6 at all. The KSID
trailer has zero unit coverage (it lives in the server, untestable without a
model, but a 10-line helper test over `slot_model_identity_same` and the
80-byte layout would catch a magic/version/arch-length drift before a release
does), and the cross-device refusal has no test either. For a release whose
point is "refuse instead of abort", that is thin.

---

## Angle 7 — clean code

* Sizes after the change: `tools/server/server-context.cpp` 6062,
  `src/llama-kv-cache.cpp` 3093, `src/llama-context.cpp` 4535,
  `tests/test-save-load-state.cpp` 1006, workflow 2660. The KSID block adds ~130
  lines of self-contained helpers; acceptable and style-consistent.
* `id.reserved` (`tools/server/server-context.cpp:2619,2670`) is written as 0
  and never compared — forward-compat padding, fine, but it is a field nobody
  reads today.
* Dead code found: the tautological gate at
  `.github/workflows/kalsa-server.yml:658` (see B1) and the unreachable
  branch-push version path (`:21, :269-271, :1569-1571`, plus the whole
  non-release `VERSION` case).
* Comments narrating history rather than invariants: the header comment's
  "(there is one view per aliased layer group, which warned 12-18x per
  save/restore otherwise)" (`src/llama-kv-cache.h:321-323`) and the two
  long workflow comments that pin upstream file/line claims about
  `ggml/src/CMakeLists.txt` and `ggml-backend.cpp:941` (both of which I
  verified are still true today, so this is fragility, not error). The
  `cannot share KV cells` block comment is 15 lines for a 40-line check —
  consistent with this fork's house style, but it is where N7 hides.

---

## Bottom line

Ship after fixing **B1** (one line: `grep -Fx … > /dev/null` instead of
`grep -Fqx`) and deleting the tautological gate. Then disclose, in the
release notes: (a) v1.1.5 slot files are not readable by v1.1.4 and the error
says something misleading; (b) the KSID trailer refuses cross-geometry swaps
only — a fine-tune/adapter/rope change with the same shape is still accepted
silently, and a corrupted payload restores 200; (c) `--spec-draft-device none`
plus an MTP drafter now refuses instead of aborting. Worth an hour more of
work before the tag: N2 (unknown trailer version must not hard-fail),
N11 (a test for the trailer), and the N7 comment rewrite, because both wrong
comments point the next editor at a predicate change that would produce
false-positive refusals for real users.

### What I could not verify here

Multi-GPU Vulkan (the original abort), Windows legs, the actual CI verify step
(I proved its failure mode in isolation with the same shell and the same
archive), and anything requiring a pre-fix build (I reasoned from the
pre-image instead).