#!/usr/bin/env bash
# Build the KalsaIroh XCFramework into modules/kalsa-iroh/ios/Generated/:
# the native/kalsa-iroh-mobile crate as static libraries (device
# aarch64-apple-ios + simulator aarch64-apple-ios-sim) plus the uniffi
# Swift bindings and the modulemap that exposes the C FFI to them.
#
# Runs on the Mac, from the generated ios/Podfile (injected by
# plugins/withIrohXcframework.js) before pods resolve — the same seam
# scripts/gen-metal-embed.js uses for the Metal embeds. Never on Linux CI:
# the Podfile only exists after an iOS prebuild, which CI never runs.
# Nothing it produces is committed; Generated/ is gitignored (no binaries
# in git). Android never sees this script: the crate's Android .so path
# (cargo-ndk in apk.yml) is untouched, and `cargo rustc --crate-type
# staticlib` here overrides the emit type for this invocation only.
#
# The build is skipped only when a stamp beside the output records the
# exact hash of the crate inputs (Cargo.toml + Cargo.lock + src/**) that
# produced the current framework; any drift — or a missing stamp —
# rebuilds from scratch, so stale output is never silently linked.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE="$ROOT/native/kalsa-iroh-mobile"
OUT="$ROOT/modules/kalsa-iroh/ios/Generated"
CRATE_NAME="kalsa_iroh_mobile"
LIB_NAME="libkalsa_iroh_mobile.a"
TARGETS="aarch64-apple-ios aarch64-apple-ios-sim"

for tool in cargo xcodebuild; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "gen-iroh-xcframework: '$tool' not found; the KalsaIroh pod needs a Mac with the Rust toolchain and Xcode" >&2
    exit 1
  }
done

# Fail before the minutes-long compile when a rustup target is missing.
# Only rustup-managed toolchains can be preflighted; a bare cargo fails
# later with its own missing-target error.
if command -v rustup >/dev/null 2>&1; then
  missing=""
  for target in $TARGETS; do
    rustup target list --installed 2>/dev/null | grep -qx "$target" ||
      missing="$missing $target"
  done
  if [ -n "$missing" ]; then
    echo "gen-iroh-xcframework: Rust Apple target(s) not installed:$missing" >&2
    echo "gen-iroh-xcframework: install with: rustup target add$missing" >&2
    exit 1
  fi
fi

# What the framework is built from, in dependency order for a stable hash.
INPUTS_HASH="$({
  cat "$CRATE/Cargo.toml" "$CRATE/Cargo.lock"
  find "$CRATE/src" -type f -print0 | LC_ALL=C sort -z | xargs -0 cat
} | shasum -a 256 | cut -d' ' -f1)"
STAMP="$OUT/.inputs.sha256"

if [ -f "$STAMP" ] &&
  [ "$(cat "$STAMP")" = "$INPUTS_HASH" ] &&
  [ -f "$OUT/KalsaIroh.xcframework/Info.plist" ]; then
  echo "gen-iroh-xcframework: crate inputs unchanged; reusing $OUT/KalsaIroh.xcframework"
  exit 0
fi

for target in $TARGETS; do
  echo "gen-iroh-xcframework: $target slice"
  (cd "$CRATE" && cargo rustc --release --lib --locked --target "$target" --crate-type staticlib --quiet)
done
DEVICE_LIB="$CRATE/target/aarch64-apple-ios/release/$LIB_NAME"
SIM_LIB="$CRATE/target/aarch64-apple-ios-sim/release/$LIB_NAME"

for lib in "$DEVICE_LIB" "$SIM_LIB"; do
  [ -f "$lib" ] || { echo "gen-iroh-xcframework: $lib was not built" >&2; exit 1; }
done

echo "gen-iroh-xcframework: uniffi Swift bindings"
rm -rf "$OUT"
mkdir -p "$OUT"
(cd "$CRATE" && cargo run --locked --quiet --bin uniffi-bindgen -- generate \
  --library "$DEVICE_LIB" --crate "$CRATE_NAME" --language swift --out-dir "$OUT")

echo "gen-iroh-xcframework: assembling KalsaIroh.xcframework"
# The uniffi header and modulemap ride INSIDE the xcframework: CocoaPods
# copies them to XCFrameworkIntermediates/<pod>/Headers for every consuming
# target, which is how the generated Swift resolves
# `canImport(kalsa_iroh_mobileFFI)`. Keeping them only there avoids a
# module-redefinition clash between two search paths.
rm -rf "$OUT/KalsaIroh.xcframework"
mkdir -p "$OUT/headers"
cp "$OUT/$CRATE_NAME""FFI.h" "$OUT/headers/"
cp "$OUT/$CRATE_NAME""FFI.modulemap" "$OUT/headers/module.modulemap"
xcodebuild -create-xcframework \
  -library "$DEVICE_LIB" -headers "$OUT/headers" \
  -library "$SIM_LIB" -headers "$OUT/headers" \
  -output "$OUT/KalsaIroh.xcframework"

printf '%s\n' "$INPUTS_HASH" > "$STAMP"
echo "gen-iroh-xcframework: done"
