#!/usr/bin/env bash
# 50_upload.sh — collect artifacts for pull. Responsibility: verify the
# destination is PRIVATE before any byte leaves the pod, then upload.
# Proposal (owner creates, we never create): private HF repo
# Aspis0/kalsa-reap-drafts (model repo; stats/keeps/GGUFs all fit) —
# runpodctl send is the fallback pull path.
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
OUT="$ROOT/gguf"
STAGE="$RUN/upload-staging"
HF_REPO="${POD_HF_UPLOAD_REPO:-Aspis0/kalsa-reap-drafts}"
PY="$ROOT/.venv-kalsa/bin/python"
OK="$RUN/50_upload.ok"

if [ -f "$OK" ]; then echo "50_upload: already verified OK"; exit 0; fi

# verify privacy FIRST: refuse to upload to anything public or missing
[ -n "${HF_TOKEN:-}" ] || { echo "50: HF_TOKEN not provided to this stage" >&2; exit 2; }
"$PY" - "$HF_REPO" "${HF_TOKEN}" <<'EOF'
import json, sys, urllib.request
repo, tok = sys.argv[1], sys.argv[2]
req = urllib.request.Request(
    f"https://huggingface.co/api/models/{repo}",
    headers={"Authorization": f"Bearer {tok}"})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        info = json.load(r)
except urllib.error.HTTPError as e:
    if e.code == 404:
        sys.exit(f"50: destination {repo} does not exist — create it PRIVATE first (we never create repos)")
    sys.exit(f"50: repo info HTTP {e.code} (check HF_TOKEN)")
if not info.get("private", False):
    sys.exit(f"50: REFUSING — {repo} is not private")
print("50: destination is private:", info["id"])
EOF

# This stage ALWAYS uploads after the privacy check — run_all terminates the
# pod on completion, and skipped upload would mean destroyed artifacts. For a
# debug session where the coordinator pulls files by hand, the coordinator
# sets POD_KEEP_ALIVE=1 in run_all (not here) before running.
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp "$RUN/profile.stats.pt" "$STAGE/"                        # ~1 MB, all criteria
cp "$RUN"/keep_reap_*.json "$STAGE/"                        # deterministic re-cut seeds
cp "$RUN"/*.summary.json "$STAGE/" 2>/dev/null || true
cp "$OUT"/*.log "$STAGE/" 2>/dev/null || true

HF="$ROOT/.venv-kalsa/bin/hf"
"$HF" upload "$HF_REPO" "$STAGE" --repo-type model
"$HF" upload "$HF_REPO" "$OUT"/kalsa-reap*-q4_0.gguf --repo-type model
"$HF" upload "$HF_REPO" "$OUT"/kalsa-reap*-q4_k_m.gguf --repo-type model
"$HF" upload "$HF_REPO" "$OUT"/kalsa-reap*-q8_0.gguf --repo-type model

# verify: every artifact we promised is on the remote
"$PY" - "$HF_REPO" "${HF_TOKEN}" <<'EOF'
import json, sys, urllib.request
repo, tok = sys.argv[1], sys.argv[2]
req = urllib.request.Request(
    f"https://huggingface.co/api/models/{repo}/tree/main/upload-staging",
    headers={"Authorization": f"Bearer {tok}"})
with urllib.request.urlopen(req, timeout=30) as r:
    files = {i["path"] for i in json.load(r)}
need = {"upload-staging/profile.stats.pt"} | {f"upload-staging/keep_reap_{k}.json"
       for k in ("0.75", "0.5", "0.35", "0.25")}
missing = need - files
assert not missing, f"missing after upload: {sorted(missing)}"
print("50: remote tree check ok")
EOF

touch "$OK"
echo "50_upload: OK"
