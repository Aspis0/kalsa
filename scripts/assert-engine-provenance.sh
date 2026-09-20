#!/usr/bin/env bash
# Prove the installed engine is the fork commit the lockfile names, file for file.
#
# `npm ci` already binds the install to one tarball through the lockfile's integrity
# hash. This gate answers the other half: that the tarball is what Aspis0/llama.rn
# holds at that commit, and that nothing has edited node_modules/llama.rn since.
# It is a manual gate — the old road's assert-vendor-pristine.sh in its new shape.
#
# Exit 0 = identical. 1 = divergent, first differing path printed. 2 = cannot decide.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCKFILE="$REPO_ROOT/package-lock.json"
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
  git+ssh://git@github.com/Aspis0/llama.rn.git#*  | \
  git+https://github.com/Aspis0/llama.rn.git#*    | \
  https://github.com/Aspis0/llama.rn.git#*        ) ;;
  *) fatal "the engine does not come from Aspis0/llama.rn: $resolved" ;;
esac

SHA="${resolved##*#}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || fatal "no 40-hex commit in $resolved"
note "lockfile pins Aspis0/llama.rn@${SHA:0:12}"

curl -fsSL "https://codeload.github.com/Aspis0/llama.rn/tar.gz/$SHA" -o "$WORK/fork.tgz" \
  || fatal "cannot fetch Aspis0/llama.rn@${SHA:0:12} from codeload"
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
  note "OK: $(wc -l < "$WORK/installed.manifest" | tr -d ' ') files match Aspis0/llama.rn@${SHA:0:12}"
  # The app pins the fork, and the fork pins the engine: nothing here declares
  # an expected kalsallama sha, so print the one that is installed.
  note "engine inside it: kalsallama@${engine:0:12}"
  exit 0
fi

FIRST="$(grep -m1 -E '^[+-]\./|^[+-][0-9a-f]{64}' "$WORK/diff" | awk '{print $NF}' || true)"
echo "[provenance] DIVERGENT: the installed engine is not Aspis0/llama.rn@${SHA:0:12}" >&2
echo "[provenance] first differing path: ${FIRST:-<unknown>}" >&2
grep -c -E '^[+-][0-9a-f]{64}' "$WORK/diff" | xargs -I{} echo "[provenance] differing entries: {}" >&2
exit 1
