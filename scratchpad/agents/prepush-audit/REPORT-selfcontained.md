# Pre-push audit: self-contained server release

Target: /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-selfcontained, branch
kalsa-selfcontained-release, 6c3502345acb6b786271f40dfe46cf98b71211e1.

Verdicts use CONFIRMED, REFUTED, or UNVERIFIABLE. This is a read-only static
audit; no push, dispatch, or tag operation was performed.

## 1. Build from the tag ref — CONFIRMED

The target-ref step takes inputs.release_tag through the environment at
.github/workflows/kalsa-server.yml:75-119. For a non-empty input it writes
refs/tags/${TAG} to the checkout output at lines 101-109, and checkout
consumes that output at lines 122-130. The release assertion at lines 132-148
compares git rev-parse HEAD with git rev-parse
"refs/tags/${KALSA_TAG}^{commit}", prints the checked-out commit, ref,
and tag object, and exits nonzero on mismatch.

The provenance step at .github/workflows/kalsa-server.yml:412-450 writes all
required fields: tag object at 429/434, resolved commit at 424/435, checked-out
ref at 415/436, trigger at 416/437, run URL at 421/438, and reproducibility
hash at 419/441. It appends the same provenance.txt to the job summary at
444-449 and to release notes at 509-511.

Evidence that the frozen tag and the commit used as the new branch parent agree:

~~~
$ git rev-parse refs/tags/kalsa-server-v1.0.0^{commit}
4ccef2f85dbc27e095e11ffcbad4628be9961790
$ git rev-parse refs/tags/kalsa-server-v1.0.0
d30c8d475d5eb47a544304ba592138d066bbc2e3
$ git rev-parse HEAD^1
4ccef2f85dbc27e095e11ffcbad4628be9961790
~~~

## 2. Version is derived from the input tag — CONFIRMED for the intended tag; see item 7

At .github/workflows/kalsa-server.yml:150-217, release mode selects KALSA_TAG
at 167-170; the branch ref is used only in the non-release branch. The release
publisher is guarded by is_release == '1' at 452-453, so a branch ref cannot
become the release version or silently publish.

The checks are present at 173-180, 185-194, and 203-214: empty refs, refs over
64 characters, empty/still-kalsa-server- prefixed stripped versions, characters
outside [A-Za-z0-9._-], and versions over 96 characters fail. The normal frozen
input derives v1.0.0; no branch fallback is used on that release path. Branch
derivation remains at 195-201 and is non-empty for a normal GitHub branch ref.

There is, however, no requirement here that a dispatch input itself start with
kalsa-server-. That namespace gap is the option-injection finding in item 7; it
does not affect the stated kalsa-server-v1.0.0 derivation.

## 3. Immutable tag, no clobber, exact URL — CONFIRMED for a valid frozen tag

The only release command is at .github/workflows/kalsa-server.yml:511-513 and
uses --verify-tag; no tag creation, movement, force, deletion, or --clobber
operation is present. The existing-release check at 504-507 exits before the
create/upload command at 511. The asset URL is printed before that check at
496-500.

~~~
$ rg -n -- '--clobber|git tag|git push|gh release upload' .github/workflows/kalsa-server.yml
496:          # the tag is never created, moved or deleted here: --verify-tag only
~~~

The match is a comment, not an operation. The release command itself is:

~~~
$ sed -n '502,513p' .github/workflows/kalsa-server.yml
          if gh release view "$TAG" > /dev/null 2>&1; then
            echo "release ${TAG} already exists; release assets are immutable; aborting" >&2
            exit 1
          fi
          ...
          gh release create "$TAG" --verify-tag --title "$TAG" \
            --notes "$NOTES" \
            "${ASSETS[@]}"
~~~

For the requested frozen tag, the derivation and URL are:

