#!/usr/bin/env bash
# run_probe.sh — one-shot GPU probe orchestrator. Responsibility: arm order,
# the remaining-budget guard, upload, terminate. Per-arm cost/estimate table
# lives in the README (the estimates below are the guard's inputs).
#
# Billing is really stopped by --terminate-after at pod CREATION (see README
# create command); the in-pod terminate at the end is best-effort only.
set -uo pipefail
# shellcheck source=env.sh
. "$(dirname "$0")/env.sh"

token_cat() { cat "$SECRETS/hf_token" 2>/dev/null; }

# arm <tag> <est_hours> <gguf> <tokenizer> [server flags...]
run_arm() {
  local tag="$1" est="$2" gguf="$3" tok="$4"; shift 4 || true
  if [ -f "$RESULTS/$tag/gsm8k.json" ]; then
    echo "== [$tag] already done"; return 0
  fi
  local left
  left=$(awk -v e="$(elapsed_h)" -v b="$PROBE_BUDGET_H" 'BEGIN {print b - e}')
  if awk -v l="$left" -v n="$est" 'BEGIN {exit !(l < n)}'; then
    echo "== [$tag] SKIPPED — ${left}h left < ${est}h estimate" | tee -a "$RUNS/skipped.log"
    return 0
  fi
  echo "== [$tag] running (est ${est}h, ${left}h left) $(date +%H:%M:%S)"
  bash "$(dirname "$0")/30_gate.sh" "$tag" "$gguf" "$tok" "$@" \
    2>&1 | tee -a "$RUNS/gate-$tag.log"
  local rc=${PIPESTATUS[0]}
  if [ "$rc" != "0" ]; then
    echo "== [$tag] FAILED rc=$rc — later arms continue; rerun resumes here" \
      | tee -a "$RUNS/failed.log"
  fi
}

HF_TOKEN="$(token_cat)" bash "$(dirname "$0")/00_env.sh"
HF_TOKEN="$(token_cat)" bash "$(dirname "$0")/10_fetch.sh"
bash "$(dirname "$0")/20_convert.sh"

K4=(--override-kv qwen35moe.expert_used_count=int:4)
K4_K2=(--override-kv qwen35moe.expert_used_count=int:4 --override-kv qwen35moe.expert_used_k2=int:16)

# order = value: baseline first, then the decision arms, extras last
run_arm lfm              0.8 "$MODELS/ship/LFM2.5-2.6B-QAD-Q4_0.gguf" "$LFM_TOK"
run_arm razor19-k8-q4km  2.1 "$MODELS/kalsa-razor19-q4_k_m.gguf"     "$QWEN36_TOK"
run_arm razor19-k4-q4km  2.0 "$MODELS/kalsa-razor19-q4_k_m.gguf"     "$QWEN36_TOK" "${K4[@]}"
run_arm qwen36-k4        2.2 "$MODELS/$QWEN36_GGUF_FILE"             "$QWEN36_TOK" "${K4[@]}"
run_arm qwen35-2b-q4km   0.7 "$MODELS/Qwen3.5-2B-Q4_K_M.gguf"        "$QWEN35_TOK"
run_arm qwen35-2b-q4_0   0.7 "$MODELS/Qwen3.5-2B-Q4_0.gguf"          "$QWEN35_TOK"
run_arm qwen35-4b        1.0 "$MODELS/Qwen3.5-4B-Q4_K_M.gguf"        "$QWEN35_TOK"
run_arm razor19-k8-q4_0  1.4 "$MODELS/kalsa-razor19-q4_0.gguf"       "$QWEN36_TOK"

# k2 renormalisation arm — needs the spike build (skips itself on main)
if [ ! -f "$RUNS/using-main" ]; then
  run_arm razor19-k4-k2  2.0 "$MODELS/kalsa-razor19-q4_k_m.gguf"     "$QWEN36_TOK" "${K4_K2[@]}"
else
  echo "== [razor19-k4-k2] SKIPPED — engine is fork main (spike not pushed)"
fi

# optional 25% RAZOR (~28B; Q4_K_M ~16 GB — does not fit any 16 GB budget)
if [ "$PROBE_WITH_RAZOR28" = "1" ]; then
  run_arm razor28-k8-q4km 3.0 "$MODELS/kalsa-razor28-q4_k_m.gguf"    "$QWEN36_TOK"
fi

HF_TOKEN="$(token_cat)" bash "$(dirname "$0")/40_upload.sh"
rc=$?
if [ "$rc" = "0" ]; then
  echo "run_probe: results verified on $HF_RESULTS_REPO — terminating."
  bash "$CELL/pod/terminate_pod.sh" || true
  exit 0
fi
echo "run_probe: UPLOAD FAILED (rc=$rc) — pod kept alive for manual salvage;" >&2
echo "run_probe: rerun podprobe/40_upload.sh, then terminate by hand." >&2
exit "$rc"
