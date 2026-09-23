# Independent audit: kalsa-app-landing @ a9c68b21ec5307cc58d2a65271c61483976c6ac2

Auditor: independent reviewer, read-only on all shared checkouts. Scope note: the pin
commit a9c68b2 is TEMPORARY - it will be superseded by a re-pin to a newer engine
(fast int8 + f32 activation scale, 0.005412 / 93.982% @ 76.44 t/s vs the currently
pinned f32 route at 0.006954 / 92.913% @ 68.42 t/s) and the APK will be rebuilt.
Per the orchestrator, the pin VALUES are not deeply audited here; the pin diff will
be re-verified after it moves. Everything else on the line is audited in full.

Worktree audited: /Users/marco/Projects/kalsa-wt-landing (branch kalsa-app-landing,
git status: clean). Audit started 2026-09-22. This report is written incrementally;
each section is filled in as its evidence is gathered.

## Item 1: the line - order, single-parent, cherry-pick provenance

**CONFIRMED.**

Tip: `git rev-parse kalsa-app-landing` ->
`a9c68b21ec5307cc58d2a65271c61483976c6ac2` (matches the claimed tip).

Order and parents, from
`git log --format='%H parents=[%P] %s' e5788cf..kalsa-app-landing`
(newest first as printed; the parent of each line is the next one down, base `e5788cf`):

```
a9c68b21... parents=[a855ab6c...] deps : pin llama.rn to binding b62be78, engine pin to d754229
a855ab6c... parents=[18d4e334...] governor : forward raw battery observations, drop the app-side idle policy
18d4e334... parents=[943144f...]  app: drop the total-RAM gate from gpuFit, enable V73; agent rules: both phones are ours
943144f...  parents=[fc23b2ed...] ci : run the provenance gate in build-kalsa-apk.yml
fc23b2ed... parents=[62ce72e...]  tests : regression cases for the provenance gate's silent passes
62ce72e...  parents=[e5788cf...]  provenance gate : compare package.json with the lockfile and the engine sha with native/kalsallama.pin
```

Six commits, every one exactly single-parent (each `%P` holds a single hash), linear
chain `e5788cf -> 62ce72e -> fc23b2e -> 943144f -> 18d4e33 -> a855ab6 -> a9c68b2`.

Cherry-picks carried, not rebuilt: `git show <c> | git patch-id --stable` computed by
me on both sides of each pair (full SHAs resolved with `git rev-parse`):

```
orig 28d775e438363f180eccd68371f8e234d48e61a3 patch-id 6f929aecbda32920a2aa849a6bf51f6e3b0b5960
pick 62ce72e82a9d98e37655922a50b28294294fdd43 patch-id 6f929aecbda32920a2aa849a6bf51f6e3b0b5960  MATCH
orig 924e9aad2f6910cc20570e8ad6e20d3fdd821e8c patch-id 340bcba0c440559c04c24e22fa7533fff18d5e07
pick fc23b2edcb61804cee75baa8ed30f01f5452d791 patch-id 340bcba0c440559c04c24e22fa7533fff18d5e07  MATCH
orig b1fe88b1ace39b03a377f9fe8f746c18787d699a patch-id 44f3c55dc5c06a4e1192085cfac36bd6030b8e46
pick 943144f860b72a05338b2f3abdca0b250351ea4f patch-id 44f3c55dc5c06a4e1192085cfac36bd6030b8e46  MATCH
orig 7e04002a0e203f8f788f7ca773d143bc3f09ab39 patch-id f03fa0ad96f7e5b2a062c9b4b97f5b9b993463ec
pick 18d4e3349dc8970bcdabf8088c8f81f3161bc7ff patch-id f03fa0ad96f7e5b2a062c9b4b97f5b9b993463ec  MATCH
orig 0db9dc68228fa7a074fddffc13acf0ccb30493a3 patch-id e234fe611a3e7ab04e1fe055f37fcafff2a4cb1c
pick a855ab6c1d91b1684eea249e5f0aa6f4642f2fef patch-id e234fe611a3e7ab04e1fe055f37fcafff2a4cb1c  MATCH
```

All five identical on both sides; the values also match the coder's report
byte-for-byte. Provenance of the originals (where they live):
`28d775e`/`924e9aa`/`b1fe88b` on branch `landing-check-fix` (worktree
`kalsa-wt-landing-check`), `7e04002` on `kalsa-app-gpu-v73`, `0db9dc6` on
`kalsa-governor-policy-consolidate` (worktree `kalsa-wt-gov-policy`).

