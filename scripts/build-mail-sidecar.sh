#!/bin/sh
# Builds the mail sidecar in release and copies it to the name Tauri bundles beside
# the app. Prints one line, the export the app is compiled with, on stdout; cargo
# reports on stderr.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
target_dir=${CARGO_TARGET_DIR:-$root/target}
triple=$(rustc -vV | sed -n 's/^host: //p')
cargo build --release -p kalsa-mail --manifest-path "$root/Cargo.toml" 1>&2
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
cp "$target_dir/release/kalsa-mail" "$staging/kalsa-mail"
# Tauri ad-hoc signs every bundled executable under its bundled name with the hardened
# runtime, which changes its bytes. The digest is taken over the copy signed the same way.
codesign --force -s - --options runtime "$staging/kalsa-mail" 1>&2
mkdir -p "$root/src-tauri/binaries"
cp "$staging/kalsa-mail" "$root/src-tauri/binaries/kalsa-mail-$triple"
sha=$(shasum -a 256 "$root/src-tauri/binaries/kalsa-mail-$triple" | cut -d' ' -f1)
echo "export KALSA_MAIL_SHA256=$sha"
