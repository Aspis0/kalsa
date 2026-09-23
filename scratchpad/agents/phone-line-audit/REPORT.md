# Independent audit - ref kalsa-phone-v1-1-1, tip d75422944 (phone line v1.1.1)

Auditor: independent reviewer pass, 2026-09-22. Adversarial by default.
Scope of writes: this report only. No push, no tag, no ref moved, no checkout
modified. The worktree /Users/marco/Projects/kalsallama-wt-phone-line and the
shared checkout /Users/marco/Projects/kalsallama were treated as read-only;
the only bytes written outside this directory are test-run logs written here.

Inputs audited:

- Ref under audit: refs/heads/kalsa-phone-v1-1-1 = d754229443670a7454731cd48028cb409ecc0ec2
- Claimed base: refs/heads/kalsa-release-v1-1-1 = a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1
- Claimed picks: cd213fff7, 86f602f8a, 5b6c5361c, d75422944 (tip) - picks of
  1068eb03d, 533d40008, 603f57800, 563896ffa
- Coder evidence: ../phone-line-prep/REPORT.md (testimony; every load-bearing
  claim re-derived here from the repo and the artifacts)

Method note: `git patch-id` hashes only added/removed lines (whitespace and
line numbers ignored), so patch-id equality alone does not prove the hunk
landed with identical surroundings. Item 3 therefore verifies the governor
file from source, not from the file-level patch-id.

Status: IN PROGRESS - sections appended as completed.

---

## 1. Scope - CONFIRMED

Command: `git -C /Users/marco/Projects/kalsallama-wt-phone-line diff --name-status a7d2cec79..d754229443670a7454731cd48028cb409ecc0ec2`

Output, verbatim (8 lines, counted with `wc -l` = 8):

```
M	ggml/src/ggml-opencl/CMakeLists.txt
M	ggml/src/ggml-opencl/cl-program-cache.cpp
M	ggml/src/ggml-opencl/cl-program-cache.h
M	ggml/src/ggml-opencl/ggml-opencl.cpp
M	ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl
M	src/llama-governor-policy.cpp
M	tests/CMakeLists.txt
M	tests/test-opencl-moe-roundtrip.cpp
```

- Set equality with the coder's eight paths: byte-identical list, all eight match, no more, no less.
- `grep -iE 'transpose|q8|instrument|quant_a|dp4a'` over the name-status: no hits (rc=1). No
  `transpose.cl`, no q8-scale file, no instrument file.
- Commit enumeration: `git log --format='%H %s' a7d2cec79..d75422944` = exactly 4 commits,
  `git rev-list --count` = 4:

```
d754229443 opencl: KALSA_Q6K_DENSE routes dense q6_K prefill to the f32 GEMM by default
5b6c5361c4 opencl: compute the Adreno q6_K GEMM product in f32
86f602f8ab ggml-opencl : degrade weight-upload failures to a load error instead of abort
cd213fff78 gpu: no exit(1) on the OpenCL compile path, verdict keyed on the kernel set, V73 GPU prefill lane
```

  No governor commit in the range (no subject naming governor/defect 5.x; the only governor
  content in the range rides inside cd213fff7 - see section 3).
- `git merge-base a7d2cec79 d75422944` = a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1 (the tip is a
  strict descendant of the release tip).
- Excluded refs NOT ancestors of the tip (rc=1 from `git merge-base --is-ancestor`):
  f32-transpose 40a9358a1: rc=1; q8-scale 87f31d81f: rc=1; instrument c6b45aaa4: rc=1.
- Base identity: `git rev-parse a7d2cec79^{commit}` = refs/heads/kalsa-release-v1-1-1 =
  refs/remotes/origin/kalsa-release-v1-1-1 = a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1.
- `git rev-list --count d75422944` = 11199 (matches the claimed build number, re-checked in
  section 5).

## 2. Patch-id equality and commit messages - CONFIRMED

Command per side: `git show <sha> | git patch-id --stable | cut -d' ' -f1`
(patch-id token only; the second token is the commit id and necessarily differs).