First attempt at this check produced bogus MISMATCH lines; that was a zsh word
splitting bug in my own loop (`set -- $pair` does not split in zsh), not a data
problem. Re-run with an explicit read loop; results above are from that clean run.

## Item 2: combined governorInputs* result at tip (the auto-merge)

**CONFIRMED - all three intents fully applied, combination reintroduces nothing.**

Setup verified: `git show 7e04002 --stat` and `git show 0db9dc6 --stat` both list
`src/engine/governorInputs.ts` and `src/engine/governorInputs.test.ts` (7e04002 also
`AGENTS.md`; 0db9dc6 also `native/GovernorBatteryModule.kt` and
`src/engine/governorBatterySampler.test.ts`). Their hunks in `governorInputs.ts` are
disjoint (7e04002: lines 5-135; 0db9dc6: lines 166+), so git auto-merged without
conflict - which is exactly why the tip, not the two diffs, was audited.

Read at the tip `a9c68b2` (worktree clean, so files on disk == tip):

(a) **App-side idle/validity policy: deleted, no residue.** `profileFrom` in
`src/engine/governorInputs.ts` (lines 166-187) forwards `t_idle_valid: idleValidRaw`
and `t_idle_c` with only the tenths-to-degrees lift; the old app rule
`idleValid = idleValidRaw && idle > 0 && idle + 1 < 42` is gone. Repo-wide
`grep -rn "idleBaseline|EIGHT_GIB|idle + 1 < 42|idle > 0 &&" src/ native/` hits only
(i) `governorBatterySampler.test.ts:247` which asserts the Kotlin source does NOT
contain `idleBaselineTenthsC` (a pin of the deletion), and (ii) explanatory comments
in `governorInputs.test.ts`. Nothing live remains.

(b) **Live temperature + validity flag: emitted.** `native/GovernorBatteryModule.kt`
at the tip has no latch field at all: `readThermo` reports `battTempTenthsC` = live
sensor temperature, `sensorValid = present && temperature > 0`,
`t_idle_valid = sensorValid`, and `t_idle_tenths_c` = the same live temperature
("Raw reading only: the engine latches the plugged baseline and judges it"). The
Kotlin `idleBaselineTenthsC` latch from before `0db9dc6` is gone. Cross-check on the
ENGINE side at the pinned commit:
`git -C ~/Projects/kalsallama show d754229:src/llama-governor-policy.cpp` has
`profile_is_valid` = `... && profile.t_idle_c + 1.0f < 42.0f` (line 53/66) and the
`have_t_idle_reference_` latch (lines 101-113). The exact rule the app deleted now
lives in the engine the app is pinned to. Ownership moved; it did not get lost.

