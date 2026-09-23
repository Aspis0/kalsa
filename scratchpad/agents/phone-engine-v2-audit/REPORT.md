# Phone engine v2 - independent pre-push audit

Auditor: independent reviewer agent, 2026-09-22. Adversarial pass, run immediately
before the push of branch `kalsa-phone-v1-1-1`.

Line under audit (all shas re-verified on disk this session):

```
d754229443670a7454731cd48028cb409ecc0ec2  base (already-audited phone pin, remote tip of kalsa-phone-v1-1-1)
e1cfb60f7141bcd2b2dad00d2d36d41ea49c2d7d  cherry-pick of 87f31d81f (activation-scale fix)
1577495b92096fca572f57a35b71607bacac85d5  the KALSA_Q6K_DENSE default flip  <- tip
```

Sources of truth: worktree `/Users/marco/Projects/kalsallama-wt-phone-engine-v2`
(detached HEAD at tip, checked clean), coder testimony in
`../phone-engine-v2/REPORT.md` treated as claims only. Evidence logs for this audit
live in this directory. Shared checkout `/Users/marco/Projects/kalsallama` and the
worktree were not modified: no checkout, no commit, no build, no test artifact left
behind (worktree `git status --porcelain` snapshotted before and after the test runs,
diff quoted in section 5). The push command was NOT run. Nothing tagged.

Verdict summary (details per section):

| item | verdict |
|---|---|
| 1. cherry-pick patch-id + message | CONFIRMED |
| 2. default flip truth table + default composition | CONFIRMED |
| 3. selector independence | CONFIRMED (one pre-existing note, see 3.1) |
| 4. scope + transpose absence | CONFIRMED |
| 5. seven targets run by auditor | CONFIRMED |
| 6. Android artifact identity | CONFIRMED |
| 7. push hygiene | CONFIRMED SAFE (command NOT run) |

---

## 1. The cherry-pick - CONFIRMED

Parentage re-read from the object database (`git log --format='%H %P %s' -3 tip`):

```
1577495b92096fca572f57a35b71607bacac85d5  parent e1cfb60f7141bcd2b2dad00d2d36d41ea49c2d7d
e1cfb60f7141bcd2b2dad00d2d36d41ea49c2d7d  parent d754229443670a7454731cd48028cb409ecc0ec2
d754229443670a7454731cd48028cb409ecc0ec2  parent 5b6c5361c43dc9581719540ed2fcdd680e27ef6a
```

`git rev-list --count d75422944..tip` = **2** (the line is exactly base + pick + flip,
nothing else). `git rev-list --count HEAD` = **11201**.

Patch-ids, `git show <sha> | git patch-id --stable`, run by this audit:

```
original 87f31d81fe2660b1608cd260f0ed45573a867b9c: 7e82148c4554321daffaeb20ddc5e4d3146757a1  87f31d81fe2660b1608cd260f0ed45573a867b9c
picked   e1cfb60f7141bcd2b2dad00d2d36d41ea49c2d7d: 7e82148c4554321daffaeb20ddc5e4d3146757a1  e1cfb60f7141bcd2b2dad00d2d36d41ea49c2d7d
```

Token **7e82148c4554321daffaeb20ddc5e4d3146757a1** on both sides: patch-id EQUAL.

Commit messages: dumped with `git show -s --format=%B` to `msg-87f31d81f.txt` /
`msg-e1cfb60f71.txt` (580 bytes each) and compared with `cmp`: **rc=0, byte-identical**
(no `(cherry picked from ...)` trailer on either side).

Files touched, `git diff-tree --name-status -r` (identical 3-file set on both commits):
`ggml-opencl.cpp`, `kernels/gemm_noshuffle_q6_k_q8_1_dp4a.cl`, `kernels/quant_a_q8_1.cl`.

---

## 2. The default flip, read from the source bytes - CONFIRMED

The flip commit `1577495b92` touches `ggml/src/ggml-opencl/ggml-opencl.cpp` only,
5 insertions(+), 5 deletions(-); the diff re-read by this audit is exactly the mirror
the coder quoted (comment line, `dp4a` early-return becomes `f32` early-return, the
unrecognized-value guard flips from `!= "f32"` to `!= "dp4a"`, final `return true` ->
`return false`). Pre-image re-read at `d75422944`: in the old lambda the final
`return true` was the sole fall-through for both "explicit f32" and "unset", so the
coder's claim is arithmetically true - a naive one-line flip would have let
`KALSA_Q6K_DENSE=f32` fall past both ifs into `return false`, silently selecting dp4a
and killing the f32 arm. The mirrored arms avoid that.

Truth table FROM THE SOURCE BYTES: the two selector functions were extracted verbatim
(`sed -n '1548,1582p'` of the tip file, fragment archived here as
`selector-fragment.inc`) into a standalone harness (`selector-harness.cpp`,
`c++ -std=c++17`, GGML_LOG_ERROR stubbed to fprintf - the only edit; both function
bodies untouched) and executed. Log: `selector-matrix.log`.

