#!/usr/bin/env bash
# Prove the installed engine is the fork commit the lockfile names, file for file.
#
# `npm ci` already binds the install to one tarball through the lockfile's integrity
# hash. This gate answers the other half: that the tarball is what Aspis0/kalsa.rn
# holds at that commit, that nothing has edited node_modules/llama.rn since, that
# package.json names the same fork sha, and that the engine inside is the sha
# native/kalsallama.pin declares.
# It is a manual gate — the old road's assert-vendor-pristine.sh in its new shape.
#
# Exit 0 = identical. 1 = divergent, first differing path printed. 2 = cannot decide.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCKFILE="$REPO_ROOT/package-lock.json"
PKGJSON="$REPO_ROOT/package.json"
PIN="$REPO_ROOT/native/kalsallama.pin"
INSTALLED="$REPO_ROOT/node_modules/llama.rn"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/engine-provenance.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

fatal() { echo "[provenance] FATAL: $1" >&2; exit 2; }
note()  { echo "[provenance] $1"; }

if command -v sha256sum >/dev/null 2>&1; then HASH=(sha256sum); else HASH=(shasum -a 256); fi

# Build output written inside the installed copy. Anything else that is
# there and not in the fork is a divergence, and must be reported.
manifest() {
  local root="$1" out="$2" count
  count="$(cd "$root" && find . -type f \
    -not -path './android/.cxx/*' -not -path './android/build/*' \
    -not -path './ios/build/*'    -not -path './node_modules/*' | wc -l)" \
    || fatal "cannot list $root"
  # A handful of files would compare "equal" against an equally broken tree.
  [[ "$count" -ge 100 ]] || fatal "implausibly small comparison set under $root ($count files)"
  (cd "$root" && find . -type f \
    -not -path './android/.cxx/*' -not -path './android/build/*' \
    -not -path './ios/build/*'    -not -path './node_modules/*' \
    -print0 | LC_ALL=C sort -z | xargs -0 "${HASH[@]}") > "$out" \
    || fatal "cannot hash the files under $root"
}

[[ -f "$LOCKFILE"  ]] || fatal "missing $LOCKFILE"
[[ -d "$INSTALLED" ]] || fatal "$INSTALLED is not installed — nothing to check"

resolved="$(node -e '
const lock = require(process.argv[1]);
const entry = lock.packages && lock.packages["node_modules/llama.rn"];
if (!entry || typeof entry.resolved !== "string") process.exit(1);
process.stdout.write(entry.resolved);
' "$LOCKFILE")" || fatal "no resolved URL for node_modules/llama.rn in $LOCKFILE"

case "$resolved" in
  git+ssh://git@github.com/Aspis0/kalsa.rn.git#*  | \
  git+https://github.com/Aspis0/kalsa.rn.git#*    | \
  https://github.com/Aspis0/kalsa.rn.git#*        ) ;;
  # LEGACY-REDIRECT-ALLOWANCE: the fork repo was renamed on GitHub from
  # Aspis0/llama.rn to Aspis0/kalsa.rn (the old URL redirects). A lockfile
  # written before the rename still names the old path, so accept it here
  # rather than failing an old lock. It is the same repository and the same
  # sha, and the tarball is fetched from the canonical name below either way.
  git+ssh://git@github.com/Aspis0/llama.rn.git#*  | \
  git+https://github.com/Aspis0/llama.rn.git#*    | \
  https://github.com/Aspis0/llama.rn.git#*        ) ;;
  *) fatal "the engine does not come from Aspis0/kalsa.rn: $resolved" ;;
esac

SHA="${resolved##*#}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fatal "no 40-hex commit in $resolved"
note "lockfile pins Aspis0/kalsa.rn@${SHA:0:12}"

# package.json must name the same fork sha. Drift between the two files is the
# mechanism of the hand-pinned APK; the lockfile alone cannot see it.
[[ -f "$PKGJSON" ]] || fatal "missing $PKGJSON"
pkg_spec="$(node -e '
const pkg = require(process.argv[1]);
const spec = pkg.dependencies && pkg.dependencies["llama.rn"];
if (typeof spec !== "string") process.exit(1);
process.stdout.write(spec);
' "$PKGJSON")" || fatal "no dependencies[\"llama.rn\"] in $PKGJSON"
PKG_SHA="${pkg_spec##*#}"
[[ "$PKG_SHA" =~ ^[0-9a-f]{40}$ ]] || fatal "package.json does not pin llama.rn to a 40-hex commit: $pkg_spec"
[[ "$PKG_SHA" == "$SHA" ]] \
  || fatal "package.json pins Aspis0/kalsa.rn@$PKG_SHA but package-lock.json pins Aspis0/kalsa.rn@$SHA"