(c) **gpuFit RAM gate removed, V73 enabled.** At the tip `gpuFit` no longer contains
`const total = profile.totalMemoryBytes ?? memory.totalMemoryBytes`, no `EIGHT_GIB`,
and no `total <= EIGHT_GIB -> NoFit`; `GPU_PREFILL_CORRECT.V73: true` ("owner decision
2026-09-21") and `gpu_prefill_measured` includes V73. The merged test file pins the
combined behavior: "refuses unknown KV and no longer gates on total RAM" builds a
device with `8 * 1024**3` total RAM and expects `gpu_fit == "Fit"` (the old gate would
have said NoFit), and the two deliberately-changed tests forward `t_idle_c = 350`
(out of range) and `t_idle_c = 0` unchanged "for the engine to judge".

Checked for half-application elsewhere: the only remaining `totalMemoryBytes <= 6e9`
condition (`AppShell.tsx:4274`) is the pre-existing co-residency policy (release the
embedder before chat init), unrelated to gpuFit and untouched by this line.
`buildGovernorParams` has a single production caller (`LlamaService.ts:2316`).

Observations (not defects):
- `gpu_prefill_measured: true` for V73 even though the same commit says V73 was
  "never measured in-app". The mismatch of name vs semantics is acknowledged in the
  code comment and is an owner enablement decision in-commit, following the pattern
  V75/V79 already had. The engine owns what it does with the flag.
- The merged tests document each deliberate behavior change with a "CHANGED
  DELIBERATELY" comment pointing at the engine's `profile_is_valid` - consistent with
  the commit message of 0db9dc6.

## Item 3: provenance gate - pass + negative case

**CONFIRMED - gate passes on the audited tree and demonstrably fails on a broken pin.**

What the gate is (read before running, `scripts/assert-engine-provenance.sh`):
lockfile `resolved` for `node_modules/llama.rn` must be `Aspis0/kalsa.rn@<40-hex>` and
`package.json` must name the same sha; the fork tarball is fetched from codeload at
that sha, `npm pack`ed, and compared file-for-file by sha256 against the installed
`node_modules/llama.rn` (build dirs excluded, minimum 100 files so two equally broken
trees cannot compare equal); only then is `vendor/VERSIONS` `LLAMA_CPP_COMMIT` tied to
`native/kalsallama.pin`. Exit 0 = identical, 1 = divergent, 2 = cannot decide.

Positive case, run by me in the worktree:

```
$ cd ~/Projects/kalsa-wt-landing && bash scripts/assert-engine-provenance.sh
[provenance] lockfile pins Aspis0/kalsa.rn@b62be78f95b9
[provenance] OK: 1119 files match Aspis0/kalsa.rn@b62be78f95b9
[provenance] engine inside it: kalsallama@d75422944367 == native/kalsallama.pin
GATE_EXIT=0
```

Same three lines the coder reported. `vendor/VERSIONS` at the installed tree declares
`LLAMA_CPP_COMMIT=d754229443670a7454731cd48028cb409ecc0ec2` (read directly, quoted in
full in my session log).

Negative case, in my own scratch copy
(`.../app-landing-audit/scratch/`, 34 MB: package.json, package-lock.json,
native/kalsallama.pin, the script, and `node_modules/llama.rn` copied via
`rsync --exclude android/.cxx --exclude android/build --exclude ios/build
--exclude node_modules` - exactly the paths the gate's own manifest excludes; the
excluded build outputs were 14.3 GB and are invisible to the comparison on both
sides). The unbroken scratch copy gates green (exit 0, identical output), so the
copy is a valid input; then:

```
$ echo "4ccef2f85dbc27e095e11ffcbad4628be9961790" > native/kalsallama.pin
$ bash scripts/assert-engine-provenance.sh
[provenance] lockfile pins Aspis0/kalsa.rn@b62be78f95b9
[provenance] FATAL: engine mismatch: .../scratch/native/kalsallama.pin pins kalsallama@4ccef2f85dbc27e095e11ffcbad4628be9961790 but vendor/VERSIONS declares kalsallama@d754229443670a7454731cd48028cb409ecc0ec2
SCRATCH_BROKEN_EXIT=2
```

Non-zero exit (2), and BOTH shas printed - the broken pin's sha and the engine the
tree actually declares. The gate cannot silently pass a wrong engine pin.

Observation (not a defect): the script header says "1 = divergent, 2 = cannot
decide", and a pin mismatch exits 2 rather than 1. Both are non-zero; CI just has to
treat any non-zero as failure, which a plain `bash scripts/...` step does.

## Item 4: tsc + jest, accounting for the test delta

**CONFIRMED for the landing line (tsc clean, 94/1214 all green - reproduced by me);
CORRECTED on the baseline story: the true base number is 1213, not 1209, so the line
adds exactly 1 test, not 5. The coder's "base" was measured on a dirty tree.**

My runs (both in the landing worktree at `a9c68b2`):

```
$ npx tsc --noEmit ; echo TSC_EXIT=$?
TSC_EXIT=0

$ npx jest --cache=false   (cache disabled so the shared tree stays untouched)
Test Suites: 94 passed, 94 total
Tests:       1214 passed, 1214 total
JEST_EXIT=0
```

Exactly the coder's reported numbers.

The claimed "+5 vs base 1209" does not survive scrutiny:

- Only two jest files differ between `e5788cf` and the tip
  (`git diff --name-only`): `src/engine/governorInputs.test.ts` and
  `src/engine/governorBatterySampler.test.ts`. Static count of `test(`/`it(`
  declarations: sampler 17 -> 17 (two latch tests renamed to no-latch tests),
  inputs 10 -> 11 ("refuses a tenths value that leaks into the degrees field"
  replaced by two tests: "forwards an out-of-range plugged baseline unchanged" and
  "forwards a zero plugged baseline for the engine to judge"). No `.each`/`forEach`
  test generation in either file. Net: +1.
- I therefore ran the pristine base myself, in my own scratch
  (`base-tree/`, produced with `git archive e5788cf | tar -x`,
  `node_modules` symlinked to the worktree's installed tree - the lockfile diff
  between base and tip is only the llama.rn entries, so all other dependency
  versions are identical):

```
Test Suites: 94 passed, 94 total
Tests:       1213 passed, 1213 total
BASE_JEST_EXIT=0
```

- 1213 + 1 = 1214: the numbers now close exactly.

Why the coder's baseline says 1209: their baseline log
(`~/Projects/kalsa/local-artifacts/jest-baseline.log`, mtime Sep 21 10:34) was
captured in the MAIN checkout `~/Projects/kalsa`, which is DIRTY right now -
`git status --short` shows `M src/engine/governorInputs.test.ts`,
`M src/engine/governorInputs.ts`, `M src/engine/LlamaService.ts`,
`M AGENTS.md` plus untracked files - i.e. working-tree state of exactly the files
this line was developed from, not a clean `e5788cf`. Their base number is evidence
from a dirty tree; the conclusion they drew from it ("no suite fails on either ref")
happens to hold anyway (my clean-base run: 94/1213 all passed, exit 0), but the
arithmetic "adds 5 tests" is wrong: the line adds 1.

## Item 5: APK - size, sha256, engine stamp, counterfactual

**CONFIRMED - all values reproduce exactly, and the stamp is re-derived from inputs,
not trusted from a printed claim. NOTE: this APK is the d754229/f32 artifact and will
be REPLACED when the re-pin lands; audited here to prove the method.**

```
$ ls -la android/app/build/outputs/apk/release/app-release.apk
-rw-r--r-- 1 marco staff 152760095 Sep 22 15:28 ...app-release.apk
$ stat -f size=%z ...  -> size=152760095          (matches claim)
$ shasum -a 256 ...    -> 09ae46f87caf3afaa2055e5440a86899c753aad5f8af036a2830b2d2e2b70eee
```

Stamp read from INSIDE the artifact:

```
$ unzip -p app-release.apk assets/app.config
..."extra":{"engineBuildId":"kalsa-eng-v2:698c3664d2593388738fd6a119096aab16f07bc7199c417d031c8c6ee3fcd6d2"}...
```

What that id binds (read from `scripts/engine-build-id.js`, not from the report):
sha256 of a canonical subject containing the binding sha from the lockfile
(`llama-rn:b62be78f...`), the engine sha from the installed `vendor/VERSIONS`
(`kalsallama:d754229...`), the binding version, the sha256 of
`plugins/withLlamaFromSource.js`, every file digest under `native/` (2 files), and
every file digest of the allow-listed engine subtrees of the installed
`node_modules/llama.rn` (1110 files). `app.config.js:143` embeds
`computeEngineBuildId(__dirname)` at prebuild, so the stamp is tree-derived, not
hand-typed.

Re-derived by me on the committed tree:

```
$ node scripts/engine-build-id.js
kalsa-eng-v2:698c3664d2593388738fd6a119096aab16f07bc7199c417d031c8c6ee3fcd6d2
== APK stamp: true
```

Counterfactual for the OLD engine `4ccef2f85dbc27e095e11ffcbad4628be9961790`,
computed by me with the same inputs and only `kalsallamaSha` swapped:

```
old-engine c/f : kalsa-eng-v2:5a8157213bd540e68272fa94a528d22cfc6ca91dc4c61fa31fe12491513b51ff
== APK stamp: false
```

- byte-identical to the coder's claimed counterfactual value, and different from the
  APK stamp. (This swap-underlines only the `kalsallama:<sha>` line; a real old-engine
  build would also differ in all 1110 content digests, so the true old-engine id would
  differ even further. The sensitivity argument only gets stronger.)

Chain closed: gate proves installed tree == Aspis0/kalsa.rn@b62be78f and its
`vendor/VERSIONS` engine == `native/kalsallama.pin` == d754229; the id derives from
that same installed tree and that same `vendor/VERSIONS` line; the fresh recompute
equals the APK-embedded stamp. The APK's own claim is bound to engine d754229 via
binding b62be78f, and I re-derived it from inputs.

## Item 6: push hygiene (assessed; NOT run)

**SAFE as a single-ref, non-force, no-tags branch creation - with one fact the
orchestrator must approve knowingly: the pushed branch carries 61 base commits that
origin does not yet have, and CI will not run on this branch.**

Facts gathered (read-only):

- `git ls-remote origin` (run by me): `refs/heads/kalsa-app-landing` does NOT exist
  on `origin` (`https://github.com/Aspis0/kalsa.git`). The push CREATES exactly one
  ref. The repo's existing tags are untouched (explicit refspec pushes no tags;
  no `--tags`/`--follow-tags`).
