#!/usr/bin/env bash
# Prove the non-overlaid part of the vendored engine is pristine npm plus the
# committed patch. Overlay-owned cpp/ files are deliberately excluded.
#
# Exit 0 = identical. 1 = divergent. 2 = could not decide.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 2
PACKAGE="llama.rn"
VERSION="0.12.8"
PATCH="$REPO_ROOT/patches/$PACKAGE+$VERSION.patch"
OVERLAY="$REPO_ROOT/scripts/sync-kalsallama.sh"
INSTALLED="$REPO_ROOT/node_modules/$PACKAGE"
LOCKFILE="$REPO_ROOT/package-lock.json"
fatal() { echo "[vendor] FATAL: $1"; exit 2; }
[[ -f "$PATCH" ]] || fatal "missing committed patch $PATCH"
[[ -f "$OVERLAY" ]] || fatal "missing overlay script $OVERLAY"
[[ -d "$INSTALLED" ]] || fatal "$INSTALLED is not installed — nothing to check"
[[ -f "$LOCKFILE" ]] || fatal "missing lockfile $LOCKFILE"
LOCK_INTEGRITY="$(node - "$LOCKFILE" "$PACKAGE" "$VERSION" <<'NODE'
const fs = require("fs");
const lock = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const entry = lock.packages && lock.packages["node_modules/" + process.argv[3]];
if (!entry || entry.version !== process.argv[4] || typeof entry.integrity !== "string") process.exit(1);
process.stdout.write(entry.integrity);
NODE
)" || fatal "cannot read $PACKAGE@$VERSION integrity from $LOCKFILE"
for exclusion in \
  "--exclude 'rn-*'" "--exclude 'jsi/'" "--exclude 'ggml-ext.h'" \
  "--exclude 'anyascii.*'" "--exclude 'VENDOR_SHA'"; do
  grep -Fq -- "$exclusion" "$OVERLAY" || fatal "overlay exclusion is missing: $exclusion"
done
if command -v shasum >/dev/null 2>&1; then HASH_TOOL=shasum
elif command -v sha256sum >/dev/null 2>&1; then HASH_TOOL=sha256sum
else fatal "neither shasum nor sha256sum is available"; fi

TMP="$(mktemp -d)" || exit 2
trap 'rm -rf "$TMP"' EXIT

hash_file() {
  local output
  if [[ "$HASH_TOOL" == shasum ]]; then output="$(shasum -a 256 "$1")" || return 1
  else output="$(sha256sum "$1")" || return 1; fi
  [[ -n "$output" ]] || return 1
  printf '%s\n' "${output%% *}"
}
write_manifest() {
  local root="$1" output="$2" raw="$2.raw" line hash file rel
  if [[ "$HASH_TOOL" == shasum ]]; then
    find "$root" -type f -exec shasum -a 256 {} + > "$raw" || return 1
  else
    find "$root" -type f -exec sha256sum {} + > "$raw" || return 1
  fi
  : > "$output" || return 1
  while IFS= read -r line; do
    hash="${line%% *}"
    file="${line#"$hash"}"
    file="${file#  }"
    rel="${file#"$root"/}"
    printf '%s\t%s\n' "$hash" "$rel" >> "$output" || return 1
  done < "$raw"
  sort -t $'\t' -k2,2 "$output" -o "$output" || return 1
}
echo "[vendor] package $PACKAGE@$VERSION, patch $PATCH"
DIRTY_INPUTS="$(git status --porcelain -- patches/ scripts/sync-kalsallama.sh)" || fatal "cannot inspect working-tree inputs"
if [[ -n "$DIRTY_INPUTS" ]]; then
  DIRTY_INPUTS="${DIRTY_INPUTS//$'\n'/; }"
  echo "[vendor] WARNING: patch/overlay inputs are dirty: $DIRTY_INPUTS"
fi
if ! npm pack "$PACKAGE@$VERSION" --pack-destination "$TMP" >"$TMP/pack.log" 2>&1; then
  echo "[vendor] FATAL: npm pack $PACKAGE@$VERSION failed"
  tail -5 "$TMP/pack.log"
  exit 2
fi
TARBALL="$(find "$TMP" -maxdepth 1 -type f -name '*.tgz' -print -quit)" || fatal "cannot inspect npm pack output"
[[ -n "$TARBALL" ]] || fatal "npm pack produced no tarball"
PACKED_INTEGRITY="$(node - "$TARBALL" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const digest = crypto.createHash("sha512").update(fs.readFileSync(process.argv[2])).digest("base64");
process.stdout.write("sha512-" + digest);
NODE
)" || fatal "cannot hash npm tarball"
if [[ "$PACKED_INTEGRITY" != "$LOCK_INTEGRITY" ]]; then
  echo "[vendor] FATAL: npm tarball integrity does not match $LOCKFILE"
  echo "  lockfile $LOCK_INTEGRITY"
  echo "  tarball   $PACKED_INTEGRITY"
  exit 2
