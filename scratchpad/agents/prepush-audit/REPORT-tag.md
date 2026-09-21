# Delta pre-push audit: tag release

Target reviewed read-only:

/Users/marco/.paseo/worktrees/0f85s4e7/kalsa-tag-release, branch
kalsa-tag-release, HEAD 106029533d74bb5baa7fb1051b59ee4111697c73.

## 1. Commit shape and changed path

Verdict: CONFIRMED.

~~~text
Command:
git rev-list --parents -n1 HEAD
git log --first-parent --format='%H %s' b255b9f57..HEAD
git merge-base --is-ancestor b255b9f57 HEAD && echo true
git diff --name-only b255b9f57..HEAD

Output:
106029533d74bb5baa7fb1051b59ee4111697c73 b255b9f5787e2cffd871f2de6b6e83b2f3fe9ccb
106029533d74bb5baa7fb1051b59ee4111697c73 ci : name tag builds after the tag and publish a release
true
.github/workflows/kalsa-server.yml
~~~

The target worktree was clean and no upstream path is in this delta.

## 2. Version derivation

Verdict: REFUTED.

At workflow lines 151-162, the intended tag kalsa-server-v1.0.0 is
classified as a tag and becomes v1.0.0. Lines 163-168 preserve the branch
ref-b<count>-sha shape. Lines 171-187 reject an empty result, characters
outside the allowlist, and results over 96 characters.

