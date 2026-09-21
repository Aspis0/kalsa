# Fork-rename adversarial review

Target: APP worktree `rename-fork-kalsa-rn`, commit `f5be12c2`, parent `5429799`.
The APP worktree was inspected read-only. This report is the only requested LAB artifact.

## Verdict summary

| item | verdict | conclusion |
|---|---|---|
| 1. Identity chain and URL regex | **CONFIRMED** | Canonical and legacy names are accepted; wrong host, owner, and repository are rejected by the production regex. The `NotAspis0` test and a real legacy-accept test remain. Automated test execution was unavailable because dependencies are absent; the existing rejection test covers only the wrong-owner case despite its broader name. |
| 2. Remaining `Aspis0/llama` hits | **CONFIRMED** | Every hit is an intentional allowance, explanation, or legacy test. No live package or fetch regression remains. |
| 3. Package manifests | **CONFIRMED** | Both dependency URLs use `kalsa.rn`; the full 40-hex pin, version, and integrity are unchanged. |
| 4. Provenance gate | **UNVERIFIABLE** | The source logic accepts legacy locks and always fetches the canonical codeload URL, but the end-to-end gate could not run and has no fixture test in this branch. |
| 5. Architecture and repository docs | **REFUTED** | The rename and npm-name nuance are correct, but `REPOS.md:11` still says three live repositories while listing four, and `ARCHITECTURE.md:61` still names a removed `cpp/KALSALLAMA_SHA` output. |
| 6. Over-claims and dropped surface | **REFUTED** | The stale documentation claims are live on the target; URL rejection coverage is narrower than its test name suggests. No C++ file or symbol rename was silently introduced. |
| 7. Merge-conflict information | **CONFIRMED** | `ARCHITECTURE.md` and `REPOS.md` have overlapping hunks with the current docs-cleanup branch; conflict locations are listed below. |

## 1. Identity chain and regex — CONFIRMED

The production regex is at `scripts/engine-build-id.js:148-155`:

```text
const LLAMA_RN_GIT_URL =
  /^git\+(?:ssh|https):\/\/(?:git@)?github\.com\/Aspis0\/(?:kalsa\.rn|llama\.rn)(?:\.git)?$/;
```

It is anchored at both ends, fixes the host and owner, and limits the repository basename to the
two intended names. Direct evaluation of the literal extracted from the production file gives:

```text
$ node -e '...extract LLAMA_RN_GIT_URL from scripts/engine-build-id.js and test six URLs...'
canonical_ssh=true
canonical_https=true
legacy=true
wrong_owner=false
wrong_repo=false
wrong_host=false
```

The test file also has the required cases:

- Canonical SSH acceptance: `src/engine/engineIdentity.test.ts:340-349`.
- Canonical HTTPS acceptance: `:351-360`.
- Real legacy acceptance, including a lockfile-shaped resolved URL: `:362-374`.
- The `NotAspis0` negative test: `:387-401`.
- Short-SHA rejection: `:403-415`.

The `NotAspis0` test remains meaningful: it exercises `collectEngineBuildInputs()` with a complete
scaffold and asserts the canonical-owner error, rather than merely testing a string helper.

The test name at `:387` says “wrong host/owner/repo”, but the only actual negative fixture is the
wrong owner at `:393`; there is no distinct wrong-host or wrong-repository fixture. The production
regex rejects both, as shown above, but the test suite does not independently protect those two
constraints. This is a coverage gap, not an observed acceptance bug.

The chain also preserves the subject identity: `llamaRnCommit()` reads the resolved URL from
`package-lock.json` at `scripts/engine-build-id.js:157-177`, while the installed package remains
`node_modules/llama.rn` and the npm package name remains `llama.rn` in the test scaffold at
`src/engine/engineIdentity.test.ts:306-322`.

## 2. Remaining legacy references — CONFIRMED

The complete branch search is:

```text
$ git grep -n 'Aspis0/llama' f5be12c2 -- .
f5be12c2:ARCHITECTURE.md:49:...the gate also accepts the pre-rename `Aspis0/llama.rn`...
f5be12c2:scripts/assert-engine-provenance.sh:55:...Aspis0/llama.rn to Aspis0/kalsa.rn...
f5be12c2:scripts/assert-engine-provenance.sh:59-61:legacy URL allowlist entries
f5be12c2:scripts/engine-build-id.js:151:rename explanation
f5be12c2:scripts/engine-build-id.js:171:legacy-name explanation
f5be12c2:src/engine/engineIdentity.test.ts:362:rename explanation
f5be12c2:src/engine/engineIdentity.test.ts:365:legacy test name
f5be12c2:src/engine/engineIdentity.test.ts:369:legacy fixture URL
```