| pair | original | patch-id (original) | picked | patch-id (picked) | verdict |
|---|---|---|---|---|---|
| 1 | 1068eb03d | f038dbf67d85f7719b58ee561717d574ed42d5c8 | cd213fff7 | f038dbf67d85f7719b58ee561717d574ed42d5c8 | EQUAL |
| 2 | 533d40008 | a1f22bb0616010b87cc5e61a70f5e42c2fe79ba4 | 86f602f8a | a1f22bb0616010b87cc5e61a70f5e42c2fe79ba4 | EQUAL |
| 3 | 603f57800 | 1501e8275d7760011f258cddea524cc6e9b2bb20 | 5b6c5361c | 1501e8275d7760011f258cddea524cc6e9b2bb20 | EQUAL |
| 4 | 563896ffa | 079721e8ecbecc67b1de96b3d59a5d255a3699af | d75422944 | 079721e8ecbecc67b1de96b3d59a5d255a3699af | EQUAL |

Commit messages: `%B` of each pair dumped to msg/orig.N.txt and msg/pick.N.txt, compared
with `cmp -s` (byte compare) and `shasum -a 256`:

```
pair 1  sha256 15bf232e49c5f96adf934f04de6b1ac1fc4244a986c9ccb60a56278165b6b942  cmp IDENTICAL
pair 2  sha256 a1577849039058e1133e1903a3afff9defeb73f1aa396641db54aa287998d489  cmp IDENTICAL
pair 3  sha256 6ee04f1cdc22436c5200e60255194d4d43f8090d37993a28fa18be1db3257e60  cmp IDENTICAL
pair 4  sha256 f2dbc4aaadf5bdc315379c788af098a6774caa67d3196dabdc9e7c0f696c3b5b  cmp IDENTICAL
```

Byte-identical, not merely similar. (No "(cherry picked from ...)" trailer was appended on
any pick.) Note: the coder's quoted message digests (f9e53b5c.., a825cd6a.., bd9ee257..,
d79654ef..) do not match mine - different digest (likely shasum default SHA-1 vs my
SHA-256 over the same %B bytes); pairwise equality is what the audit needs, and it holds
under both cmp and sha256, so this is a cosmetic difference in the report only.

Caveat carried into section 3: `git patch-id` hashes only +/- lines and ignores line
numbers and context, so patch-id equality does NOT prove the hunk landed in identical
surroundings. Section 3 therefore reads the governor file from source.

---

## 3. The governor file - CONFIRMED, with one bounded FINDING

Claim under test: the range's diff to src/llama-governor-policy.cpp is exactly one hunk
(the V73 prefill lane, belonging to 1068eb03d itself), and the governor pair's own hunks
are byte-identical to the release.

### 3.1 The hunk

`git diff a7d2cec79..d75422944 -- src/llama-governor-policy.cpp` - hunk count = 1 (counted
with `grep -c '^@@'`). Verbatim:

```diff
diff --git a/src/llama-governor-policy.cpp b/src/llama-governor-policy.cpp
index 479fcafca..e1fd6408e 100644
--- a/src/llama-governor-policy.cpp
+++ b/src/llama-governor-policy.cpp
@@ -166,7 +166,10 @@ llama_governor_engine llama_governor_policy::prefill_engine() const {
     }
     // measured: ALIVE #38: 8 Elite GPU prefill, G ttft 1434/1470 ms vs
     // C 16476/14412 ms (>=9.8x); decode 25.3/24.2 t/s >= C's.
-    if ((params_.generation == llama_governor_generation::V75 ||
+    // V73 carries the owner's 2026-09-21 enablement decision, not a measurement.
+    // The generation list is duplicated in the app; the form refactor should carry it once.
+    if ((params_.generation == llama_governor_generation::V73 ||
+         params_.generation == llama_governor_generation::V75 ||
          params_.generation == llama_governor_generation::V79) &&
         params_.gpu_fit == llama_governor_fit::Fit && params_.gpu_prefill_measured) {
         return llama_governor_engine::GPU;
```

