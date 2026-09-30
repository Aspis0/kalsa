#!/usr/bin/env bash
# run_all.sh — pod orchestrator. Responsibility: sequencing, spend cap,
# per-stage timeouts, global deadline, token scoping, and pod termination on
# EVERY exit path (the only way billing stops; see terminate_pod.sh).
#
# Usage: run_all.sh <CAP_USD>            (FASE A: floor 40 / soft 120 / STOP 150)
# Secrets: HF token is read from $POD_SECRETS_DIR/hf_token (chmod 600, mounted
# by the coordinator) and passed ONLY to stages 05/10/50. It is never in this
# process's environment otherwise, so no setup tool ever sees it.
set -uo pipefail

ROOT="${POD_ROOT:-/workspace}"
LAB="$ROOT/kalsa-reap-prep/pod"
RUN="$ROOT/runs"
RATE="${POD_RATE_USD_H:-1.98}"        # 1x A100 80GB on-demand, USD/h (assumption)
CAP="${1:?usage: run_all.sh <CAP_USD>}"
DEADLINE_MIN="${POD_DEADLINE_MIN:-}"  # optional hard wall-clock override
SECRETS="${POD_SECRETS_DIR:-/root/.secrets}"
KEEP_ALIVE="${POD_KEEP_ALIVE:-0}"     # 1 = do not terminate (debug only)

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

# stages needing the HF token, in order. reserve = per-stage timeout hours.
STAGES="00_env:0.75 05_fetch_calib:0.2 10_fetch_model:0.6 20_observe:0.6 30_prune:0.4 40_convert:1.7 50_upload:1.6"
NEEDS_TOKEN=" 05_fetch_calib 10_fetch_model 50_upload "

# shellcheck disable=SC2329  # invoked from the EXIT trap string below
best_effort_mini_upload() { # on crash: push ~1MB of keep-sets/stats if we can
  local tok
  tok=$(cat "$SECRETS/hf_token" 2>/dev/null) || return 0
  [ -n "$tok" ] || return 0
  [ -f "$RUN/profile.stats.pt" ] || return 0
  timeout 20 env HF_TOKEN="$tok" "$ROOT/.venv-kalsa/bin/hf" upload \
    "${POD_HF_UPLOAD_REPO:-Aspis0/kalsa-reap-drafts}" "$RUN/profile.stats.pt" \
    --repo-type model >/dev/null 2>&1 || true
}

job_pid=$$
bash "$LAB/watchdog.sh" "$DEADLINE" "$job_pid" &
WATCHDOG_PID=$!
trap 'rc=$?; echo "run_all: exiting rc=$rc"; kill "$WATCHDOG_PID" 2>/dev/null;
      [ "$rc" != "0" ] && best_effort_mini_upload;
      if [ "$KEEP_ALIVE" != "1" ]; then bash "$LAB/terminate_pod.sh"; fi' EXIT

for entry in $STAGES; do
  stage="${entry%%:*}"
  reserve_h="${entry##*:}"
  now=$(date +%s)
  spent=$(awk -v r="$RATE" -v s="$START_EPOCH" -v n="$now" 'BEGIN {print r*(n-s)/3600}')
  projected=$(awk -v s="$spent" -v r="$reserve_h" 'BEGIN {printf "%.2f", s+r}')
  echo "== $stage: spent ~\$${spent}, projected with reserve ~\$${projected} (cap \$${CAP}, deadline $(date -u -r "$DEADLINE" 2>/dev/null || date -u -d @$DEADLINE) UTC) =="
  if awk -v p="$projected" -v c="$CAP" 'BEGIN {exit !(p > c)}'; then
    echo "run_all: CAP STOP — $stage would exceed cap \$${CAP} (projected \$${projected})." >&2
    exit 3
  fi
  timeout_s=$(awk -v h="$reserve_h" 'BEGIN {printf "%d", h*3600}')
  if [[ "$NEEDS_TOKEN" == *" $stage "* ]]; then
    env HF_TOKEN="$(hf_token_cat)" \
      timeout --foreground -k 120 "$timeout_s" bash "$LAB/${stage}.sh" \
      2>&1 | tee -a "$RUN/${stage}.log"
  else
    env -u HF_TOKEN timeout --foreground -k 120 "$timeout_s" \
      bash "$LAB/${stage}.sh" 2>&1 | tee -a "$RUN/${stage}.log"
  fi
  rc=${PIPESTATUS[0]}
  if [ "$rc" != "0" ]; then
    echo "run_all: stage $stage failed rc=$rc (timeout or error) — terminating." >&2
    exit "$rc"
  fi
done

spent=$(awk -v r="$RATE" -v s="$START_EPOCH" -v n="$(date +%s)" 'BEGIN {print r*(n-s)/3600}')
echo "run_all: ALL STAGES OK — spent ~\$${spent} of cap \$${CAP}; terminating pod (artifacts uploaded in 50_upload)."
exit 0
