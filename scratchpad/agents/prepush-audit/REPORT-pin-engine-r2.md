# Re-audit: rebased engine pin

Target: /Users/marco/.paseo/worktrees/1vffp1wo/pin-engine, branch pin-on-top, HEAD 96eb9d9b1b3a4b5157f506ca91db44f1e1a2ce66.

This was a read-only review. I did not push.

## 1. Patch identity — CONFIRMED

Commands:

~~~text
git diff 6dd71c29f3379a865427d01b559c56bc1559f15d..0e3c46089023d61b5c5c41707d6f6537014633d6 > /tmp/pin-old.diff
git diff 213850e1b617831586e9b9c18b0144ea74664efb..96eb9d9b1b3a4b5157f506ca91db44f1e1a2ce66 > /tmp/pin-new.diff
wc -l /tmp/pin-old.diff /tmp/pin-new.diff
diff -q /tmp/pin-old.diff /tmp/pin-new.diff
~~~

Output:

~~~text
      53 /tmp/pin-old.diff
      53 /tmp/pin-new.diff
     106 total
~~~

diff -q produced no output, so the old and rebased patches are identical.

## 2. Commit and file scope — CONFIRMED

~~~text
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git rev-list --parents -n1 HEAD
git diff --name-only 213850e1b617831586e9b9c18b0144ea74664efb..HEAD
git diff --name-status 6dd71c29f3379a865427d01b559c56bc1559f15d..0e3c46089023d61b5c5c41707d6f6537014633d6
git diff --name-status 213850e1b617831586e9b9c18b0144ea74664efb..96eb9d9b1b3a4b5157f506ca91db44f1e1a2ce66
~~~

Relevant output:

~~~text
pin-on-top
96eb9d9b1b3a4b5157f506ca91db44f1e1a2ce66
96eb9d9b1b3a4b5157f506ca91db44f1e1a2ce66 213850e1b617831586e9b9c18b0144ea74664efb
REPOS.md
package-lock.json
package.json
M	REPOS.md
M	package-lock.json
M	package.json
M	REPOS.md
M	package-lock.json
M	package.json
~~~

The rebased commit has exactly the same three modified files, with no additions, deletions, conflict artifact, whitespace error, or extra hunk. The worktree was clean.

## 3. Pin and old-SHA check — CONFIRMED

package.json:49, package-lock.json:41, and package-lock.json:10017 still carry the full F SHA and matching resolved URL. The exact old-SHA grep was:

~~~text
git grep -n '0f313bab' || true
REPOS.md:94: vendor-migration; origin/kalsa is 0f313bab, the app's pin until 20/09; origin/vendor-migration
scripts/test_engine_provenance.sh:33:SHA=0f313bab464ef28a58a8b4b2a37a5d4c1968b54e
~~~

Both hits remain the previously approved historical branch record or frozen gate fixture; neither is a live dependency pin. The F grep still finds only the intended package.json, package-lock.json, and REPOS.md references.

## 4. Gates and tests — CONFIRMED

Real installed-tree provenance gate:

~~~text
bash scripts/assert-engine-provenance.sh
[provenance] lockfile pins Aspis0/kalsa.rn@0288dc278691
[provenance] OK: 1119 files match Aspis0/kalsa.rn@0288dc278691
[provenance] engine inside it: kalsallama@4ccef2f85dbc
~~~

Fixture gate:

~~~text
bash scripts/test_engine_provenance.sh
=== 17 passed, 0 failed ===
~~~

Engine identity tests:

~~~text
npx jest src/engine
Test Suites: 59 passed, 59 total
Tests:       717 passed, 717 total
Snapshots:   0 total
~~~

## 5. Fast-forward push — CONFIRMED

~~~text
git rev-parse origin/app-integration-2026-09-20
git rev-parse HEAD^1
git merge-base --is-ancestor 213850e1b617831586e9b9c18b0144ea74664efb 96eb9d9b1b3a4b5157f506ca91db44f1e1a2ce66 && echo fast_forward=true
git log --first-parent --oneline 213850e1b617831586e9b9c18b0144ea74664efb..HEAD
~~~

~~~text
213850e1b617831586e9b9c18b0144ea74664efb
213850e1b617831586e9b9c18b0144ea74664efb
fast_forward=true
96eb9d9 chore(engine): pin llama.rn to 0288dc27 (engine 4ccef2f85)
~~~

## Required fixes

None.

## Final verdict

PUSH-SAFE for the fast-forward push of 96eb9d9 onto app-integration-2026-09-20.

~~~text
git -C /Users/marco/.paseo/worktrees/1vffp1wo/pin-engine push origin 96eb9d9b1b3a4b5157f506ca91db44f1e1a2ce66:app-integration-2026-09-20
~~~

Final line: PUSH-SAFE; no force push is required.
