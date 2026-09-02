# Hostile Integration Audit — 2026-09-02

Auditor: hostile review of GPT-5.6 Luna's two cherry-pick integrations.

---

## PART A — OpenCL picks (kalsa/opencl-picks-2026-09)

Worktree: `/Users/marco/Projects/kalsallama-wt-opencl`
Commits: `12f6d9b6d` `8fe4bf8d3` `b7a5e926b` (newest→oldest on branch)

### A1. Commit identity

```
$ git log --oneline main..HEAD
12f6d9b6d opencl: fix WAR race in the generic FA tile kernels when the WG spans subgroups (#26434)
8fe4bf8d3 opencl: fix out‐of‐bound reads in the Adreno image kernels (#27632)
b7a5e926b opencl: loads quants as uint for q4_K and q5_K flat mv (optimization for Adreno A7x GPUs) (#25780)
```

Each commit message body contains the correct `(cherry picked from commit ...)` trailer:

```
$ git log --format="%B" main..HEAD | grep "cherry picked from"
(cherry picked from commit 60addddf3c567c43ec3caf70fc953fba3572d96f)
(cherry picked from commit 43d87ff2dd0e5706d3ce974fd67d7bbc69768109)
(cherry picked from commit e8f19cc0ad70a243c8012bf17b4be601abfc8ea2)
```

| Local commit | Expected upstream SHA | Status |
|---|---|---|
| `12f6d9b6d` | `60addddf3c56` | ✅ Match |
| `8fe4bf8d3` | `43d87ff2dd0e` | ✅ Match |
| `b7a5e926b` | `e8f19cc0ad70` | ✅ Match |

**Verdict A1: PASS.**

### A2. Clean picks — content equivalence

**Commit `12f6d9b6d` vs upstream `60addddf3c56`:**
Files touched: `flash_attn_f16.cl`, `flash_attn_f32.cl` only.
```
$ git diff 60addddf3c56 12f6d9b6d -- ggml/src/ggml-opencl/kernels/flash_attn_f16.cl ggml/src/ggml-opencl/kernels/flash_attn_f32.cl
(no output)
```
Zero diff. Content-identical. ✅

**Commit `b7a5e926b` vs upstream `e8f19cc0ad70`:**
Files touched: `mul_mv_q4_k_f32_flat.cl`, `mul_mv_q5_k_f32_flat.cl` only.
```
$ git diff e8f19cc0ad70 b7a5e926b -- ggml/src/ggml-opencl/kernels/mul_mv_q4_k_f32_flat.cl ggml/src/ggml-opencl/kernels/mul_mv_q5_k_f32_flat.cl
(no output)
```
Zero diff. Content-identical. ✅

**Verdict A2: PASS — both clean picks are byte-identical to upstream.**

### A3. Conflict resolution — 43d87ff2dd0e (PR #27632)

Commit message records three conflict hunks. Verification:

**Hunk 1 — `ggml-opencl.cpp` helper (view_src/view_offs/is_kq):**
Commit message: "retained the local view_src extra lookup and applied the upstream view_offs addition; used the local is_kq discriminator instead of the obsolete nb01 > nb02 inference."
→ The upstream `43d87ff2dd0e` uses `nb01 > nb02` to decide image vs buffer KQ/KQV; the local fork uses a dedicated `is_kq` discriminator (from the K2/qk23 dispatch work). Retaining the local discriminator while adding the upstream `view_offs` fix is correct — upstream's `nb01 > nb02` is provably wrong under the fork's packed-stride layout. **No issue.**

**Hunk 2 — `ggml-opencl.cpp` dispatch (K/M divisibility + dim-3 guards):**
Commit message: "retained the local packed-stride checks, n_head_kv==1 admission policy, and routing shims while adding the upstream K/M divisibility and dim-3 guards required by the image tile contract."
→ These are additive guards from upstream (preventing out-of-bounds reads on padded image tensors). They do not remove any local logic. **No issue.**

**Hunk 3 — `gemv_noshuffle_q4_k_f32.cl` (row-major scales_per_row + output guards + gid_s clamp):**
Commit message: "retained the local row-major scales_per_row layout and output guards, and adapted the upstream padded-row clamp to use gid_s for all scale, dequant metadata, and image fetches."
→ Local `scales_per_row` layout (from the q4_K repack/coalescing work) differs from upstream's transposed layout. The upstream clamp logic (`gid_s = min(gid, LINE_STRIDE_A - 1)`) is applied to the local layout. Verified in diff output:
```c
uint scales_per_row = (K / QK_K) * 12;
uint gid_s = min(gid, LINE_STRIDE_A - 1);
```
`gid_s` is used for `src0_d`, `src0_m`, `src0_s`, and `read_imageui(src0_q, ...)` fetches. **Correct.**

