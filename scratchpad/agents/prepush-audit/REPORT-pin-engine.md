# Pre-push audit: pin engine 0288dc27

Target: /Users/marco/.paseo/worktrees/1vffp1wo/pin-engine, branch pin-engine-0288dc27, HEAD 0e3c46089023d61b5c5c41707d6f6537014633d6.

This was a read-only review. I did not push.

## 1. Commit shape and scope — CONFIRMED

~~~text
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git rev-list --parents -n1 HEAD
git diff --name-only 6dd71c29f3379a865427d01b559c56bc1559f15d..HEAD
~~~

~~~text
pin-engine-0288dc27
0e3c46089023d61b5c5c41707d6f6537014633d6
0e3c46089023d61b5c5c41707d6f6537014633d6 6dd71c29f3379a865427d01b559c56bc1559f15d
REPOS.md
package-lock.json
package.json
~~~

The three changed files are justified: package.json and package-lock.json are the live dependency pin, and REPOS.md corrects the live fork-branch/pin history. The diff contains no absolute local path or credential-looking literal:

~~~text
git diff 6dd71c29f3379a865427d01b559c56bc1559f15d..HEAD | rg -n '/Users/marco|BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY|ghp_|github_pat_'
~~~

Output was empty.

## 2. package and lockfile — CONFIRMED

package.json:49 is exactly:

~~~text
"llama.rn": "github:Aspis0/kalsa.rn#0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2"
~~~

The dependency key remains llama.rn. The fork package at F also still declares name llama.rn at package.json:2.

The lockfile has the same dependency string at line 41 and the same full F SHA in node_modules/llama.rn.resolved at line 10017. Its integrity value was recomputed:

~~~text
{
  "packageName": "kalsa",
  "dependency": "github:Aspis0/kalsa.rn#0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2",
  "lockDependency": "github:Aspis0/kalsa.rn#0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2",
  "resolved": "git+ssh://git@github.com/Aspis0/kalsa.rn.git#0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2",
  "integrity": "sha512-6nVhgebK6nTrFI86gNH80vvt0vQbbKR0gjBEK9RrLivNmAKf/KsjeCXwrfMgIgpycAP4w+jN/69RCCvipcobTw=="
}
~~~

The top-level application package is kalsa; the npm dependency/package name is unchanged. No old SHA remains in either live dependency field, and npm lock consistency passed:

~~~text
npm ci --dry-run --ignore-scripts --no-audit --no-fund
added 41 packages in 463ms
~~~

## 3. Old and new SHA occurrences — CONFIRMED

Exact commands:

~~~text
git grep -n '0f313bab' || true
git grep -n '0288dc27' || true
~~~

Old-SHA disposition:

| Hit | Classification | Disposition |
|---|---|---|
| REPOS.md:94 | Historical live-branch fact: origin/kalsa remained at the old pin until 20/09 | Correct and must remain |
| scripts/test_engine_provenance.sh:33 | Frozen fixture SHA used to test the gate’s canonical/legacy URL behavior | Correct; not a live app pin |

The new-SHA hits are exactly the intended live references:

~~~text
REPOS.md:95
package-lock.json:41
package-lock.json:10017
package.json:49
~~~

No historical record was incorrectly rewritten, and no live pin was left at 0f313bab.

## 4. Provenance and engine identity tests — CONFIRMED

The public branch ref resolves as requested:

~~~text
git -C /Users/marco/Projects/llama.rn-kalsa ls-remote origin refs/heads/vendor-migration
0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2	refs/heads/vendor-migration
~~~

Real installed-tree gate:

~~~text
bash scripts/assert-engine-provenance.sh
~~~

The sandbox-only attempt failed before comparison because codeload DNS was unavailable. The same read-only command with network access passed:

~~~text
[provenance] lockfile pins Aspis0/kalsa.rn@0288dc278691
[provenance] OK: 1119 files match Aspis0/kalsa.rn@0288dc278691
[provenance] engine inside it: kalsallama@4ccef2f85dbc
~~~

Fixture gate:

~~~text
bash scripts/test_engine_provenance.sh
...
=== 17 passed, 0 failed ===
~~~

The fixture’s old SHA is intentional; it tests generic canonical/legacy URL and divergence cases, while the real gate tested the new installed pin.

Engine identity tests:

~~~text
npx jest src/engine
Test Suites: 59 passed, 59 total
Tests:       717 passed, 717 total
Snapshots:   0 total
~~~

## 5. Engine source versus the previous pin — CONFIRMED, with provenance boundary noted

