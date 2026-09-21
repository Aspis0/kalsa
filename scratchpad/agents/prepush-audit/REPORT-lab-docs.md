# Docs-only pre-push audit

Target: governor-audit-recheck, commits 9e9b25099d5a1989e3a62fdd3dab4f6af28a09dd and
53a65318287e19403fb2f9199fc9e2dbe4999fe1.

## 1. Scope — CONFIRMED

The branch is exactly two commits ahead of origin/governor-audit-recheck:

~~~text
$ git rev-list --count origin/governor-audit-recheck..HEAD
2

$ git log --first-parent --oneline origin/governor-audit-recheck..HEAD
53a65318 docs(alive): fill the known built_at and pack_sha256 in the manifest example
9e9b2509 docs: mark kalsa-server-v1.0.0 live and record the R2 cache and head-object lessons
~~~

The per-commit name/status checks were:

~~~text
$ git show --name-status --oneline 9e9b25099d5a1989e3a62fdd3dab4f6af28a09dd
9e9b2509 docs: mark kalsa-server-v1.0.0 live and record the R2 cache and head-object lessons
M       PLAN.md
M       docs/ALIVE.md

$ git show --name-status --oneline 53a65318287e19403fb2f9199fc9e2dbe4999fe1
53a65318 docs(alive): fill the known built_at and pack_sha256 in the manifest example
M       docs/ALIVE.md
~~~

The combined changed-file list is exactly PLAN.md and docs/ALIVE.md; there is no code,
configuration, executable, or scratchpad path. git diff --check origin/governor-audit-recheck..HEAD
also returned status 0.

## 2. Leaks and language — CONFIRMED

The diff-only secret/path scan was:

~~~text
$ git diff --unified=0 origin/governor-audit-recheck..HEAD -- PLAN.md docs/ALIVE.md |
  rg -n -i '/Users/marco|BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE KEY|github_pat_|ghp_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|R2_SECRET_ACCESS_KEY[[:space:]]*[:=][[:space:]]*[^[:space:]]+|[[:alnum:]._%+-]+@[[:alnum:].-]+\.[A-Za-z]{2,}' || true
(empty)
~~~

The only credential references are names such as R2_ACCESS_KEY_ID,
R2_SECRET_ACCESS_KEY, and R2_ENDPOINT; no value, token, email address, key, or absolute
personal path was added.

The changed prose has no Italian words, accents, or phrases:

~~~text
$ git diff --unified=0 origin/governor-audit-recheck..HEAD -- PLAN.md docs/ALIVE.md |
  rg -n -i '(?:\b(?:perche|perché|della|delle|degli|questa|questo|sono|senza|nella|nelle|anche|oggi|stato|fatto|serve|deve|può)\b|[àèéìòù])' || true
(empty)
~~~

The first lines remain the required archive pointers:

~~~text
$ sed -n '1p' PLAN.md; sed -n '1p' docs/ALIVE.md
> Archived full history: archived/PLAN-2026-09-full.md (3162 lines, Italian, frozen 2026-09-20).
> Archived full history: archived/ALIVE-2026-09-full.md (7773 lines, mixed IT/EN, frozen 2026-09-20).
~~~

The words Italian and mixed IT/EN describe the frozen archive; they are not Italian prose
introduced into the living documents.

## 3. Published facts — CONFIRMED, with two provenance limits

The public manifest, digest, and archive were fetched from the URLs recorded at
docs/ALIVE.md:67-77. The observed results were:

~~~text
manifest.json                         HTTP/2 200, content-length 1097
...tar.gz.sha256                       HTTP/2 200, content-length 109
...tar.gz                              HTTP/2 200, content-length 11203439
archive sha256                         3fe62ebfe7fd9ddd21fa8857f68f2c34bfc8557fb1811b54f89012260c5c88a7
archive size                            11203439 bytes
tar first entry                         kalsa-server-v1.0.0/
~~~

The fetched manifest contains the documented run URL 35549848243, built_at
2026-09-21T01:16:13Z, tag object d30c8d475d5eb47a544304ba592138d066bbc2e3, target
4ccef2f85dbc27e095e11ffcbad4628be9961790, pack/archive digest
3fe62ebfe7fd9ddd21fa8857f68f2c34bfc8557fb1811b54f89012260c5c88a7, size 11203439, and
exe digest 327fb363e5246284a74fe9ee7ed8ea70d121979d65a670caf1d0cdd838e96cde.
The public .sha256 object agrees with the archive. The local tag checks independently agree:

~~~text
$ git -C /Users/marco/Projects/kalsallama rev-parse refs/tags/kalsa-server-v1.0.0
d30c8d475d5eb47a544304ba592138d066bbc2e3
$ git -C /Users/marco/Projects/kalsallama rev-parse refs/tags/kalsa-server-v1.0.0^{}
4ccef2f85dbc27e095e11ffcbad4628be9961790
~~~

The kalsa-server --version value and the executable digest are corroborated by the public
manifest; this audit did not independently run that macOS executable. The anonymous GitHub
Actions URL itself is not independently readable from this repository audit, so the run
identity is a recorded provenance claim corroborated by the public manifest, not an independently
replayed Actions log.

The claim that GitHub-release publishing was removed is supported by the current workflow:

~~~text
$ rg -n -i 'gh release|--clobber|--verify-tag' /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-r2/.github/workflows/kalsa-server.yml
(empty)
~~~

The three traps and the head-object rule are stated at PLAN.md:213-220 and
docs/ALIVE.md:116-124. The implementation comments at
.github/workflows/kalsa-server.yml:697-709 say that listing is advisory, exact-key
head-object is authoritative, and denied head requests abort. The documented public Cloudflare
cache source is linked at PLAN.md:248 and docs/ALIVE.md:130. The observed public headers were
consistent with the narrower claim actually made: the archive was cached, while the manifest and
digest were served dynamically; the document does not claim that every object is uncached.

## 4. Consistency — REFUTED

Two live-document statements are stale or contradictory against the current engine repository
state and must be corrected before these documents are treated as the current reference.

First, PLAN.md:157-158 says the integration branch is currently
635ea0ed25988fb8bf1cc9b3b75d2fbc1a6c1acc plus a pending fix, and the same position is
repeated in PLAN.md:81-83 and docs/ALIVE.md:53-57. The current repository ref is:

~~~text
$ git -C /Users/marco/Projects/kalsallama rev-parse origin/b11010-merge
916b8f0bcfcb829011f129b4dff8acfd01ab7814
$ git -C /Users/marco/Projects/kalsallama show -s --format='%H %P %s' origin/b11010-merge
916b8f0bcfcb829011f129b4dff8acfd01ab7814 f404d9180445772b6c857e0444f1f3fb3de5b19c ci(server): decide the R2 existence check with head-object
~~~

The wording Branch tip at last read in ALIVE is historical, but the matching PLAN wording says
currently; both should be re-pinned or explicitly dated as historical.

Second, docs/ALIVE.md:109-112 says the R2 token “can only write objects”. The live workflow
requires GetObject for its head-object checks:

~~~text
$ nl -ba /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-r2/.github/workflows/kalsa-server.yml | sed -n '697,709p'
  697  # A listing may run below, but it is ADVISORY ONLY...
  707  # head-object needs GetObject permission (s3:GetObject) in addition to
  708  # the put the uploads already use. Without it every check aborts...
~~~

PLAN.md:185 already describes object read, write, and listing, so ALIVE contradicts both the
workflow and the neighboring PLAN inventory. It should say object read/head, write, and listing
on the single bucket, with no repository permission.

The old blocked/GitHub-release wording in PLAN.md:196-208 is historical dead-end context, not
a current delivery claim. The frozen archive also contains historical blocked material by design;
the archive pointer and frozen date make that distinction explicit. Current living prose says the
R2 publish is live at PLAN.md:162-165 and docs/ALIVE.md:61-77, with no current claim that
publishing is blocked or delivered by GitHub Release.

## 5. Required corrections, ordered

1. Re-pin the live integration-branch value in PLAN.md:81-83 and 157-158 and
   docs/ALIVE.md:53-57 to the current ref, or mark the old value unambiguously as a dated
   historical observation.
2. Correct docs/ALIVE.md:109-112 so the token permission statement includes the
   GetObject/HeadObject read permission required by the live gate, plus write/listing, and does
   not imply write-only access.

No code or release artifact correction is required by this docs-only audit. The manifest values,
URLs, archive layout, R2 head-object decision, cache caveat, and removal of the GitHub-release path
are otherwise supported by the repository and the public objects.

Final verdict: NOT PUSH-SAFE until the two live-document corrections above are made. Intended
fast-forward command after correction:

~~~text
git -C /Users/marco/.paseo/worktrees/0dh4675z/gov-audit-recheck push origin 53a65318287e19403fb2f9199fc9e2dbe4999fe1:governor-audit-recheck
~~~

NOT PUSH-SAFE for the two-commit fast-forward as currently written.