- No force: the planned refspecs (`a9c68b2:refs/heads/kalsa-app-landing`, or the
  branch-name form `kalsa-app-landing`) carry no leading `+` and no `--force`. If the
  branch appeared on the remote meanwhile with divergent history, the push is
  rejected, not clobbered. `remote.origin.push` is unset; `push.default` unset
  (irrelevant with an explicit refspec).
- **The 61-commit caveat:** remote `main` is `54297994`, local `main` is `e5788cf`,
  and `git rev-list --count` gives `e5788cf..origin/main` = 0,
  `origin/main..e5788cf` = 61; no remote branch contains `e5788cf`
  (`git branch -r --contains` empty). The landing branch is therefore based on a
  local-only main line, and creating `kalsa-app-landing` at `a9c68b2` publishes all
  61 base commits plus the 6 line commits - 67 commits the remote has never seen,
  reachable through the one new branch. No other ref is created, but if any of those
  61 commits was meant to stay private, this push leaks them. This is inherent to the
  branch's parentage, not to the command form; it needs Marco's explicit yes.
- The coder's two-step variant (`a855ab6` first, then `a9c68b2`) is equally
  non-force and single-ref, but the intermediate step briefly publishes the branch
  with the OLD engine pin (`4ccef2f8...` - read at both tips:
  `git show a855ab6:native/kalsallama.pin` = 4ccef2f8..., tip = d754229...). Given
  the pin is about to be superseded anyway, the single-step form at the final tip is
  the cleaner choice.
