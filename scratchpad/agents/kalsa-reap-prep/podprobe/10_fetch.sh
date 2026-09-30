#!/usr/bin/env bash
# 10_fetch.sh — download every gate artifact at its pinned revision.
# Responsibility: fetch + verify. Every pin is a COMMIT sha, verified through
# the HF API after the download (a moved ref fails loudly). Public repos need
# no token; the ship LFM file comes from our PRIVATE dataset repo, so this
# stage receives HF_TOKEN via the environment only (never argv).
set -euo pipefail
# shellcheck source=env.sh
. "$(dirname "$0")/env.sh"
OK="$RUNS/10_fetch.ok"
HF="$ROOT/.venv-probe/bin/hf"

if [ -f "$OK" ]; then echo "10_fetch: already OK"; exit 0; fi

assert_pinned() { # repo sha  — the revision must still resolve to the pin
  "$PY" - "$1" "$2" <<'EOF'
import sys
from huggingface_hub import HfApi
sha = HfApi().model_info(sys.argv[1], revision=sys.argv[2]).sha
assert sha == sys.argv[2], f"{sys.argv[1]}: revision now resolves to {sha}"
EOF
}

fetch_dir() { # repo sha destdir
  if [ ! -f "$3/.probe-pin" ] || [ "$(cat "$3/.probe-pin")" != "$2" ]; then
    "$HF" download "$1" --revision "$2" --local-dir "$3" >/dev/null
    assert_pinned "$1" "$2"
    echo "$2" > "$3/.probe-pin"
  fi
}

fetch_file() { # repo file sha destdir — pinned download of a single file
  if [ ! -f "$4/$2" ]; then
    "$HF" download "$1" "$2" --revision "$3" --local-dir "$4" >/dev/null
  fi
}

# RAZOR checkpoints (HF dirs; converted to GGUF on the pod in 20_convert)
fetch_dir "$RAZOR19_REPO" "$RAZOR19_SHA" "$MODELS/razor19"
[ "$PROBE_WITH_RAZOR28" != "1" ] || fetch_dir "$RAZOR28_REPO" "$RAZOR28_SHA" "$MODELS/razor28"

# prebuilt GGUFs, pinned by commit sha
fetch_file "$QWEN36_GGUF_REPO" "$QWEN36_GGUF_FILE" "$QWEN36_GGUF_SHA" "$MODELS"
assert_pinned "$QWEN36_GGUF_REPO" "$QWEN36_GGUF_SHA"
fetch_file "$QWEN35_4B_REPO" "Qwen3.5-4B-Q4_K_M.gguf" "$QWEN35_4B_SHA" "$MODELS"
assert_pinned "$QWEN35_4B_REPO" "$QWEN35_4B_SHA"
fetch_file "$QWEN35_2B_REPO" "Qwen3.5-2B-Q4_K_M.gguf" "$QWEN35_2B_SHA" "$MODELS"
fetch_file "$QWEN35_2B_REPO" "Qwen3.5-2B-Q4_0.gguf" "$QWEN35_2B_SHA" "$MODELS"
assert_pinned "$QWEN35_2B_REPO" "$QWEN35_2B_SHA"

# ship baseline from the private results repo (prerequisite upload; README)
[ -n "${HF_TOKEN:-}" ] || { echo "10: HF_TOKEN needed for the ship LFM pull" >&2; exit 2; }
if [ ! -f "$MODELS/ship/LFM2.5-2.6B-QAD-Q4_0.gguf" ]; then
  "$HF" download "$HF_RESULTS_REPO" "ship/LFM2.5-2.6B-QAD-Q4_0.gguf" \
    --repo-type dataset --local-dir "$MODELS" >/dev/null  # path_in_repo already carries ship/
fi
got=$(sha256sum "$MODELS/ship/LFM2.5-2.6B-QAD-Q4_0.gguf" | awk '{print $1}')
[ "$got" = "$LFM_SHIP_SHA256" ] \
  || { echo "10: ship LFM sha256 mismatch ($got)" >&2; exit 1; }

for f in "$CELL/$QWEN36_TOK/tokenizer.json" "$CELL/$QWEN35_TOK/tokenizer.json" \
         "$CELL/$LFM_TOK/tokenizer.json"; do
  test -f "$f" || { echo "10: bundle missing $f (see README rsync step)" >&2; exit 2; }
done

touch "$OK"
echo "10_fetch: OK"