Source-level comparison (not just file-level patch-id): `git show 1068eb03d --
src/llama-governor-policy.cpp` produces the same hunk at @@ -163 (the release tree has 3
more lines earlier in the file, from the release pair's defect-5.2 hunk in
update_thermal()). With @@/index/header lines stripped, the two diffs are byte-identical
INCLUDING the context lines - so the hunk did not merely land with identical +/- lines
(patch-id's guarantee), it landed in byte-identical surroundings. The hunk belongs to
1068eb03d, exactly as the coder claims.

Release-governor content: `git diff --stat a7d2cec79..d75422944 -- src/llama-ext.h
tests/test-governor-v02-router.cpp` is empty - both unchanged across the range, as claimed.
Since the whole-file diff is the single hunk above, every other byte of the release's
governor policy (profile_is_valid(), update_thermal(), admit_prefill(), select_decode(),
the defect-5.2 unplug clearing) ships byte-identical on the phone line.

### 3.2 Interaction with the governor guard

Guard locations at the tip (all line numbers verified identical between a7d2cec79 and
d75422944):

- The `t_idle_c > 0.0f` refusal is profile_is_valid() (lines 65-66), enforced in
  update_thermal() (lines 93-99): an invalid profile sets profile_valid_ = false and state
  = Invalid.
- The defect-5.2 unplug baseline clearing is update_thermal() lines 111-114 (added by
  61db879b8, whose policy-file hunk is at line ~105 - a different function from the V73
  hunk at ~166).
- The defect-5.1 hot-prefill pause lives in src/llama-governor-runtime.cpp (f2073505e
  touches runtime + test, not the policy file). That file is NOT in the range's 8-path
  diff, so it ships byte-identical to release.
- prefill_engine()'s first gate (lines 159-163) returns CPU unless profile_valid_ and
  state is not CRITICAL/Invalid/LOWBAT and battery >= 45.

Can the hunk bypass the t_idle_c refusal? No. The refusal is strictly upstream: a refused
profile forces CPU at lines 159-163 before the V73 lane at 171-176 is ever reached. The
hunk adds a generation to an existing device list; it does not touch any guard input.

Is there an interaction at all? Yes - same function, same decision, and this is the
finding to record: for a V73 device with gpu_fit == Fit AND gpu_prefill_measured,
prefill_engine() now returns GPU where the release falls through to the pre-existing V73
cool lane (lines 177-179: MoE + cool_prefill_eligible + Fit + !hot_plugged_ ->
GPU_COOLMODE) or to CPU. The new lane has NO hot_plugged_ check, so a hot plugged V73 now
presents a GPU prefill request to the unchanged admit_prefill() admission table (rule 3 /
CPUFallback semantics) and to the unchanged runtime-side defect-5.1 pause, where the
release would have presented CPU (rule 9, Admit). The governor's prefill DECISION for V73
therefore differs from the released engine - by design: this hunk IS the V73 GPU prefill
enablement, and its own comment states "V73 carries the owner's 2026-09-21 enablement
decision, not a measurement."

Why this is not a silent divergence from the measured engine: the defect-5.1 and 5.2
commits are ancestors of BOTH the release tip a7d2cec79 and the integration tip
563896ffa, and

`git diff 563896ffa d75422944 -- src/llama-governor-policy.cpp src/llama-governor-policy.h
 src/llama-governor-runtime.cpp src/llama-ext.h 'tests/test-governor-*'`

is EMPTY. The governor code the phone will run is byte-identical to the integration tip
where the four GPU picks were developed and exercised; it differs from the release only by
this one intended, in-code-documented lane. The one genuinely unmeasured behavior is V73
GPU prefill itself - the hunk says so on its face, so nothing is silent - and the phone
measurement (run after pinning, against this binary) is the intended validation of it.

One pinning-time note out of this repo's scope: the hunk's comment warns the generation
list is duplicated in the app. The engine-side lane only takes effect if the app-side
duplicate also names V73 - the binding/app step must be checked for that, or the phone
silently stays on the old path (harmless, but not the intent).

## 4. The tests, run by me on this base - CONFIRMED

Two builds used. (a) The worktree's own standing build/ (GGML_METAL=OFF, GGML_OPENCL=OFF,
Release per CMakeCache.txt; generated build/common/build-info.cpp says LLAMA_COMMIT =
"d75422944", LLAMA_BUILD_NUMBER = 11199; binaries timestamped after the commits). The one
pending `ninja -n` step was investigated with `-d explain`: build.ninja is older than the
worktree's git INDEX file (mtime refreshed by status runs after the build) - no compile
input is pending, so build/ is the tip's build. (b) My own independent rebuild at
/tmp/phone-line-audit-build, configured from the audited worktree with the same flags
(configure log: `-- ggml commit:  d75422944`; 160/160 ninja steps rc=0), so the results do
not rest on the coder's binaries alone.

