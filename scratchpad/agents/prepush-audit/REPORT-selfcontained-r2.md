# Re-audit: self-contained server release

Target: /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-selfcontained,
branch kalsa-selfcontained-release, HEAD
f13543cd8c7abb67c85344696b6318eca25e47b5.

No push, dispatch, tag operation, or release creation was performed.

## 1. Early input validation — NOT RESOLVED under the stated criterion

The new non-empty validation is at
.github/workflows/kalsa-server.yml:101-122. It is before checkout and before
any later release lookup. The prefix and suffix cases are equivalent to the
requested ^kalsa-server-[A-Za-z0-9._-]+$ predicate, with Git's ref check as an
additional guard. Invalid values are printed inside single quotes at lines
107, 113, and 120.

The problem is the empty value. The input is only assigned to TAG when it is
non-empty at lines 91-93. An empty value skips the validation entirely,
selects IS_RELEASE=0 at lines 125-126, and proceeds as a branch build. That
is consistent with the older comment at lines 20-23, but it is not a
rejection of an empty release_tag as required by this re-audit.

Independent harness: the validation cases were transcribed from lines
101-122, with a shell gh stub that increments gh_calls. The publish predicate
from lines 482-498 then calls the stub only for a valid release:

~~~
$ bash -s <<'EOF'
set +e
gh_calls=0
gh() { gh_calls=$((gh_calls + 1)); printf 'STUB_GH argv:'; printf ' <%s>' "$@"; printf '\n'; }
validate_target() {
  local input=$1 TAG="" REF="refs/heads/b11010-merge" IS_RELEASE=0
  if [ -n "${input:-}" ]; then TAG="$input"; fi
  if [ -n "$TAG" ]; then
    case "$TAG" in
      kalsa-server-*) ;;
      *) printf "'%s' is not a kalsa-server- tag; a release tag must match ^kalsa-server-[A-Za-z0-9._-]+$\n" "$TAG"; return 1 ;;
    esac
    case "${TAG#kalsa-server-}" in
      ""|*[!A-Za-z0-9._-]*) printf "'%s' holds characters outside [A-Za-z0-9._-] after the kalsa-server- prefix\n" "$TAG"; return 1 ;;
    esac
    if ! git check-ref-format "refs/tags/$TAG" >/dev/null 2>&1; then printf "'%s' is not a valid tag name\n" "$TAG"; return 1; fi
    REF="refs/tags/$TAG"; IS_RELEASE=1
  else
    printf '%s\n' 'EMPTY_PATH=branch_fallback'
  fi
  if [ "$IS_RELEASE" -eq 1 ]; then gh release view -- "$TAG"; fi
}
for input in '--help' '-foo' '..' '$(id)' '' 'kalsa-server-' \
  'kalsa-server-v1.0.0;rm -rf /' 'kalsa-server-v1.0.0'; do
  gh_calls=0
  printf '%s\n' "--- input=$(printf '%q' "$input") ---"
  validate_target "$input"
  rc=$?
  printf 'rc=%s gh_calls=%s\n' "$rc" "$gh_calls"
done
EOF
--- input=--help ---
'--help' is not a kalsa-server- tag; a release tag must match ^kalsa-server-[A-Za-z0-9._-]+$
rc=1 gh_calls=0
--- input=-foo ---
'-foo' is not a kalsa-server- tag; a release tag must match ^kalsa-server-[A-Za-z0-9._-]+$
rc=1 gh_calls=0
--- input=.. ---
'..' is not a kalsa-server- tag; a release tag must match ^kalsa-server-[A-Za-z0-9._-]+$
rc=1 gh_calls=0
--- input=\$\(id\) ---
'$(id)' is not a kalsa-server- tag; a release tag must match ^kalsa-server-[A-Za-z0-9._-]+$
rc=1 gh_calls=0
--- input='' ---
EMPTY_PATH=branch_fallback
rc=0 gh_calls=0
--- input=kalsa-server- ---
'kalsa-server-' holds characters outside [A-Za-z0-9._-] after the kalsa-server- prefix
rc=1 gh_calls=0
--- input=kalsa-server-v1.0.0\;rm\ -rf\ / ---
'kalsa-server-v1.0.0;rm -rf /' holds characters outside [A-Za-z0-9._-] after the kalsa-server- prefix
rc=1 gh_calls=0
--- input=kalsa-server-v1.0.0 ---
STUB_GH argv: <release> <view> <--> <kalsa-server-v1.0.0>
rc=0 gh_calls=1
EOF
~~~

Thus every non-empty hostile value is rejected with zero gh calls. The empty
case has zero gh calls but is not rejected; it can continue to later build
steps and write build outputs. This is the only remaining issue found in the
required fix.

## 2. Re-check beside gh — CONFIRMED for release-mode inputs

The same variable is copied into TAG at
.github/workflows/kalsa-server.yml:475-478, then the predicate is repeated
immediately at lines 480-498 before git rev-parse at 504 or either gh call.
The second check rejects an empty suffix and any non-allowlisted suffix.
Nothing other than this checked TAG is passed as the release target.

For the frozen input, the shell-level argv is:

~~~
lookup:
<gh> <release> <view> <--> <kalsa-server-v1.0.0>
create:
<gh> <release> <create> <--> <verify-tag> <title> <kalsa-server-v1.0.0> <notes-file> <release-notes.md> <--> <kalsa-server-v1.0.0> <kalsa-server-v1.0.0-bin-macos-arm64.tar.gz> <kalsa-server-v1.0.0-bin-macos-arm64.tar.gz.sha256>
~~~

