# Living-document re-audit

Target: governor-audit-recheck, HEAD 1c56a86cd56541e72993b47a391315d740111583.
The two commits reviewed in this round are 6f9a0626 and 1c56a86c. The branch is four
commits ahead of origin/governor-audit-recheck because the two previously reviewed docs
commits are also not on that remote ref.

## 1. Stale branch-tip finding — RESOLVED

The engine repository independently reports the same current tip:

~~~text
$ git -C /Users/marco/Projects/kalsallama rev-parse origin/b11010-merge
916b8f0bcfcb829011f129b4dff8acfd01ab7814
$ git -C /Users/marco/Projects/kalsallama show -s --format='%H %P %s' origin/b11010-merge
916b8f0bcfcb829011f129b4dff8acfd01ab7814 f404d9180445772b6c857e0444f1f3fb3de5b19c ci(server): decide the R2 emptiness check to use head-object
~~~

The living-document references are now:

- PLAN.md:82-83 names the current origin/b11010-merge tip as 916b8f0bc.
- PLAN.md:157-159 names the same ref, commit subject, and parent.
- docs/ALIVE.md:53-57 names the same branch tip and release identity.

The stale 635ea0ed value no longer occurs in either living document:

~~~text
$ rg -n '635ea0ed25988fb8bf1cc9b3b75d2fbc1a6c1acc|635ea0ed2' PLAN.md docs/ALIVE.md
(empty)
~~~

## 2. R2 token-scope finding — RESOLVED

docs/ALIVE.md:109-114 now says the token is limited to the single
kalsa-downloads bucket, has object read/head, write, and listing for the advisory check,
and has no repository permission. It also explicitly says at docs/ALIVE.md:113-114 that
the head-object gate needs read/head permission and aborts without it.

PLAN.md:184-186 has the matching inventory entry: the same single-bucket scope,
object read/head plus write, listing for the advisory check, and no repository permission.
Neither wording can reasonably be read as write-only.

The implementation requirement is visible in the workflow comments:

~~~text
$ nl -ba /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-r2/.github/workflows/kalsa-server.yml | sed -n '707,709p'
  707  # head-object needs GetObject permission (s3:GetObject) in addition to
  708  # the put the uploads already use. Without it every check aborts, on
  709  # purpose: a denied head must never be read as an absent key.
~~~

## 3. Recovered S23 record — CONFIRMED

The new file is tracked:

~~~text
$ git ls-files --error-unmatch scratchpad/agents/repack-s23-recovered/RECOVERED.md
scratchpad/agents/repack-s23-recovered/RECOVERED.md
~~~

Its heading and scratchpad/agents/repack-s23-recovered/RECOVERED.md:3-7 explicitly label it
RECOVERED FROM THE RUN RECORD and NOT RE-MEASURED, explain that the original report was
untracked and deleted during worktree archiving, and point to the existing analysis and review
records.

The requested values are present at lines 13-33:

- line 15: ARM A uses kalsa.bench.norepack=1, Qwen loads, MemAvailable falls about 1.31 GiB,
  and no_extra_bufts=1.
- lines 16 and 20-22: ARM B refuses with the exact refusedBy=fit and
  reasonKey=model.tightNow record, falls back to LFM, has about 2.15 GiB lower
  MemAvailable, and no_extra_bufts=0.
- line 26 records the conclusion that the roughly 3 GB anonymous repack copy is the memory hog.
- lines 30-33 preserve every stated limitation: AC power, functional-only scope, no timing,
  different starting MemAvailable, and a different ARM B model, so the footprints are not a
  controlled comparison.

The values also match the already reviewed source records in
analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md and
scratchpad/agents/repack-policy-review/REPORT.md. The new record does not present a new
measurement or a stronger timing/performance claim.

## 4. Scope, leaks, language, and archive pointers — CONFIRMED

The two new commits have only documentation/evidence files:

~~~text
$ git show --name-status --oneline 6f9a0626
6f9a0626 docs: fix the two prepush-audit findings (branch tip, R2 token scope)
M       PLAN.md
M       docs/ALIVE.md

$ git show --name-status --oneline 1c56a86c
1c56a86c scratchpad: track the recovered S23 functional repack figures
A       scratchpad/agents/repack-s23-recovered/RECOVERED.md
~~~

The new-commit diff has no secret values, credential strings, absolute personal paths, or
Italian prose:

~~~text
$ git diff --unified=0 53a65318287e19403fb2f9199fc9e2dbe4999fe1..HEAD -- PLAN.md docs/ALIVE.md scratchpad/agents/repack-s23-recovered/RECOVERED.md | rg -n -i '/Users/marco|BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE KEY|github_pat_|ghp_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|R2_SECRET_ACCESS_KEY[[:space:]]*[:=][[:space:]]*[^[:space:]]+|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[A-Za-z]{2,}' || true
(empty)

$ git diff --unified=0 53a65318287e19403fb2f9199fc9e2dbe4999fe1..HEAD -- PLAN.md docs/ALIVE.md scratchpad/agents/repack-s23-recovered/RECOVERED.md | rg -n -i '(?:\b(?:perche|perché|della|delle|degli|questa|questo|sono|senza|nella|nelle|anche|oggi|stato|fatto|serve|deve|può)\b|[àèéìòù])' || true
(empty)

$ sed -n '1p' PLAN.md; sed -n '1p' docs/ALIVE.md
> Archived full history: archived/PLAN-2026-09-full.md (3162 lines, Italian, frozen 2026-09-20).
> Archived full history: archived/ALIVE-2026-09-full.md (7773 lines, mixed IT/EN, frozen 2026-09-20).
~~~

The archive-language words are English descriptions of frozen historical blobs, not leaked
Italian prose. git diff --check also returned status 0.

## Ancestry and final verdict

The remote ref is an ancestor and the push is fast-forward-only:

~~~text
$ git rev-parse origin/governor-audit-recheck
ab5b1d30c0e2edc1668f6a7a949cb15f89ba1676
$ git rev-list --count origin/governor-audit-recheck..HEAD
4
$ git merge-base --is-ancestor origin/governor-audit-recheck HEAD
ancestor_rc=0
~~~

No required fix remains from the two prior findings. The recovered file is an intentionally
labelled record, not a new device result.

PUSH-SAFE for the fast-forward branch push:

~~~text
git -C /Users/marco/.paseo/worktrees/0dh4675z/gov-audit-recheck push origin 1c56a86cd56541e72993b47a391315d740111583:governor-audit-recheck
~~~

PUSH-SAFE.