Runs (cwd = worktree root, fixture build/tinyllamas/stories15M-q4_0.gguf - a symlink to
the shared checkout's 19,077,344-byte model; logs in runs-standing-build/ and
runs-independent-build/ here):

| target | invocation | standing rc | independent rc |
|---|---|---|---|
| test-governor-v0 | -m fixture | 0 | 0 |
| test-governor-v0-commit | -m fixture | 0 | 0 |
| test-governor-v0-devices | -m fixture | 77 | 77 |
| test-governor-v0-hybrid | bare (takes no -m) | 77 | 77 |
| test-governor-v0-shared-cells | -m fixture | 0 | 0 |
| test-governor-v0-turns | -m fixture | 0 | 0 |
| test-governor-v02-router | bare (takes no -m) | 0 | 0 |

Sequence 0 0 77 77 0 0 0, identical on both builds and identical to the release line's
recorded sequence. The two 77s are documented self-skips, quoted from the logs:
"governor-devices: SKIP no GPU backend available (exit 77)" and "governor-hybrid: SKIP
KALSA_HYBRID_GGUF is unset (exit 77)". The router log carries router_v02_golden=PASS and
router_v02_metrics=PASS on both builds.

Bare-run trap, demonstrated on all five model-dependent targets, both builds: exit 1 each,
and the five bare logs contain exactly 5 occurrences of "error: --model is required"
(fixture problem, not code).

FAIL count: `grep -c FAIL` over all seven designated logs (both builds) = 0 everywhere.

test-opencl-moe-roundtrip (the OpenCL-side test the line touches): the target is built
UNCONDITIONALLY in tests/CMakeLists.txt (llama_build, "not a ctest"); the range's CMake
change is only the GGML_OPENCL-gated include-dir block. In this METAL=OFF/OPENCL=OFF
config the binary runs and exits rc=2 printing "no OpenCL backend" (identical on both
builds) - it is launchable but cannot produce its round-trip verdict without an OpenCL
backend, which this config does not have. The OPENCL=ON binary that does exist is the
Android ARM ELF, which cannot execute on this Mac and has no Adreno device here. So the
test cannot yield a verdict in any config runnable on this host; its rc=2/"no OpenCL
backend" behavior is reported rather than claimed as a pass.

Coverage note: build/bin also contains test-governor-v0-mtp-hybrid, which appears in
neither the coder's table nor the "seven" as scoped. I ran it on both builds: bare -> rc=1
"error: --model is required"; with the fixture -> rc=77 with
"mtp_hybrid=SKIPPED model has no MTP layers, pass a Qwen3.5-class GGUF with -m"
(documented fixture skip; the standing fixture is stories15M). No failure.

## 5. The Android artifact - CONFIRMED

Artifact: build-android-ocl-phone-v1111/{bin/llama-cli,bin/llama-perplexity} in the
worktree, both `ELF 64-bit LSB pie executable, ARM aarch64, ... interpreter
/system/bin/linker64` per file(1) (BuildID 774941fe0d... and 6cbe0d9d88...,
not stripped, with debug_info).

- sha256 (shasum -a 256), verbatim:

```
4c351ace97745f847bb358dd2a0a0239757f152a830f8588892ba6902d3d17e6  bin/llama-cli
aa5fa409526c2958533e03470f8bc3571a21896e57f612485de63c31d14a24d1  bin/llama-perplexity
```

  The llama-perplexity digest matches the claimed
  aa5fa409526c2958533e03470f8bc3571a21896e57f612485de63c31d14a24d1 exactly. Sizes
  165,466,048 / 119,800,632 bytes match the coder's claims.
- Embedded commit: strings -a over each ELF, exact-line match: `d75422944` = 1 hit in
  llama-cli and 1 hit in llama-perplexity; `a7d2cec79` = 0, `563896ffa` = 0,
  `833cde99b` = 0 in both; the format string `version: %s (build %d, commit %s)` = 1 hit
  in each. The generated build-android-ocl-phone-v1111/common/build-info.cpp says `LLAMA_COMMIT = "d75422944"` and
  `LLAMA_BUILD_NUMBER = 11199`, and the Android CMakeCache has GGML_OPENCL:BOOL=ON,
  BUILD_SHARED_LIBS:BOOL=OFF, ANDROID_ABI=arm64-v8a, ANDROID_PLATFORM=android-28.
