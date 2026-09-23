# Binding prep: governor line + phone engine, stacked and verified

Date: 2026-09-22. Repo: `~/Projects/llama.rn-kalsa` (binding fork `Aspis0/kalsa.rn`).
Nothing pushed, nothing tagged, no upstream set. The app repo was not touched.

## Line built

    b62be78f95b93ea7ba8755388c87f0860827b363  (branch kalsarn-governor-engine, tip)
    b97c581d  test(governor): pin that the thermo parse forwards plugged baselines
    cc804436  refactor(governor): drop the plugged validity rule from the thermo check
    0288dc27  build(engine): pin llama.cpp to 4ccef2f85 (checkpoint persistence + cache_salt)

The governor work is stacked, not replaced: the branch was cut from
`kalsarn-governor-transport` @ `b97c581d`, so the tip carries both the validity-rule
deletion + harness test (cc804436, b97c581d) and the new engine commit. No conflict;
the two stack cleanly (the governor commits touch `cpp/`, `tests/`; the engine bump
touches `vendor/`, `src/version.ts`, `lib/` - disjoint trees).

## 1. Engine bump

- File changed: `vendor/VERSIONS`, one line -
  `LLAMA_CPP_REF=d754229443670a7454731cd48028cb409ecc0ec2`
  (`LLAMA_CPP_REPO` already was `https://github.com/Aspis0/kalsallama`).
- Command that regenerated `vendor/`: `npm run sync:vendor`
  (= `scripts/sync-vendor.sh`, the repo's documented mechanism per AGENTS.md /
  vendor/README.md; it resolves `*_REF` to `*_COMMIT` itself and rewrote
  `LLAMA_CPP_COMMIT=` in VERSIONS to the same sha).
- One extra command was needed: `npm run build`. The sync's own gate
  (`assert-kalsa-vendor` check 5) requires the committed `lib/` output to agree with
  the regenerated `src/version.ts`; its message prescribes `npm run build`, after which
  a second `npm run sync:vendor` passed all gates (exit 0):
  `assert-kalsa-vendor: ok (...)`, `assert-rnllama-sources: ok (...)` x2.
- The engine commit is **not pushed yet**, so the sync cache
  (`~/.cache/llama.rn/llama.cpp`, origin = the kalsallama fork URL) was primed first
  with a local fetch of the shared checkout's ref (read-only for
  `~/Projects/kalsallama`; its `git status --porcelain` count was 12 before and after):
  `git -C ~/.cache/llama.rn/llama.cpp fetch ~/Projects/kalsallama kalsa-phone-v1-1-1`.
  After that, `sync-vendor.sh` resolved the 40-hex ref from its own cache without any
  network access. Once the ref is pushed to GitHub this step is unnecessary.

Synced result: `vendor/VERSIONS` names `d754229...` for both REF and COMMIT;
`src/version.ts` = `BUILD_NUMBER 11199` (= `git rev-list --count d754229`),
`BUILD_COMMIT 'd754229'`; `vendor/llama.cpp/common/build-info.cpp` =
`LLAMA_COMMIT = "d754229"` (exactly 7 chars). Changed vendor files: the OpenCL GPU set
(`ggml-opencl.cpp`, `cl-program-cache.cpp/h`, `CMakeLists.txt`,
`kernels/gemm_noshuffle_q6_k_f32.cl`) plus `src/llama-ext.h`,
`src/llama-governor-policy.cpp`, `src/llama-governor-runtime.cpp` (the plugged-baseline
engine gate the binding-side deletion hands responsibility to).

## 2. Proof the vendored tree IS that commit (not just a string)

Independent re-derivation, separate from the sync (script kept at /tmp/verify_vendor.sh,
run twice, both times VERIFY_OK):

1. `git rev-parse` of the shared checkout's `kalsa-phone-v1-1-1`, of the cache object,
   and the pin are the same sha `d754229443670a7454731cd48028cb409ecc0ec2`
   (also `4ccef2f85` verified as its ancestor, so this is the old pin + delta).
   Since the engine push landed, the fifth leg agrees too: read-only
   `git ls-remote https://github.com/Aspis0/kalsallama refs/heads/kalsa-phone-v1-1-1`
   returns that same sha, so remote = shared checkout = sync cache = `vendor/VERSIONS`.
2. Extracted the `LLAMA_CPP_PATHS` pathspec out of `scripts/sync-vendor.sh`, ran
   `git -C <cache> archive d754229... <paths>` into a fresh temp dir, re-applied all
   `scripts/patches/llama.cpp/*.patch` (20), deleted the `*.orig` backups exactly as
   sync-vendor does.
3. `diff -r` of that temp tree vs the committed `vendor/llama.cpp` (excluding the four
   generated KEEP files) - **byte-identical, no output**. So
   vendor = archive(d754229) + repo patches, recomputed from the commit object itself.
