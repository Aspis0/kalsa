# Round-2 audit: binding pin bump + landing pin commit (post-hoc)

Auditor: independent reviewer (ZCode agent, GLM-5.3-Flash), commissioned 2026-09-22.
Scope: the last two links of the delivery chain, **as already pushed**. This is a post-hoc
review, not a pre-push gate; any defect found here gets a corrective push, never a
history rewrite.

Links under audit:

- LINK 1 (binding): `~/Projects/llama.rn-kalsa`, branch `kalsarn-governor-engine`,
  tip `5b966218eadb85aaacf3eefcefa38651fc8ed1ec`, round-1 tip `b62be78f`.
- LINK 2 (app): `~/Projects/kalsa-wt-landing`, pushed branch `engine-pin-kalsallama`,
  tip `e206a945bf39610681bc50b989f5a4d179a0b889`.

Pushed-ref identity check (done first, before any content work):

- `origin/kalsarn-governor-engine` = `5b966218eadb85aaacf3eefcefa38651fc8ed1ec` (match).
- `origin/engine-pin-kalsallama` = `e206a945bf39610681bc50b989f5a4d179a0b889` (match).
- Naming note: no *local* branch is named `engine-pin-kalsallama`; the landing worktree
  has the same commit checked out as `kalsa-app-landing`. The remote branch the brief
  names exists and points at the expected sha, so this is a local/remote naming
  divergence only. Recorded here for completeness, not counted as a defect.

Per-item verdicts follow. Statuses so far are running notes; the verdict line for each
item is final only when marked PASS/FAIL.

## Item 1 (delta b62be78f..5b966218 is exactly the vendor bump)

**PASS.** `git rev-list --count b62be78f..5b966218` = 1 (the single commit
`5b966218 build(engine): pin llama.cpp to 1577495 (fast int8 default scale)`).
`git diff --name-status` between the two rounds lists **exactly 11 paths, all `M`**
(no additions, no deletions):

| # | path | role |
|---|------|------|
| 1 | `vendor/VERSIONS` | pin manifest |
| 2 | `vendor/llama.cpp/ggml/src/ggml-opencl/ggml-opencl.cpp` | real content |
| 3 | `vendor/llama.cpp/ggml/src/ggml-opencl/kernels/gemm_noshuffle_q6_k_q8_1_dp4a.cl` | real content |
| 4 | `vendor/llama.cpp/ggml/src/ggml-opencl/kernels/quant_a_q8_1.cl` | real content |
| 5 | `vendor/llama.cpp/common/build-info.cpp` | generated version file |
| 6 | `vendor/llama.cpp/ggml/src/ggml-version.h` | generated version file |
| 7 | `vendor/llama.cpp/src/llama-version.h` | generated version file |
| 8 | `lib/commonjs/version.js` | generated (package) |
| 9 | `lib/module/version.js` | generated (package) |
| 10 | `lib/typescript/version.d.ts` | generated (package) |
| 11 | `src/version.ts` | generated (package) source |

This is exactly the vendor bump's file set as reported (1 manifest + 3 real content +
3 engine-generated version files + 3 `lib/` outputs + `src/version.ts` = 11). The
generated-file hunks carry only the version swap `11199/d754229` -> `11201/1577495`
(consistent with round 1 pinning `d754229`); no stray edits ride along.

## Item 2 (three content files blob-identical to engine 1577495b)

**PASS.** Compared by blob hash (`git rev-parse <commit>:<path>`), engine commit
`1577495b92096fca572f57a35b71607bacac85d5` (kalsallama, subject: `opencl: KALSA_Q6K_DENSE
routes dense q6_K prefill to the dp4a path by default`) against binding tip `5b966218`
(`vendor/llama.cpp/...`):

