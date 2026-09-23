# Release audit - `kalsa-release-v1-1-1` before push + tag `kalsa-server-v1.1.1`

Auditor: independent review agent, 2026-09-22. Adversarial pass over the coder's
report at `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/release-prep/REPORT.md`
(treated as testimony, re-derived from the repo). Shared checkouts untouched; no push,
no tag, no fetch was performed by this audit. The only network operations were
read-only queries (`git ls-remote`, one `git push --dry-run`, which sends nothing).
Raw command output is kept in `raw/` next to this file.

Line under audit: ref `kalsa-release-v1-1-1`, tip `a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1`,
worktree `/Users/marco/Projects/kalsallama-wt-release-v1-1-1`.

Pre-flight: worktree status is clean (`git status --porcelain=v1 -b` prints only
`## kalsa-release-v1-1-1`), so the checked-out tree equals the tip; it stayed clean
throughout the audit, including after the test runs. `git worktree list` confirms the
worktree is on `kalsa-release-v1-1-1` at `a7d2cec79`. `git remote -v`:
`origin = https://github.com/Aspis0/kalsallama.git` (the owner's fork);
`upstream = https://github.com/ggml-org/llama.cpp.git` with push URL `DISABLED`.

---

## Item 1 - the line contains exactly what it claims, and nothing else

Verdict: **CONFIRMED**.

Command: `git diff --stat 833cde99b..a7d2cec79` (run in the release worktree):

```
 src/llama-ext.h                    |  7 ++++---
 src/llama-governor-policy.cpp      |  5 ++++-
 tests/test-governor-v02-router.cpp | 15 +++++++++++++++
 3 files changed, 23 insertions(+), 4 deletions(-)
```

Command: `git diff --name-status 833cde99b..a7d2cec79`:

```
M	src/llama-ext.h
M	src/llama-governor-policy.cpp
M	tests/test-governor-v02-router.cpp
```

Command: `git diff --name-only 833cde99b..a7d2cec79 | wc -l` -> `3`.
Zero GPU/OpenCL paths: no `ggml/` file, no `ggml-opencl`, no Metal, no
`tests/test-opencl*` anywhere in the diff.

Command: `git log --format='%h parents=%p %s' 833cde99b..a7d2cec79`:

```
a7d2cec79 parents=e3088932c governor : refuse a plugged baseline of 0 C or colder in the engine gate
e3088932c parents=833cde99b governor : state raw t_idle_c in llama-ext.h and pin the sole-decider rule
```

`git rev-list --count 833cde99b..a7d2cec79` -> `2`. The line is exactly `main` plus
the two governor cherry-picks, linear (no merges), touching exactly the three claimed
files. Nothing missing, nothing extra.

## Item 2 - the cherry-picks are byte-identical to the audited originals

Verdict: **CONFIRMED** (patch-ids AND messages, recomputed independently; both match
the values the coder reported).

Command per commit: `git show <sha> | git patch-id --stable`:

```
== 7ac6a2387 (original 1) ==
da3ab315f974240886b7b0c402650d69e3b102f3 7ac6a2387c68ca4dccd61422ec833313192f6849
== e3088932c (pick 1) ==
da3ab315f974240886b7b0c402650d69e3b102f3 e3088932ccf6ed4568e0bbd1996ca6f51df4fbca
== e25701d02 (original 2) ==
4b9eed7f876dc7dfb0e1dec827d3108451f30af4 e25701d02bd7a6669e627163285ce2bb5c516e2f
== a7d2cec79 (pick 2, release tip) ==
4b9eed7f876dc7dfb0e1dec827d3108451f30af4 a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1
```

Pair 1 equal (`da3ab315...`), pair 2 equal (`4b9eed7f...`). Both equal the coder's
reported values, character for character.

Commit messages: `git log -1 --format=%B <sha>` saved to four files, compared with
`cmp` and `shasum -a 256`:

```
msg-7ac6a2387.txt 21e969e1...  ==  msg-e3088932c.txt 21e969e1...  -> pair 1 messages BYTE-IDENTICAL
msg-e25701d02.txt 259a9da8...  ==  msg-a7d2cec79.txt  259a9da8...  -> pair 2 messages BYTE-IDENTICAL
```

`cmp` reported no difference for either pair (exit 0). Per-commit stats also match
their originals exactly (original 1 = pick 1: `src/llama-ext.h` 4+/3- and
`tests/test-governor-v02-router.cpp` +10; original 2 = pick 2:
`src/llama-governor-policy.cpp` 4+/1- and test 11+/6-). Author and committer are
`Marco Gualtieri` on all four commits.

## Item 3 - the base difference is genuinely disjoint, not merely conflict-free

Verdict: **CONFIRMED**.

Topology (verified): the GPU line branches directly off today's `main`:
`833cde99b -> 1068eb03d -> 533d40008 -> 603f57800 -> 7ac6a2387 -> e25701d02 -> 563896ffa`.
`git merge-base 1068eb03d 833cde99b` = `833cde99b`; `1068eb03d` is not an ancestor of
`main`. Precisely: original 1 (`7ac6a2387`) sits on the GPU line two commits above
`1068eb03d` (parent `603f57800`); original 2 (`e25701d02`) sits on original 1. The two
bases differ by exactly the three GPU commits `1068eb03d`, `533d40008`, `603f57800`.

Full base delta: `git diff --stat 833cde99b 603f57800` ->

```
 ggml/src/ggml-opencl/CMakeLists.txt                |  10 +
 ggml/src/ggml-opencl/cl-program-cache.cpp          |  81 ++++
 ggml/src/ggml-opencl/cl-program-cache.h            |  31 +-
 ggml/src/ggml-opencl/ggml-opencl.cpp               | 409 ++++++++++++++++++---
 .../ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl |  37 +-
 src/llama-governor-policy.cpp                      |   5 +-
 tests/CMakeLists.txt                               |   5 +
 tests/test-opencl-moe-roundtrip.cpp                |  82 +++++
 8 files changed, 598 insertions(+), 62 deletions(-)
```

Three facts make the disjointness genuine, each verified from the source:

1. The ONLY overlap file between the excluded GPU work and the carried governor work
   is `src/llama-governor-policy.cpp`, and the base delta in that file is a single
   hunk: `git diff 833cde99b 603f57800 -- src/llama-governor-policy.cpp` shows exactly
   one hunk, `@@ -163,7 +163,10 @@ ... llama_governor_policy::prefill_engine() const`
   (the V73 GPU-prefill enablement). A single-hunk diff proves the ENTIRE rest of the
   file is byte-identical between the two bases - including `profile_is_valid()`
   (starts at line 53) and its only caller (`src/llama-governor-policy.cpp:90`,
   `if (!profile_is_valid(profile))`, identical at both bases per `git grep`).
2. The carried hunks are in different functions, ~100 lines apart:
   pick 1 touches `src/llama-ext.h @@ -263` (struct `llama_governor_params`) and
   `tests/test-governor-v02-router.cpp @@ -171` (`test_thermal_state()`); pick 2
   touches `src/llama-governor-policy.cpp @@ -60` (`profile_is_valid()`) and the test
   at `@@ -172`. The excluded GPU hunk is `@@ -163` (`prefill_engine()`). No hunk of
   either kind comes near the other.
3. `src/llama-ext.h` and `tests/test-governor-v02-router.cpp` are byte-identical
   between the bases: `git diff 833cde99b 603f57800 -- <those two>` is empty and
   `git rev-parse` gives the same blobs on both sides - `0550d17c6...` for
   `llama-ext.h`, `e58ceb537...` for the test - matching the coder's claim.

What could have silently changed meaning at a different base, and why it did not
happen here: a clean 3-way apply is only sound if the picked hunks' context and the
semantics they depend on are the same at both bases. That would have been broken if
the GPU commits had (a) edited `profile_is_valid()` or its caller, (b) changed the
thresholds/constants the gate reads in `llama-ext.h`, or (c) added a second caller
feeding the gate different data. All three are excluded by the evidence above: the
whole file outside the `prefill_engine()` hunk is identical, the header blob is
identical, and `git grep profile_is_valid` finds the same single call site at both
bases. The only behavioural difference between the bases is `prefill_engine()`'s V73
lane - exactly the change this release excludes. The carried change means the same
thing on `833cde99b` as it did on the GPU line.

## Item 4 - the tests, run by this audit on this base

Verdict: **CONFIRMED** (all numbers reproduced first-hand, not taken from the coder).

Build state verified before running: `build/CMakeCache.txt` has
`CMAKE_HOME_DIRECTORY = /Users/marco/Projects/kalsallama-wt-release-v1-1-1`,
`CMAKE_BUILD_TYPE=Release`, `GGML_METAL:BOOL=OFF`, `GGML_OPENCL:BOOL=OFF` (the
standing config). Generated `build/common/build-info.cpp` stamps
`LLAMA_COMMIT = "a7d2cec79"` (configured after the picks). `ninja -C build -n` lists
only `Re-running CMake` - no pending compile or link step, so the binaries are current
per ninja's dependency graph. Fixture `build/tinyllamas/stories15M-q4_0.gguf` is a
symlink to the shared checkout's file; sha256 `66967fbe...` is identical on both
sides, so the fixture is untouched.

The bare-run trap, demonstrated first-hand (all five model-dependent targets exit 1;
stderr as the coder reported):

```
test-governor-v0             rc=1
test-governor-v0-commit      rc=1
test-governor-v0-devices     rc=1
test-governor-v0-shared-cells rc=1
test-governor-v0-turns       rc=1
```

The seven standing targets, run from the worktree root with the standing invocation
(`-m build/tinyllamas/stories15M-q4_0.gguf` where the target takes `-m`; logs in
`raw/run-*.log`):

```
1 test-governor-v0              -m fixture   rc=0
2 test-governor-v0-commit       -m fixture   rc=0
3 test-governor-v0-devices      -m fixture   rc=77
4 test-governor-v0-hybrid       no -m        rc=77
5 test-governor-v0-shared-cells -m fixture   rc=0
6 test-governor-v0-turns        -m fixture   rc=0
7 test-governor-v02-router      no -m        rc=0
```

Seven counts: `0 0 77 77 0 0 0` - identical to the coder's sequence. The 77s are
registered skips, not failures, verified in the source:
`tests/CMakeLists.txt:374,378` set `SKIP_RETURN_CODE 77`, and the sources print the
reason - `governor-devices: SKIP no GPU backend available (exit 77)` (correct in a
METAL=OFF/OPENCL=OFF build) and `governor-hybrid: SKIP KALSA_HYBRID_GGUF is unset
(exit 77)`. `grep -c FAIL` over all eight run logs: `0` everywhere. The model-dependent
targets end in pass markers (e.g. `governor_commit_reject_mismatched_type=PASS`,
`shared_cells_seq_rm_fence=PASS`, `governor_v0_turns=PASS turns=3 generated=18 ...`).
The extra non-standing 8th target `test-governor-v0-mtp-hybrid -m fixture`: rc=77,
`mtp_hybrid=SKIPPED model has no MTP layers` - matches the coder's note.

`test-governor-v02-router` verdict: **PASS**. Direct run prints

```
router_v02_golden=PASS
router_v02_metrics=PASS
```

with rc=0. The pins compiled into the shipped binary (`strings
build/bin/test-governor-v02-router`) are the POST-`e25701d02` form, matching
`tests/test-governor-v02-router.cpp:175-188` on the tip:
`engine rule refuses a zero plugged baseline`,
`engine rule refuses a negative plugged baseline`,
`refused baseline leaves the state Invalid` - i.e. the executed binary carries the
second commit's flipped expectation, not the superseded "accepts" version.

Nothing in the environment prevented any target from running; no target was omitted.

## Item 5 - the tag command

Verdict: **CONFIRMED** (command audited; NOT executed - this audit creates no tags).

Precedent verified: `git cat-file -t kalsa-server-v1.1.0` -> `tag`;
`git rev-parse kalsa-server-v1.1.0` -> `c105c218236799f2f651517f5a0aeabcf4a8d8a1`;
`git rev-parse kalsa-server-v1.1.0^{commit}` -> `2a290390d67311b580ef398fd545e6d060b39897`;
`git cat-file -p` shows `object 2a290390d... / type commit / tag kalsa-server-v1.1.0`.
The remote also lists the `^{}` peeled entry for v1.1.0 (and v1.1.0/v1.0.0), i.e.
annotated tag objects. So the coder's claim about v1.1.0 is exactly right.

The proposed command (report section 5) is
`git tag -a kalsa-server-v1.1.1 a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1 -m '<msg>'`:

- Annotated: `-a` creates a tag object, same shape as v1.1.0; the coder's own
  post-run check (`git cat-file -t` -> `tag`) would fail on a lightweight tag.
- Points at the RELEASE TIP, not at `main`: the object is pinned by full SHA, so the
  result is `refs/tags/kalsa-server-v1.1.1` -> tag object -> commit `a7d2cec79`
  regardless of which checkout or HEAD the command is run from. This also removes the
  classic hazard of an object-less `git tag -a ... -m ...`, which tags HEAD and would
  have produced `833cde99b` (wrong artifact) if run from the main checkout.
- The name is unused: `git rev-parse -q --verify refs/tags/kalsa-server-v1.1.1`
  fails locally, and a targeted `git ls-remote origin 'refs/tags/kalsa-server-v1.1*'`
  returns only `kalsa-server-v1.1.0` - the remote has no v1.1.1.
- A lightweight tag (`git tag kalsa-server-v1.1.1 <sha>`, no `-a`) would be a defect:
  it would point the ref straight at the commit, breaking the annotated v1.1.0
  convention and any consumer that reads the tag object/message.

Caveat on the message body: it is an AI-authored DRAFT (the coder says so in the
report). Per the repository's contribution rules the owner must author the final tag
annotation themselves before running the command. The draft's release-line claims
(patch-ids equal, counts `0 0 77 77 0 0 0`, sole-decider PASS, Android binaries at
`a7d2cec79`) are all verified by this audit; the GPU-line rejection figures it quotes
(KLD 0.006954 vs 0.005, same-top 92.913% vs 95%, -9.9% prefill) are outside this
audit's scope and were NOT verified - keep them only if you have the bench evidence.

## Item 6 - is anything being pushed that should not be?

Verdict: **CONFIRMED** (nothing extra travels).

Excluded commits absent from the release line, `git merge-base --is-ancestor <c>
a7d2cec79` (rc=1 means absent):

```
1068eb03d absent    533d40008 absent    603f57800 absent    563896ffa absent
40a9358a1 absent (f32-transpose ref)    c6b45aaa4 absent (q6k-instrument ref)
```

They are also absent from `main` itself (same check against `main`, rc=1 for all
four), so their OBJECTS do not even travel inside the pushed history - the push
cannot leak GPU-line content as reachable objects. The corresponding local refs
(`kalsa-gpu-opencl-v73` at `1068eb03d`, `kalsa-engine-integration` at `563896ffa`,
`kalsa-opencl-f32-transpose` at `40a9358a1`, `kalsa-opencl-q6k-instrument` at
`c6b45aaa4`, plus ~a dozen other local heads such as `opencl-moe-masks`) are not
named by the push and stay local.

Could `git push origin main kalsa-release-v1-1-1` carry anything else? No:

- `push.followTags` UNSET, `push.default` UNSET, `remote.origin.push` refspec UNSET
  (checked with `git config --get`). With two explicit refspecs and no
  follow-tags/tags opt-in, git sends exactly those two refs.
- Definitive check, `git push --dry-run origin main kalsa-release-v1-1-1` (sends
  nothing):

```
To https://github.com/Aspis0/kalsallama.git
   2361be359..833cde99b  main -> main
 * [new branch]          kalsa-release-v1-1-1 -> kalsa-release-v1-1-1
```

Exactly two ref updates, both intended; no tags, no other branches.

Fast-forward and remote truth, read with `git ls-remote origin`: remote
`refs/heads/main` = `2361be359` (matches local `origin/main` byte-for-byte);
`git merge-base --is-ancestor origin/main main` -> true, `origin/main..main` = 234,
`main..origin/main` = 0; `origin/main..kalsa-release-v1-1-1` = 236. Plain
fast-forwards, no force needed, as claimed. The remote has no `kalsa-release-v1-1-1`
branch and no `kalsa-server-v1.1.1` tag yet (targeted ls-remote, empty).

One testimony discrepancy, no safety impact: the coder's section 6 excerpt presents
the remote as main + `b11010-merge` + two tags. The real remote ALSO carries
`refs/heads/bump-rehearsal-tmp`, `refs/heads/mtp-ctx-other` and a large set of
`refs/tags/archive/*` tags. None of them are touched by the proposed commands (the
dry-run proves it), and the coder's operative claims (neither the release branch nor
the v1.1.1 tag exists remotely; `b11010-merge` untouched) are all true.