curl -fsSL "https://codeload.github.com/Aspis0/kalsa.rn/tar.gz/$SHA" -o "$WORK/fork.tgz" \
  || fatal "cannot fetch Aspis0/kalsa.rn@${SHA:0:12} from codeload"
mkdir -p "$WORK/fork" "$WORK/packed"
tar -xzf "$WORK/fork.tgz" -C "$WORK/fork" --strip-components=1 || fatal "cannot unpack the fork tarball"

# The fork carries no prepack/postinstall, so `npm pack` only applies the publish
# filter — the same filter that produced what npm installed.
(cd "$WORK/fork" && npm pack --silent --pack-destination "$WORK" >/dev/null) \
  || fatal "npm pack failed in the fetched fork tree"
PACKED_TGZ="$(find "$WORK" -maxdepth 1 -name '*.tgz' -not -name 'fork.tgz' | head -1)"
[[ -n "$PACKED_TGZ" ]] || fatal "npm pack produced no tarball"
tar -xzf "$PACKED_TGZ" -C "$WORK/packed" --strip-components=1 || fatal "cannot unpack the packed tree"

manifest "$WORK/packed" "$WORK/packed.manifest"
manifest "$INSTALLED"   "$WORK/installed.manifest"

if diff -u "$WORK/packed.manifest" "$WORK/installed.manifest" > "$WORK/diff"; then
  # Was cpp/KALSALLAMA_SHA while cpp/ was kalsallama flattened; after the
  # vendor migration the pin is declarative in vendor/VERSIONS.
  engine="$(sed -n 's/^LLAMA_CPP_COMMIT=//p' "$INSTALLED/vendor/VERSIONS" 2>/dev/null | tr -d '[:space:]' || true)"

  # An override note means the file declares a tree it does not hold, so the
  # sha below would be a lie and the comparison pointless.
  override="$(grep -m1 'LOCAL OVERRIDE' "$INSTALLED/vendor/VERSIONS" 2>/dev/null || true)"
  [[ -z "$override" ]] || fatal "vendor/VERSIONS declares a local override: $override"

  # The app records the engine sha it expects: native/kalsallama.pin, one line.
  # Compare before any OK line is printed; an engine sha printed untested is noise.
  [[ -f "$PIN" ]] || fatal "missing engine pin $PIN; vendor/VERSIONS declares ${engine:-<empty>}"
  pinned="$(tr -d '[:space:]' < "$PIN")"
  [[ "$pinned" =~ ^[0-9a-f]{40}$ ]] || fatal "engine pin $PIN is not one 40-hex sha: '$pinned'; vendor/VERSIONS declares ${engine:-<empty>}"
  [[ -n "$engine" && "$engine" =~ ^[0-9a-f]{40}$ ]] \
    || fatal "vendor/VERSIONS declares no usable LLAMA_CPP_COMMIT: '${engine}'; $PIN pins $pinned"
  [[ "$engine" == "$pinned" ]] \
    || fatal "engine mismatch: $PIN pins kalsallama@$pinned but vendor/VERSIONS declares kalsallama@$engine"

  note "OK: $(wc -l < "$WORK/installed.manifest" | tr -d ' ') files match Aspis0/kalsa.rn@${SHA:0:12}"
  note "engine inside it: kalsallama@${engine:0:12} == native/kalsallama.pin"
  exit 0
fi

FIRST="$(grep -m1 -E '^[+-]\./|^[+-][0-9a-f]{64}' "$WORK/diff" | awk '{print $NF}' || true)"
echo "[provenance] DIVERGENT: the installed engine is not Aspis0/kalsa.rn@${SHA:0:12}" >&2
echo "[provenance] first differing path: ${FIRST:-<unknown>}" >&2
grep -c -E '^[+-][0-9a-f]{64}' "$WORK/diff" | xargs -I{} echo "[provenance] differing entries: {}" >&2
exit 1