| file (engine path, `ggml/src/ggml-opencl/` prefix) | engine blob | vendored blob | |
|---|---|---|---|
| `ggml-opencl.cpp` | `d3979fe5fc2b7321a68e8e22eb069e98e300066d` | `d3979fe5fc2b7321a68e8e22eb069e98e300066d` | MATCH |
| `kernels/gemm_noshuffle_q6_k_q8_1_dp4a.cl` | `25d893e78b6fd1e12905a81b8607516b1d0cf882` | `25d893e78b6fd1e12905a81b8607516b1d0cf882` | MATCH |
| `kernels/quant_a_q8_1.cl` | `67eba462ebaa32086b8ed8b25c4727c7ffe0534c` | `67eba462ebaa32086b8ed8b25c4727c7ffe0534c` | MATCH |

Note for whoever re-runs this: the audit brief's earlier false alarms are confirmed as
false. The engine repo has no `common/build-info.cpp` / `ggml-version.h` /
`llama-version.h` carry-check to do here (those are sync-generated in the binding repo,
not engine source), and the engine commit subject/full sha carries the long form
`1577495b9209...` while generated files carry the short form `1577495`.

## Item 3 (generated files reproduce from the repo's own pipeline)

**PASS.** Reproduced on a clean tree:

- Fresh clone at `5b966218` (`/tmp/round2-audit/llama-rn-verify`), working tree verified
  clean before starting.
- Ran the repo's own pipeline: `./scripts/sync-vendor.sh` (stage 1) and
  `npx bob build` (stage 2, the `package.json` `build` script that generates `lib/`
  from `src/`). The sync used the standard cache `~/.cache/llama.rn`; its llama.cpp
  clone has origin `https://github.com/Aspis0/kalsallama` (the pinned repo), is not
  shallow, and contains `1577495b`.
- Stage 1 output: `Generating version files (build 11201, commit 1577495)`; both in-repo
  gates fired green (`assert-kalsa-vendor: ok ... lib/ matches src/version.ts`,
  `assert-rnllama-sources: ok`).
- After both stages: `git status --porcelain` is **empty** (zero diff; the only untracked
  entry ever seen was the `node_modules` symlink I created myself to run bob, not repo
  content). The committed tree is exactly what the pipeline produces.

Generated-file content at the tip carries the required values, verified by grep in the
reproduction tree: `BUILD_NUMBER = 11201` and `BUILD_COMMIT = 1577495` in
`src/version.ts`, `lib/commonjs/version.js`, `lib/module/version.js`,
`lib/typescript/version.d.ts`, plus `LLAMA_BUILD_NUMBER = 11201` /
`LLAMA_COMMIT = "1577495"` in `vendor/llama.cpp/common/build-info.cpp` and short-sha
`1577495` in `ggml-version.h` / `llama-version.h` (short form is correct: the generator
does `${commit:0:7}`, deliberately not `--short=7`).

## Item 4 (vendor/VERSIONS REF/COMMIT + provenance)

**PASS.** At the tip, `vendor/VERSIONS` reads:

```
LLAMA_CPP_REPO=https://github.com/Aspis0/kalsallama
LLAMA_CPP_REF=1577495b92096fca572f57a35b71607bacac85d5
LLAMA_CPP_COMMIT=1577495b92096fca572f57a35b71607bacac85d5
```

Both REF and COMMIT name the full sha `1577495b9...`, and the repo is the kalsa fork,
not upstream. Provenance is the tool, on three legs of evidence:

1. The file's own header documents the contract: "Edit a *_REF, then run
   `npm run sync:vendor`. The script resolves *_REF to *_COMMIT and rewrites those
   lines itself." `record_commit()` in `scripts/sync-vendor.sh` implements exactly that
   rewrite.
2. The round-2 commit's VERSIONS hunk touches exactly the two pin lines
   (`d75422944...` -> `1577495b92...`, REF and COMMIT together), the shape the tool
   produces - no unrelated edits.
3. Decisive: my reproduction run (item 3) executed the tool itself on a clean tree; it
   rewrote VERSIONS via `record_commit()` and the result was byte-identical to the
   committed file (zero diff). A hand edit would not have survived that equality.

## Item 5 (landing tip is the rewritten pin commit; cherry-picks unchanged)

