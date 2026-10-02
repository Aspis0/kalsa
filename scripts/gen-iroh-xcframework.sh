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
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRATE="$ROOT/native/kalsa-iroh-mobile"
OUT="$ROOT/modules/kalsa-iroh/ios/Generated"
CRATE_NAME="kalsa_iroh_mobile"
LIB_NAME="libkalsa_iroh_mobile.a"

for tool in cargo xcodebuild; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "gen-iroh-xcframework: '$tool' not found; the KalsaIroh pod needs a Mac with the Rust toolchain and Xcode" >&2
    exit 1
  }
done

echo "gen-iroh-xcframework: device slice (aarch64-apple-ios)"
(cd "$CRATE" && cargo rustc --release --lib --target aarch64-apple-ios --crate-type staticlib --quiet)
DEVICE_LIB="$CRATE/target/aarch64-apple-ios/release/$LIB_NAME"

echo "gen-iroh-xcframework: simulator slice (aarch64-apple-ios-sim)"
(cd "$CRATE" && cargo rustc --release --lib --target aarch64-apple-ios-sim --crate-type staticlib --quiet)
SIM_LIB="$CRATE/target/aarch64-apple-ios-sim/release/$LIB_NAME"

for lib in "$DEVICE_LIB" "$SIM_LIB"; do
  [ -f "$lib" ] || { echo "gen-iroh-xcframework: $lib was not built" >&2; exit 1; }
done

echo "gen-iroh-xcframework: uniffi Swift bindings"
rm -rf "$OUT"
mkdir -p "$OUT"
(cd "$CRATE" && cargo run --quiet --bin uniffi-bindgen -- generate \
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

echo "gen-iroh-xcframework: done"