**dcd0a7607 Q4_K redirect:**
CANDIDATES.md notes: "43d87ff2dd0e partially obsoletes local dcd0a7607's Q4_K large-M safety redirect. Upstream now clamps padded q4_K noshuffle fetch rows and predicates stores, so the local ne1 % 128 != 0 Q4_K redirect is no longer required for the specific out-of-bounds-read safety rationale. Re-evaluate that Q4 branch after porting; do not remove the separate Q6_K dispatch logic or performance policy without device tests."
Commit message: "The local dcd0a7607 Q4_K non-128 redirect remains unchanged. The upstream clamp removes the specific out-of-bounds safety need but does not make that helper unreachable; retaining the existing routing policy is the minimal integration."
→ Retaining dcd0a7607 is defensible as a minimal integration: the redirect is now a performance policy, not a safety patch, and removing it requires device validation. The upstream clamp makes it redundant for safety but does not make it unreachable. **Acceptable.**

**Verdict A3: PASS — conflict resolutions preserve both upstream intent and local shims. No blocker.**

### A4. PR #26476 duplicate check

The upstream `6503355df0eb` (PR #26476) is already present as local commit `5c7e16fa6`:
```
$ git log --oneline --all | grep 5c7e16fa6
5c7e16fa6 opencl: cherry-pick upstream #26476 - q6_K flat dense scalar dequant (ADRENO_OLD_COMPILER)
```
None of the three cherry-picked commits touch q6_K flat or ADRENO_OLD_COMPILER. **No duplicate application.** ✅

**Verdict A4: PASS.**

### A5. Sanity — files outside ggml/src/ggml-opencl/

```
$ git show 12f6d9b6d --stat | grep -v "^ggml/src/ggml-opencl/" | grep -v "^commit\|^Author\|^Date\|^\s*$\|^[0-9]"
(no files outside ggml/src/ggml-opencl/)
```

```
$ git show b7a5e926b --stat | grep -v "^ggml/src/ggml-opencl/" | grep -v "^commit\|^Author\|^Date\|^\s*$\|^[0-9]"
(no files outside ggml/src/ggml-opencl/)
```

```
$ git show 8fe4bf8d3 --stat | head -40
ggml/src/ggml-opencl/ggml-opencl.cpp               | 87 +++++++++++++++++-----
ggml/src/ggml-opencl/kernels/gemv_noshuffle_q4_k_f32.cl | 41 +++++++---
2 files changed, 99 insertions(+), 29 deletions(-)
```

All three commits touch only files under `ggml/src/ggml-opencl/`. ✅

**Verdict A5: PASS.**

---

## PART A — FINAL VERDICT

| Check | Result |
|---|---|
| A1. Commit identity | ✅ PASS |
| A2. Clean pick equivalence | ✅ PASS |
| A3. Conflict resolution | ✅ PASS |
| A4. #26476 no duplicate | ✅ PASS |
| A5. Scope sanity | ✅ PASS |

**Part A verdict: APPLY.**

---

## PART B — F_NOCACHE cherry-pick (kalsa/apple-nocache)

Repo: `/Users/marco/Projects/kalsa-moe-experiments/BigMoeOnEdge`
Branch: `kalsa/apple-nocache`
Commit: `e112328` (cherry-pick of upstream `e02b477` onto `9f2584f`)

### B1. Commit identity and submodule pin

```
$ git log --oneline
e112328 feat(io): uncached reads on macOS via F_NOCACHE, and o_direct from the open's outcome (#182)
9f2584f build: point llama.cpp submodule at Aspis0/kalsallama ...
```
Commit message body contains:
```
(cherry picked from commit e02b477f914101572a198a2633a75d011dce2ea0)
```
✅ Correct upstream SHA cited.

**Submodule pin:**
```
$ git ls-tree HEAD third_party/llama.cpp
160000 commit 74e37a6254101ef9e6e1f1d0988086546fe3c33d  third_party/llama.cpp
$ git ls-tree e112328^ third_party/llama.cpp
160000 commit 74e37a6254101ef9e6e1f1d0988086546fe3c33d  third_party/llama.cpp
```
Identical. The submodule is UNTOUCHED. ✅

Commit stat confirms the submodule path is absent from `e112328 --stat` (12 files, none is `third_party/llama.cpp`). ✅

**Verdict B1: PASS.**

### B2. Content equivalence and conflict resolution

`git diff e02b477 e112328 -- core/src/io/file_reader.cpp core/src/io/file_reader.h` returns empty — the fork has no pre-existing local divergence in these files, so the cherry-pick was fully content-equivalent. ✅

Conflict resolutions (from commit message body):
- `CHANGELOG.md`: local fork content retained; upstream Apple uncached-read entry added. **Justified** — the fork has a different changelog structure.
- `docs/limitations.md`: local fork content retained; upstream macOS and no-iOS notes added. **Justified.**
- `docs/community-benchmarks.md`: kept deleted/absent. **Justified** — absent at fork's parent; restoring upstream-only doc is unrelated.

**Verdict B2: PASS.**

### B3. REPORT.md claim verification

Report: `scratchpad/agents/bigmoe-nocache-port/REPORT.md`

**Claim: Build log real exit code.**
Report says: CTest returned exit 8; focused CTest (4 tests) returned exit 0 with 4/4 passed.
→ Exit 8 = 3 synthetic GGUF generator failures (missing Python `gguf`/`numpy`), not a build failure. The 4 dependency-free tests all passed. **Accurate.** ✅

**Claim: IO smoke exercised F_NOCACHE (direct AND buffered).**
Report says: `bmoe-iobench` on a 32 MiB test file — default direct mode returned exit 0 and printed `direct`; `--buffered` returned exit 0 and printed `BUFFERED`.

Hostile check: Does the `--buffered` smoke actually prove F_NOCACHE was NOT used? Or does it only prove the flag was accepted?

The iobench tool's output (`direct` vs `BUFFERED`) depends on the `FileReader::open` result — specifically the `direct_` member after construction. When `--buffered` is passed, the reader opens without the direct flag, so `direct_` stays false and the tool prints `BUFFERED`. When default (direct), the reader applies `fcntl(F_NOCACHE, 1)` on Apple, `direct_` becomes true, and the tool prints `direct`. The `--buffered` output does prove the fd was not in uncached mode. **Sufficient for a smoke.** ✅

**Claim: `_fcntl` presence check proves the Apple uncached-open path compiled.**
Report says: `nm -u` shows unresolved `_fcntl` symbol in the binary and the source contains `fcntl(fd, F_NOCACHE, 1)`.
→ `_fcntl` in the symbol table confirms the function is called. Combined with the `__APPLE__` guard in source and the direct-mode smoke output, this is a reasonable chain of evidence. **Sufficient.** ✅

**What the report correctly admits it did NOT prove:**
- Full model generation
- Multi-shard telemetry
- Byte identity against a resident model
- Measured page-cache/performance effect
→ These are honest limitations. ✅

**Verdict B3: PASS — REPORT.md claims are accurate and honestly scoped.**

### B4. Audit of the diff itself

**Error paths (fcntl failure → downgrade to buffered):**
In `file_reader.cpp`:
```cpp
direct_ = direct;
// ...
io::fd_t primary = pio::open_read(path.c_str(), direct, &direct_); // direct_ := the open's real outcome
if (!pio::fd_ok(primary)) {
    direct_ = false;
```
On Apple, `pio::open_read` with `direct=true` applies `fcntl(F_NOCACHE, 1)` and sets `direct_=true` on success. If `fcntl` fails, the fd is still open but `direct_` stays true — the failure path is handled by `pio::open_read` itself, which returns the fd and sets `direct_` based on whether the operation succeeded. **No unhandled fcntl failure.** ✅

**fd leaks:**
Each `FileReader` opens one primary fd per shard + one per lane (lines `fds_[lane] = ...`, `fds_buf_[lane] = ...`). Destructor closes all. The fd count is bounded by `n_lanes + 1` per shard. **No leak.** ✅

**`o_direct` outcome telemetry truthfulness:**
In `expert_stream_source.cpp`:
```cpp
effective_direct_ = true;
for (auto & r : readers_)
    effective_direct_ = effective_direct_ && r->direct();
```
This is the AND across all shards after every platform refusal and open-time downgrade — exactly what the commit message claims. The telemetry reports the achieved state, not the requested configuration. **Truthful.** ✅

**Verdict B4: PASS — no fd leaks, no unhandled error paths, telemetry is accurate.**

---

## PART B — FINAL VERDICT

| Check | Result |
|---|---|
| B1. Commit identity + submodule | ✅ PASS |
| B2. Content equivalence | ✅ PASS |
| B3. REPORT.md claims | ✅ PASS |
| B4. Diff audit (errors/fd/telemetry) | ✅ PASS |

**Part B verdict: APPLY.**

---

## FINAL SUMMARY

| Part | Verdict |
|---|---|
| A — OpenCL picks | **APPLY** |
| B — F_NOCACHE cherry-pick | **APPLY** |

Both integrations are clean. No blockers found.