```
KALSA_Q6K_DENSE   returns q6k_dense_f32   route
unset             0                       dp4a (NEW DEFAULT)
"" (empty)        0                       dp4a
f32               1                       transpose + noshuffle f32 GEMM (still reachable)
dp4a              0                       dp4a
fp16 / bogus / F32  exit(1)               "unrecognized KALSA_Q6K_DENSE=... (use f32|dp4a)", rc=1

KALSA_Q8A_SCALE   returns q8a_scale_f32   activation block scale
unset             1                       fp32 (f32 scale)
"" (empty)        1                       fp32
fp32              1                       fp32
fp16              0                       fp16 (control arm, still reachable)
f32 / bogus       exit(1)                 "unrecognized KALSA_Q8A_SCALE=... (use fp32|fp16)", rc=1
```

Every arm of both selectors is reachable, and every unrecognized value exits non-zero.

THE DEFAULT COMPOSITION (the question the phones depend on): with NO environment
variable set at all, the harness returns `q6k_dense_f32=0 q8a_scale_f32=1`. Consumed
at the dispatch (`ggml-opencl.cpp:23218-23248`, re-read at the tip):

- `GGML_OPENCL_Q6K_DENSE_DP4A` unset -> `q6k_dense_dp4a_on = (!kalsa_q6k_f32 && adreno_gen != X1E)`,
  then ANDed with `has_integer_dot` -> on the measurement device (Adreno 740: integer
  dot present, not X1E) the dp4a int8 route is selected, shape guards as before;
- `q8a_f32 = kalsa_q8a_scale_f32()` = true -> `kernel_quant_a_q8_1_f32` +
  `kernel_gemm_noshuffle_q6_k_q8_1_dp4a_f32`, fp32 activation block scale.

So the default configuration is exactly dp4a + f32 activation scale - the pair the
measurement credits. Cross-checked against the primary measurement report
`../s23-kld-740-q4-0/REPORT.md` (line 1170): treatment `Q6K_DENSE=dp4a` (scale fp32
default) -> **0.005412** median KLD, **93.982 +/- 0.564 %** same-top, and line 1175:
**76.44 +/- 0.19 t/s**. Default arms compose to the measured configuration. NOT A STOP.

---

## 3. Selector independence - CONFIRMED

Full 4x4 cross matrix (`KALSA_Q6K_DENSE` in unset/""/f32/dp4a x `KALSA_Q8A_SCALE` in
unset/""/fp32/fp16, same harness, log `selector-matrix.log`): each selector returns the
same value regardless of the other variable's setting in all 16 combinations, e.g.
`f32/fp16 -> 1,0`, `dp4a/fp16 -> 0,0`, `f32/unset -> 1,1`, `dp4a/unset -> 0,1`. The two
lambdas each read only their own `getenv` key (source lines 1553 and 1571); there is no
shared static, no fall-through between them. Setting one variable to its non-default
value does not move the other's arm.

3.1 Note (pre-existing, not introduced by this line): at the dispatch, the stock env
`GGML_OPENCL_Q6K_DENSE_DP4A`, when set, overrides the `KALSA_Q6K_DENSE` selector
entirely (`=1` forces dp4a, `=0` forces the f32 GEMM, comment at ggml-opencl.cpp:23216).
The two KALSA selectors do not interfere with each other; this third knob is documented
in-code and was equally able to override during the measurement. Nothing on this line
changes its semantics.

---

## 4. Scope of the line - CONFIRMED

`git diff --name-status d75422944..tip` = exactly 3 files, matching the "quantizer
kernel + dp4a GEMM kernel + ggml-opencl.cpp" envelope (and the per-commit file lists
from item 1):

```
M  ggml/src/ggml-opencl/ggml-opencl.cpp
M  ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_q8_1_dp4a.cl
M  ggml/src/ggml-opencl/kernels/quant_a_q8_1.cl
```

`git diff --name-status a7d2cec79..tip` (whole line vs the release commit) = exactly
10 files: `ggml-opencl/CMakeLists.txt`, `cl-program-cache.cpp`, `cl-program-cache.h`,
`ggml-opencl.cpp`, `kernels/gemm_noshuffle_q6_k_f32.cl`,
`kernels/gemm_noshuffle_q6_k_q8_1_dp4a.cl`, `kernels/quant_a_q8_1.cl`,
`src/llama-governor-policy.cpp`, `tests/CMakeLists.txt`,
`tests/test-opencl-moe-roundtrip.cpp` - the coder's 10-file list, file for file.

The f32 activation transpose (`40a9358a1`) is ABSENT, checked independently:

- `git merge-base --is-ancestor 40a9358a1 tip` -> rc=1 (not in the line).
  The instrument commit `c6b45aaa4` also rc=1.
- `git diff d75422944..tip | grep -i -c 'transpose_32_32|KALSA_GEMM_B'` -> 0 hits;
  same grep over `git diff a7d2cec79..tip` -> 0 hits.
- `git diff --name-only a7d2cec79..tip | grep -i transpose` -> no hits (rc=1).
- On disk at the tip: `kernels/transpose.cl` has 0 occurrences of
  `kernel_transpose_32_32`; `ggml-opencl.cpp` and `kernels/gemm_noshuffle_q6_k_f32.cl`
  have 0 occurrences of `KALSA_GEMM_B`.
- Every remaining "transpose" hit in the whole-line diff is stock machinery
  (`kernel_transpose_32_16`, `kernel_transpose_32`, `transpose_2d_as_16b`, and the
  selector comment "f32 = transpose + noshuffle f32 GEMM") - the f32 route's existing
  transpose, not the `40a9358a1` activation transpose.

---

## 5. The seven standing targets, run by this audit - CONFIRMED

Fixture re-checked on disk: `build/tinyllamas/stories15M-q4_0.gguf` -> symlink to the
shared checkout's file, sha256 prefix `66967fbe`. Binary freshness re-checked before
running: `ninja -C build -n` lists only 9 pending steps, all in the UI-assets chain
(the "Provisioning UI assets" stamp is absent because the known `b11201` download
failed at configure time) - none of the seven test binaries or their objects are in
the pending set, so the binaries on disk are current with the tip sources. Logs:
`targets/*.log` in this directory.

cwd = worktree root, real exit codes:

| # | target | invocation | exit | FAIL lines |
|---|---|---|---|---|
| 1 | test-governor-v0 | `-m` fixture | 0 | 0 |
| 2 | test-governor-v0-commit | `-m` fixture | 0 | 0 |
| 3 | test-governor-v0-devices | `-m` fixture | 77 | 0 |
| 4 | test-governor-v0-hybrid | no `-m` | 77 | 0 |
| 5 | test-governor-v0-shared-cells | `-m` fixture | 0 | 0 |
| 6 | test-governor-v0-turns | `-m` fixture | 0 | 0 |
| 7 | test-governor-v02-router | no `-m` | 0 | 0 |

Seven counts: **0 0 77 77 0 0 0** - the standing sequence, reproduced by the auditor.
The 77s print their registered skip reasons, verbatim from the logs:

```
governor-devices: SKIP no GPU backend available (exit 77)
governor-hybrid: SKIP KALSA_HYBRID_GGUF is unset (exit 77)
```

(GPU-backend skip is expected: the standing build is METAL=OFF/OPENCL=OFF.)

PASS markers present: `governor_v0_token_check=PASS (8 tokens)`,
`governor_commit_full_state=PASS bytes=41712`, `governor_commit_subranges=PASS`,
`governor_commit_staged_cache_bound=PASS`, `governor_commit_reject_mismatched_type=PASS`,
`shared_cells_clear_fence=PASS`, `shared_cells_decode_fence=PASS`,
`shared_cells_seq_rm_fence=PASS`, `shared_cells_negative_guards=PASS`,
`governor_chunked_prefill=PASS`, `governor_hot_prefill_pause=PASS`,
`governor_low_battery_prefill=PASS`, `governor_v0_turns=PASS turns=3 generated=18`,
and the router verdict: **`router_v02_golden=PASS` + `router_v02_metrics=PASS`**.

Worktree hygiene: `git status --porcelain=v1` = 0 lines before the runs, 0 lines after,
`diff` of the two snapshots rc=0 - the test runs left the worktree byte-identical.

---

## 6. The Android artifact - CONFIRMED

Both ELFs re-verified on disk this session
(`build-android-ocl-phone-engine-v2/bin/`):

- `file`: both `ELF 64-bit LSB pie executable, ARM aarch64 ... interpreter
  /system/bin/linker64`. BuildIDs: `llama-cli`
  `cdc28acd01418541f1ca9fa7751411da7ce3156c`, `llama-perplexity`
  `9ae9ecf020b55c37702d0168db4c870b0b383081`. Sizes: 165,605,064 B and 119,901,504 B.
- **sha256 of `bin/llama-perplexity`** (the binary the phone measurement will run):

```
403857dab29ec33100628d4dae62395c23ad8e0d8e5663b3d7ca4025b432916e  bin/llama-perplexity
c69c3ae7bf86bfca357db92ae757a301d9acac5a5a47da82f236b3d585cb116a  bin/llama-cli
```

  The perplexity hash is byte-for-byte the value the coder reported; the phone
  measurement would run exactly this artifact.
