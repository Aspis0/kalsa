#!/usr/bin/env bash
# 40_upload.sh — push the pod's results (~1 MB) to our PRIVATE HF repo and
# verify they landed. Responsibility: privacy gate, upload, remote-tree check,
# .ok only after verification. This is the ONLY artifact path off the pod:
# profile stats, the one keep-set, summaries, stage logs. No GGUF is ever
# produced here — conversion/quantisation run on the Mac (mac/30_convert.sh),
# so the old ~156 GB upload path is gone.
# `--mini` (used by run_all's failure trap) uploads without the stage .ok book
# so a crash can still salvage the stats/keep-set.
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
STAGE="$RUN/upload-staging"
HF_REPO="${POD_HF_UPLOAD_REPO:-Aspis0/kalsa-reap-drafts}"
HF="$ROOT/.venv-kalsa/bin/hf"
OK="$RUN/40_upload.ok"
MINI=0
[ "${1:-}" = "--mini" ] && MINI=1

if [ "$MINI" = "0" ] && [ -f "$OK" ]; then echo "40_upload: already verified OK"; exit 0; fi

# verify privacy FIRST: refuse to upload to anything public or missing.
# The token reaches python via the environment, never argv.
[ -n "${HF_TOKEN:-}" ] || { echo "40: HF_TOKEN not provided to this stage" >&2; exit 2; }
export HF_TOKEN
"$ROOT/.venv-kalsa/bin/python" - "$HF_REPO" <<'EOF'
import json, os, sys, urllib.request
repo = sys.argv[1]
req = urllib.request.Request(
    f"https://huggingface.co/api/models/{repo}",
    headers={"Authorization": f"Bearer {os.environ['HF_TOKEN']}"})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        info = json.load(r)
except urllib.error.HTTPError as e:
    if e.code == 404:
        sys.exit(f"40: destination {repo} does not exist — create it PRIVATE first (we never create repos)")
    sys.exit(f"40: repo info HTTP {e.code} (check HF_TOKEN)")
if not info.get("private", False):
    sys.exit(f"40: REFUSING — {repo} is not private")
print("40: destination is private:", info["id"])
EOF

rm -rf "$STAGE"; mkdir -p "$STAGE"
cp "$RUN/profile.stats.pt" "$STAGE/"                        # ~1 MB, all criteria
cp "$RUN"/keep_reap_*.json "$STAGE/"                        # deterministic re-cut seeds
cp "$RUN"/*.summary.json "$STAGE/" 2>/dev/null || true
cp "$RUN"/*.log "$STAGE/" 2>/dev/null || true

# HF_TOKEN is already this stage's environment; the hf CLI reads it from there
"$HF" upload "$HF_REPO" "$STAGE" --repo-type model

# verify: everything we promised is on the remote
"$ROOT/.venv-kalsa/bin/python" - "$HF_REPO" <<'EOF'
import json, os, sys, urllib.request
repo = sys.argv[1]
req = urllib.request.Request(
    f"https://huggingface.co/api/models/{repo}/tree/main/upload-staging",
    headers={"Authorization": f"Bearer {os.environ['HF_TOKEN']}"})
with urllib.request.urlopen(req, timeout=30) as r:
    files = {i["path"] for i in json.load(r)}
need = {"upload-staging/profile.stats.pt"} \
       | {f"upload-staging/keep_reap_{k}.json" for k in ("0.5",)}
missing = need - files
assert not missing, f"missing after upload: {sorted(missing)}"
print("40: remote tree check ok")
EOF

if [ "$MINI" = "0" ]; then
  touch "$OK"
fi
echo "40_upload: OK (results verified on $HF_REPO)"
