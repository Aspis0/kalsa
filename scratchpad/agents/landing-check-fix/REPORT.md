# Fix: the three provenance-gate holes (landing-check-fix)

Date: 2026-09-22. Closes holes 1-3 of `../landing-check-mutation/REPORT.md`.

Where the work lives: repo `~/Projects/kalsa` (shared checkout, untouched - its
`git status` is whatever it was before this task). Work landed in the worktree
`/Users/marco/Projects/kalsa-wt-landing-check`, branch `landing-check-fix`, 3 local
commits on top of `e5788cf`. No push, no tag, no upstream, no APK build, no phone.

- `28d775e` provenance gate : compare package.json with the lockfile and the engine sha with native/kalsallama.pin
- `924e9aa` tests : regression cases for the provenance gate's silent passes
- `b1fe88b` ci : run the provenance gate in build-kalsa-apk.yml

## Hole 1 - print-only, fail-open first link: fixed

`native/kalsallama.pin` is back as a one-line file holding the 40-hex engine sha the
app expects (`4ccef2f85dbc27e095e11ffcbad4628be9961790` - the `LLAMA_CPP_COMMIT`
declared by fork `0288dc27`, verified as a real commit in the kalsallama checkout
with `git cat-file -t`). One-line justification for the mechanism: it is the retired
path with the lightest possible shape - one `printf`, one `tr`, one `[[ ]]` - and every
bump now shows it as a one-line diff that a reviewer cannot miss.

On the gate's success path, after the manifest diff matches and before any `OK:` line
is printed (no printing without comparing), all of these are fatal (exit 2) with both
sides of the comparison named:

| condition | message (abridged) |
|---|---|
| pin file missing | `missing engine pin .../native/kalsallama.pin; vendor/VERSIONS declares <sha-or-empty>` |
| pin empty / not 40-hex | `engine pin ... is not one 40-hex sha: '<value>'; vendor/VERSIONS declares <sha>` |
| `LLAMA_CPP_COMMIT` empty/absent/malformed | `vendor/VERSIONS declares no usable LLAMA_CPP_COMMIT: '<value>'; <pin> pins <sha>` |
| the two shas differ | `engine mismatch: <pin> pins kalsallama@<sha> but vendor/VERSIONS declares kalsallama@<sha>` (both full 40-hex) |

Beyond the verifier's proposed remedy, one extra two-line check: a `LOCAL OVERRIDE`
note anywhere in the installed `vendor/VERSIONS` is fatal, and the offending line is
quoted. The verifier's own text says a committed LOCAL OVERRIDE "passes green" - but
the pin-only fix would still pass it, because the 4c construction keeps
`LLAMA_CPP_COMMIT` equal on both sides. The gate already parses this exact file for
its link-1 check; failing on a file that declares "this tree is not the sha written
below" is the same check refusing to trust a self-contradicting statement. This is
the one place I went past the verifier's minimal proposal - flag it if you want it
removed, fixture case I depends on it.

## Hole 2 - package.json/lockfile drift: fixed

After the lockfile's `resolved` sha is parsed (same spot, same regex), the gate now
reads `package.json` `dependencies["llama.rn"]` with the same `node -e` style as the
lockfile parse and fatals when the two shas differ or when the package.json value is
not a 40-hex pin. Both full shas are printed. This runs before any network fetch
(fixture H asserts `CURL_LOG` stays empty). Everything else - allow-list, legacy
`Aspis0/llama.rn` allowance, sha format, manifest diff, exit-code scheme - is
untouched.

"Or with the binding commit actually installed": there is no direct third comparison
because the installed tree records no full fork sha to read. Evidence: no 40-hex in
`node_modules/llama.rn/package.json`, no `.git` anywhere in it, and
`lib/commonjs/version.js` carries only an 8-hex ENGINE stamp
(`BUILD_COMMIT = '8537d097'`), not a binding commit. The chain still closes
transitively: package.json == lockfile (new check) and lockfile == installed
byte-for-byte (the pre-existing manifest diff).

## Hole 3 - the APK builder never ran the gate: fixed