F’s only parent is the old fork pin:

~~~text
git -C /Users/marco/Projects/llama.rn-kalsa rev-list --parents -n1 0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2
0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2 0f313bab464ef28a58a8b4b2a37a5d4c1968b54e
~~~

The exact F parent-to-child file list is:

~~~text
git -C /Users/marco/Projects/llama.rn-kalsa diff-tree --no-commit-id --name-status -r 0f313bab464ef28a58a8b4b2a37a5d4c1968b54e 0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2
M lib/commonjs/version.js
M lib/module/version.js
M lib/typescript/version.d.ts
M src/version.ts
M vendor/VERSIONS
M vendor/llama.cpp/common/build-info.cpp
M vendor/llama.cpp/ggml/src/ggml-version.h
M vendor/llama.cpp/src/llama-version.h
~~~

These are the eight unique changed paths. The unified diff shows only build-number/commit constants in generated files and LLAMA_CPP_REF/COMMIT in vendor/VERSIONS; it contains no engine algorithm or C++ source change.

The fork’s F vendor/VERSIONS says:

~~~text
LLAMA_CPP_REF=4ccef2f85dbc27e095e11ffcbad4628be9961790
LLAMA_CPP_COMMIT=4ccef2f85dbc27e095e11ffcbad4628be9961790
~~~

The immutable desktop tag resolves to the same commit:

~~~text
git -C /Users/marco/Projects/kalsallama rev-parse refs/tags/kalsa-server-v1.0.0^{commit}
4ccef2f85dbc27e095e11ffcbad4628be9961790
~~~

As a cross-check against a metadata-only claim, the desktop diff from 8537d097c to 4ccef2f85 contains only the workflow and tools/server checkpoint/cache-salt files; it contains no core llama.cpp source files. Therefore the evidence supports this precise statement: the app source is unchanged relative to its previous fork pin except for version metadata, and the desktop tag also did not change core engine source over that baseline. F’s new 4c value is a declared provenance label for the release commit; it is not evidence that F imported a new engine source tree.

## 6. Push safety — REFUTED

At the content level, there is no changed live pin outside the dependency records and corrected REPOS history. The lockfile resolves the exact F commit, the real provenance gate compares the installed tree to F, all engine tests pass, and the desktop tag points at the declared engine commit. The blocking issue is integration ancestry, not the pin contents.

However, the requested integration branch has moved since this commit was based. The target parent is 6dd71c29, while the local remote-tracking integration branch is already 213850e1, the telemetry commit:

~~~text
git rev-parse origin/app-integration-2026-09-20
git merge-base --is-ancestor 0e3c46089023d61b5c5c41707d6f6537014633d6 origin/app-integration-2026-09-20; echo target_is_ancestor_rc=$?
git merge-base --is-ancestor origin/app-integration-2026-09-20 0e3c46089023d61b5c5c41707d6f6537014633d6; echo remote_is_ancestor_rc=$?
git merge-base 0e3c46089023d61b5c5c41707d6f6537014633d6 origin/app-integration-2026-09-20
git log --oneline --left-right 0e3c46089023d61b5c5c41707d6f6537014633d6...origin/app-integration-2026-09-20
~~~

~~~text
213850e1b617831586e9b9c18b0144ea74664efb
target_is_ancestor_rc=1
remote_is_ancestor_rc=1
6dd71c29f3379a865427d01b559c56bc1559f15d
< 0e3c460 chore(engine): pin llama.rn to 0288dc27 (engine 4ccef2f85)
> 213850e feat(telemetry): move the Worker origin to telemetry.kalsa.io
~~~

The pin commit and the current integration tip diverge at 6dd71c29. A direct push of this commit to the integration branch would be rejected as non-fast-forward and must not be forced.

## Required fix

Integrate or rebase this pin commit onto the current app-integration-2026-09-20 tip 213850e1, then rerun this audit before pushing. Do not force-push the divergent commit.

## Final verdict

NOT PUSH-SAFE for pushing the current 0e3c460 directly onto the current app integration branch.

~~~text
git -C /Users/marco/.paseo/worktrees/1vffp1wo/pin-engine push origin 0e3c46089023d61b5c5c41707d6f6537014633d6:app-integration-2026-09-20
~~~

That exact command is expected to fail with a non-fast-forward rejection; it is not a command to run until the commit is integrated on top of 213850e1.

Final line: NOT PUSH-SAFE for 0e3c460 onto app-integration-2026-09-20; do not force-push.
