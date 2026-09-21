# Pre-push audit: first integration commit

Target reviewed read-only:

/Users/marco/.paseo/worktrees/0f85s4e7/kalsa-merge, branch
kalsa-merge-2026-09-20, commit b255b9f5787e.

## 1. Merge ancestry

Verdict: CONFIRMED.

The merge has exactly three parents, with 8537d097c first and the reviewed
server-CI and checkpoint+salt tips as the other parents. The first-parent
range contains exactly one line.

~~~text
Command:
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-merge rev-list --parents -n1 b255b9f57
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-merge log --first-parent --format='%H %s' 8537d097c..b255b9f57

Output:
b255b9f5787e2cffd871f2de6b6e83b2f3fe9ccb 8537d097c32e7307d82540b6da8eb448d7e07107 c8dff98b0ec34374efc5eae485f6d709fdf3b099 67c0be86b941dea06a79d54dfb53f4d41ea9db6c
b255b9f5787e2cffd871f2de6b6e83b2f3fe9ccb merge(engine): server build workflow + context checkpoint persistence and cache_salt
~~~

## 2. Changed paths and upstream containment

Verdict: CONFIRMED.

The diff contains exactly the six requested paths, and release.yml is
unchanged.

~~~text
Command:
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-merge diff --name-only 8537d097c..b255b9f57
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-merge diff --quiet 8537d097c..b255b9f57 -- .github/workflows/release.yml && echo 'release.yml unchanged'

Output:
.github/workflows/kalsa-server.yml
tools/server/server-context.cpp
tools/server/server-task.cpp
tools/server/server-task.h
tools/server/tests/unit/test_cache_salt.py
tools/server/tests/unit/test_slot_save.py
release.yml unchanged
~~~

## 3. Reviewed-tip blob identity

Verdict: CONFIRMED.

Every merged blob ID equals the corresponding reviewed-tip blob ID. The
workflow was compared with c8dff98b0; all five tools/server files were compared
with 67c0be86b.

~~~text
Command:
for p in .github/workflows/kalsa-server.yml tools/server/server-context.cpp tools/server/server-task.cpp tools/server/server-task.h tools/server/tests/unit/test_cache_salt.py tools/server/tests/unit/test_slot_save.py; do
  case "$p" in .github/*) ref=c8dff98b0;; *) ref=67c0be86b;; esac
  printf '%s\n' "$p"
  printf 'b255b9f57='; git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-merge rev-parse "b255b9f57:$p"
  printf '%s=' "$ref"; git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-merge rev-parse "$ref:$p"
done

Output:
.github/workflows/kalsa-server.yml
b255b9f57=76c4064ed2ed7249eaeb860fb87d78c917e23cc1
c8dff98b0=76c4064ed2ed7249eaeb860fb87d78c917e23cc1
tools/server/server-context.cpp
b255b9f57=408febda0e4a3e548da2ec59029a3635ce5386e5
67c0be86b=408febda0e4a3e548da2ec59029a3635ce5386e5
tools/server/server-task.cpp
b255b9f57=989c0c1387c85204d8f8e0e2b59ec852af16df75
67c0be86b=989c0c1387c85204d8f8e0e2b59ec852af16df75
tools/server/server-task.h
b255b9f57=fe592629466d10d66ff6137a9b868a66aaff0e71
67c0be86b=fe592629466d10d66ff6137a9b868a66aaff0e71
tools/server/tests/unit/test_cache_salt.py
b255b9f57=6678b35a334297c5a90285da36dec5b19e3dcc21
67c0be86b=6678b35a334297c5a90285da36dec5b19e3dcc21
tools/server/tests/unit/test_slot_save.py
b255b9f57=4fa5b8423672ea4e605504622ce012fefc1e74f0
67c0be86b=4fa5b8423672ea4e605504622ce012fefc1e74f0
~~~

No mismatch was found.

## 4. Remote base and fast-forward status

Verdict: REFUTED for the requested fast-forward condition.

The specified project checkout no longer has 8537d097c at
origin/b11010-merge. It now has the already-audited child 4ccef2f.

~~~text
Command:
git -C /Users/marco/Projects/kalsallama rev-parse origin/b11010-merge
git -C /Users/marco/Projects/kalsallama merge-base --is-ancestor 4ccef2f85dbc27e095e11ffcbad4628be9961790 b255b9f57 && echo remote-is-ancestor-of-b255=true || echo remote-is-ancestor-of-b255=false
git -C /Users/marco/Projects/kalsallama merge-base --is-ancestor b255b9f57 origin/b11010-merge && echo b255-is-ancestor-of-remote=true || echo b255-is-ancestor-of-remote=false

Output:
4ccef2f85dbc27e095e11ffcbad4628be9961790
remote-is-ancestor-of-b255=false
b255-is-ancestor-of-remote=true
~~~

Therefore b255b9f57 alone is behind the current remote-tracking branch. A
normal push of b255b9f57 to b11010-merge would be rejected as non-fast-forward;
force-pushing it would attempt to move the branch backwards and is unsafe.

## 5. Diff path and credential hygiene

Verdict: CONFIRMED.

The absolute-path scan is empty. The credential-pattern scan has one benign
comment hit containing the word secret; it is a namespace-selector comment,
not a credential, token, or secret value.

~~~text
Command:
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-merge diff --unified=0 8537d097c..b255b9f57 | rg -n '/Users/marco|/Users/' || echo '(none)'
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-merge diff --unified=0 8537d097c..b255b9f57 | rg -n -i '\b(api[_-]?key|access[_-]?token|bearer|password|secret|private[[:space:]]+key|ghp_|github_pat_|sk-[A-Za-z0-9]+)\b' || true

Output:
(none)
557:+// It is a NAMESPACE SELECTOR, NOT AUTHENTICATION: a known salt is not a secret, and any
~~~

The target worktree was clean.

## 6. Vendor-export boundary

Verdict: CONFIRMED.

The fork vendor manifest contains no tools/server, server-context,
server-task, or server/tests path. The server integration files therefore do
not enter the phone fork through this export; the phone-side change remains
pin-only.

~~~text
Command:
rg -n 'tools/server|server-context|server-task|server/tests' /Users/marco/Projects/llama.rn-kalsa/scripts/sync-vendor.sh || echo '(none)'

Output:
(none)
~~~

The explicit llama.cpp export manifest begins at
/Users/marco/Projects/llama.rn-kalsa/scripts/sync-vendor.sh:34 and lists
selected paths through line 153; it has no broad tools path covering the
server subtree.

## Required fixes

1. Do not push b255b9f57 alone to b11010-merge while the remote-tracking branch
   is at 4ccef2f. Reconcile the intended push target with the already-pushed
   child commit. Do not force-push backwards.

NOT PUSH-SAFE — do not run git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-merge push origin HEAD:b11010-merge; the current remote-tracking branch is already 4ccef2f.
