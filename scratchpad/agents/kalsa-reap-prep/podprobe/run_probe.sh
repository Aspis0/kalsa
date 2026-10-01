#!/usr/bin/env bash
# run_probe.sh — one-shot GPU probe orchestrator. Responsibility: the in-pod
# hard stop, arm order, per-arm timeout, per-arm upload, teardown.
#
# MONEY GUARD, started before anything else: a background sleep STOPS this
# pod after $PROBE_HARD_STOP_H hours. Coordinator-verified 2026-09-30 on a
# 1-minute CPU pod: the pod-scoped key CAN stop its own pod (REST stop, or
# the GraphQL podStop mutation), but CANNOT delete it (DELETE -> 403). A
# stopped pod still bills its volume until the coordinator deletes it.
set -uo pipefail
# shellcheck source=env.sh
. "$(dirname "$0")/env.sh"

# SSH sessions do not inherit the container env: take the pod id and the
# pod-scoped key from PID 1 when absent, or the money guard never arms.
if [ -z "${RUNPOD_POD_ID:-}" ] && [ -r /proc/1/environ ]; then
  eval "$(tr '\0' '\n' < /proc/1/environ | grep -E '^RUNPOD_(POD_ID|API_KEY)=' | sed 's/^/export /')"
fi
# nvcc lives outside the non-login PATH on the runpod/pytorch images
export PATH="/usr/local/cuda/bin:$PATH"
token_cat() { tr -d '\n\r' < "$SECRETS/hf_token" 2>/dev/null; }

# Stop THIS pod: REST first, GraphQL podStop as fallback (the coordinator
# could not tell which of the two acted on the test pod — keep both). Logs
# HTTP codes only; the key goes to curl via a 600 header file, never argv.
self_stop() {
  [ -n "${RUNPOD_POD_ID:-}" ] && [ -n "${RUNPOD_API_KEY:-}" ] || return 0
  local hdr code
  hdr=$(mktemp) || return 1
  chmod 600 "$hdr" || { rm -f "$hdr"; return 1; }
  printf 'Authorization: Bearer %s\n' "$RUNPOD_API_KEY" > "$hdr" \
    || { rm -f "$hdr"; return 1; }
  code=$(curl -s -o /tmp/self-stop.json -w '%{http_code}' --max-time 30 \
    -X POST "https://rest.runpod.io/v1/pods/${RUNPOD_POD_ID}/stop" \
    -H @"$hdr" || echo 000)
  echo "self-stop: REST stop -> HTTP $code"
  case "$code" in 200|204) rm -f "$hdr"; return 0 ;; esac
  code=$(curl -s -o /tmp/self-stop-gql.json -w '%{http_code}' --max-time 30 \
    -X POST "https://api.runpod.io/graphql" -H @"$hdr" \
    -H 'Content-Type: application/json' \
    -d '{"query":"mutation{podStop(input:{podId:\"'"${RUNPOD_POD_ID}"'\"}){id}}"}' \
    || echo 000)
  rm -f "$hdr"
  echo "self-stop: GraphQL podStop -> HTTP $code"
  case "$code" in 200) return 0 ;; esac
  return 1
}

self_stop_after() { # <hours> — the hard-stop backstop
  sleep "${1}h"
  self_stop >> /tmp/hard-stop.log 2>&1
  echo "hard-stop: pod stop attempted after ${1}h" >> /tmp/hard-stop.log
}

HARD_STOP_PID=""
if [ -n "${RUNPOD_POD_ID:-}" ] && [ -n "${RUNPOD_API_KEY:-}" ]; then
  self_stop_after "$PROBE_HARD_STOP_H" >/dev/null 2>&1 &
  HARD_STOP_PID=$!
  disown "$HARD_STOP_PID" 2>/dev/null || true
  echo "run_probe: in-pod hard STOP armed at +${PROBE_HARD_STOP_H}h (verified on a CPU pod; volume bills until the coordinator deletes)"
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

finish() { # stop the pod on EVERY exit from here on: an idle RUNNING pod
           # bills its GPU; the stopped pod bills only its volume until the
           # coordinator deletes it
  [ -n "$HARD_STOP_PID" ] && kill "$HARD_STOP_PID" 2>/dev/null
  if self_stop; then
    echo "run_probe: pod STOPPED — coordinator: delete it to end volume billing."
  else
    echo "run_probe: self-stop FAILED — pod may still be RUNNING; stop/delete it by hand." >&2
  fi
}