- Build number: `git rev-list --count d75422944` = 11199 = LLAMA_BUILD_NUMBER. (My
  independent /tmp rebuild of the same tree independently stamped commit d75422944 and
  build 11199 at configure time.)

## 6. Push hygiene - CONFIRMED

- Proposed command (coder section 6, UNRUN): `git push origin
  refs/heads/kalsa-phone-v1-1-1:refs/heads/kalsa-phone-v1-1-1` from the shared checkout.
  One explicit full refspec; no --tags, no --all, no --mirror, no --force.
- Config: push.default, push.followTags, remote.origin.push all UNSET;
  branch.kalsa-phone-v1-1-1 has no upstream (remote/merge unset). With an explicit
  single-refspec push and followTags off, the only remote ref that can be created or moved
  is refs/heads/kalsa-phone-v1-1-1.
- Remote state (read-only `git ls-remote origin`, nothing written): NO
  kalsa-phone-v1-1-1 exists remotely (creation, not a move); refs/heads/kalsa-release-v1-1-1
  = a7d2cec79e7d495cbfa3e6b3a78bd4af3fab44b1; refs/tags/kalsa-server-v1.1.1 =
  0f1b3bec7342ddd5624dc474c760a0b38bc80b5b, peeled ^{} = a7d2cec79 (matches the coder's
  expected values verbatim; the tag will not move).
- Excluded refs must not travel: kalsa-opencl-f32-transpose (40a9358a1),
  kalsa-opencl-q8-activation-scale (87f31d81f), kalsa-opencl-q6k-instrument (c6b45aaa4),
  and the originals' branches kalsa-gpu-opencl-v73 / kalsa-engine-integration are ALL
  absent from the remote (ls-remote returned no output for all five), none is an ancestor
  of the tip (section 1), and none is named in the push command - so neither their refs
  nor their unique objects (transpose.cl, the q8-scale and instrument changes) can be
  sent by this push. Their local branches and the detached worktrees at 40a9358a1 /
  87f31d81f / c6b45aaa4 are unaffected by a push of the phone branch.
- No local ref moves: push does not rewrite the local branch; on success it would only add
  refs/remotes/origin/kalsa-phone-v1-1-1 (a new ref, not a move of an existing one).
- I did not run the push, nor any dry run.

---

## Verdict

Per-item: 1 CONFIRMED, 2 CONFIRMED, 3 CONFIRMED with one bounded FINDING (detailed in
section 3.2), 4 CONFIRMED, 5 CONFIRMED, 6 CONFIRMED.

This line is safe to push and then pin. The range is exactly the four GPU picks on top of
the untouched release tip (patch-ids and commit messages byte-equal to their originals,
and the first pick's governor hunk landed in byte-identical surroundings); the standing
tests reproduce the release line's exact exit sequence on the coder's build AND on my own
independent rebuild of the audited tree; the Android ELFs carry exactly the audited tip
(d75422944, build 11199), the claimed llama-perplexity sha256 reproduces bit-for-bit, and
the proposed push is a single-refspec creation of kalsa-phone-v1-1-1 with the release ref,
the release tag, and the three excluded GPU refs all verified immovable by it. The FINDING
that must travel with the pin, not block it: the phone engine's governor prefill decision
for V73 differs from the released engine - that is the intended, in-code-documented
"owner's 2026-09-21 enablement decision, not a measurement", the guard code (t_idle_c
refusal, unplug baseline clearing, hot-prefill admission) is untouched and still binds
upstream of the lane, and the whole governor is byte-identical to the integration tip the
picks were measured on. Two conditions before/with pinning: (a) confirm the app-side
duplicate of the generation list names V73, since the engine lane is dead without it; and
(b) treat the phone measurement against this binary as the pending validation of the V73
lane itself - if that measurement is skipped, the lane ships owner-approved but never
measured on the device it will run on. The test-opencl-moe-roundtrip verdict remains
unavailable on this host by construction (rc=2 "no OpenCL backend" in any runnable
config); it is not a pass and was never claimed as one.