fi
tar -xzf "$TARBALL" -C "$TMP" || fatal "cannot extract $TARBALL"
PRISTINE="$TMP/package"
[[ -d "$PRISTINE" ]] || fatal "npm tarball has no package/ directory"
# Apply the patch only in this scratch project; the live node_modules tree is
# never an input to patch-package and is never written by this check.
PROJECT="$TMP/proj"
mkdir -p "$PROJECT/patches" "$PROJECT/node_modules" || fatal "cannot create scratch project"
printf '%s\n' '{"name":"vp-probe","version":"1.0.0","dependencies":{"llama.rn":"0.12.8"}}' > "$PROJECT/package.json" || exit 2
cp "$PATCH" "$PROJECT/patches/" || fatal "cannot copy committed patch to scratch project"
cp -R "$PRISTINE" "$PROJECT/node_modules/$PACKAGE" || fatal "cannot copy npm package to scratch project"
write_manifest "$PROJECT/node_modules/$PACKAGE" "$TMP/before.manifest" || fatal "cannot hash scratch package before patching"
if ! (cd "$PROJECT" && node "$REPO_ROOT/node_modules/patch-package/index.js" --error-on-fail) >"$TMP/patch.log" 2>&1; then
  echo "[vendor] FATAL: patch-package failed"
  tail -10 "$TMP/patch.log"
  exit 2
fi
write_manifest "$PROJECT/node_modules/$PACKAGE" "$TMP/expected.manifest" || fatal "cannot hash patched scratch package"
cmp -s "$TMP/before.manifest" "$TMP/expected.manifest"
cmp_status=$?
if [[ "$cmp_status" -eq 0 ]]; then fatal "patch-package changed nothing"; fi
[[ "$cmp_status" -eq 1 ]] || fatal "cannot verify that patch-package changed the package"
cut -f2 "$TMP/expected.manifest" > "$TMP/expected.paths" || fatal "cannot list patched scratch package"
find "$INSTALLED" -type f -print > "$TMP/actual.paths.raw" || fatal "cannot list installed package"
: > "$TMP/actual.paths" || fatal "cannot prepare installed file list"
while IFS= read -r actual_file; do
  printf '%s\n' "${actual_file#"$INSTALLED"/}" >> "$TMP/actual.paths" || fatal "cannot list installed package"
done < "$TMP/actual.paths.raw"
sort "$TMP/actual.paths" -o "$TMP/actual.paths" || fatal "cannot sort installed file list"
EXPECTED_COUNT=0
FAILED=0
while IFS=$'\t' read -r expected_hash rel; do
  case "$rel" in
    cpp/*) case "$rel" in cpp/rn-*|cpp/jsi/*|cpp/ggml-ext.h|cpp/anyascii.*) ;; *) continue ;; esac ;;
  esac
  EXPECTED_COUNT=$((EXPECTED_COUNT + 1))
  actual_file="$INSTALLED/$rel"
  if [[ ! -f "$actual_file" ]]; then
    echo "[vendor] MISSING: $rel"
    echo "  expected $expected_hash"
    echo "  actual   <missing>"
    FAILED=1
    continue
  fi
  actual_hash="$(hash_file "$actual_file")" || fatal "cannot hash installed file $rel"
  if [[ "$expected_hash" != "$actual_hash" ]]; then
    echo "[vendor] DIVERGENT: $rel"
    echo "  expected $expected_hash"
    echo "  actual   $actual_hash"
    FAILED=1
  fi
done < "$TMP/expected.manifest"
[[ "$EXPECTED_COUNT" -ge 100 ]] || fatal "implausibly small comparison set ($EXPECTED_COUNT files)"
echo "[vendor] comparing $EXPECTED_COUNT authoritative files"
comm -13 "$TMP/expected.paths" "$TMP/actual.paths" > "$TMP/installed-only.paths" || fatal "cannot identify installed-only files"
# llama.rn postinstall artifacts: prebuilt binaries and their .llama-rn.sha256 markers.
echo "[vendor] NOTE: prebuilt binaries and .llama-rn.sha256 markers under android/src/main/jniLibs/ and ios/rnllama.xcframework/ are outside this check's reach."
WARNING_COUNT=0
WARNING_MORE=0
BUILD_COUNT=0
warn_installed_only() {
  WARNING_COUNT=$((WARNING_COUNT + 1))
  if [[ "$WARNING_COUNT" -le 5 ]]; then
    echo "[vendor] WARNING: installed-only file outside overlay/build dirs: $1"
  else
    WARNING_MORE=$((WARNING_MORE + 1))
  fi
}
while IFS= read -r rel; do
  case "$rel" in
    android/src/main/jniLibs/.llama-rn.sha256|ios/rnllama.xcframework/.llama-rn.sha256|\
    android/src/main/jniLibs/*|ios/rnllama.xcframework/*) continue ;;
    # In-place build output. Counted, not listed: naming thousands of CMake
    # reply files would bury the divergences this check exists to show.
    android/.cxx/*|android/build/*|ios/build/*) BUILD_COUNT=$((BUILD_COUNT + 1)); continue ;;
    cpp/rn-*|cpp/jsi/*|cpp/ggml-ext.h|cpp/anyascii.*)
      echo "[vendor] EXTRA: patch-owned installed-only file: $rel"
      FAILED=1
      continue
      ;;
    cpp/*) continue ;;
    *)
      echo "[vendor] EXTRA: patch-owned installed-only file: $rel"
      FAILED=1
      continue
      ;;
  esac
done < "$TMP/installed-only.paths"
if [[ "$WARNING_MORE" -gt 0 ]]; then
  echo "[vendor] … and $WARNING_MORE more installed-only files"
fi
if [[ "$BUILD_COUNT" -gt 0 ]]; then
  echo "[vendor] NOTE: $BUILD_COUNT local build artifacts under the package — it was built in place"
fi
if [[ "$FAILED" -ne 0 ]]; then
  echo "[vendor] FATAL: installed files differ from patched pristine npm"
  exit 1
fi
echo "[vendor] OK: $INSTALLED matches $PACKAGE@$VERSION plus the committed patch"
exit 0
