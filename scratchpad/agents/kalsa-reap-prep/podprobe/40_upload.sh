#!/usr/bin/env bash
# 40_upload.sh — write the probe's results to our PRIVATE HF dataset repo
# and verify they landed. Responsibility: privacy gate, upload with an
# explicit path-in-repo, remote-tree verification. The token arrives via
# the environment only. Raw outputs (gsm8k/tools JSONs carry per-item
# content) are several MB total — nothing model-sized leaves the pod.
set -euo pipefail
# shellcheck source=env.sh
. "$(dirname "$0")/env.sh"
HF="$ROOT/.venv-probe/bin/hf"

[ -n "${HF_TOKEN:-}" ] || { echo "40: HF_TOKEN not provided" >&2; exit 2; }
export HF_TOKEN

# privacy gate BEFORE any byte leaves the pod
"$PY" - "$HF_RESULTS_REPO" <<'EOF'
import json, os, sys, urllib.request
repo = sys.argv[1]
req = urllib.request.Request(f"https://huggingface.co/api/datasets/{repo}",
                             headers={"Authorization": f"Bearer {os.environ['HF_TOKEN']}"})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        info = json.load(r)
except urllib.error.HTTPError as e:
    if e.code == 404:
        sys.exit(f"40: {repo} does not exist — the owner creates it PRIVATE, once:\n"
                 f"  hf repo create {repo} --repo-type dataset --private")
    sys.exit(f"40: repo info HTTP {e.code} (check HF_TOKEN)")
if not info.get("private", False):
    sys.exit(f"40: REFUSING — {repo} is not private")
print("40: destination is private:", info["id"])
EOF

"$HF" upload "$HF_RESULTS_REPO" "$RESULTS" "results" --repo-type dataset >/dev/null

# verify: every arm dir we ran is on the remote
"$PY" - "$HF_RESULTS_REPO" "$RESULTS" <<'EOF'
import json, os, pathlib, sys, urllib.request
repo, root = sys.argv[1], pathlib.Path(sys.argv[2])
req = urllib.request.Request(
    f"https://huggingface.co/api/datasets/{repo}/tree/main/results",
    headers={"Authorization": f"Bearer {os.environ['HF_TOKEN']}"})
with urllib.request.urlopen(req, timeout=30) as r:
    remote = {i["path"] for i in json.load(r)}
local = {f"results/{d.name}" for d in root.iterdir() if d.is_dir()}
missing = local - remote
assert not missing, f"missing after upload: {sorted(missing)}"
print(f"40: remote tree check ok ({len(local)} arm dirs)")
EOF
echo "40_upload: OK"
