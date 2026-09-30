#!/usr/bin/env bash
# ensure_moep.sh — pinned moep clone on the Mac (shared by 20_surgery.sh).
# Responsibility: clone/refresh $MOEP_DIR at the pinned sha. Prints nothing.
set -euo pipefail

MOEP_DIR="${MOEP_DIR:?MOEP_DIR required}"
PIN="fdc9a3fc025236bfbc48e050e23e46d0562a5956"
if [ ! -d "$MOEP_DIR/.git" ]; then
  git clone --quiet "https://github.com/anik-jha/moep.git" "$MOEP_DIR"
fi
git -C "$MOEP_DIR" fetch --quiet origin || true
git -C "$MOEP_DIR" checkout --quiet --force "$PIN"
test -f "$MOEP_DIR/src/moep/manifest.py" \
  || { echo "ensure_moep: clone incomplete (no src/moep/manifest.py)" >&2; exit 1; }