---

## Verdict

**This line is safe to push and tag as it stands.** All six audit items are CONFIRMED
against first-hand evidence: the diff is exactly the three governor files and nothing
else; both picks are patch-id- and message-identical to the audited originals; the
base difference is a single GPU hunk in `prefill_engine()` ~100 lines away from the
carried `profile_is_valid()` hunk, with every dependency of the carried change
byte-identical between bases, so the picks mean the same thing on `833cde99b` as on
the GPU line; the seven standing targets reproduce `0 0 77 77 0 0 0` on this base
with zero FAIL lines and the sole-decider router PASSes with the post-`e25701d02`
pins in the shipped binary; the tag command is annotated, pinned by SHA to the
release tip, uses an unused name, and matches the v1.1.0 precedent; and the proposed
push - proven by a dry-run - carries exactly `main` (fast-forward) and the new
release branch, with the GPU line, the f32-transpose ref and the instrument ref
absent even as objects. Nothing found would make the pushed artifact wrong; there is
no stop. Two conditions before running the block: (1) author the tag annotation
yourself - the message in section 5 of the prep report is an AI draft, and its
GPU-line KLD/same-top/prefill figures were not audited here; (2) nothing else - the
push order (branch push, tag, tag push) is correct as written, and the tag will
trigger the server artifact build on commit `a7d2cec79` exactly as the consuming
workstream expects.