There are no other hits. The old name is absent from `package.json`, `package-lock.json`, the
canonical codeload fetch, and the ordinary application documentation. No remaining hit is a live
dependency or a live fetch target.

## 3. Manifest pin, version, and integrity — CONFIRMED

The manifest diff is limited to the repository component of the dependency URL:

```text
$ git diff 5429799..f5be12c2 --unified=0 -- package.json package-lock.json
package.json:49  - github:Aspis0/llama.rn#0f313bab464ef28a58a8b4b2a37a5d4c1968b54e
package.json:49  + github:Aspis0/kalsa.rn#0f313bab464ef28a58a8b4b2a37a5d4c1968b54e
package-lock.json:41  - github:Aspis0/llama.rn#0f313bab464ef28a58a8b4b2a37a5d4c1968b54e
package-lock.json:41  + github:Aspis0/kalsa.rn#0f313bab464ef28a58a8b4b2a37a5d4c1968b54e
package-lock.json:10017  - .../Aspis0/llama.rn.git#0f313bab464ef28a58a8b4b2a37a5d4c1968b54e
package-lock.json:10017  + .../Aspis0/kalsa.rn.git#0f313bab464ef28a58a8b4b2a37a5d4c1968b54e
```

The current lock entry at `package-lock.json:10015-10019` is:

```text
"node_modules/llama.rn": {
  "version": "0.13.0-rc.4",
  "resolved": "git+ssh://git@github.com/Aspis0/kalsa.rn.git#0f313bab464ef28a58a8b4b2a37a5d4c1968b54e",
  "integrity": "sha512-5pnaIbcYIQCDcV084eCnAgxuRGDUDITSfxX4rLz9bNWqhs7nCMnMV8UckpjzoIucOl6LVRiuv8IYEWst1YoLnw=="
}
```

The parent has the same version, integrity, and 40-hex SHA. No C++ symbol or file was renamed:

```text
$ git diff --name-status 5429799..f5be12c2 -- '*.cpp' '*.cc' '*.cxx' '*.h' '*.hpp' '*.mm' '*.m' '*.kt' '*.java'
[no output]
```

## 4. Provenance gate — UNVERIFIABLE

The static behavior is internally correct:

- Canonical lockfile forms are accepted at `scripts/assert-engine-provenance.sh:50-53`.
- Legacy SSH, `git+https`, and plain HTTPS forms are accepted at `:54-61`.
- Both paths validate the same 40-hex SHA at `:65-66`.
- The fetch is unconditionally canonical at `:69-70`:
  `https://codeload.github.com/Aspis0/kalsa.rn/tar.gz/$SHA`.
- The fetched tarball is packed and compared file-for-file against the installed package at
  `:74-93`.

Therefore accepting an old lock name does not redirect the fetch to the old name or remove the
tree comparison. The gate still fails on a wrong URL at `:62`, a malformed SHA at `:66`, and any
manifest divergence at `:94-100`.

The end-to-end assertion was not executable in this worktree:

```text
$ ./scripts/assert-engine-provenance.sh
[provenance] FATAL: .../node_modules/llama.rn is not installed — nothing to check
exit=2

$ test -d node_modules && echo present || echo absent
absent
```

There is also no shell-fixture test for `assert-engine-provenance.sh` in the branch. The TypeScript
identity test proves legacy URL acceptance in the build-id path, but not that the shell gate can
complete against an installed legacy lock. Verdict is therefore UNVERIFIABLE for execution, while
the source-level behavior is consistent with the requested decision.

## 5. Architecture and repository documentation — REFUTED

The rename statements themselves are correct:

- `ARCHITECTURE.md:16-20` names `Aspis0/kalsa.rn`, states the GitHub rename and redirect, and
  explicitly says the npm package name remains `llama.rn`.
- `ARCHITECTURE.md:47-49` documents canonical provenance plus intentional legacy acceptance.
- `REPOS.md:3-4,15-18,25-30,77-86` names the live fork `Aspis0/kalsa.rn` and preserves the
  `llama.rn` npm-package nuance.

Two live claims are nevertheless false or internally inconsistent:

1. `REPOS.md:3` says four repositories are live and the table at `:15-18` has four rows, but the
   section heading at `REPOS.md:11` still says **“The three live ones.”** This is a stale count on
   the target branch.

