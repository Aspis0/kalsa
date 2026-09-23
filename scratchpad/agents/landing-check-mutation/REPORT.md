# Mutation test: `scripts/assert-engine-provenance.sh` (kalsa)

Date: 2026-09-22. Scratch: `/tmp/prov-mutation` (throwaway; real repos read-only, never edited).
Report: `~/Projects/kalsa-moe-experiments/scratchpad/agents/landing-check-mutation/REPORT.md`.

## Method

I read the gate first and let its implementation decide which cases are reachable. The gate has
no `--help` and no dry mode; it has no argument handling at all (the only `$1` uses are its own
`fatal`/`note` helpers). It derives `REPO_ROOT` from its own path, so each case is a directory
holding a copy of the gate under `scripts/`, `package.json`, `package-lock.json`, and
`node_modules/llama.rn` (copy excluding only the paths the gate itself excludes:
`android/.cxx`, `android/build`, `ios/build`, nested `node_modules` - 34 MB instead of 5.7 GB).
`node_modules/llama.rn` needed no `--help` note: nothing else in it is read.

What the gate actually checks, in full:

1. `package-lock.json` -> `packages["node_modules/llama.rn"].resolved` must be an `Aspis0/kalsa.rn`
   (or legacy `Aspis0/llama.rn`) git URL with a 40-hex sha.
2. It fetches that sha from codeload, runs `npm pack` on the fetched tree, and diffs a sha256
   manifest of the packed tree against the manifest of `node_modules/llama.rn`.
3. Only if the manifests match (exit 0 path) it *prints* `LLAMA_CPP_COMMIT` from
   `node_modules/llama.rn/vendor/VERSIONS`. It never compares that value to anything.
   `package.json` is never read.

Exit codes observed: 0 = identical, 1 = divergent, 2 = cannot decide (its own documented scheme).

Real shas used (all verified present with `git cat-file` in the read-only checkouts):

