#!/usr/bin/env bash
# sha256<TAB>path for every file under a llama.rn tree that feeds the build.
# Excludes in-place build output, downloaded binaries and their markers, nested
# node_modules, and package.json (compared field-wise, not byte-wise).
set -euo pipefail
ROOT="${1:?usage: manifest.sh <llama.rn dir>}"
cd "$ROOT"
find . -type f \
  -not -path './android/.cxx/*' -not -path './android/build/*' -not -path './ios/build/*' \
  -not -path './android/src/main/jniLibs/*' -not -path './ios/rnllama.xcframework/*' \
  -not -path './node_modules/*' -not -path './.git/*' \
  -not -name '.llama-rn.sha256' -not -name '.DS_Store' -not -path './package.json' \
  -print0 | sort -z | xargs -0 shasum -a 256 | sed -E 's|^([0-9a-f]{64})  \./|\1\t|'