bash "$(dirname "$0")/00_env.sh" || { echo "run_probe: 00_env failed — aborting" >&2; finish; exit 1; }
HF_TOKEN="$(token_cat)" bash "$(dirname "$0")/10_fetch.sh" || { echo "run_probe: 10_fetch failed — aborting" >&2; finish; exit 1; }
bash "$(dirname "$0")/20_convert.sh" || { echo "run_probe: 20_convert failed — aborting" >&2; finish; exit 1; }

K4=(--override-kv qwen35moe.expert_used_count=int:4)
K4_K2=(--override-kv qwen35moe.expert_used_count=int:4
       --override-kv qwen35moe.expert_used_k2=int:16)

# order = decision value (Fable-3 §1): baseline, the free-prune verdict and
# its control FIRST, then k=4 arms, then the owner's extras.
# est hours = the NEW gate workload (964 generations/arm, math+humaneval at
# 8192, evals run 4 slots concurrently on the A100) — derivation and the
# conservative/realistic band per arm-class: PHASE0-EVALS.md "Probe budgets".
run_arm lfm              1.2 "$MODELS/ship/LFM2.5-2.6B-QAD-Q4_0.gguf" "$LFM_TOK"
run_arm razor19-k8-q4km  3.0 "$MODELS/kalsa-razor19-q4_k_m.gguf"     "$QWEN36_TOK"
run_arm qwen35-4b        1.5 "$MODELS/Qwen3.5-4B-Q4_K_M.gguf"        "$QWEN35_TOK"
run_arm razor19-k4-q4km  3.0 "$MODELS/kalsa-razor19-q4_k_m.gguf"     "$QWEN36_TOK" "${K4[@]}"
run_arm qwen36-k4        3.0 "$MODELS/$QWEN36_GGUF_FILE"             "$QWEN36_TOK" "${K4[@]}"

# k2 renormalisation arm — needs the spike build (skips itself on main)
if [ ! -f "$RUNS/using-main" ]; then
  run_arm razor19-k4-k2  3.0 "$MODELS/kalsa-razor19-q4_k_m.gguf"     "$QWEN36_TOK" "${K4_K2[@]}"
else
  echo "== [razor19-k4-k2] SKIPPED — engine is fork main (spike not pushed)"
fi

run_arm qwen35-2b-q4km   0.6 "$MODELS/Qwen3.5-2B-Q4_K_M.gguf"        "$QWEN35_TOK"
run_arm qwen35-2b-q4_0   0.6 "$MODELS/Qwen3.5-2B-Q4_0.gguf"          "$QWEN35_TOK"
run_arm razor19-k8-q4_0  3.0 "$MODELS/kalsa-razor19-q4_0.gguf"       "$QWEN36_TOK"

# optional 25% RAZOR (~28B; Q4_K_M ~16 GB — does not fit any 16 GB budget)
if [ "$PROBE_WITH_RAZOR28" = "1" ]; then
  run_arm razor28-k8-q4km 4.0 "$MODELS/kalsa-razor28-q4_k_m.gguf"    "$QWEN36_TOK"
fi

# S1 stop rule (audit H2: the tool existed but NOTHING ever called it).
# Decision-relevant arms are the k=4 128-expert checkpoints; their exact
# unpruned control is qwen36-k4, so the rule runs arm-vs-qwen36-k4 — never
# arm-vs-arm (the previous round's only proof was that vacuous self-pair).
# Runs when both arms' gate JSONs exist; the verdict goes into
# results/stop-rule.log (uploaded below). A STOP is a coordinator verdict —
# it does not change this script's exit code, which tracks the upload.
: > "$RESULTS/stop-rule.log"
for arm_tag in razor19-k4-q4km razor19-k4-k2; do
  [ -d "$RESULTS/$arm_tag" ] || continue
  echo "# $(date -u +%FT%TZ) $arm_tag vs qwen36-k4" >> "$RESULTS/stop-rule.log"
  (cd "$EVAL" && "$PY" check_stop_rule.py --arm "$RESULTS/$arm_tag" \
     --base "$RESULTS/qwen36-k4") >> "$RESULTS/stop-rule.log" 2>&1
  rc_rule=$?
  echo "== stop-rule [$arm_tag] vs qwen36-k4: EXIT=$rc_rule (0=GO, 1=STOP)"
done

HF_TOKEN="$(token_cat)" bash "$(dirname "$0")/40_upload.sh" >>"$RUNS/upload.log" 2>&1
rc=$?
if [ "$rc" = "0" ]; then
  echo "run_probe: results verified on $HF_RESULTS_REPO."
else
  echo "run_probe: final upload FAILED rc=$rc — partial arms are already on HF if" >&2
  echo "run_probe: their per-arm upload succeeded." >&2
fi
finish
exit "$rc"
