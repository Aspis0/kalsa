# Independent audit - binding line kalsarn-governor-engine, tip b62be78f95b93ea7ba8755388c87f0860827b363

Auditor: independent reviewer pass, 2026-09-22. Adversarial by default.
Scope of writes: this directory only. No push, no tag, no ref moved. The
shared checkouts (~/Projects/llama.rn-kalsa, ~/Projects/kalsallama) were
treated as read-only; all sync re-runs and test runs happen in my own
clone under runs/ here.

Inputs audited:

- Ref under audit: refs/heads/kalsarn-governor-engine = b62be78f95b93ea7ba8755388c87f0860827b363
- Claimed line: 0288dc27 -> cc804436 -> b97c581d -> b62be78f9
- Claimed vendored engine commit: d754229443670a7454731cd48028cb409ecc0ec2
- Coder evidence: ../binding-prep/REPORT.md (testimony; every load-bearing
  claim re-derived here from the repo and the artifacts)
- Methodology follows ../phone-line-audit/REPORT.md (patch-id --stable,
  source-level comparison where patch-id is not sufficient, read-only
  ls-remote for push hygiene).

Status: COMPLETE - all six items verified, verdict at the end.

---

## 1. The line is what it claims - CONFIRMED

Repo: /Users/marco/Projects/llama.rn-kalsa (origin = https://github.com/Aspis0/kalsa.rn.git,
upstream = mybigday/llama.rn with push DISABLED). Shared checkout read-only for me; its
working tree is clean except the pre-existing untracked pnpm-lock.yaml / pnpm-workspace.yaml.

Command: `git rev-list --count 0288dc27..b62be78f9` = 3, and
`git log --format='%H %P %s' 0288dc27..b62be78f9`:

```
b62be78f95b93ea7ba8755388c87f0860827b363 b97c581d7968ba516bdf66d05da9ad4d33bda67a build(engine): pin llama.cpp to d754229 (GPU numerics fix)
b97c581d7968ba516bdf66d05da9ad4d33bda67a cc80443609bda38f0152730549b2861882d52964 test(governor): pin that the thermo parse forwards plugged baselines
cc80443609bda38f0152730549b2861882d52964 0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2 refactor(governor): drop the plugged validity rule from the thermo check
```

Single-parent chain, exactly the claimed four commits in the claimed order. Refs:
`main` = `origin/vendor-migration` = 0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2 (base);
`kalsarn-governor-transport` = b97c581d...; `kalsarn-governor-engine` = b62be78f9... (HEAD).

### Carried, not replaced - object identity, which is stronger than patch-id

The original of the governor-transport work exists: it is the branch
`kalsarn-governor-transport`, and its tip is the SAME commit object b97c581d7968 that the
new line carries as its second parent. `git rev-parse refs/heads/kalsarn-governor-transport`
= b97c581d7968ba516bdf66d05da9ad4d33bda67a. There was no rebuild/rebase: the branch reflog
shows the two commits being created in place
(`branch: Created from HEAD` at 0288dc27, then `commit:` cc804436, then `commit:` b97c581d),
and the engine branch reflog shows `branch: Created from b97c581d` followed by one commit.
No reset, no amend, no rebase entries.

patch-ids recomputed the way previous audits did
(`git show <sha> | git patch-id --stable`):

```
cc80443609 -> baffefd6b4b22d1128952e9c143e821c4a3e0c84
b97c581d79 -> b666d1745482254a605ed0e0f934b6185c8a4555
git show refs/heads/kalsarn-governor-transport | git patch-id --stable -> b666d1745482254a605ed0e0f934b6185c8a4555 (identical)
```

Patch-id equality here is trivially true because the objects are identical; the parent
linkage makes the equality statement redundant. What the patch-id cannot prove (identical
surroundings) does not arise for a carried object.

Content check of the carried work:

- `git diff --name-status 0288dc27 cc804436` = exactly `M cpp/rn-governor-params.cpp`;
  the hunk replaces the plugged branch (`t_idle_valid && isfinite(t_idle_c) && t_idle_c
  + 1.0f < 42.0f`) with `return true;` inside governor_thermo_profile_is_valid - the
  deletion of the binding's third copy of the engine's plugged validity rule, as claimed.