The create command at lines 553-555 places --verify-tag before the option
terminator and the same validated tag after it. The title is also the same
TAG. Therefore verification and the release target refer to the same tag.

## 3. Option terminators — CONFIRMED

The lookup is gh release view -- TAG at
.github/workflows/kalsa-server.yml:541. The create is
gh release create --verify-tag --title TAG --notes-file NOTES_FILE -- TAG
ASSETS at lines 553-555. The tag is positional after -- in both cases.

Help-only inspection of the installed CLI showed the normal positional-tag
forms and did not reject the workflow's syntax:

~~~
$ gh release view --help | sed -n '1,12p'
View information about a GitHub Release.
...
USAGE
  gh release view [<tag>] [flags]
$ gh release create --help | sed -n '1,12p'
Create a new GitHub Release for a repository.
...
Use --verify-tag to abort the release if the tag doesn't already exist.
~~~

No live gh release view or gh release create was run during this read-only
audit, so no external parser/network side effect was attempted. The exact argv
above is what the shell constructs; there is no remaining leading-dash option
path for a tag that passes the namespace predicate.

## 4. Rejection before release lookup — CONFIRMED for hostile non-empty inputs; NOT RESOLVED for empty input

For non-empty invalid input, lines 101-122 exit before checkout and before the
publish job step, so gh release view at 541 cannot run. The stub output in
item 1 records zero gh calls for every such value.

For an empty dispatch input, the workflow intentionally takes the branch path
at 91-99 and 125-126. It still avoids gh, but it is not an error and can
continue through UI/build/packaging steps. Under the user's explicit
requirement that empty be rejected, this remains a required fix or a
specification conflict that must be resolved explicitly.

## 5. Residual dash-leading version — CONFIRMED

release_tag=kalsa-server---help passes the tag predicate because its suffix
--help contains only allowed characters. It derives VERSION --help at
.github/workflows/kalsa-server.yml:200-206:

~~~
$ TAG=kalsa-server---help
$ VERSION=--help
$ printf 'TAG=%s VERSION=%s\n' "$TAG" "$VERSION"
TAG=kalsa-server---help VERSION=--help
~~~

The version uses are at lines 203-232, 305-321, 353-360, 433-456, and 473-512.
It is used in case patterns/messages/output, passed to later steps only
through KALSA_VERSION environment values, and prefixed with kalsa-server-
when forming TAR, BIN, and expected asset paths. It never becomes a bare
positional argument. In particular, the tar transform argument at 321 and all
filenames at 309, 357, 360, and 512 begin with the literal kalsa-server-; the
release gh target is TAG, not VERSION.

No concrete bare-positional counterexample exists in the current file.

## 6. Regression checks — CONFIRMED

Scope and ancestry:

~~~
$ git rev-list --parents -n1 HEAD
f13543cd8c7abb67c85344696b6318eca25e47b5 4ccef2f85dbc27e095e11ffcbad4628be9961790
$ git diff --name-only 4ccef2f85..HEAD
.github/workflows/kalsa-server.yml
$ git -C /Users/marco/Projects/kalsallama rev-parse origin/b11010-merge
4ccef2f85dbc27e095e11ffcbad4628be9961790
~~~

The workflow still has only checkout@v6 and setup-node@v6 at lines 138 and
243. No artifact/cache action, ui-build.yml reference, or --clobber occurs.
The existing-release abort remains at 541-544 before create at 553, and
--verify-tag remains at 553.

The exact frozen URL still derives as:

~~~
https://github.com/Aspis0/kalsallama/releases/download/kalsa-server-v1.0.0/kalsa-server-v1.0.0-bin-macos-arm64.tar.gz
~~~

The double-pack hash comparison and fail-on-mismatch remain at
.github/workflows/kalsa-server.yml:325-337. The Mach-O scan and @rpath
dependency containment remain at 365-409. The workflow still uses contents:
read globally at 38-39 and contents: write only on macos at 50-53. The
run-body scan for github/env expressions was empty, and the absolute-path and
credential scan found no path or literal credential; its only token-related
match is the expected runtime expression at line 470.

The UI reusable workflow is unchanged:

~~~
$ git diff --quiet 4ccef2f85..HEAD -- .github/workflows/ui-build.yml && echo ui-build-diff=unchanged
ui-build-diff=unchanged
~~~

## Required fixes

1. Resolve the empty-input contract. Under the acceptance criterion as written,
   make an empty release_tag fail the release-tag validator with a quoted value
   and nonzero status before any build or gh activity. If empty is intentionally
   the branch-build sentinel, explicitly amend the criterion and document that
   empty is not a release request; do not call it a rejection. A separate
   explicit release-mode signal is needed if both behaviors must coexist.

No option-injection fix remains outstanding for non-empty inputs.

## Final verdict

NOT PUSH-SAFE under the stated acceptance criteria because empty release_tag is
still accepted as a successful branch fallback rather than rejected. If the
owner explicitly confirms that empty means branch build and is exempt from the
release-tag rejection rule, the option-injection fix and all listed regression
checks are otherwise confirmed.

Exact commands, conditional on resolving that contract:

~~~
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-selfcontained push origin f13543cd8c7abb67c85344696b6318eca25e47b5:b11010-merge
gh workflow run kalsa-server.yml --ref b11010-merge -f release_tag=kalsa-server-v1.0.0
~~~

Final line: NOT PUSH-SAFE for the two-step push and dispatch under the stated acceptance criteria.
