#!/usr/bin/env bash
# run_all.sh — pod orchestrator. Responsibility: sequencing, spend cap,
# per-stage timeouts, global deadline, token scoping, and pod termination
# AFTER results are verifiably uploaded (never before).
#
# The REAL spend stop is Runpod-side: the pod is created (by the coordinator,
# with the owner's OK) via `runpodctl pod create ... --terminate-after <iso8601>`
# set to the hard runtime cap — `--terminate-after` deletes the pod, whereas
# `--stop-after` only stops it and disk keeps billing (runpodctl skill,
# SKILL.md:88). This script's terminate path is a best-effort extra on top.
#
# Usage: run_all.sh <CAP_USD>
# Secrets: the HF token is read from $POD_SECRETS_DIR/hf_token (chmod 600,
# mounted by the coordinator) and passed ONLY to stages 05/10/40 as an
# environment variable (VAR=... cmd) — never as a command argument, so it
# never appears in ps/argv.
set -uo pipefail

ROOT="${POD_ROOT:-/workspace}"
LAB="$ROOT/kalsa-reap-prep/pod"
RUN="$ROOT/runs"
RATE="${POD_RATE_USD_H:-1.98}"        # 1x A100 80GB on-demand, USD/h (assumption)
CAP="${1:?usage: run_all.sh <CAP_USD>}"
DEADLINE_MIN="${POD_DEADLINE_MIN:-}"  # optional hard wall-clock override
SECRETS="${POD_SECRETS_DIR:-/root/.secrets}"
KEEP_ALIVE="${POD_KEEP_ALIVE:-0}"     # 1 = do not terminate (debug only)
DESTROY_ON_FAILED_UPLOAD="${POD_DESTROY_ON_FAILED_UPLOAD:-0}"

# spend state survives crash-resume
mkdir -p "$RUN"
if [ ! -f "$RUN/spend-state.env" ]; then
  printf 'START_EPOCH=%s\n' "$(date +%s)" > "$RUN/spend-state.env"
fi
# shellcheck source=/dev/null
. "$RUN/spend-state.env"

if [ -n "$DEADLINE_MIN" ]; then
  DEADLINE=$(( START_EPOCH + DEADLINE_MIN * 60 ))
else
  DEADLINE=$(( START_EPOCH + $(awk -v c="$CAP" -v r="$RATE" 'BEGIN {printf "%d", (c / r) * 3600}') ))
fi

hf_token_cat() { cat "$SECRETS/hf_token" 2>/dev/null; }

# The pod job produces ~1 MB (profile stats + one keep-set + logs). GGUF
# conversion, imatrix and quantisation happen on the Mac (mac/30_convert.sh);
# nothing heavy is ever uploaded from here.
STAGES="00_env:0.4 05_fetch_calib:0.2 10_fetch_model:0.7 20_observe:1.2 30_score:0.3 40_upload:0.3"
NEEDS_TOKEN=" 05_fetch_calib 10_fetch_model 40_upload "

# shellcheck disable=SC2329  # invoked from the EXIT trap string below
results_uploaded() { [ -f "$RUN/40_upload.ok" ]; }

# shellcheck disable=SC2329  # invoked from the EXIT trap string below
mini_upload_or_keep() { # failure path: push the ~1 MB, keep the pod if it won't land
  local rc
  rc=1
  for _ in 1 2 3; do
    if HF_TOKEN="$(hf_token_cat)" timeout 60 bash "$LAB/40_upload.sh" --mini; then
      rc=0; break
    fi
    sleep 10
  done
  if [ "$rc" = "0" ]; then
    echo "run_all: mini upload verified — safe to terminate." >&2
    return 0
  fi
  echo "run_all: mini upload DID NOT VERIFY after 3 tries — NOT terminating:" >&2
  echo "run_all: the stats/keep-set exist only on this pod's volume. Fix upload," >&2
  echo "run_all: re-run 40_upload.sh, then terminate by hand (or set" >&2
  echo "run_all: POD_DESTROY_ON_FAILED_UPLOAD=1 to trade artifacts for billing)." >&2
  [ "$DESTROY_ON_FAILED_UPLOAD" = "1" ]
}

job_pid=$$
bash "$LAB/watchdog.sh" "$DEADLINE" "$job_pid" &
WATCHDOG_PID=$!
trap 'rc=$?; echo "run_all: exiting rc=$rc"; kill "$WATCHDOG_PID" 2>/dev/null;
      if [ "$rc" = "0" ] && results_uploaded; then
        [ "$KEEP_ALIVE" != "1" ] && bash "$LAB/terminate_pod.sh";
      elif [ "$rc" != "0" ]; then
        if mini_upload_or_keep && [ "$KEEP_ALIVE" != "1" ]; then bash "$LAB/terminate_pod.sh"; fi;
      else
        echo "run_all: rc=0 but 40_upload.ok missing — keeping pod alive." >&2;
      fi' EXIT

for entry in $STAGES; do
  stage="${entry%%:*}"
  reserve_h="${entry##*:}"
  now=$(date +%s)
  spent=$(awk -v r="$RATE" -v s="$START_EPOCH" -v n="$now" 'BEGIN {print r*(n-s)/3600}')
  projected=$(awk -v s="$spent" -v r="$reserve_h" 'BEGIN {printf "%.2f", s+r}')
  echo "== $stage: spent ~\$${spent}, projected with reserve ~\$${projected} (cap \$${CAP}, deadline epoch $DEADLINE) =="
  if awk -v p="$projected" -v c="$CAP" 'BEGIN {exit !(p > c)}'; then
    echo "run_all: CAP STOP — $stage would exceed cap \$${CAP} (projected \$${projected})." >&2
    exit 3
  fi
  timeout_s=$(awk -v h="$reserve_h" 'BEGIN {printf "%d", h*3600}')
  if [[ "$NEEDS_TOKEN" == *" $stage "* ]]; then
    HF_TOKEN="$(hf_token_cat)" \
      timeout --foreground -k 120 "$timeout_s" bash "$LAB/${stage}.sh" \
      2>&1 | tee -a "$RUN/${stage}.log"
  else
    env -u HF_TOKEN timeout --foreground -k 120 "$timeout_s" \
      bash "$LAB/${stage}.sh" 2>&1 | tee -a "$RUN/${stage}.log"
  fi
  rc=${PIPESTATUS[0]}
  if [ "$rc" != "0" ]; then
    echo "run_all: stage $stage failed rc=$rc (timeout or error)." >&2
    exit "$rc"
  fi
done

spent=$(awk -v r="$RATE" -v s="$START_EPOCH" -v n="$(date +%s)" 'BEGIN {print r*(n-s)/3600}')
echo "run_all: ALL STAGES OK — spent ~\$${spent} of cap \$${CAP}; results verified on HF; terminating pod."
exit 0