- `git diff --name-status cc804436 b97c581d` = `M tests/CMakeLists.txt`,
  `M tests/build_and_test.sh`, `A tests/governor_params_test.cpp` (113 lines),
  `M tests/run_tests.sh` - the harness test is added AND wired into both harness scripts,
  not left dangling.
- `git diff --name-status b97c581d b62be78f9` touches NO file under cpp/ or tests/ - the
  tip does not weaken or bypass the carried work.

---

## 2. The vendored tree IS engine d7542294, by comparison - CONFIRMED

Re-derived independently, starting from scripts/sync-vendor.sh (read in full), not from the
coder's description. Write scope: everything below runs/ in this audit directory; the
shared checkout and the sync cache were only read.

Chain of identity established first (content-addressed, so sha equality IS tree equality):

```
git -C ~/.cache/llama.rn/llama.cpp remote get-url origin
  -> https://github.com/Aspis0/kalsallama          (matches LLAMA_CPP_REPO; the script's
                                                      wrong-repo-in-cache vector is closed)
git -C ~/.cache/llama.rn/llama.cpp rev-parse --is-shallow-repository -> false
git -C ~/.cache/llama.rn/llama.cpp cat-file -e d754229443...^{commit} -> present
git -C ~/Projects/kalsallama rev-parse refs/heads/kalsa-phone-v1-1-1
  -> d754229443670a7454731cd48028cb409ecc0ec2      (= shared checkout)
git ls-remote https://github.com/Aspis0/kalsallama refs/heads/kalsa-phone-v1-1-1
  -> d754229443670a7454731cd48028cb409ecc0ec2      (= GitHub, read-only query)
git merge-base --is-ancestor 4ccef2f85dbc27e095e11ffcbad4628be9961790 d754229443...
  -> 0; old pin IS an ancestor (this bump = old pin + delta, as claimed)
```

So remote = shared checkout = sync cache = vendor/VERSIONS, four independent legs, same
object. The revision graph from the old pin to the new pin is exactly 20 commits
(11179 = rev-list --count 4ccef2f85, 11199 = rev-list --count d7542294).