~~~
$ REPO=Aspis0/kalsallama; TAG=kalsa-server-v1.0.0; VERSION=${TAG#kalsa-server-}; ARCH=arm64
$ printf 'https://github.com/%s/releases/download/%s/kalsa-server-%s-bin-macos-%s.tar.gz\n' "$REPO" "$TAG" "$VERSION" "$ARCH"
https://github.com/Aspis0/kalsallama/releases/download/kalsa-server-v1.0.0/kalsa-server-v1.0.0-bin-macos-arm64.tar.gz
~~~

## 4. No UI-build dependence — CONFIRMED

The workflow has exactly these action uses at .github/workflows/kalsa-server.yml:123
and :228:

~~~
$ rg -n '^\s+uses:' .github/workflows/kalsa-server.yml
123:        uses: actions/checkout@v6
228:        uses: actions/setup-node@v6
~~~

There are no uses: ./, artifact upload/download, cache, or ui-build.yml
references. The diff also leaves the reusable workflow untouched:

~~~
$ git diff --name-only 4ccef2f85..HEAD
.github/workflows/kalsa-server.yml
$ git diff --quiet 4ccef2f85..HEAD -- .github/workflows/ui-build.yml && echo ui-build-diff=unchanged
ui-build-diff=unchanged
~~~

The macOS matrix keeps only arm64; the disabled x64 entry and its stated cost
and Intel-Metal reason are documented at lines 62-71.

## 5. Exact bytes and reproducibility — CONFIRMED in workflow logic

.github/workflows/kalsa-server.yml:287-334 packs twice, computes and prints
both SHA-256 values at 313-317, fails on mismatch at 318-321, and obtains
size_bytes from the actual tarball with stat -f%z at 324-326. The sibling
.sha256 is written from the second pack's hash and the same tar path at
328-330. The publish step constructs the exact expected tar and digest names
at 471-483 and rejects missing or unexpected assets at 484-494 before invoking
gh.

This confirms the implementation and its failure ordering. It is not evidence
that a GitHub macOS runner has completed two independent runs; that runtime
claim remains unverified until CI executes it.

## 6. Change scope — CONFIRMED

~~~
$ git rev-parse --abbrev-ref HEAD
kalsa-selfcontained-release
$ git rev-parse HEAD
6c3502345acb6b786271f40dfe46cf98b71211e1
$ git rev-list --parents -n1 HEAD
6c3502345acb6b786271f40dfe46cf98b71211e1 4ccef2f85dbc27e095e11ffcbad4628be9961790
$ git diff --name-only 4ccef2f85..HEAD
.github/workflows/kalsa-server.yml
$ git remote get-url origin
https://github.com/Aspis0/kalsallama.git
~~~

The base is the requested frozen-tag commit and current integration tip:

~~~
$ git -C /Users/marco/Projects/kalsallama rev-parse origin/b11010-merge
4ccef2f85dbc27e095e11ffcbad4628be9961790
~~~

The absolute-path and literal-credential scan produced no path or credential
match. The only token-related diff match is the necessary runtime expression
${{ github.token }} at .github/workflows/kalsa-server.yml:455,
assigned to GH_TOKEN for the publish step; it is not a committed token or
secret value.

## 7. Injection and option handling — REFUTED

Shell interpolation is handled through environment variables: the input enters
at .github/workflows/kalsa-server.yml:81-85, and no ${{ github.* }}
or ${{ env.* }} expression occurs in a run body. The scan was empty:

~~~
$ awk '/^[[:space:]]*run: \|/{inrun=1;next} inrun && /^[[:space:]]*-[[:space:]]+name:/{inrun=0} inrun && /\$\{\{[[:space:]]*(github|env)\./{print NR ":" $0}' .github/workflows/kalsa-server.yml
~~~

$(), backticks, quotes, and .. are either rejected by the version/ref checks or
cannot become shell source because the variables are quoted. The leading-dash
case is not safely handled, however. The workflow accepts a valid Git ref
beginning with -, derives an allowlisted version, and passes the tag as the
first argument to gh release view and gh release create without an option
terminator:

~~~
$ for ref in '-foo' '--help' '..' '$(id)' 'kalsa-server-v1.0.0'; do if git check-ref-format "refs/tags/${ref}" >/dev/null 2>&1; then verdict=VALID; else verdict=INVALID; fi; printf '%s => %s\n' "$ref" "$verdict"; done
-foo => VALID
--help => VALID
.. => INVALID
$(id) => VALID
kalsa-server-v1.0.0 => VALID
$ REF_SAFE=-foo; VERSION="${REF_SAFE#kalsa-server-}"; case "$VERSION" in ''|kalsa-server-*) echo REJECTED_PREFIX;; *) echo PREFIX_CHECK_PASSED;; esac; printf '%s' "$VERSION" | grep -Eq '^[A-Za-z0-9._-]+$' && echo ALLOWLIST_PASSED
PREFIX_CHECK_PASSED
ALLOWLIST_PASSED
~~~