~~~text
Command:
  # Inline shell function used for these four cases; its derivation matches lines 146-187.
  run_version() {
    REF="$1"; REF_TYPE="$2"; GREF="$3"; BUILD_NUMBER=1234; SHORT_HASH=abcdef0
    REF_SAFE="$(printf '%s' "$REF" | tr '/' '-')"; IS_TAG=0
    [ "$REF_TYPE" = tag ] && IS_TAG=1
    case "$GREF" in refs/tags/*) IS_TAG=1;; esac
    if [ "$IS_TAG" -eq 1 ]; then VERSION="${REF_SAFE#kalsa-server-}"; else
      case "$REF_SAFE" in master|"b${BUILD_NUMBER}") VERSION="b${BUILD_NUMBER}";; *) VERSION="${REF_SAFE}-b${BUILD_NUMBER}-${SHORT_HASH}";; esac
    fi
    if [ -z "$VERSION" ]; then echo "$REF => REJECT empty"; return; fi
    case "$VERSION" in *[!A-Za-z0-9._-]*) echo "$REF => REJECT allowlist";; *) echo "$REF => $VERSION";; esac
  }
nl -ba .github/workflows/kalsa-server.yml | sed -n '122,190p'

Relevant output:
128        env:
129          KALSA_REF: github.head_ref || github.ref_name
130          KALSA_REF_TYPE: github.ref_type
151          IS_TAG=0
159          if [ "$IS_TAG" -eq 1 ]; then
162            VERSION=strip-one-kalsa-server-prefix
167            VERSION=ref-b<count>-sha
171          if [ -z "$VERSION" ]; then
178          case "$VERSION" in
179            allowlist check
184          if [ length > 96 ]; then
~~~

The no-doubled-prefix property is not enforced. Re-running the same derivation
with fixed build number/hash gives:

~~~text
Command:
run_version kalsa-server-v1.0.0 tag refs/tags/kalsa-server-v1.0.0
run_version b11010-merge branch refs/heads/b11010-merge
run_version kalsa-server- tag refs/tags/kalsa-server-
run_version kalsa-server-kalsa-server-v1.0.0 tag refs/tags/kalsa-server-kalsa-server-v1.0.0

Output:
kalsa-server-v1.0.0 => v1.0.0
b11010-merge => b11010-merge-b1234-abcdef0
kalsa-server- => REJECT empty
kalsa-server-kalsa-server-v1.0.0 => kalsa-server-v1.0.0
~~~

The last result passes the allowlist but produces
kalsa-server-kalsa-server-v1.0.0-bin-macos-arm64.tar.gz at the pack step
(line 195). The tag trigger at lines 21-25 also accepts all kalsa-* tags,
not only kalsa-server-*. The intended tag does produce the required archive
name and line 207 gives the required top directory, but the property is not
enforced over the accepted tag space.

For the intended tag specifically, lines 195 and 207 yield
kalsa-server-v1.0.0-bin-macos-arm64.tar.gz and top directory
kalsa-server-v1.0.0. The release step uses the same tag at lines 328 and
352, so GitHub's release asset URL is the requested
https://github.com/Aspis0/kalsallama/releases/download/kalsa-server-v1.0.0/kalsa-server-v1.0.0-bin-macos-arm64.tar.gz.

## 3. Release is tag-only and asset completeness

Verdict: CONFIRMED for branch exclusion and missing-asset failure.

The release job guard at line 311 requires a refs/tags/kalsa- ref, so a branch
push cannot run it. Workflow-level permissions at lines 27-30 are
contents: read; contents: write is scoped to the release job at lines 309-316.

~~~text
Command:
nl -ba .github/workflows/kalsa-server.yml | sed -n '27,31p;301,355p'

Relevant output:
29  permissions:
30    contents: read
309  release:
311    if: startsWith(github.ref, 'refs/tags/kalsa-')
315    permissions:
316      contents: write
333          for tar in kalsa-server-*-bin-macos-*.tar.gz; do
335            if missing tar: exit 1
339            if missing sibling sha256: exit 1
343            add tar and sibling sha256 to ASSETS
~~~

The macOS upload paths at lines 301-307 contain both the tarball and sibling
.sha256. The release loop aborts before gh is called if either is absent.
The release namespace is still broader than the stated kalsa-server tag
namespace; that is part of the version finding above.

## 4. Injection and immutable-release behavior

Verdict: REFUTED.

The tag/ref enters the version step through env values at lines 128-130 and
the release step through KALSA_TAG at lines 325-331. The release shell copies
that value into TAG with quoted expansion and passes quoted arguments to gh.
The run-body scan found no github/env expression:

~~~text
Command:
awk '/^        run: \|/{inrun=1;next} /^      - name:/{inrun=0} inrun && /\$\{\{.*(github\.|env\.)/{print NR ":" $0}' .github/workflows/kalsa-server.yml

Output:
(empty)
~~~

Diff-wide scans also found no absolute checkout path or credential value:

~~~text
Command:
git diff --unified=0 b255b9f57..HEAD | rg -n '/Users/marco|/Users/' || true
git diff --unified=0 b255b9f57..HEAD | rg -n -i '\b(api[_-]?key|access[_-]?token|bearer|password|secret|private[[:space:]]+key|ghp_|github_pat_|sk-[A-Za-z0-9]+)\b' || true

Output:
(empty)
~~~

The immutable-release behavior is unsafe. At lines 346-354, --verify-tag is
used only when creating a release. If gh release view succeeds, line 350
runs gh release upload with --clobber. A rerun or rebuild can therefore
replace existing assets behind an immutable tag URL, even if the Git tag was
never moved. The owner policy is not enforced by code.

The existing-release path must fail on existing assets, or verify the tag
target and exact existing asset digests before allowing an idempotent no-op.
It must never overwrite bytes behind a pinned tag.

## 5. Two-commit fast-forward chain

Verdict: CONFIRMED for local ancestry.

~~~text
Command:
git -C /Users/marco/Projects/kalsallama rev-parse origin/b11010-merge
git rev-parse 8537d097c
git rev-parse b255b9f57
git rev-parse HEAD
git merge-base --is-ancestor 8537d097c b255b9f57 && git merge-base --is-ancestor b255b9f57 HEAD && echo true

Output:
8537d097c32e7307d82540b6da8eb448d7e07107
8537d097c32e7307d82540b6da8eb448d7e07107
b255b9f5787e2cffd871f2de6b6e83b2f3fe9ccb
106029533d74bb5baa7fb1051b59ee4111697c73
true
~~~

The non-force branch push would be:

~~~text
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-tag-release push origin HEAD:b11010-merge
~~~

After the release fixes, the exact sequence would be:

~~~text
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-tag-release push origin HEAD:b11010-merge
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-tag-release tag -a kalsa-server-v1.0.0 HEAD -m 'Release kalsa-server-v1.0.0'
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-tag-release push origin refs/tags/kalsa-server-v1.0.0
~~~

Neither the tag nor either push was created or executed.

## Required fixes

1. Restrict the release namespace to kalsa-server-* and reject a stripped
   result that still begins with kalsa-server-, while retaining empty,
   allowlist, and length checks.
2. Remove --clobber for immutable release assets, or make the existing-release
   path verify the tag target and existing asset digests and fail on mismatch.
3. Assert the exact expected archive and digest names before publishing, so a
   non-server kalsa-* tag cannot publish an unintended asset.

NOT PUSH-SAFE — do not run the two-commit branch/tag push sequence until fixes 1 and 2 are implemented.