2. `ARCHITECTURE.md:61` says the provenance script prints `cpp/KALSALLAMA_SHA`, and `:78-80`
   lists `node_modules/llama.rn/cpp/KALSALLAMA_SHA` as evidence. The target script actually reads
   `vendor/VERSIONS` and extracts `LLAMA_CPP_COMMIT` at `scripts/assert-engine-provenance.sh:86-92`.
   The `engine-build-id.js` implementation agrees at `:180-199`. This is not a rename failure, but
   it is a false live documentation claim on the review target and must not be carried forward.

## 6. Over-claims and silently dropped surface — REFUTED

The rename diff itself is narrow and did not drop a code surface: `git diff --stat` reports changes
to ten files, no C++ file, and no rename-status entry. The additional edited files are expected
reference/comment updates in `assert-overlay-includes.sh`, `LlamaService.ts`, and
`kvShiftRefuse.test.ts`; their old-name hits are not live URL consumers.

The remaining over-claims are:

- The test name `throws on a wrong host/owner/repo` overstates the actual negative coverage. Only
  `NotAspis0` is exercised at `engineIdentity.test.ts:387-401`.
- The provenance gate's legacy behavior is source-supported but not runtime-tested in this branch;
  treating it as fully verified would be an over-claim.
- `ARCHITECTURE.md:61,78-80` is stale about the engine-pin evidence, as described above.
- `REPOS.md:11` silently retains the old three-live count while the rename branch lists four.

No C++ symbol/file rename, package-name rename, SHA change, integrity change, or accidental legacy
live dependency was found.

## 7. Informational merge-conflict map — CONFIRMED

The comparison was against the current `docs-cleanup-2026-09` worktree, whose HEAD is
`39f403a4` and whose parent is `2377a7f`. A read-only `git merge-tree f5be12c2 5429799 39f403a4`
reports both files changed in both branches.

Likely manual-resolution spots:

- **`ARCHITECTURE.md` engine assembly, original lines 16-22.** The rename branch changes the fork
  URL to `Aspis0/kalsa.rn`; docs-cleanup rewrites the same paragraph for the vendor layout. Keep
  both the new fork URL and the vendor-layout facts.
- **`ARCHITECTURE.md` fork update code block, original lines 25-35.** The rename branch updates
  the repository name in the old `sync-kalsallama.sh` workflow; docs-cleanup replaces that workflow
  with `vendor/VERSIONS` / `sync:vendor`. Prefer the vendor workflow and `kalsa.rn` name.
- **`ARCHITECTURE.md` provenance paragraph, original lines 47-49.** Keep the rename branch's
  canonical name plus legacy allowance, while retaining docs-cleanup's corrected
  `vendor/VERSIONS` terminology elsewhere.
- **`ARCHITECTURE.md` evidence list, original lines 78-82.** Both branches edit the fork/evidence
  paragraph. The merged result should name `Aspis0/kalsa.rn` and `vendor/VERSIONS`, not the stale
  `cpp/KALSALLAMA_SHA`.
- **`REPOS.md` repository table, original lines 15-18.** The rename branch changes the binding-fork
  row; docs-cleanup changes tracked-file counts and also retains the old fork name. Resolve to
  `Aspis0/kalsa.rn`, four live rows, and the docs-cleanup count/source text.
- **`REPOS.md` app section, original lines 25-30.** Both branches rewrite the dependency paragraph:
  merge the new fork name with docs-cleanup's vendor-layout description.
- **`REPOS.md` binding-fork section, original lines 77-92.** The rename branch changes the heading,
  redirect explanation, and fork name; docs-cleanup changes the section's branch/pin and
  re-vendoring facts. Preserve all current facts, then fix the heading count.

## Required fixes, in order

1. Correct `ARCHITECTURE.md:61,78-80` from `cpp/KALSALLAMA_SHA` to the actual
   `vendor/VERSIONS` / `LLAMA_CPP_COMMIT` evidence path.
2. Change `REPOS.md:11` to “The four live ones” so it agrees with `REPOS.md:3` and `:15-18`.
3. Add separate wrong-host and wrong-repository rejection fixtures, or narrow the test name at
   `src/engine/engineIdentity.test.ts:387` so it does not claim coverage it lacks.
4. Add a fixture-based test for `assert-engine-provenance.sh` covering a canonical lock and a
   legacy lock, asserting that both fetch `codeload.github.com/Aspis0/kalsa.rn` and compare the
   installed manifest. Until then, keep the gate's runtime status UNVERIFIABLE.

The merge-conflict work in §7 is informational and is not itself a required fix to this branch.