- CI will NOT run on the new branch: `.github/workflows/build-kalsa-apk.yml`
  triggers are `workflow_dispatch` and `push: branches: [engine-pin-kalsallama,
  bench-dev-models]` - `kalsa-app-landing` is not in the list. The gate's CI wiring
  (`943144f`) is real and correctly placed (right after `npm ci`, so a non-zero exit
  stops the build before native work), but on this branch it will only ever run when
  manually dispatched, not on push. The green that matters today is the local gate
  run (mine, above), not a CI run.

## Verdict

**The five-commit app line is clean and safe to push as a branch creation; the APK
audited here is NOT the artifact for the phones - it proves the method and will be
replaced by the re-pin.**

What holds: the six commits are exactly as claimed - linear, single-parent, tip
`a9c68b21...`, every pick carried with identical patch-ids (computed by me). The
auto-merged governor area reads correctly at the tip: the app-side idle/validity rule
is gone without residue, the native module emits the live temperature with
`t_idle_valid = sensorValid`, and the engine at the pinned commit d754229 demonstrably
owns the deleted rule (`profile_is_valid`, `t_idle_c + 1 < 42`, plus the latch);
the gpuFit total-RAM gate is gone with the deletion pinned by a test, V73 is enabled
as a documented owner decision, and nothing in the combination reintroduces a
decision the engine owns. The provenance gate passes on the audited tree (1119 files
match, engine == pin) and I proved it fails loudly on a broken pin (exit 2, both
shas printed). tsc is clean and the full jest suite passes (94/1214, reproduced by
me with cache disabled). The APK matches its claimed size and sha256 exactly, its
embedded stamp was re-derived by me from the committed tree (byte-identical), and my
own counterfactual shows the old engine would have produced a different stamp - the
method is sound.

What is corrected or caveated: (1) the coder's "base 1209 / +5 tests" story is wrong
- the true clean base is 1213 (I ran it), the line adds exactly 1 test, and their
baseline log was captured in a dirty checkout of exactly these files; no harm to the
line, but their evidence discipline on baselines is weak. (2) The pin commit and this
APK are temporary by design: the APK embeds the d754229/f32 route (0.006954 /
92.913% @ 68.42 t/s), not the measured-better int8+f32-scale configuration
(0.005412 / 93.982% @ 76.44 t/s) - shipping this APK would ship the slower engine.
(3) The push, while single-ref and non-force, publishes the 61-commit local main base
under the new branch, and CI does not trigger on the branch - both need Marco's
explicit acknowledgment, and the pin diff must be re-audited after it moves
(gate, lockfile agreement, tsc/jest, APK stamp) before anything ships.

## Evidence on disk

- This report: `REPORT.md` (this file).
- `scratch/` - my negative-case copy of the gate inputs (34 MB; pin left in the
  BROKEN state `4ccef2f8...` on purpose, with the failing output quoted above).
- `base-tree/` - pristine `e5788cf` tree (`git archive` extract) used for the
  clean-base jest run; `node_modules` inside is a symlink into the landing worktree
  (dependency-identical apart from the llama.rn entries; see Item 4).
- Session log quotes every command whose output is cited above.