`.github/workflows/build-kalsa-apk.yml` now runs
`bash scripts/assert-engine-provenance.sh` as its own step right after `npm ci` and
before prebuild/gradle, same step name as in `apk.yml`/`e2e-emulator.yml`. A non-zero
exit fails the step, which stops the job before any native work and before the
artifact exists; upload never runs. YAML parses (`python3 -c 'import yaml'`).

Also updated two ARCHITECTURE.md rows this change falsifies: "nothing compares it to
an expected value" and "run by hand, not in CI", plus the bump recipe now ends with
`printf '%s\n' <engine-sha40> > native/kalsallama.pin`.

## Regression tests

Extended `scripts/test_engine_provenance.sh` (the existing offline fixture harness,
same curl/npm PATH-shim technique) with cases F-L plus a pin-agreement assertion in
case A. The fixture root now ships `package.json` and `native/kalsallama.pin` like
the real repo does. The cases, each asserted as a FAILURE (no happy-path-only tests):

- F: engine mismatch - pin vs `vendor/VERSIONS`, manifests match. Asserts exit 2,
  both full shas in stderr, no `OK:` line. This is the construction the old gate
  could not express at all (the app recorded no engine sha).
- G: `vendor/VERSIONS` absent on BOTH sides - the 4e fail-open. Asserts exit 2
  (was 0), empty side and pin sha named, no `OK:`.
- H: package.json pin drifted off the lockfile - the 3a mechanism. Asserts exit 2
  (was 0), both fork shas named, nothing fetched.
- I: LOCAL OVERRIDE note on both sides, commits equal - the committed-override
  silent pass. Asserts exit 2 (was 0), note quoted, no `OK:`.
