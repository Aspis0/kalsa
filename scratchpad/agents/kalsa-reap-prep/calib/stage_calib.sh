#!/usr/bin/env bash
# stage_calib.sh — Mac side of calibration staging (audit item: scripted,
# PRIVATE path Mac -> pod). Responsibility: verify the destination dataset
# repo exists AND is private, upload jsonl + imatrix text + counts, record
# the revision in staging.json for pod/05_fetch_calib.sh.
#
# The repo is NEVER created here (owner creates it private, once):
#   hf repo create Aspis0/kalsa-reap-calib --repo-type dataset --private
# Usage: stage_calib.sh [repo_id]   (default Aspis0/kalsa-reap-calib)
set -euo pipefail

REPO="${1:-Aspis0/kalsa-reap-calib}"
CALIB_DIR="${CALIB_DIR:-$HOME/kalsa-models/reap-calib}"
LAB="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${VENV:-$CALIB_DIR/.venv/bin/python}"
FILES=(kalsa-reap-calib.jsonl calib-imatrix.txt counts.json)

[ -n "${HF_TOKEN:-}" ] || { echo "stage_calib: HF_TOKEN not in env (export it; never echoed)" >&2; exit 2; }

# 1. privacy gate BEFORE any upload
"$VENV" - "$REPO" <<'EOF'
import json, sys, urllib.request
repo = sys.argv[1]
req = urllib.request.Request(
    f"https://huggingface.co/api/datasets/{repo}",
    headers={"Authorization": f"Bearer {__import__('os').environ['HF_TOKEN']}"})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        info = json.load(r)
except urllib.error.HTTPError as e:
    if e.code == 404:
        sys.exit(f"stage_calib: {repo} does not exist — create it PRIVATE first:\n"
                 f"  hf repo create {repo} --repo-type dataset --private")
    sys.exit(f"stage_calib: repo info HTTP {e.code}")
if not info.get("private", False):
    sys.exit(f"stage_calib: REFUSING — {repo} is public")
print("stage_calib: destination is private:", info["id"])
EOF

# 2. upload (creates a new revision on main)
for f in "${FILES[@]}"; do
  test -f "$CALIB_DIR/$f" || { echo "stage_calib: missing $CALIB_DIR/$f" >&2; exit 1; }
  "$CALIB_DIR/.venv/bin/hf" upload "$REPO" "$CALIB_DIR/$f" "$f" --repo-type dataset >/dev/null
done

# 3. record the pinned revision + hashes the pod stage verifies against
"$VENV" - "$REPO" "$CALIB_DIR" "$LAB" <<'EOF'
import hashlib, json, os, pathlib, sys, urllib.request
repo, cdir, lab = sys.argv[1], pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
req = urllib.request.Request(f"https://huggingface.co/api/datasets/{repo}/revision/main",
                             headers={"Authorization": f"Bearer {os.environ['HF_TOKEN']}"})
with urllib.request.urlopen(req, timeout=30) as r:
    rev = json.load(r)["sha"]
def sha(p):
    return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
jsonl = cdir / "kalsa-reap-calib.jsonl"
staging = {"repo": repo, "revision": rev,
           "sha256_jsonl": sha(jsonl),
           "sha256_imatrix": sha(cdir / "calib-imatrix.txt"),
           "n_rows": sum(1 for _ in open(jsonl))}
(lab / "calib" / "staging.json").write_text(json.dumps(staging, indent=2))
print(json.dumps(staging, indent=2))
EOF
echo "stage_calib: OK — staging.json written; commit it so the pod fetches this exact revision"
