# Pre-push audit: tag release round 2

Target reviewed read-only:

/Users/marco/.paseo/worktrees/0f85s4e7/kalsa-tag-release, branch
kalsa-tag-release, HEAD 4ccef2f85dbc27e095e11ffcbad4628be9961790.

## 1. Namespace and double-prefix rejection

Verdict: CONFIRMED.

The push trigger at .github/workflows/kalsa-server.yml:21-26 now accepts only
kalsa-server-* tags, and the release guard at line 313 matches the same
namespace.

The tag branch at lines 160-169 strips one prefix and rejects an empty result
or a result still beginning with kalsa-server-. The branch path at lines
170-175 is unchanged. The earlier empty-ref rejection at lines 138-145 plus
the branch suffix ensures a branch cannot produce an empty version.

~~~text
Command:
nl -ba .github/workflows/kalsa-server.yml | sed -n '16,31p;123,192p;311,318p'

Relevant output:
21    # KALSA-OWNED: only kalsa-server-* tags name an artifact.
25    tags:
26      - 'kalsa-server-*'
160          if tag; then
163            strip one kalsa-server- prefix
164            case result
165              empty or kalsa-server-* -> exit 1
170          else
172            branch/master version case
313    if: startsWith(github.ref, 'refs/tags/kalsa-server-')
~~~

The required derivation outcomes are:

~~~text
Command:
run_version() {
  REF="$1"; REF_TYPE="$2"; GREF="$3"; BUILD_NUMBER=1234; SHORT_HASH=abcdef0
  REF_SAFE="$(printf '%s' "$REF" | tr '/' '-')"; IS_TAG=0
  [ "$REF_TYPE" = tag ] && IS_TAG=1
  case "$GREF" in refs/tags/*) IS_TAG=1;; esac
  if [ "$IS_TAG" -eq 1 ]; then
    VERSION="${REF_SAFE#kalsa-server-}"
    case "$VERSION" in ""|kalsa-server-*) printf '%s => REJECT\n' "$REF"; return;; esac
  else
    case "$REF_SAFE" in master|"b${BUILD_NUMBER}") VERSION="b${BUILD_NUMBER}";; *) VERSION="${REF_SAFE}-b${BUILD_NUMBER}-${SHORT_HASH}";; esac
  fi
  printf '%s => %s\n' "$REF" "$VERSION"
}
run_version kalsa-server-v1.0.0 tag refs/tags/kalsa-server-v1.0.0
run_version kalsa-server-kalsa-server-v1.0.0 tag refs/tags/kalsa-server-kalsa-server-v1.0.0
run_version kalsa-server- tag refs/tags/kalsa-server-
run_version b11010-merge branch refs/heads/b11010-merge

Output:
kalsa-server-v1.0.0 => v1.0.0
kalsa-server-kalsa-server-v1.0.0 => REJECT
kalsa-server- => REJECT
b11010-merge => b11010-merge-b1234-abcdef0
~~~

The intended tag still yields
kalsa-server-v1.0.0-bin-macos-arm64.tar.gz and top directory
kalsa-server-v1.0.0.

## 2. Immutable release assets and no clobber

Verdict: CONFIRMED.

The whole workflow contains no --clobber and no gh release upload call. If
the release already exists, lines 370-373 print the immutability message and
exit before the only release-mutating gh call at line 375.

~~~text
Command:
rg -n -- '--clobber|gh release (upload|create)' .github/workflows/kalsa-server.yml
nl -ba .github/workflows/kalsa-server.yml | sed -n '360,378p'

Output:
375          gh release create TAG --verify-tag --title TAG ...
370          if gh release view TAG > /dev/null 2>&1; then
371            echo "release TAG already exists; release assets are immutable; aborting"
372            exit 1
373          fi
~~~

There is no overwrite path: an existing release aborts, and a new release is
created only after the expected-asset checks.

## 3. Exact asset set and matrix drift

Verdict: CONFIRMED.

The release job receives the macOS version output and KALSA_ARCHES=arm64 at
lines 327-332. Lines 344-353 construct both expected files for every
configured architecture: the tarball and sibling sha256. Missing expected
files exit before gh. Lines 355-365 reject every present unexpected
kalsa-server tarball or digest. The only release-mutating gh call is at line
375.

~~~text
Command:
nl -ba .github/workflows/kalsa-server.yml | sed -n '303,377p'

Relevant output:
303      - name: Upload artifacts
306          name: kalsa-server-bin-macos-arm64.tar.gz
308            kalsa-server-<version>-bin-macos-arm64.tar.gz
309            kalsa-server-<version>-bin-macos-arm64.tar.gz.sha256
331          KALSA_VERSION: macOS version output
332          KALSA_ARCHES: arm64
347              expected name = kalsa-server-<version>-bin-macos-<arch>.tar.gz plus suffix
348              missing expected file -> exit 1
355          for found in kalsa-server-*.tar.gz kalsa-server-*.tar.gz.sha256
360                unexpected asset -> exit 1
375          gh release create ...
~~~

This fails closed in both drift directions. If the matrix adds x64 while
KALSA_ARCHES remains arm64, the x64 file is found as unexpected. If
KALSA_ARCHES adds x64 while the matrix does not upload it, the expected x64
file is missing. The arch list cannot silently produce an incomplete or extra
release.

The exact expected-set loop was also exercised with temporary files in both
matrix-drift directions:

~~~text
Command:
# run the lines 344-365 loop with an extra x64 file while KALSA_ARCHES=arm64,
# then with KALSA_ARCHES='arm64 x64' while only arm64 files exist

Output:
unexpected kalsa-server-v1.0.0-bin-macos-x64.tar.gz
matrix-extra-x64 rc=1
missing kalsa-server-v1.0.0-bin-macos-x64.tar.gz
list-extra-x64 rc=1
~~~

## 4. Injection, permissions, and diff hygiene

Verdict: CONFIRMED.

The ref, tag, version, and architecture values enter through env entries at
lines 129-131 and 328-332. No github.* or env.* expression occurs inside a
run body:

~~~text
Command:
awk '/^        run: \|/{inrun=1;next} /^      - name:/{inrun=0} inrun && /\$\{\{.*(github\.|env\.)/{print NR ":" $0}' .github/workflows/kalsa-server.yml
awk '/^        run: \|/{inrun=1;next} /^      - name:/{inrun=0} inrun && /\$\{\{.*(github\.|env\.)/{n++} END{print n+0}' .github/workflows/kalsa-server.yml

Output:
(empty)
run-body-expression-count=0
~~~

Workflow permissions remain contents: read globally at lines 28-31 and
contents: write only on the release job at lines 311-318.

~~~text
Command:
git diff --unified=0 b255b9f57..HEAD | rg -n '/Users/marco|/Users/' || true
git diff --unified=0 b255b9f57..HEAD | rg -n -i '\b(api[_-]?key|access[_-]?token|bearer|password|secret|private[[:space:]]+key|ghp_|github_pat_|sk-[A-Za-z0-9]+)\b' || true

Output:
(empty)
~~~

No new injection, absolute path, secret, or permission-widening regression was
found.

## 5. Two-commit push and tag sequence

Verdict: CONFIRMED for local ancestry and sequencing.

~~~text
Command:
git -C /Users/marco/Projects/kalsallama rev-parse origin/b11010-merge
git rev-parse 8537d097c
git rev-parse b255b9f57
git rev-parse HEAD
git merge-base --is-ancestor 8537d097c b255b9f57 && git merge-base --is-ancestor b255b9f57 HEAD && echo ancestry-ok

Output:
8537d097c32e7307d82540b6da8eb448d7e07107
8537d097c32e7307d82540b6da8eb448d7e07107
b255b9f5787e2cffd871f2de6b6e83b2f3fe9ccb
4ccef2f85dbc27e095e11ffcbad4628be9961790
ancestry-ok
~~~

The withheld sequence is:

~~~text
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-tag-release push origin HEAD:b11010-merge
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-tag-release tag -a kalsa-server-v1.0.0 HEAD -m 'Release kalsa-server-v1.0.0'
git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-tag-release push origin refs/tags/kalsa-server-v1.0.0
~~~

No command was executed and no tag was created.

## Required fixes

None.

PUSH-SAFE — commands: git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-tag-release push origin HEAD:b11010-merge; git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-tag-release tag -a kalsa-server-v1.0.0 HEAD -m 'Release kalsa-server-v1.0.0'; git -C /Users/marco/.paseo/worktrees/0f85s4e7/kalsa-tag-release push origin refs/tags/kalsa-server-v1.0.0