- J: pin file missing. Asserts exit 2, file path + installed engine sha named.
- K: pin file empty. Asserts exit 2, "not one 40-hex sha" + installed engine sha.
- L: LOCAL OVERRIDE on the installed side only (the verifier's 4c construction).
  Asserts exit 1 stays, `first differing path: ./vendor/VERSIONS` stays.

Evidence the tests are real regressions, not decoration: run against the OLD gate
(`/tmp/fix-before`, old checker + new tests) 18 of 37 assertions fail - exactly F,
G, H, I, J, K plus the pin line in A. Against the patched gate: `=== 37 passed,
0 failed ===`, exit 0.

`scripts/test_engine_provenance.sh` still runs in no workflow (verifier's context
finding). Wiring it into CI is a separate decision; I did not do it unasked.

## The 14 cases: before / after

Method: the verifier's constructions in `/tmp/prov-mutation` were reused untouched.
Each case dir was copied to `/tmp/prov-mutation-after/<case>` with exactly two
deltas: `scripts/assert-engine-provenance.sh` replaced by the patched gate, and
`native/kalsallama.pin` added holding `4ccef2f85...` (the value the real repo now
ships - without it every dir would be a state the patched repo cannot exist in, and
the comparison would not be like-for-like). Runner mirrors `run-all.sh` case for
case, tag for tag: `/tmp/prov-mutation-after/run-after.sh`, logs in
`/tmp/prov-mutation-after/logs/`. Same real-network conditions as the verifier;
only 4e is shimmed, using the verifier's own shim/stage copies.

| # | Case | Before (rc) | After (rc) | Required | Verdict |
|---|---|---|---|---|---|
| 1 | case1-positive | 0 | 0 | pass | unchanged; engine line now `kalsallama@4ccef2f85dbc == native/kalsallama.pin` |
| 2 | case1b-prev-pin | 1 | 1 | fail | unchanged (manifest divergence, reached before any new check) |
| 3 | case2a-real-current-state | 1 | 1 | fail | unchanged (stale install of real main; still DIVERGENT, first path `./lib/commonjs/version.js`) |
| 4 | case2b-engine-sha-swap | 1 | 1 | fail | unchanged (DIVERGENT at `./vendor/VERSIONS`; see disagreement note below) |
| 5 | case3a-pkg-drift | **0** | **2** | fail | **hole 2 closed**: `FATAL: package.json pins Aspis0/kalsa.rn@0a9b9379... but package-lock.json pins Aspis0/kalsa.rn@0288dc27...` |
| 6 | case3b-ghost-sha | 2 | 2 | fail | unchanged (404 -> fatal) |
| 7 | case3c-other-real-sha | 1 | 1 | fail | unchanged |
| 8 | case4a-versions-absent | 1 | 1 | fail | unchanged |
| 9 | case4b-versions-empty | 1 | 1 | fail | unchanged |
| 10 | case4c-local-override-note | 1 | 1 | fail | unchanged (installed-only note -> manifest divergence; the both-sides variant is fixture I) |
| 11 | case4e-real-prevendor | 2 | 2 | fail (cannot decide) | unchanged (`npm pack failed`, bob) |
| 12 | case4e-shim-VERSIONS-absent-both-sides | **0** | **2** | fail | **hole 1 closed**: `FATAL: vendor/VERSIONS declares no usable LLAMA_CPP_COMMIT: ''; .../native/kalsallama.pin pins 4ccef2f85...` |
| 13 | case5a-apk-worktree | 1 | 1 | fail | unchanged (2845 differing entries - the gate sees yesterday's trap when it is run) |
| 14 | case5b-excluded-outputs | 0 | 0 | see below | still passes: invisible by construction, stated below, not papered over |

Summary: the two silent passes (3a, 4e) now fail; nothing that was required to pass
newly fails (case 1 still exits 0); no other verdict moved.

## What this change does NOT see (explicit)

- Case 5b stays 0 on purpose. A hand-pin confined to `android/build/`,
  `android/.cxx/`, `ios/build/` or a nested `node_modules` is excluded from the
  manifest by construction; a repo-level check cannot see it, and neither can it see
  engine sources that were hand-pinned, compiled into an APK, then reverted. Fixing
  that means reproducible-build or binary-forensics work, not more lines in this
  checker. The verifier's own classification (invisible) stands; I am not pretending
  to cover it.
- `vendor/llama.cpp` contents vs `kalsallama@<sha>` (fork-internal honesty without
  an override note) would require fetching the engine repo and diffing - a second
  network dependency and a much bigger check. Out of scope; the note-marker fatal
  catches the known-bad construct, not every possible lie.
- DIVERGENT-path messages (cases 2a/2b) still print only the fork sha and the first
  differing path; they never name the two engine shas. The verdicts are correct
  (fail), and the task scoped the both-shas message to the success-path comparison,
  so I did not touch that branch. If you want engine context added to the DIVERGENT
  output for diagnosis speed, that is a small follow-up.
- The pin is only as good as the bump discipline - but a wrong pin now fatals the
  gate, and updating it is a visible one-line diff in every bump commit.
- Real main stays red (case 2a) until `npm ci` is run there. The gate is correctly
  detecting a stale install; this change does not and should not green it.
- Pre-existing doc drift the verifier noted and I did not touch: `REPOS.md` still
  calls `8537d097c` the shipped pin; `ARCHITECTURE.md`'s "run by hand" claim was
  fixed only because my workflow change falsified it directly.

## Where I agree and disagree with the verifier

- Holes 1, 2, 3 as stated: reproduced, agree, fixed (table above).
- Their remedy (b) - pin file + success-path compare - is what I implemented, plus
  the LOCAL OVERRIDE fatal, because their own hole-1 text says a committed override
  passes green and the pin comparison alone does not catch that case.
- "The engine mismatch cannot be constructed at all": true for the old gate only
  because the app recorded nothing. With the pin restored the construction exists
  and is now fixture case F (manifests match, shas disagree) - their case 2b is a
  different thing (installed tree mutated, so the manifest diff fires first and the
  pin check is never reached; still exit 1, as required).
- Their case 4d complaint (fails closed but blames the packer): real, unchanged by
  this task, left alone.
- Their case-table row for 5b ("PASS - invisible"): agree; my report says so rather
  than claiming coverage.

## Verification trail

- `bash scripts/test_engine_provenance.sh` -> `=== 37 passed, 0 failed ===`, exit 0
  (run from the worktree after the final edit).
- Old-gate control (`/tmp/fix-before/scripts/test_engine_provenance.sh`) ->
  `=== 19 passed, 18 failed ===`.
- 14-case re-run: `/tmp/prov-mutation-after/logs/*.rc` quoted in the table; runner
  output captured above the table's source logs.
- `bash -n` clean on both shell scripts; `build-kalsa-apk.yml` parses as YAML.
- Shared checkout untouched: `git -C ~/Projects/kalsa status --short` shows only the
  pre-existing local modifications, none of them mine.