| sha | what it is | where |
|---|---|---|
| `0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2` | fork commit currently pinned by app package.json + lockfile | `~/Projects/kalsa` |
| `0a9b937956919fc510f5acbaa35cf4b0447838de` | previous fork pin (engine 8537d097) | fork checkout log |
| `0f313bab464ef28a58a8b4b2a37a5d4c1968b54e` | fork binding-fix commit (gate's own fixture sha) | fork checkout log |
| `2d66996245fb29af8060ddc3e0a211a3f7421a66` | real pre-vendor fork sha: `vendor/VERSIONS` does not exist in it | fork checkout, parent of the commit that added the file |
| `4ccef2f85dbc27e095e11ffcbad4628be9961790` | engine commit declared by fork@0288dc27 | kalsallama |
| `8537d097c32e7307d82540b6da8eb448d7e07107` | engine commit declared by the installed tree in main | kalsallama |
| `1068eb03d301a1dcb657f4e6923fe77678e651ee` | hand-pin engine (local archive) from the APK worktree | kalsallama, real commit |
| `deadbeefdeadbeefdeadbeefdeadbeefdeadbeef` | the only invented sha: case 3 requires a sha that exists nowhere | - |

One construction note up front: **the real repo state cannot serve as the positive control today.**
Running the gate against an unmutated copy of `~/Projects/kalsa` exits 1 (that run doubles as
case 2a below). For case 1 I therefore built the consistent state the gate is meant to see, i.e.
exactly what `npm ci` produces for the app's current pins: lockfile `resolved` =
`0288dc27...`, installed tree = the `npm pack` output of that same commit (byte-verified
identical with `cmp`), both sides carrying `LLAMA_CPP_COMMIT=4ccef2f85...`.

All gate runs used the real network (codeload + npm); the only shimmed run is 4e, which uses the
curl/npm PATH-shim technique from the repo's own `scripts/test_engine_provenance.sh` and says so.

## The five cases

| # | Case | Verdict | Exit | Message (key line, verbatim) |
|---|---|---|---|---|
| 1 | Positive control: pin 0288dc27, installed = its npm-ci output, both VERSIONS = `4ccef2f85...` | PASS as required | 0 | `[provenance] OK: 1119 files match Aspis0/kalsa.rn@0288dc278691` / `engine inside it: kalsallama@4ccef2f85dbc` |
| 2a | Engine mismatch, REAL current state of `~/Projects/kalsa`: pin declares `4ccef2f85...`, installed declares `8537d097...` | FAIL as required, but message names neither engine sha | 1 | `[provenance] DIVERGENT: the installed engine is not Aspis0/kalsa.rn@0288dc278691` / `first differing path: ./lib/commonjs/version.js` |
| 2b | Engine mismatch, isolated: installed `vendor/VERSIONS` rewritten to `1068eb03d...` (real APK-worktree sha), fork side unchanged | FAIL, path named, **both values NOT named** | 1 | `[provenance] DIVERGENT: ...` / `first differing path: ./vendor/VERSIONS` / `differing entries: 2` |
| 3a | npm drift: `package.json` pin -> `0a9b9379...`, lockfile stays `0288dc27...` | **PASS - should have failed** | 0 | full success message, identical to case 1 |
| 3b | Lockfile names a 40-hex sha that exists nowhere (`deadbeef...`) | FAIL as required (as "cannot decide") | 2 | `curl: (56) The requested URL returned error: 404` / `[provenance] FATAL: cannot fetch Aspis0/kalsa.rn@deadbeefdead from codeload` |
| 3c | Control for 3b: both pins coherent at real but different fork sha `0f313bab...` vs installed 0288dc27 tree | FAIL as required | 1 | `[provenance] DIVERGENT: the installed engine is not Aspis0/kalsa.rn@0f313bab464e` / `first differing path: ./lib/commonjs/version.js` |
| 4a | `vendor/VERSIONS` absent from installed | FAIL as required (generic message) | 1 | `DIVERGENT: ...` / `first differing path: ./vendor/VERSIONS` / `differing entries: 1` |
| 4b | `vendor/VERSIONS` present but 0 bytes | FAIL as required (generic message) | 1 | `DIVERGENT: ...` / `first differing path: ./vendor/VERSIONS` / `differing entries: 2` |
| 4c | Exact `LOCAL OVERRIDE (2026-09-21, build-with-fixes)` note block from the APK worktree inserted (commits left equal) | FAIL as required, but the note is never quoted and no override-specific warning exists | 1 | `DIVERGENT: ...` / `first differing path: ./vendor/VERSIONS` / `differing entries: 2` |
| 4d | Real pre-vendor fork sha `2d669962...` where no `vendor/VERSIONS` ever existed | Cannot decide - wrong reason | 2 | `sh: bob: command not found` / `[provenance] FATAL: npm pack failed in the fetched fork tree` |
| 4e | `vendor/VERSIONS` absent on BOTH sides (shimmed: real 0288dc27 tree minus the file, repo's own fixture technique) | **PASS with an empty engine sha - fails open** | 0 | `[provenance] OK: 1118 files match Aspis0/kalsa.rn@0288dc278691` / `engine inside it: kalsallama@` |
| 5a | Yesterday's trap, real APK worktree state (`kalsa-wt-build-fixes`): LOCAL OVERRIDE + `git archive 1068eb03d` export in place of the vendored engine (+2789 files) | FAIL as required - the gate CAN see this when it is run | 1 | `DIVERGENT: ...` / `first differing path: ./lib/commonjs/version.js` / `differing entries: 2845` |
| 5b | Hand-pin confined to gate-excluded paths: planted `android/build/libggml.so`, `android/.cxx/ggml.o`, `ios/build/libggml.a`, nested `node_modules/left-pad` | **PASS - invisible** | 0 | full success message, identical to case 1 |

### Exact inputs per case

1. `/tmp/prov-mutation/case1-positive` = copy of real `scripts/assert-engine-provenance.sh`,
   real `package.json` (pin `github:Aspis0/kalsa.rn#0288dc27...`), real `package-lock.json`
   (resolved `git+ssh://git@github.com/Aspis0/kalsa.rn.git#0288dc27...`), installed tree =
   unpacked `npm pack` output of that commit (what `npm ci` installs), `vendor/VERSIONS`
   `LLAMA_CPP_COMMIT=4ccef2f85dbc27e095e11ffcbad4628be9961790` on both sides. Exit 0.
   stdout: `lockfile pins Aspis0/kalsa.rn@0288dc278691` / `OK: 1119 files match Aspis0/kalsa.rn@0288dc278691` / `engine inside it: kalsallama@4ccef2f85dbc`.

2a. `/tmp/prov-mutation/base` = unmutated copy of the real `~/Projects/kalsa` trio (gate,
   package.json, lockfile, installed tree as it sits on disk). Forensics: installed tree
   mtime Sep 20 08:23; the pin bump commit `96eb9d9 chore(engine): pin llama.rn to 0288dc27
   (engine 4ccef2f85)` is Sep 20 20:09 - the bump was committed and `npm install` was never
   run after it. I then identified the installed tree byte-for-byte: its manifest is identical
   (0 differing lines) to `npm pack` of fork `a974a52b` and `0f313bab` (both carry engine
   `8537d097`), and differs from `0a9b9379` (3 binding files) and `0288dc27` (8 files:
   `vendor/VERSIONS` + 7 version-stamp files). So main is a clean but stale install, one bump
   behind, not a hand-mixed tree. Exit 1, 16 differing entries, first path
   `./lib/commonjs/version.js`. The message contains neither `4ccef2f85` nor `8537d097`.

2b. `case2b-engine-sha-swap` = case-1 dir with installed `vendor/VERSIONS` lines changed to
   `LLAMA_CPP_REF=LLAMA_CPP_COMMIT=1068eb03d301a1dcb657f4e6923fe77678e651ee` (real sha, the
   APK worktree's hand-pin). Exit 1; message names the path `./vendor/VERSIONS` and the fork
   sha only - it never prints either engine value, so "the message must name both values" is
   NOT satisfied. The task's literal construction - binding VERSIONS vs *an engine sha the app
   records* - is unreachable by construction: the app records no machine-readable engine sha
   anywhere (`native/kalsallama.pin` was retired; `ARCHITECTURE.md` line 60 says so itself:
   "prints the LLAMA_CPP_COMMIT ... but nothing compares it to an expected value").

3a. `case3a-pkg-drift` = case-1 dir with `package.json` dependency rewritten to
   `github:Aspis0/kalsa.rn#0a9b9379...`, lockfile untouched. Exit 0 - the gate never reads
   `package.json`. (Whether `npm ci`'s own package/lock sync check would reject this was not
   tested here; the gate itself is blind to it.)

3b. `case3b-ghost-sha` = case-1 dir with lockfile `resolved` (and package.json) set to
   `...#deadbeefdeadbeefdeadbeefdeadbeefdeadbeef`. Exit 2, FATAL as quoted.

3c. `case3c-other-real-sha` = case-1 dir with lockfile and package.json both set to real fork
   sha `0f313bab...` while the installed tree stays the 0288dc27 pack. Exit 1.

4a/4b/4c = case-1 dir with installed `vendor/VERSIONS` respectively deleted; truncated to
   empty; or augmented with the verbatim 6-line `# LOCAL OVERRIDE (2026-09-21,
   build-with-fixes). The tree under vendor/llama.cpp is a LOCAL commit ...` block copied from
   `~/Projects/kalsa-wt-build-fixes/node_modules/llama.rn/vendor/VERSIONS` (commit lines left
   at `4ccef2f85...` so the note alone is the mutation). All three exit 1 with the same
   generic DIVERGENT message; the override note is never echoed, and no message distinguishes
   "provenance malformed" from "some file changed".

4d. `case4e-real-prevendor`: lockfile and package.json at real pre-vendor fork sha
   `2d669962...` (verified: `vendor/VERSIONS` does not exist at that commit), installed tree =
   that commit's raw tree. Exit 2 because the old fork's `prepack` is `bob build`, which needs
   devDependencies the fetched tree does not have. The gate cannot evaluate this era at all,
   and its message blames the packer, not provenance.

4e. `case4e-shim`: same gate, same real lockfile sha `0288dc27...`; curl/npm PATH shims exactly
   as in the repo's own `scripts/test_engine_provenance.sh`, staging the real pack output of
   `0288dc27...` with `vendor/VERSIONS` deleted, and the installed tree likewise (1118 files
   both sides). Manifests match, the `sed` finds no `LLAMA_CPP_COMMIT=`, `engine=""`, and the
   gate prints `engine inside it: kalsallama@` and exits 0. This is the fail-open proof: a
   fork that omits or empties the line passes with a vacuous engine statement.

5a. `case5a-apk-worktree`: read-only rsync of `~/Projects/kalsa-wt-build-fixes` (gate,
   package.json, lockfile, `node_modules/llama.rn` minus the gate-excluded build dirs). That
   checkout carries the LOCAL OVERRIDE note, `LLAMA_CPP_COMMIT=1068eb03d...`, and a full
   `git archive` export of the engine (+2789 extra files under `vendor/llama.cpp`, including
   `ggml-cuda`, `ggml-sycl`, `ggml-vulkan`, `tests` - trees the publish filter never ships).
   Exit 1, 2845 differing entries. The gate sees yesterday's trap completely - *if it is run*.

5b. `case5b-excluded-outputs`: case-1 dir with planted files
   `node_modules/llama.rn/android/build/libggml.so`,
   `android/.cxx/ggml.o`, `ios/build/libggml.a`, `node_modules/llama.rn/node_modules/left-pad/index.js`
   (content labeled as built from `kalsallama@1068eb03d`). Exit 0 - every one of these paths
   is excluded by the manifest's `-not -path` list.

### Context findings (outside the five cases)

- The gate is wired into `.github/workflows/apk.yml` and `e2e-emulator.yml`, but **not** into
  `build-kalsa-apk.yml` (the APK builder: `npm ci` at line 49, `assembleRelease` at line 65,
  no provenance step). `ARCHITECTURE.md` still claims it is "run by hand, not in CI" - the
  doc and the workflows disagree with each other.
- The real main checkout is red right now (case 2a). CI would be green on the same pins
  because CI's `npm ci` installs the pinned commit fresh; only checkouts that predate a bump
  go stale, and nobody runs the gate on them.
- Existing coverage: `scripts/test_engine_provenance.sh` is a decent offline fixture test of
  the URL allow-list, sha format, fetch URL and manifest diff (cases A-E). It never exercises
  `package.json`, never exercises `vendor/VERSIONS` content, and asserts the engine line only
  positively (`kalsallama@<sha>`) - never the empty/malformed fail-open path.

## (a) What the checker does NOT catch

First, one fact outside the checker that shapes everything above: `build-kalsa-apk.yml` never
runs it, so the most common way the gate fails to help is that nobody reaches it. Ranked by how
likely each *checker* hole is to bite during the next landing: (1) the first link of the chain,
engine commit -> binding `vendor/VERSIONS`, is never verified - the success path only *prints*
the `LLAMA_CPP_COMMIT` value and compares it to nothing, because the app no longer records an
expected engine sha anywhere (`native/kalsallama.pin` was retired and `ARCHITECTURE.md` admits
it); if a fork ever ships with the line missing or empty the gate prints `engine inside it:
kalsallama@` and exits 0 (case 4e), so a fork-side re-vendor mistake or a committed LOCAL
OVERRIDE passes green, and the only record keeping this link honest is prose that has already
drifted (`REPOS.md` still calls `8537d097c` the shipped pin while the pin says `4ccef2f85`).
(2) The manifest excludes `android/build`, `android/.cxx`, `ios/build` and nested `node_modules`,
so a hand-pin that lives only in build outputs - or in sources that were reverted after an APK
was compiled from the hand-pinned engine - passes with the full success message (case 5b); this
is precisely the non-reproducible-APK mechanism of yesterday, and it is invisible as long as the
sources look clean. (3) `package.json` is never read: moving its pin alone yields exit 0
(case 3a), and a lockfile-only edit of `resolved` plus a reinstall is invisible end to end,
since the gate then happily verifies installed == edited-lockfile. (4) When it does fail, the
message names only the fork sha and the first differing path: engine mismatches never show both
engine values (cases 2a/2b) and the LOCAL OVERRIDE note is never quoted (case 4c), so a real
provenance incident and a stray build artifact look identical to the reader - slow diagnosis,
not a wrong pass. (5) Lowest likelihood: pins from the pre-vendor era cannot be evaluated at
all (`npm pack failed`, exit 2, case 4d) - fails closed, but with a message that points at the
packer rather than at provenance.

## (b) Minimal change for the most dangerous hole

Restore the retired app-side engine pin as a one-line file (the old `native/kalsallama.pin`
shape, e.g. `8537d097...`/`4ccef2f85...`), and add one comparison on the gate's existing
success path: after the `OK:` line, take the `LLAMA_CPP_COMMIT` value the script already parses,
and `fatal` (exit 2) if the pin file is missing, the value is empty or not 40-hex, or the two
shas differ - printing both values in the message. That is roughly five lines reusing an
existing parse, it closes the fail-open case 4e, gives case 2 the "names both values" message
the delivery chain needs, and turns link 1 of the chain from prose into a check the bump flow
must satisfy. The owner also needs to decide separately on the one-line runner gap - add
`bash scripts/assert-engine-provenance.sh` after `npm ci` in `build-kalsa-apk.yml` - but that
is deployment of the gate, not a change to it.