**PASS.** `HEAD` = `e206a94` ("deps : pin llama.rn to binding 5b966218, engine pin to
1577495b"), `HEAD^` = `a855ab6` (verified from `%p`: parent of `e206a94` is
`a855ab6c1d91b1684eea249e5f0aa6f4642f2fef`). The reflog of `kalsa-app-landing` records
the full construction and the in-place rewrite:

```
e206a94 landing@{0}: commit (amend): deps : pin llama.rn to binding 5b966218, engine pin to 1577495b
a9c68b2 landing@{1}: commit: deps : pin llama.rn to binding b62be78, engine pin to d754229   <- round-1 pin
a855ab6 landing@{2}: cherry-pick: governor : forward raw battery observations ...
18d4e33 landing@{3}: cherry-pick: app: drop the total-RAM gate from gpuFit ...
943144f landing@{4}: cherry-pick: ci : run the provenance gate in build-kalsa-apk.yml
fc23b2e landing@{5}: cherry-pick: tests : regression cases for the provenance gate's silent passes
62ce72e landing@{6}: cherry-pick: provenance gate : compare package.json with the lockfile ...
e5788cf landing@{7}: branch: Created from e5788cf
```

So the round-1 pin `a9c68b2` was amended in place into `e206a94` (same parent
`a855ab6`), and the amend's content delta is exactly the three pin files
(`native/kalsallama.pin`, `package-lock.json`, `package.json`; 5 insertions, 5
deletions). **One pin commit on the line:** `main` is `e5788cf`; `git log
e5788cf..e206a94` contains exactly the 5 cherry-picks plus the single pin commit
`e206a94` - no other pin commit exists on the line.

The five cherry-picks beneath it, with shas and patch-ids (unchanged by the rewrite:
they are ancestors of the amended tip, and each commit's current sha equals its sha at
reflog creation; the amend touched only the tip):

| pick sha | full sha | patch-id | source commit | source patch-id |
|---|---|---|---|---|
| `62ce72e` | `62ce72e82a9d98e37655922a50b28294294fdd43` | `6f929aecbda32920a2aa849a6bf51f6e3b0b5960` | `28d775e` (landing-check-fix) | equal |
| `fc23b2e` | `fc23b2edcb61804cee75baa8ed30f01f5452d791` | `340bcba0c440559c04c24e22fa7533fff18d5e07` | `924e9aa` (landing-check-fix) | equal |
| `943144f` | `943144f860b72a05338b2f3abdca0b250351ea4f` | `44f3c55dc5c06a4e1192085cfac36bd6030b8e46` | `b1fe88b` (landing-check-fix) | equal |
| `18d4e33` | `18d4e3349dc8970bcdabf8088c8f81f3161bc7ff` | `f03fa0ad96f7e5b2a062c9b4b97f5b9b993463ec` | `7e04002` (kalsa-app-gpu-v73) | equal |
| `a855ab6` | `a855ab6c1d91b1684eea249e5f0aa6f4642f2fef` | `e234fe611a3e7ab04e1fe055f37fcafff2a4cb1c` | `0db9dc6` (kalsa-governor-policy-consolidate) | equal |

Every pick's patch-id equals its source commit's patch-id, i.e. all five are faithful
cherry-picks, not silent variants.

## Item 6 (package.json / lockfile / pin agreement)

**PASS.** At `e206a94`:

- `package.json` (deps): `"llama.rn": "github:Aspis0/kalsa.rn#5b966218eadb85aaacf3eefcefa38651fc8ed1ec"`
- `package-lock.json`: `packages["node_modules/llama.rn"].resolved` =
  `git+ssh://git@github.com/Aspis0/kalsa.rn.git#5b966218eadb85aaacf3eefcefa38651fc8ed1ec`
  (same sha; scheme differs only because npm records github: deps over ssh)
- `native/kalsallama.pin`: `1577495b92096fca572f57a35b71607bacac85d5` (single line)

Agreement with the pushed commits:

- Binding: the shas above equal `origin/kalsarn-governor-engine` =
  `5b966218eadb85aaacf3eefcefa38651fc8ed1ec` (LINK 1's pushed tip). Match.
- Engine: the pin file equals `LLAMA_CPP_COMMIT` in LINK 1's `vendor/VERSIONS` and the
  audited engine commit `1577495b92096fca572f57a35b71607bacac85d5`. Match.

The amendment itself (`a9c68b2` -> `e206a94`) changed exactly these three files, each
in the same direction: `b62be78f...` -> `5b966218...` in package.json (two spots) and
the lockfile (`resolved` line, plus its `integrity` hash, which necessarily changed with
the tarball), and `d7542294...` -> `1577495b9...` in the pin file. No other content rode
along. The chain is single-threaded: app -> binding commit -> engine commit.

## Item 7 (provenance gate: pass + forced failure)

**PASS.** What the gate does (`scripts/assert-engine-provenance.sh`): takes the
lockfile's resolved `Aspis0/kalsa.rn@<sha>`, requires package.json to name the same
sha, fetches the fork tarball at that sha from codeload, re-packs it through `npm pack`
(the publish filter that produced what npm installed), hashes all files of packed vs
installed `node_modules/llama.rn`, and finally requires the engine sha inside
(`vendor/VERSIONS` `LLAMA_CPP_COMMIT`) to equal `native/kalsallama.pin`.

Positive run (in the landing worktree at `e206a94`):

```
[provenance] lockfile pins Aspis0/kalsa.rn@5b966218eadb
[provenance] OK: 1119 files match Aspis0/kalsa.rn@5b966218eadb
[provenance] engine inside it: kalsallama@1577495b9209 == native/kalsallama.pin
exit=0
```

Negative runs (scratch copy of the tracked tree at `e206a94` in
`/tmp/round2-audit/landing-negtest`, `node_modules` symlinked to the worktree's real
install; the audited repo itself untouched):

1. Pin broken (`native/kalsallama.pin` first hex digit `1`->`2`):

```
[provenance] lockfile pins Aspis0/kalsa.rn@5b966218eadb
[provenance] FATAL: engine mismatch: .../native/kalsallama.pin pins kalsallama@2577495b92096fca572f57a35b71607bacac85d5 but vendor/VERSIONS declares kalsallama@1577495b92096fca572f57a35b71607bacac85d5
exit=2
```

Non-zero, and **both shas printed** (the declared-good sha and the bad pin), exactly as
required.

2. package.json drift (binding sha last char `c`->`0`), the gate's own named "mechanism
of the hand-pinned APK":

```
[provenance] FATAL: package.json pins Aspis0/kalsa.rn@5b966218...fc8ed1e0 but package-lock.json pins Aspis0/kalsa.rn@5b966218...fc8ed1ec
exit=2
```

Also non-zero with both shas. The gate is not pass-only; its failure paths work and are
loud. (Its documented exit code convention is 1 = divergent, 2 = cannot decide; both
forced cases here route through the `fatal` path and exit 2.)

## Item 8 (APK size, sha256, in-APK stamp, re-derivation, old-stamp comparison)

**PASS.** Artefact: `~/Projects/kalsa-wt-landing/android/app/build/outputs/apk/release/app-release.apk`,
dated 2026-09-22 16:28.

- Size: 152,760,583 bytes - **matches** the brief.
- sha256: `d3c66bdb135d394b4bec741c96d89128efc3172cd8ef583e7f2347fdeddf00e3` - **matches**
  the brief.
- Stamp read from **inside** the APK (`assets/app.config`, field `extra.engineBuildId`):
  `kalsa-eng-v2:1725f3a838b0b799f715136a16e6e18ace4f609bd89acb9258ec5c47c819b231` -
  **matches** the brief's expected value.
- Re-derivation from committed inputs: `node scripts/engine-build-id.js` in the landing
  worktree at `e206a94`. The script digests the lockfile's fork commit (`5b966218...`),
  `LLAMA_CPP_COMMIT` from the installed `vendor/VERSIONS` (`1577495b...`), the llama.rn
  version, `plugins/withLlamaFromSource.js`, the whole `native/` tree, and the engine
  subtrees {android,bin,cpp,ios,lib,src,vendor} of the installed fork - which item 7's
  gate proved file-for-file equal to the pushed fork commit. Result:

  `kalsa-eng-v2:1725f3a838b0b799f715136a16e6e18ace4f609bd89acb9258ec5c47c819b231`

  Byte-identical to the in-APK stamp. The APK's declared identity is derivable from the
  pushed commits.

- Previous APK's stamp: **it would have differed - and provably does.** I reconstructed
  the round-1 build inputs (app tree at the round-1 pin commit `a9c68b2`; installed fork
  materialised by `npm pack` of fork commit `b62be78f`) and re-ran the same script:
  `kalsa-eng-v2:698c3664d2593388738fd6a119096aab16f07bc7199c417d031c8c6ee3fcd6d2`.
  That reproduces the previous APK's recorded `kalsa-eng-v2:698c3664...` prefix exactly,
  which both confirms the old APK was the round-1 content and demonstrates the stamp is
  content-bound: the round-2 bump changes the fork-commit line, the engine-tree digest
  (the three OpenCL content files, the version files, `lib/`), and the `native/` digest
  (`kalsallama.pin` itself), so no round-1 APK can carry the round-2 stamp or vice
  versa.

## Item 9 (what this APK cannot do; bench build feasibility)

**PASS (limitation confirmed, nothing blocks a bench build).**

The one thing this APK cannot do, already on record from the earlier report: **it is not
debuggable, so the energy trace cannot be armed on it.** Verified in the artefact: the
string `debuggable` does not appear anywhere in the APK's binary
`AndroidManifest.xml` (attribute absent, i.e. default false), and the build path explains
why: `KALSA_DEBUGGABLE` is `0` for the `engine-pin-kalsallama` branch in
`.github/workflows/build-kalsa-apk.yml`, and only when it is `1` does `app.config.js`
include `plugins/withDebuggableRelease`, the config plugin that patches
`debuggable true` into the release build type for `run-as` sideloading.

Nothing in the line makes a bench build impossible: the same workflow already triggers on
the `bench-dev-models` branch and sets `KALSA_DEBUGGABLE=1` there, producing a debuggable
release APK of the same chain; the provenance gate runs in that workflow before any
native work and is variant-independent; and the engine-pin chain itself carries no
variant assumptions. The bench build is commissioned separately and is deliberately not
part of this audit.

## Verdict paragraph

Every checked property holds, so the chain as pushed does resolve to the artefact the
phones are running: the app pin commit `e206a94` names binding commit `5b966218`
(package.json = lockfile = pushed `origin/kalsarn-governor-engine`) and engine commit
`1577495b9...` (`native/kalsallama.pin` = the binding's `vendor/VERSIONS` = the audited
kalsallama commit, whose three OpenCL content files are blob-identical in the vendored
tree); the vendor tree is exactly what the repo's own sync pipeline regenerates on a
clean tree (zero diff, build 11201 / short sha `1577495`); the provenance gate passes on
the pushed state and fails loudly with both shas when the pin or the package.json sha is
broken; and the shipped APK's size, sha256, and embedded `engineBuildId`
(`kalsa-eng-v2:1725f3a8...`) are all exactly what the committed inputs re-derive, while
the round-1 inputs re-derive the old APK's `698c3664...` stamp, so the two builds are
distinguishable by content and the phones' APK is the round-2 artefact. Would a pre-push
audit run then have stopped anything? On the evidence of this audit, no: the two links
are internally consistent, single-threaded from app pin to engine blob, and every gate
they carry (sync assertions, provenance gate, CI gate) was demonstrably in place and
passing at the pushed tips. The only observations that fall short of a pass are
procedural, not defects: the local worktree holds the pushed commit under the branch name
`kalsa-app-landing` while the pushed branch is named `engine-pin-kalsallama` (same sha;
a naming trap for future audits, worth one corrective note, not a push), and the
binding worktree carries two untracked files (`pnpm-lock.yaml`, `pnpm-workspace.yaml`)
that are not part of any commit but should be cleaned or ignored so the next audit's
"clean tree" check is unambiguous. This review was post-hoc, as commissioned; the remedy
for anything found would have been a corrective push, and nothing found warrants one.
