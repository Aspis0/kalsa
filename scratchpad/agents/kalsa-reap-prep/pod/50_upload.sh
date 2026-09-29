#!/usr/bin/env bash
# 50_upload.sh — collect artifacts for pull. Responsibility: stage + upload
# the small provenance files always, the GGUFs only on explicit opt-in.
# Proposal (owner to create): private HF repo Aspis0/kalsa-reap-<date>;
# runpodctl to our own storage as fallback. Nothing is created here.
set -euo pipefail

ROOT="${POD_ROOT:-/workspace}"
RUN="$ROOT/runs"
OUT="$ROOT/gguf"
STAGE="$ROOT/runs/upload-staging"
HF_REPO="${POD_HF_UPLOAD_REPO:-Aspis0/kalsa-reap-drafts}"

rm -rf "$STAGE"; mkdir -p "$STAGE"
cp "$RUN/profile.stats.pt" "$STAGE/"                        # ~1 MB, all criteria
cp "$RUN"/keep_reap_*.json "$STAGE/"                        # deterministic re-cut seeds
cp "$RUN"/*.summary.json "$STAGE/" 2>/dev/null || true
cp "$OUT"/*.log "$STAGE/" 2>/dev/null || true
for d in "$ROOT"/models/kalsa-reap*/; do
  cp "$d/config.json" "$STAGE/config-$(basename "$d").json"
done
ls -la "$STAGE"

if [ "${POD_UPLOAD:-0}" != "1" ]; then
  echo "50_upload: POD_UPLOAD!=1 — staged only. To publish (owner creates repo first):"
  echo "  hf upload $HF_REPO $STAGE/* --repo-type model   # private"
  echo "  runpodctl put $OUT/kalsa-reap*-q8_0.gguf          # alternative pull path"
  exit 0
fi
[ -n "${HF_TOKEN:-}" ] || { echo "HF_TOKEN required for upload" >&2; exit 2; }
"$ROOT/.venv-kalsa/bin/hf" upload "$HF_REPO" "$STAGE" --repo-type model
"$ROOT/.venv-kalsa/bin/hf" upload "$HF_REPO" "$OUT"/kalsa-reap*-q8_0.gguf --repo-type model
echo "50_upload: OK"
