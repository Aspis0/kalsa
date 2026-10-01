#!/usr/bin/env bash
# fetch_lid176.sh — download the fastText language-ID model ONCE to
# ~/kalsa-models (run_flores.py needs it for the wrong-language rate).
# lid.176.bin is 131 MB, CC-BY-SA-3.0 (fastText repo) — never committed to
# git; the sha256 below is the pin. Skips itself when the hash already matches.
# Usage: fetch_lid176.sh [target_dir]
set -euo pipefail
DEST="${1:-$HOME/kalsa-models}/lid.176.bin"
URL="https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin"
SHA256="7e69ec5451bc261cc7844e49e4792a85d7f09c06789ec800fc4a44aec362764e"
mkdir -p "$(dirname "$DEST")"
if [ -f "$DEST" ] && [ "$(shasum -a 256 "$DEST" | cut -d' ' -f1)" = "$SHA256" ]; then
  echo "lid.176.bin already present and sha256 matches: $DEST"
  exit 0
fi
echo "downloading $URL -> $DEST"
curl -sL --max-time 570 -o "$DEST" "$URL"
got="$(shasum -a 256 "$DEST" | cut -d' ' -f1)"
[ "$got" = "$SHA256" ] || { echo "sha256 mismatch: got $got want $SHA256" >&2; exit 1; }
echo "lid.176.bin OK ($DEST, sha256 $got)"