- `strings -a` counts over both ELFs: `1577495b9` = **1** occurrence in each;
  `d75422944`, `87f31d81f`, `833cde99b` = **0** occurrences in each (9-char and 40-char
  forms both checked, all zero except the tip short form).
- Generated `build-android-ocl-phone-engine-v2/common/build-info.cpp`:
  `int LLAMA_BUILD_NUMBER = 11201;` and `char const * LLAMA_COMMIT = "1577495b9";`.
  `git rev-list --count 1577495b92` = **11201** - equal, as required.
- Freshness (auditor-added check the coder did not make): `ninja -C
  build-android-ocl-phone-engine-v2 -n` lists **zero** pending steps for
  `llama-perplexity` or any of its inputs - per the build graph the on-disk ELF is
  current with the tip sources (ELF mtime 15:47 is after the tip commit time
  15:43:52). The dry run does list 249 other pending steps: the never-built remainder
  of the full target graph (70 test objects, other tools/examples; `bin/llama` was
  never produced - the coder built exactly the perplexity+cli subset) plus the
  perpetual UI-assets chain whose stamp is absent because the known `b11201` download
  failed. `bin/llama-cli` sits in that pending relink set, but its on-disk bytes embed
  the correct commit and its sha256 matches the coder's record; `llama-perplexity`,
  the binary that matters for the phone, is fully current. No rebuild was run (that
  would have modified the worktree and possibly perturbed the artifact).

---

## 7. Push hygiene - CONFIRMED SAFE, COMMAND NOT RUN

Remote state read with `git ls-remote origin` this session
(`origin = https://github.com/Aspis0/kalsallama.git`):

```
d754229443670a7454731cd48028cb409ecc0ec2  refs/heads/kalsa-phone-v1-1-1
a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1  refs/heads/kalsa-release-v1-1-1
0f1b3bec7342ddd5624dc474c760a0b38bc80b5b  refs/tags/kalsa-server-v1.1.1
a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1  refs/tags/kalsa-server-v1.1.1^{}
```

- The remote phone branch is still exactly at the base `d75422944` - the push has not
  happened - and the tip `1577495b92` appears on **no** remote ref
  (`git ls-remote origin | grep -c 1577495b920...` = 0).
- Fast-forward precondition re-proven by the auditor:
  `git merge-base --is-ancestor d754229443 1577495b920` -> **rc=0**.
- `kalsa-server-v1.1.1`: `git cat-file -t` -> `tag` (annotated, object
  `0f1b3bec...`, identical to the remote tag object); `git rev-parse
  kalsa-server-v1.1.1^{commit}` -> **`a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1`**,
  identical to the remote peeled value. The release tag and the release branch have
  not moved.
- `remote.origin.push` and `push.default` are both unset, so the proposed explicit
  refspec is the whole story: it names exactly one destination ref.

Verdict on the command the owner proposes to run:

```sh
git push origin 1577495b92096fca572f57a35b71607bacac85d5:refs/heads/kalsa-phone-v1-1-1
```

**SAFE**: sha-based refspec, one destination ref, no force, no lease needed (plain FF
guaranteed by ancestry plus the observed remote value), cannot move the release branch,
the tag, or any other ref, and touches no local branch. It was NOT run by this audit,
and nothing was tagged.

---

## Verdict

**This line is safe to push, and then to vendor into the binding and pin into the app.**
All seven items CONFIRMED: the cherry-pick is patch-id-identical to `87f31d81f` with a
byte-identical message; the default flip, extracted from the source bytes and executed
as a standalone harness, leaves every arm reachable and composes - with no environment
variable set at all - to exactly the measured configuration (dp4a dense route +
fp32 activation scale, `0.005412 / 93.982 %` at `76.44 t/s` per
`../s23-kld-740-q4-0/REPORT.md` line 1170/1175), while `f32` and `fp16` remain
reachable and every bogus value exits non-zero; the two KALSA selectors are fully
independent across a 4x4 matrix; the diff is confined to the three allowed files (ten
versus the release commit) and the `40a9358a1` transpose is absent by ancestry and by
symbol; the seven standing targets reproduce the standing sequence `0 0 77 77 0 0 0`
with zero FAIL lines and both registered skip reasons; the Android `llama-perplexity`
hashes to exactly the recorded sha256, embeds only the tip commit, carries
`LLAMA_BUILD_NUMBER = 11201 = git rev-list --count`, and is current per the build
graph; and the push is a provable fast-forward of exactly one ref with the release tag
still peeling to `a7d2cec79`. Nothing was found that would make the phones run a
configuration other than the one that was measured. Two non-blocking notes for the
record: (1) the pre-existing stock env `GGML_OPENCL_Q6K_DENSE_DP4A`, if set in a
deployment environment, overrides the KALSA selector (documented in-code; keep it
unset on the phones); (2) empty-string values of the KALSA env vars select the default
arms, same as unset.