Shell quoting does not stop a CLI parser from treating a leading-dash
argument as an option. With the installed gh, the same shape is parsed as a
flag:

~~~
$ gh release create -foo --verify-tag --help
unknown shorthand flag: 'f' in -foo
~~~

Therefore the input is not rejected before the gh calls, and quoting alone does
not meet the stated option-injection requirement. The comments at
.github/workflows/kalsa-server.yml:29-32 also overstate that tags outside the
kalsa-server-* namespace never become releases: the dispatch input bypasses
that namespace check.

## 8. Permission trade-off — CONFIRMED, with a material blast-radius warning

The workflow-level permission is read-only at
.github/workflows/kalsa-server.yml:36-39; only the macos job grants contents:
write at 50-53. GH_TOKEN is explicitly passed only to the publish step at
452-457.

The trade-off is broad at job scope: checkout, npm ci, UI/build commands,
tests, packaging, verification, server startup, and provenance all run in the
same write-capable job before the publish step. Those are repository-controlled
and dependency-controlled code-execution surfaces, even though this workflow
has no pull-request trigger and the intended refs are owner-controlled. The
permission is not narrowed to the publish step by GitHub's job permission
model. This is the stated design trade-off, not an additional change-scope
finding.

## 9. Dispatch path — CONFIRMED for the intended frozen tag

After the fast-forward, the workflow at b11010-merge is this one because the
only diff from 4ccef2f85 is .github/workflows/kalsa-server.yml. The intended
command is:

~~~
gh workflow run kalsa-server.yml --ref b11010-merge -f release_tag=kalsa-server-v1.0.0
~~~

On that dispatch, github.ref is the branch, but the non-empty input makes the
target step select refs/tags/kalsa-server-v1.0.0; checkout and the assertion
therefore build the frozen tag rather than the branch.

## Required fixes, in order

1. Before any release lookup or creation, require a dispatch/tag value in the
   kalsa-server-* namespace (or at minimum reject a leading -), and keep the
   same validation immediately before the gh calls. Use an option-safe argument
   form supported by the installed gh CLI as defense in depth. This closes
   both the leading-dash option-injection path and the false namespace claim in
   the comments.
2. After that fix, run the workflow once on a macOS runner and retain evidence
   for the two-pack hash comparison, archive contents, size_bytes, health check,
   and exact published URL. No other fix is required by this static audit.

## Final verdict

NOT PUSH-SAFE for the combined fast-forward push and dispatch until required
fix 1 is implemented. The containment push itself is a fast-forward, but the
release path still accepts an attacker-influenced leading-dash tag and passes
it to gh as an option-bearing positional argument.

Exact commands, to run only after the fix and owner approval:

~~~
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-selfcontained push origin 6c3502345acb6b786271f40dfe46cf98b71211e1:b11010-merge
gh workflow run kalsa-server.yml --ref b11010-merge -f release_tag=kalsa-server-v1.0.0
~~~