The re-derivation itself (mechanical, from the script's own arrays):

1. Extracted `LLAMA_CPP_PATHS` verbatim out of scripts/sync-vendor.sh with
   `sed -n '/^LLAMA_CPP_PATHS=(/,/^)/p'` (96 pathspec entries, comments included) and ran
   `git -C ~/.cache/llama.rn/llama.cpp archive --format=tar
   d754229443670a7454731cd48028cb409ecc0ec2 "${LLAMA_CPP_PATHS[@]}"` into a fresh empty
   directory runs/vendor-derive.
2. Re-applied all 20 patches from scripts/patches/llama.cpp/ in glob order with
   `patch -p1`, exactly as the script does: 20/20 applied, 0 failed. Deleted the 11
   `*.orig`/`*.rej` leftovers exactly as the script's cleanup does.
3. `diff -r` of runs/vendor-derive vs the committed vendor/llama.cpp, excluding the
   script's own KEEP semantics (`-x ggml-version.h -x llama-version.h -x build-info.cpp
   -x 'ggml-metal-embed-*.s' -x v73`): **exit 0, byte-identical, zero output.**
4. Exhaustive classification of what the committed tree has that the derivation does not
   (full `diff -r -q`, no excludes): 23 entries, every one either a
   `ggml-metal-embed-*.s` file (20) or one of the three generated version files
   (src/llama-version.h, ggml/src/ggml-version.h, common/build-info.cpp). The reverse
   direction is empty - the derivation contains NOTHING that is absent from the committed
   tree. 23 = exactly the script's KEEP list; nothing else, nothing hidden.
5. Blob check on the files this bump changed under vendor/llama.cpp. The tip's diff has 11
   vendor/llama.cpp paths; the 3 generated ones are covered in (6). For the other 8,
   `git hash-object vendor/llama.cpp/<path>` vs
   `git rev-parse d7542294...:<path>` - ALL EQUAL:

```
EQUAL  ggml/src/ggml-opencl/CMakeLists.txt                 bbc11ea0d33e9ae7ca4306a06fa49b91602a158f
EQUAL  ggml/src/ggml-opencl/cl-program-cache.cpp           fce86a27b0b1b5717962b4c556fec75677fdb03f
EQUAL  ggml/src/ggml-opencl/cl-program-cache.h             e408c0159417749eb01b2a01dbe724af63981d84
EQUAL  ggml/src/ggml-opencl/ggml-opencl.cpp                f0c5d8ee854dd7edf8afd510859af43a62aa2187
EQUAL  ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl 8ec34883e9fd509072706f60230928458652088d
EQUAL  src/llama-ext.h                                     1810cf9ac4c7160d86d093efcb72289db8987726
EQUAL  src/llama-governor-policy.cpp                       e1fd6408e7a1fa0369b2fdfd6760d74d46fa774d
EQUAL  src/llama-governor-runtime.cpp                      8819951a988ef1cc8aea87a4f20581ea8ae91d7b
```

6. The three generated version files and src/version.ts were regenerated here with the
   script's own pipeline (rev-list --count = 11199, commit prefix d754229, llama 0.4.1-dev,
   ggml 0.24.0-dev, sed over the committed .in templates) and byte-compared:

```
BYTE-IDENTICAL vendor/llama.cpp/src/llama-version.h
BYTE-IDENTICAL vendor/llama.cpp/ggml/src/ggml-version.h
BYTE-IDENTICAL vendor/llama.cpp/common/build-info.cpp
BYTE-IDENTICAL src/version.ts
```

Verdict: the committed vendor/llama.cpp is exactly archive(d7542294...) + the repo's 20
patches, recomputed from the commit object itself, plus the script's own generated/KEEP
files, which also byte-reproduce from the same commit. The string in VERSIONS, the 7-char
build commit in three version files, and the actual bytes on disk all derive from and
agree with one content-addressed commit that exists on GitHub, in the shared checkout, and
in the sync cache. The hand-pinned-tree incident vector is closed on this line.

---

## 3. The bump's scope - CONFIRMED

Command: `git diff --name-status b97c581d b62be78f9` - 16 paths, counted with `wc -l`:

```
M	lib/commonjs/version.js
M	lib/module/version.js
M	lib/typescript/version.d.ts
M	src/version.ts
M	vendor/VERSIONS
M	vendor/llama.cpp/common/build-info.cpp
M	vendor/llama.cpp/ggml/src/ggml-opencl/CMakeLists.txt
M	vendor/llama.cpp/ggml/src/ggml-opencl/cl-program-cache.cpp
M	vendor/llama.cpp/ggml/src/ggml-opencl/cl-program-cache.h
M	vendor/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp
M	vendor/llama.cpp/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_f32.cl
M	vendor/llama.cpp/ggml/src/ggml-version.h
M	vendor/llama.cpp/src/llama-ext.h
M	vendor/llama.cpp/src/llama-governor-policy.cpp
M	vendor/llama.cpp/src/llama-governor-runtime.cpp
M	vendor/llama.cpp/src/llama-version.h
```

Every path is under `vendor/` or is the sync's own version output (`src/version.ts`, the
three `lib/` version modules the sync gate demands stay in agreement with the regenerated
`src/version.ts`). Nothing else: no source, no build files, no scripts, no package.json.
The 8 content files + 3 generated files under vendor/llama.cpp are exactly the delta
between the old and new engine pins (section 2), and the lib/ triple is the compiled
output of the src/version.ts change (checked byte-identical to the committed ones after
`npm run build` in section 5).

vendor/VERSIONS names the engine commit: `LLAMA_CPP_REF=d754229443670a7454731cd48028cb409ecc0ec2`
and `LLAMA_CPP_COMMIT=d754229443670a7454731cd48028cb409ecc0ec2`; the tip's diff shows the
pair moving together from 4ccef2f85... to d7542294...

`LLAMA_CPP_COMMIT` written by the tooling, not typed - three legs of evidence:
(a) scripts/sync-vendor.sh `record_commit()` mechanically rewrites the line with
`sed "s/^LLAMA_CPP_COMMIT=.*/LLAMA_CPP_COMMIT=${commit}/"` from the resolved ref, and
`ensure_repo` only accepts a 40-hex REF by checking the object exists in the cache
(`cat-file -e`) - a hand-typed value that was not a real object could not have passed;
(b) the committed value is a sha that exists on GitHub, in the shared checkout, and in the
sync cache, all verified equal in section 2; (c) the decisive one, section 4: re-running
the sync on the committed tree leaves the file byte-stable, so the committed line IS what
the tooling writes from LLAMA_CPP_REF.

---

## 4. Reproducibility: sync re-run on a clean tree - CONFIRMED

Not run in the shared checkout. I cloned it fresh:
`git clone --no-hardlinks ~/Projects/llama.rn-kalsa runs/binding-clone`
(HEAD = b62be78f95b93ea7ba8755388c87f0860827b363, branch kalsarn-governor-engine,
`git status --porcelain` = 0 lines). The clone carries no untracked pnpm files, no
node_modules, no test build artifacts - a genuinely clean tree.

`npm run sync:vendor` in that clone: **exit 0**. From runs/sync-rerun.log:

```
==> Syncing llama.cpp @ d754229443670a7454731cd48028cb409ecc0ec2
  commit: d754229443670a7454731cd48028cb409ecc0ec2
  patch: barbet-llama-arch.cpp.patch
  ... (20 patch lines, llama.cpp; then codec.cpp, OpenCL-Headers, OpenCL-ICD-Loader)
assert-kalsa-vendor: ok (marker x1, kalsa_moe x1, upstream hunks present, governor src real, lib/ matches src/version.ts)
assert-rnllama-sources: ok (41 explicitly-named paths resolve)
assert-rnllama-sources: ok (18 cpp/jsi sources use framework-safe includes)
```

`git status --porcelain` after the sync: **0 lines** (file runs/status-after-sync.txt,
empty). `git diff --stat`: empty. The tooling re-resolved the pin from the 40-hex sha in
its own cache with no fetch, rewrote VERSIONS/COMMIT to the same value, regenerated the
three version files and src/version.ts, re-applied the patches, and produced not one
changed byte. The vendoring step is idempotent on the committed tree, and the gates inside
the sync pass on my clone exactly as the coder reported.

---

## 5. The tests, run by me - CONFIRMED (jest pre-existing; harness 4/4)

Environment: my clone runs/binding-clone (no node_modules, no build artifacts at start);
node_modules copied in from the shared checkout with rsync (read-only source), so jest ran
against the same pnpm-installed dependency tree; node v26.3.0. The LFS fixture
tests/tiny-random-llama.gguf was an un-smudged 133-byte pointer in the clone; I fetched the
object ONCE into my clone via the GitHub LFS batch API for
oid sha256:27fa9f4815defb3baa537eb82ec98df4f3bc5eba3b5c9a827075190e8be36e4f
(size 65973792), got the object, sha256 matches the pointer oid exactly, first 4 bytes
= "GGUF". The shared checkout was never touched by this.

### LFS fixture state in the SHARED checkout - CONFIRMED as it was

`git -C ~/Projects/llama.rn-kalsa status --porcelain tests/` = 0 lines; the on-disk file
byte-compares equal to `git cat-file blob HEAD:tests/tiny-random-llama.gguf` (the
133-byte pointer, `version https://git-lfs.github.com/spec/v1`, oid sha256:27fa9f48...,
size 65973792). The coder's "fetched transiently, then restored" claim holds: the fixture
is exactly as committed.