4. Direct blob check: `git hash-object` of the 8 files this bump changed equals
   `git rev-parse d754229:<path>` for each - hash-identical to the commit's blobs.
5. Idempotency: `npm run sync:vendor` on the committed (clean) tree, exit 0,
   `git status` unchanged - the documented "clean tree produces no diff" invariant holds.

This closes the hand-pinned-tree incident vector: the string in VERSIONS, the 7-char
build commit, and the actual file bytes are all derived from and checked against the
same commit object. Re-run against the committed tip after the engine push: VERIFY_OK.

### Audit notes, applied to what this suite reports

- `test-opencl-moe-roundtrip` (rc=2 "no OpenCL backend" with OPENCL=OFF) and the eighth
  governor test `test-governor-v0-mtp-hybrid` (rc=1 bare, rc=77 fixture skip) live in the
  ENGINE's `tests/`, not the binding's: grep over the binding's `tests/` finds neither,
  and the binding harness (`tests/run_tests.sh`) runs exactly four suites
  (rnllama_tests, parallel_decoding_test, chat_parse_utf8_test, governor_params_test).
  Neither was run here, so neither is reported as a pass; the OpenCL roundtrip's rc=2
  on this Mac is an environment limit, not a verdict.

## 3. Tests run

All in `~/Projects/llama.rn-kalsa` on the tip:

| what | command | result |
|---|---|---|
| vendor + source-list gates | `npm run sync:vendor` (runs `assert-kalsa-vendor.sh`, `assert-rnllama-sources.sh`) | exit 0, both ok |
| C++ harness build | `./tests/build_and_test.sh` | exit 0, 4 targets incl. `governor_params_test` |
| C++ harness run | `./tests/run_tests.sh` | **4/4 suites**: rnllama 6/6, parallel-decoding 28/28, chat-parse 18/18, governor-params 4/4 |
| typecheck | `npm run typecheck` | exit 0 |
| lint | `npm run lint` | 0 errors (1 pre-existing warning in `example/`) |
| pre-commit hooks | lefthook: lint + types + commitlint | all green at commit |
| Jest | `npm test` | **FAILS, pre-existing**: 12/12 suites fail inside `react-native/jest/setup.js` before loading any test; reproduced identically on the pristine base `b97c581d` with my changes stashed (node v26.3.0 vs jest 28 / pnpm-installed node_modules). Not caused by this bump; needs an environment fix, not a code fix. |

