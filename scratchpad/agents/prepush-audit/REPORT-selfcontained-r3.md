# Re-audit r3: self-contained server release

Target: /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-selfcontained,
branch kalsa-selfcontained-release, HEAD
3a4d5143e8eed99999b5aa34185cc420ddc5ffc7.

No push, dispatch, tag operation, or release creation was performed.

## 1. Empty or absent dispatch input — CONFIRMED

The input is required at
.github/workflows/kalsa-server.yml:18-25:

~~~
release_tag:
  description: 'Tag to rebuild and publish (e.g. kalsa-server-v1.0.0)'
  required: true
  type: string
~~~

The resolver reads the environment at lines 81-85 and then fails before
choosing REF/TAG at lines 91-95:

~~~
if [ "$KALSA_EVENT" = workflow_dispatch ] && [ -z "${KALSA_RELEASE_TAG:-}" ]; then
  echo "workflow_dispatch needs a release_tag; name the tag to rebuild, a branch build comes from the push trigger" >&2
  exit 1
fi
~~~

The checkout decision starts only at lines 97-133. No gh command occurs in the
resolver; release lookup is later and the publish step is guarded by
is_release.

The guard was independently transcribed with a shell gh stub:

~~~
$ bash -s <<'EOF'
set +e
gh_calls=0
gh() { gh_calls=$((gh_calls + 1)); }
KALSA_EVENT=workflow_dispatch
KALSA_REF=refs/heads/b11010-merge
if [ "$KALSA_EVENT" = workflow_dispatch ] && [ -z "${KALSA_RELEASE_TAG:-}" ]; then
  echo "workflow_dispatch needs a release_tag; name the tag to rebuild, a branch build comes from the push trigger" >&2
  rc=1
else
  rc=0
fi
printf 'release_tag=%s rc=%s gh_calls=%s\n' "${KALSA_RELEASE_TAG-<ABSENT>}" "$rc" "$gh_calls"
EOF
release_tag=<ABSENT> rc=1 gh_calls=0
workflow_dispatch needs a release_tag; name the tag to rebuild, a branch build comes from the push trigger

$ KALSA_RELEASE_TAG='' bash -s <<'EOF'
set +e
gh_calls=0
gh() { gh_calls=$((gh_calls + 1)); }
KALSA_EVENT=workflow_dispatch
if [ "$KALSA_EVENT" = workflow_dispatch ] && [ -z "${KALSA_RELEASE_TAG:-}" ]; then
  echo "workflow_dispatch needs a release_tag; name the tag to rebuild, a branch build comes from the push trigger" >&2
  rc=1
else
  rc=0
fi
printf "release_tag='%s' rc=%s gh_calls=%s\n" "$KALSA_RELEASE_TAG" "$rc" "$gh_calls"
EOF
workflow_dispatch needs a release_tag; name the tag to rebuild, a branch build comes from the push trigger
release_tag='' rc=1 gh_calls=0
~~~

Both empty and absent dispatch inputs therefore fail loudly before checkout,
gh, or release lookup, with zero stub invocations.

## 2. Branch and tag paths — CONFIRMED

The branch fallback remains at
.github/workflows/kalsa-server.yml:97-105 and sets is_release=0 at 131-132.
The tag path strips refs/tags/ at 100-102, validates it at 107-128, and sets
the tag ref and is_release=1 at 129-130.

Resolver harness output:

~~~
$ run_case push '' refs/heads/b11010-merge branch
resolved ref=refs/heads/b11010-merge tag= is_release=0 trigger=push on a branch gh_calls=0
rc=0 gh_calls=0
$ run_case push '' refs/tags/kalsa-server-v1.0.0 tag
resolved ref=refs/tags/kalsa-server-v1.0.0 tag=kalsa-server-v1.0.0 is_release=1 trigger=push on a tag gh_calls=0
rc=0 gh_calls=0
~~~

The dispatch path is intentionally different: its empty input fails as shown
in item 1 rather than falling through to the branch path.

## 3. Option-injection fix — CONFIRMED

The namespace and suffix predicate remains immediately after TAG is known at
.github/workflows/kalsa-server.yml:107-128. The same predicate is repeated on
the same TAG variable immediately before release lookup/create at 483-504.
Invalid input therefore exits before gh release view at 547.

The exact shell argv for the frozen tag is:

~~~
lookup:
[gh, release, view, --, kalsa-server-v1.0.0]

create:
[gh, release, create, --verify-tag, --title, kalsa-server-v1.0.0,
 --notes-file, release-notes.md, --, kalsa-server-v1.0.0,
 kalsa-server-v1.0.0-bin-macos-arm64.tar.gz,
 kalsa-server-v1.0.0-bin-macos-arm64.tar.gz.sha256]
~~~

These forms are at lines 547 and 559-561. The validated TAG is the
post-terminator target and the title; --verify-tag is on the create command.

## 4. Other regression checks — CONFIRMED

The action scan found only:

~~~
$ rg -n '^\s+uses:' .github/workflows/kalsa-server.yml
144:        uses: actions/checkout@v6
249:        uses: actions/setup-node@v6
~~~

The forbidden-action scan had no matches for --clobber, upload-artifact,
download-artifact, actions/cache, uses: ./, ui-build.yml, gh release upload,
git tag, or git push. Existing-release abort remains at
.github/workflows/kalsa-server.yml:547-550 before create at 559.

The exact frozen URL is:

~~~
https://github.com/Aspis0/kalsallama/releases/download/kalsa-server-v1.0.0/kalsa-server-v1.0.0-bin-macos-arm64.tar.gz
~~~

The double-pack comparison and failure are at lines 327-340. The Mach-O
enumeration and per-file otool/@rpath containment check are at lines 371-409.
Workflow contents: read remains at 36-39 and macos-job contents: write at
50-53. The run-body scan for GitHub/env expressions was empty. The diff scan
found no absolute /Users/marco path or literal credential; the only
token-related match is the expected runtime github.token expression at line
464.

## 5. Scope and fast-forward — CONFIRMED

~~~
$ git rev-list --parents -n1 HEAD
3a4d5143e8eed99999b5aa34185cc420ddc5ffc7 4ccef2f85dbc27e095e11ffcbad4628be9961790
$ git log --first-parent --oneline 4ccef2f85..HEAD
3a4d5143e ci : make the kalsa-server release self-contained
$ git diff --name-only 4ccef2f85..HEAD
.github/workflows/kalsa-server.yml
$ git merge-base --is-ancestor 4ccef2f85 HEAD && echo ancestor=true
ancestor=true
$ git -C /Users/marco/Projects/kalsallama rev-parse origin/b11010-merge
4ccef2f85dbc27e095e11ffcbad4628be9961790
~~~

The parent and origin integration tip are identical, and the UI reusable
workflow is unchanged:

~~~
$ git diff --quiet 4ccef2f85..HEAD -- .github/workflows/ui-build.yml && echo ui-build-diff=unchanged
ui-build-diff=unchanged
~~~

## Required fixes

None.

Exact commands:

~~~
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-selfcontained push origin 3a4d5143e8eed99999b5aa34185cc420ddc5ffc7:b11010-merge
gh workflow run kalsa-server.yml --ref b11010-merge -f release_tag=kalsa-server-v1.0.0
~~~

Final line: PUSH-SAFE for the fast-forward push and the specified dispatch.
