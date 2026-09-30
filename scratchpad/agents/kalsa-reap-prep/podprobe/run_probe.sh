#!/usr/bin/env bash
# run_probe.sh — one-shot GPU probe orchestrator. Responsibility: the in-pod
# hard stop, arm order, per-arm timeout, per-arm upload, teardown.
#
# MONEY GUARD, started before anything else: a background sleep deletes THIS
# pod via the Runpod REST API with the pod's injected key after
# $PROBE_HARD_STOP_H hours. Whether a pod-scoped RUNPOD_API_KEY may delete
# its own pod is UNVERIFIED (README: test once with a 1-minute CPU pod);
# if it cannot, the ONLY things that stop billing are the coordinator's
# console and the per-arm upload below limiting the loss window.
set -uo pipefail
# shellcheck source=env.sh
. "$(dirname "$0")/env.sh"

token_cat() { cat "$SECRETS/hf_token" 2>/dev/null; }

if [ -n "${RUNPOD_POD_ID:-}" ] && [ -n "${RUNPOD_API_KEY:-}" ]; then
  # key passed via the ENVIRONMENT of the child, never argv, never printed
  RUNPOD_API_KEY="$RUNPOD_API_KEY" RUNPOD_POD_ID="$RUNPOD_POD_ID" \
  PROBE_HARD_STOP_H="$PROBE_HARD_STOP_H" nohup sh -c '
    sleep "${PROBE_HARD_STOP_H}h"
    code=$(curl -s -o /tmp/hard-stop.json -w "%{http_code}" --max-time 30 \
      -X DELETE "https://rest.runpod.io/v1/pods/$RUNPOD_POD_ID" \
      -H "Authorization: Bearer $RUNPOD_API_KEY")
    echo "hard-stop: DELETE -> HTTP $code" >> /tmp/hard-stop.log
  ' >/dev/null 2>&1 &
  echo "run_probe: in-pod hard stop armed at +${PROBE_HARD_STOP_H}h (delete permission UNVERIFIED)"
elif [ -z "${RUNPOD_POD_ID:-}" ]; then
  echo "run_probe: not on a Runpod pod — no hard stop armed (local run)"
fi

# arm <tag> <est_hours> <gguf> <tokenizer> [server flags...]
run_arm() {
  local tag="$1" est="$2" gguf="$3" tok="$4"; shift 4 || true
  if [ -f "$RESULTS/$tag/bench.txt" ]; then
    echo "== [$tag] already done"; return 0
  fi
  local left
  left=$(awk -v e="$(elapsed_h)" -v b="$PROBE_BUDGET_H" 'BEGIN {print b - e}')
  if awk -v l="$left" -v n="$est" 'BEGIN {exit !(l < n)}'; then
    echo "== [$tag] SKIPPED — ${left}h left < ${est}h estimate" | tee -a "$RUNS/skipped.log"
    return 0
  fi
  echo "== [$tag] running (est ${est}h, timeout ${PROBE_ARM_TIMEOUT_H}h, ${left}h left) $(date +%H:%M:%S)"
  local rc=0
  timeout -k 120 "$(awk -v h="$PROBE_ARM_TIMEOUT_H" 'BEGIN {printf "%d", h*3600}')" \
    bash "$(dirname "$0")/30_gate.sh" "$tag" "$gguf" "$tok" "$@" \
    2>&1 | tee -a "$RUNS/gate-$tag.log" || rc=${PIPESTATUS[0]}
  if [ "$rc" != "0" ]; then
    echo "== [$tag] FAILED rc=$rc — later arms continue; rerun resumes here" \
      | tee -a "$RUNS/failed.log"
  fi
  # upload after EVERY arm: a later hard stop or failure can only destroy
  # work that was never uploaded (Fable-3 §7.9)
  if [ -n "$(ls -A "$RESULTS/$tag" 2>/dev/null)" ]; then
    HF_TOKEN="$(token_cat)" bash "$(dirname "$0")/40_upload.sh" \
      >>"$RUNS/upload.log" 2>&1 \
      && echo "== [$tag] results uploaded" || echo "== [$tag] upload FAILED (see $RUNS/upload.log)"
  fi
}

bash "$(dirname "$0")/00_env.sh" || { echo "run_probe: 00_env failed — aborting" >&2; exit 1; }
HF_TOKEN="$(token_cat)" bash "$(dirname "$0")/10_fetch.sh" || { echo "run_probe: 10_fetch failed — aborting" >&2; exit 1; }
bash "$(dirname "$0")/20_convert.sh" || { echo "run_probe: 20_convert failed — aborting" >&2; exit 1; }

K4=(--override-kv qwen35moe.expert_used_count=int:4)
K4_K2=(--override-kv qwen35moe.expert_used_count=int:4
       --override-kv qwen35moe.expert_used_k2=int:16)

# order = decision value (Fable-3 §1): baseline, the free-prune verdict and
# its control FIRST, then k=4 arms, then the owner's extras
run_arm lfm              0.8 "$MODELS/ship/LFM2.5-2.6B-QAD-Q4_0.gguf" "$LFM_TOK"
run_arm razor19-k8-q4km  2.5 "$MODELS/kalsa-razor19-q4_k_m.gguf"     "$QWEN36_TOK"
run_arm qwen35-4b        1.0 "$MODELS/Qwen3.5-4B-Q4_K_M.gguf"        "$QWEN35_TOK"
run_arm razor19-k4-q4km  2.5 "$MODELS/kalsa-razor19-q4_k_m.gguf"     "$QWEN36_TOK" "${K4[@]}"
run_arm qwen36-k4        2.5 "$MODELS/$QWEN36_GGUF_FILE"             "$QWEN36_TOK" "${K4[@]}"

# k2 renormalisation arm — needs the spike build (skips itself on main)
if [ ! -f "$RUNS/using-main" ]; then
  run_arm razor19-k4-k2  2.5 "$MODELS/kalsa-razor19-q4_k_m.gguf"     "$QWEN36_TOK" "${K4_K2[@]}"
else
  echo "== [razor19-k4-k2] SKIPPED — engine is fork main (spike not pushed)"
fi

run_arm qwen35-2b-q4km   0.7 "$MODELS/Qwen3.5-2B-Q4_K_M.gguf"        "$QWEN35_TOK"
run_arm qwen35-2b-q4_0   0.7 "$MODELS/Qwen3.5-2B-Q4_0.gguf"          "$QWEN35_TOK"
run_arm razor19-k8-q4_0  1.5 "$MODELS/kalsa-razor19-q4_0.gguf"       "$QWEN36_TOK"

# optional 25% RAZOR (~28B; Q4_K_M ~16 GB — does not fit any 16 GB budget)
if [ "$PROBE_WITH_RAZOR28" = "1" ]; then
  run_arm razor28-k8-q4km 3.0 "$MODELS/kalsa-razor28-q4_k_m.gguf"    "$QWEN36_TOK"
fi

HF_TOKEN="$(token_cat)" bash "$(dirname "$0")/40_upload.sh" >>"$RUNS/upload.log" 2>&1
rc=$?
if [ "$rc" = "0" ]; then
  echo "run_probe: results verified on $HF_RESULTS_REPO — terminating."
  bash "$CELL/pod/terminate_pod.sh" || true
  exit 0
fi
echo "run_probe: final upload FAILED rc=$rc — partial arms are already on HF if" >&2
echo "run_probe: their per-arm upload succeeded; the hard stop still bounds billing." >&2
exit "$rc"