The `rnllama_tests` model suite needed the LFS fixture `tests/tiny-random-llama.gguf`,
which was an un-smudged 133-byte pointer (magic error `'vers'`, 4 failures) - the same
4 failures occur without the fixture regardless of engine. `git-lfs` is not installed, so
the object was fetched once via the GitHub LFS batch API (sha256 verified against the
pointer's oid, `GGUF` magic), the harness run green, and the file restored to the
committed pointer afterwards (`git status` under `tests/` clean). The vendored engine
therefore really loaded a model, tokenized and completed - the glue and the new
numerics build agree on host.

## 4. Values the next link needs

- New binding sha: `b62be78f95b93ea7ba8755388c87f0860827b363`
- Line for the app's `package.json` (line 49, replacing the `#0288dc27...` value):

      "llama.rn": "github:Aspis0/kalsa.rn#b62be78f95b93ea7ba8755388c87f0860827b363",

- Order reminder: the binding tip must be **pushed** before the app's
  `scripts/assert-engine-provenance.sh` can pass (it curls
  `codeload.github.com/Aspis0/kalsa.rn/tar.gz/<sha>`), and the app order stays
  bump -> install -> gate -> build (never gate-then-bump).

### Push command - REPORTED, NOT RUN

    git -C ~/Projects/llama.rn-kalsa push origin kalsarn-governor-engine

(I hold push; the engine ref is already on GitHub, so the binding tip is the only
thing left to push - run the command above whenever you are ready.)

---

# SECOND ROUND - fast int8 default (`1577495b9`), stacked on the same line

Date: 2026-09-22 (same day, after the measurement). Nothing pushed, nothing tagged,
no upstream, app repo untouched. Same discipline as round one.

## Line built

    5b966218eadb85aaacf3eefcefa38651fc8ed1ec  (branch kalsarn-governor-engine, new tip)
    b62be78f95b93ea7ba8755388c87f0860827b363  round-1 engine bump (d754229)
    b97c581d  test(governor): pin that the thermo parse forwards plugged baselines
    cc804436  refactor(governor): drop the plugged validity rule from the thermo check
    0288dc27  build(engine): pin llama.cpp to 4ccef2f85

One new commit on the existing branch: the governor-transport work and the round-1
bump are untouched underneath.

## 1. Engine bump

- File changed: `vendor/VERSIONS`, one line -
  `LLAMA_CPP_REF=1577495b92096fca572f57a35b71607bacac85d5` (`LLAMA_CPP_COMMIT`
  rewritten by the sync itself).
- Sync cache primed from the remote this time (the ref is pushed):
  `git -C ~/.cache/llama.rn/llama.cpp fetch origin kalsa-phone-v1-1-1` -> FETCH_HEAD
  `1577495b...`; `merge-base --is-ancestor d754229..1577495` confirms fast-forward.
- Command: `npm run sync:vendor`. First run hit the same gate as round one
  (`lib/commonjs/version.js disagrees with src/version.ts (want 11201/1577495)`),
  fixed with the prescribed `npm run build`, then:
  `assert-kalsa-vendor: ok (...)`, `assert-rnllama-sources: ok (...)` x2, exit 0.
- Identity: `src/version.ts` = `BUILD_NUMBER '11201'` (= `git rev-list --count
  1577495b`), `BUILD_COMMIT '1577495'`; `vendor/llama.cpp/common/build-info.cpp` =
  `LLAMA_COMMIT = "1577495"` (7 chars). Delta vs the round-1 pin is exactly 3 files,
  all in `ggml/src/ggml-opencl/` (`ggml-opencl.cpp`,
  `kernels/gemm_noshuffle_q6_k_q8_1_dp4a.cl`, `kernels/quant_a_q8_1.cl`) - none of
  them covered by a patch or generated, so all three are directly hash-checkable.

## 2. Proof the vendored tree IS that commit (comparison, not the entry in a file)

Same method as round one, script `/tmp/verify_vendor2.sh`, run twice (before and after
the commit), both times VERIFY_OK:

1. Five-way object identity: `git ls-remote https://github.com/Aspis0/kalsallama
   refs/heads/kalsa-phone-v1-1-1` == cache object == `LLAMA_CPP_COMMIT` ==
   `LLAMA_CPP_REF` == `1577495b92096fca572f57a35b71607bacac85d5`, with
   `d754229...` verified as its ancestor.
2. Extracted `LLAMA_CPP_PATHS` from `scripts/sync-vendor.sh`, `git archive`d that
   commit into a fresh temp dir, re-applied all 20 `scripts/patches/llama.cpp/*.patch`,
   deleted the `*.orig` backups as sync-vendor does.
3. `diff -r` (excluding only the 4 generated KEEP files) of temp vs the committed
   `vendor/llama.cpp`: **byte-identical, zero differences over 1409 files**; `diff -r`
   reports `Only in` in both directions, so this is also a set-equality check of the
   file lists, both ways.
4. Blob-level check on exactly the 3 files this round changed:
   `git hash-object vendor/llama.cpp/<f>` == `git rev-parse 1577495b:<f>` for each.
5. Idempotency (task item 3): `npm run sync:vendor` re-run on the committed clean tree
   -> both gates ok, exit 0, `git status` unchanged (only the two pre-existing
   untracked pnpm files). The documented "clean tree produces no diff" invariant holds.

## 3. Tests run (task item 4)

| what | command | result |
|---|---|---|
| vendor + source-list gates | `npm run sync:vendor` (both assert scripts) | exit 0, ok |
| C++ harness build | `./tests/build_and_test.sh` | exit 0, 4 targets |
| C++ harness run | `./tests/run_tests.sh` | **4/4**: rnllama 6/6, parallel 28/28, chat-parse 18/18, governor-params 4/4 |
| typecheck | `npm run typecheck` | exit 0 |
| lint | `npm run lint` | 0 errors, 1 pre-existing warning |
| Jest | `npm test` | 12/12 suites fail - **identical to the base**, declared environment debt, not touched here |

As in round one, `rnllama_tests` ran with the real model: the LFS pointer fixture was
transiently replaced with the already-fetched, sha256-verified object
(`/tmp/tiny.gguf`), harness run green, pointer restored (`git status` under `tests/`
clean). So the vendored `1577495b` engine loaded a model, tokenized and completed
against the unchanged binding glue. The engine's own audit items from this round
(`test-opencl-moe-roundtrip` rc=2 "no OpenCL backend", eighth governor test
`test-governor-v0-mtp-hybrid`) are engine-side and, as round one established by grep,
are not part of the binding harness - neither is run here, neither is reported as a
pass.

## 4. Values the next link needs (task item 5)

- New binding sha: `5b966218eadb85aaacf3eefcefa38651fc8ed1ec`
- Line for the app's `package.json` (line 49, replacing the current
  `#b62be78f...` / older value):

      "llama.rn": "github:Aspis0/kalsa.rn#5b966218eadb85aaacf3eefcefa38651fc8ed1ec",

- App order unchanged: bump -> install -> gate -> build (never gate-then-bump). The
  provenance gate curls codeload for the sha, so the binding tip must be pushed first.

### Push command - REPORTED, NOT RUN

    git -C ~/Projects/llama.rn-kalsa push origin kalsarn-governor-engine

(I hold push; the engine ref `1577495b...` is already on the remote, verified by
`git ls-remote`.)
