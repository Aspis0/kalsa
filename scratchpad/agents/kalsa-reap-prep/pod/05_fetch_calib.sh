#!/usr/bin/env bash
# 05_fetch_calib.sh — pull the calibration set from our PRIVATE HF dataset
# repo at the pinned revision. Responsibility: fetch + verify + .ok marker.
# Needs HF_TOKEN (staged by calib/stage_calib.sh on the Mac; see its header).
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
CALIB="$ROOT/calib"
OK="$RUN/05_fetch_calib.ok"
# Written by calib/stage_calib.sh at upload time; carries repo id + revision.
STAGING_JSON="$(dirname "$0")/../calib/staging.json"

if [ -f "$OK" ]; then echo "05_fetch_calib: already verified OK"; exit 0; fi
for f in "$CALIB/kalsa-reap-calib.jsonl" "$CALIB/calib-imatrix.txt"; do
  rm -f "$f"   # partial files from a failed earlier run are not resumable state
done

[ -f "$STAGING_JSON" ] || { echo "05: $STAGING_JSON missing (run stage_calib.sh on the Mac)" >&2; exit 2; }
REPO=$("$ROOT/.venv-kalsa/bin/python" -c "import json;print(json.load(open('$STAGING_JSON'))['repo'])")
REV=$("$ROOT/.venv-kalsa/bin/python" -c "import json;print(json.load(open('$STAGING_JSON'))['revision'])")
WANT_JSONL=$("$ROOT/.venv-kalsa/bin/python" -c "import json;print(json.load(open('$STAGING_JSON'))['sha256_jsonl'])")
WANT_IMAT=$("$ROOT/.venv-kalsa/bin/python" -c "import json;print(json.load(open('$STAGING_JSON'))['sha256_imatrix'])")

[ -n "${HF_TOKEN:-}" ] || { echo "05: HF_TOKEN not provided to this stage" >&2; exit 2; }
mkdir -p "$CALIB"
for f in kalsa-reap-calib.jsonl calib-imatrix.txt; do
  "$ROOT/.venv-kalsa/bin/hf" download "$REPO" "$f" --repo-type dataset \
    --revision "$REV" --local-dir "$CALIB" >/dev/null
done

got_jsonl=$(sha256sum "$CALIB/kalsa-reap-calib.jsonl" | awk '{print $1}')
got_imat=$(sha256sum "$CALIB/calib-imatrix.txt" | awk '{print $1}')
[ "$got_jsonl" = "$WANT_JSONL" ] || { echo "05: jsonl sha mismatch $got_jsonl != $WANT_JSONL" >&2; exit 1; }
[ "$got_imat" = "$WANT_IMAT" ] || { echo "05: imatrix sha mismatch $got_imat != $WANT_IMAT" >&2; exit 1; }
n=$(wc -l < "$CALIB/kalsa-reap-calib.jsonl" | tr -d ' ')
[ "$n" = "1280" ] || { echo "05: expected 1280 rows, got $n" >&2; exit 1; }

touch "$OK"
echo "05_fetch_calib: OK ($REPO @ $REV, 1280 rows)"