### Jest: 12/12 failures are pre-existing on the pristine base - CONFIRMED

- At the tip (my clone, clean at b62be78f9): `npx jest` -> exit 1,
  **Test Suites: 12 failed, 12 total, Tests: 0 total**. All 12 failures are
  "Test suite failed to run" / "Jest encountered an unexpected token", dying inside
  node_modules/.pnpm/react-native@0.72.3*/jest/setup.js:16 under node v26.3.0 - no test
  body ever executes. Failing suites (runs/jest-tip.suites.txt): 7 under example/src,
  5 under src/__tests__.
- At the pristine base 0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2 (which predates ALL THREE
  commits of this line - stricter than the coder's b97c581d check): same node_modules,
  `npx jest` -> exit 1, **Test Suites: 12 failed, 12 total, Tests: 0 total**.
  `diff` of the sorted failing-suite lists at base vs tip: **IDENTICAL**; 12/12
  "Test suite failed to run" in both logs; same react-native setup.js signature.

The jest breakage exists on the unmodified base, so this line did not break it; it is an
environment problem (jest 28 / RN 0.72 preset vs node 26), matching the coder's account.

### C++ harness: first build attempt invalidated by the auditor, redone clean

Transparency note: my first `./tests/build_and_test.sh` run in the clone was wrecked by my
own sequencing - I checked the tree out to the base for the jest run WHILE the build was
still compiling, so the build saw a mixed tip/base tree and correctly failed
("No rule to make target governor_params_test" - the target does not exist at the base).
That run is discarded as auditor error; its numbers are not evidence in either direction.
I checked the tip back out (HEAD re-verified b62be78f9), deleted tests/build entirely, and
restarted a clean build with the tree left untouched until completion. Results appended
when done.

### C++ harness, clean rebuild at the tip - CONFIRMED 4/4

Rebuild after discarding my contaminated first attempt (see above): at b62be78f9, tree
untouched for the whole build, `./tests/build_and_test.sh` -> exit 0, "Build Successful",
0 "Error" lines, all four targets linked (rnllama_tests, parallel_decoding_test,
chat_parse_utf8_test, governor_params_test - the last is the load-bearing harness test
added by carried commit b97c581d). Then `./tests/run_tests.sh` -> **exit 0, Passed: 4/4,
Failed: 0/4**, `grep -c "FAIL|✗"` over the whole log = 0. Per suite, from
runs/run_tests.log:

```
Basic integration tests:       Total tests: 6   (loads ../tiny-random-llama.gguf for real)
Parallel decoding tests:       Total tests: 28
Chat parse UTF-8 tests:        Total tests: 18
Governor params tests:         Total tests: 4
```

The model load is real, not a mock: the log shows llama_model_loader reading 28 KV pairs
and 21 tensors from ../tiny-random-llama.gguf (GGUF V3, llama arch) - i.e. the vendored
engine sources from this tip parsed, loaded, and ran the tiny model on this host,
reproducing the coder's 6/6 + 28/28 + 18/18 + 4/4 exactly. The fixture object was in my
clone only (sha256 verified above); afterwards I restored the pointer in my clone and
re-verified the shared checkout's fixture is still the committed pointer.

Also run by me, not previously claimed as a pass anywhere: nothing else - per the audit
brief, the engine-side suites (test-opencl-moe-roundtrip, test-governor-v0-mtp-hybrid)
live in the ENGINE repo, are not part of this binding line's harness, and were not run
here, so none is claimed.

---

## 6. Push hygiene - CONFIRMED SAFE (command NOT run)

Proposed command (coder's report, UNRUN here, not even a dry run):
`git -C ~/Projects/llama.rn-kalsa push origin kalsarn-governor-engine`

Analysis, all from read-only inspection:

- Single explicit refspec naming one branch; no `--all`, no `--tags`, no `--mirror`,
  no `--force`. It expands to
  `refs/heads/kalsarn-governor-engine:refs/heads/kalsarn-governor-engine`.
- Remote state (read-only `git ls-remote origin`): remote refs/heads = kalsa, kalsa-step1,
  main, vendor-migration. **No kalsarn-governor-engine and no kalsarn-governor-transport
  exist on the remote** - this push CREATES one ref, it does not move anything. Remote
  main (baf1f3d1) and vendor-migration (0288dc27) are untouched by the refspec.
- Config: push.default, push.followTags, remote.origin.push, remote.origin.mirror all
  UNSET; remote.origin.pushurl unset; the branch has no upstream. With an explicit
  single-refspec push, none of the unset-but-relevant defaults could widen the push.
- Tags: `git tag --points-at` on all four line commits = empty; `git tag --contains
  b62be78f9` = empty. No tag travels, none can move.
- Exactly one local ref points at the tip: refs/heads/kalsarn-governor-engine
  (`git for-each-ref` grep). The engine branch's unique content rides only inside this
  push's history; no engine repo ref (kalsallama remote is a different GitHub repo, not
  addressed), no app repo involved, and the linked worktree at
  llama.rn-kalsa-wt-gov-transport is unaffected (push never rewrites local refs beyond
  the success-time refs/remotes/origin/kalsarn-governor-engine tracking ref, a creation).
- lefthook.yml defines pre-commit and commit-msg hooks only - no pre-push hook, so the
  push runs no local test hook that could half-execute.
- The push will upload the three new commits with their vendored engine blobs (that is
  the design: the engine sources are committed under vendor/). Size note, not a safety
  issue.

Verdict: the only ref that can be created or moved on any remote is
refs/heads/kalsarn-governor-engine on github.com/Aspis0/kalsa.rn. SAFE, and I did not run it.

---

## Write ledger

- This directory: REPORT.md, runs/ (clone, derived vendor trees, gen-version, logs, LFS
  fetch artifacts, fixture pointer backup). Nothing else written anywhere.
- Shared checkouts: zero writes (verified final sweep: binding checkout still exactly the
  2 pre-existing untracked pnpm files, HEAD unchanged at kalsarn-governor-engine
  b62be78f9; engine checkout still its pre-existing 12 dirty lines).
- The sync cache ~/.cache/llama.rn/llama.cpp: zero writes (all four pins resolved via
  cat-file without fetch; only reads + my archive).
- No push, no tag, no ref moved anywhere. The push command was NOT run, not even with
  --dry-run.

---

## Verdict

Per-item: 1 CONFIRMED, 2 CONFIRMED, 3 CONFIRMED, 4 CONFIRMED, 5 CONFIRMED (harness 4/4 on
my own clean rebuild; jest 12/12 failures proven pre-existing on the pristine base
0288dc27; LFS fixture byte-identical to the committed pointer in the shared checkout), 6
CONFIRMED SAFE (not run).

**This binding line is safe to push, and then to be pinned by the app.** The line is
exactly the four claimed commits in order, with the governor-transport work carried as
the same immutable objects (not rebuilt), the harness test that pins the third-copy
deletion present, wired, and passing. The load-bearing question - whether the app would
resolve a tree that is not the engine we measured - is closed by comparison, not by a
string: the committed vendor/ tree is byte-identical to
archive(d754229443670a7454731cd48028cb409ecc0ec2) + the repo's 20 patches, derived from
the commit object that is simultaneously on GitHub (kalsa-phone-v1-1-1), in the shared
engine checkout, and in the sync cache; the 8 content files the bump changed are
blob-identical to that commit; the generated version files and src/version.ts byte-reproduce
from the sync's own pipeline; the sync re-run on a clean clone produces zero diff. The
bump touches nothing outside vendor/, src/version.ts, and lib/. The proposed push can
create or move exactly one ref, kalsarn-governor-engine on github.com/Aspis0/kalsa.rn;
no engine ref, no tag, no app repo, and no other branch can move.

Two non-blocking notes that travel with the pin, in order of importance:

1. Jest is broken in this environment (12/12 suites die in react-native 0.72's jest
   setup on node v26.3.0 before any test runs), proven pre-existing on 0288dc27 - but that
   means the binding's JS layer is currently shipping with no effective jest net at all.
   That is an environment/toolchain debt (node/jest/RN preset alignment or a pnpm-based
   runner fix), not a defect of this line, and it should not block the pin - but someone
   should book the fix.
2. The C++ harness gates the binding's glue and the vendored engine on host against a
   tiny-random model; it does not exercise the OpenCL GPU paths the bump's 8 engine
   content files change (no Adreno device here; the engine-side roundtrip suite belongs to
   the engine line and was already reported rc=2/no-backend on this Mac by the prior
   audit). The phone measurement planned after pinning is the validation of those paths.
