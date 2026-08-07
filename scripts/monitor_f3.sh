#!/usr/bin/env bash
# =============================================================================
# monitor_f3.sh — poll del run F3 detached sul telefono (S23) ogni 5 minuti.
#
# Read-only: non modifica nulla sul telefono. Controlla:
#   - runner run_f3.sh vivo?  llama-cli attivo?
#   - righe CSV per fase (F3 / F3-numa / F3-nowarmup) + ultimo run_id
#   - batteria (pct, temp, plugged)
#   - tail del runner log
# Termina con summary FINALE quando il runner muore (completato o crash)
# oppure dopo MAX_MIN minuti (default 300 = 5h). Log: results/f3/monitor_f3.log
#
# Uso: nohup bash scripts/monitor_f3.sh >/dev/null 2>&1 &
#   POLL_S=300 MAX_MIN=300 nohup bash scripts/monitor_f3.sh >/dev/null 2>&1 &
# =============================================================================

set -u
export LC_ALL=C

SSH_HOST="u0_a344@192.168.1.152"
SSH_PORT=8022
SSH_KEY="${SSH_KEY:-$HOME/.ssh/moe_s23}"
POLL_S="${POLL_S:-300}"
MAX_MIN="${MAX_MIN:-300}"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_LOG="${REPO_DIR}/results/f3/monitor_f3.log"
mkdir -p "$(dirname "$OUT_LOG")"

SSH_BASE=(ssh -p "$SSH_PORT" -i "$SSH_KEY" -o BatchMode=yes -o ConnectTimeout=8)
SSH_TIMEOUT_S=25

_log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >>"$OUT_LOG"; }

_poll() {
    local out rows_f3 rows_numa rows_nw last_row runner llama batt temp plugged
    local tmp
    tmp="$(mktemp "${TMPDIR:-/tmp}/mof3.XXXXXX")"
    "${SSH_BASE[@]}" -o ConnectTimeout=8 "$SSH_HOST" bash -s >"$tmp" 2>&1 <<'EOF'
echo "===RUNNER==="; ps -A -o pid=,args= 2>/dev/null | grep -E "run_f3\.sh" | grep -v grep || echo DEAD
echo "===LLAMA==="; ps -A -o pid=,args= 2>/dev/null | grep -E "llama-cli" | grep -v grep || echo IDLE
echo "===CSV==="; awk -F, '$3 ~ /^F3/ {print $3, $16, $17, $21}' ~/experiments/results/runs.csv 2>/dev/null
echo "===BATT==="; termux-battery-status 2>/dev/null | grep -E "plugged|percentage|temperature"
echo "===LOGTAIL==="; tail -n 3 ~/experiments/results/f3_state/F3.runner.log 2>/dev/null || echo no-log
EOF
    out="$(cat "$tmp")"
    rm -f "$tmp"

    rows_f3="$(printf '%s\n' "$out" | grep -c '^F3 ')"; rows_numa="$(printf '%s\n' "$out" | grep -c '^F3-numa ')"
    rows_nw="$(printf '%s\n' "$out" | grep -c '^F3-nowarmup ')"
    last_row="$(printf '%s\n' "$out" | grep -E '^F3' | tail -n1 | awk '{print $1, $2" t/s eval", "rb="$4}')"
    runner="$(printf '%s\n' "$out" | sed -n 's/^===RUNNER===$/X/;/^[0-9]/p' | head -n1)"
    [ -z "${runner:-}" ] && runner="$(printf '%s\n' "$out" | grep -c '^DEAD$' >/dev/null && echo DEAD || echo ALIVE)"
    llama="$(printf '%s\n' "$out" | grep -c '^IDLE$' >/dev/null && echo idle || echo busy)"
    batt="$(printf '%s\n' "$out" | grep -oE '"percentage": ?[0-9]+' | head -n1 | grep -oE '[0-9]+')"
    temp="$(printf '%s\n' "$out" | grep -oE '"temperature": ?[0-9.]+' | head -n1 | grep -oE '[0-9.]+')"
    plugged="$(printf '%s\n' "$out" | grep -oE '"plugged": ?"[A-Z_]+"' | head -n1 | cut -d\" -f4)"
    logtail="$(printf '%s\n' "$out" | sed -n '/^===LOGTAIL===$/,$p' | tail -n +2 | tr '\n' '|' | cut -c1-140)"

    printf 'runner=%s llama=%s F3=%s numa=%s nowarmup=%s last=%s batt=%s%% temp=%s plugged=%s tail=%s\n' \
        "${runner:-?}" "$llama" "$rows_f3" "$rows_numa" "$rows_nw" "${last_row:-none}" \
        "${batt:-?}" "${temp:-?}" "${plugged:-?}" "${logtail:-}"
}

_n_polls=$(( MAX_MIN / (POLL_S / 60) ))
[ "$_n_polls" -lt 1 ] && _n_polls=1
_log "monitor start poll_s=${POLL_S} max_min=${MAX_MIN} polls=${_n_polls}"

prev_dead=0
for (( i=1; i<=_n_polls; i++ )); do
    line="$(_poll)"
    _log "[poll $i/$_n_polls] $line"
    echo "$line"

    # runner morto → snapshot finale e uscita
    if printf '%s' "$line" | grep -q 'runner=DEAD'; then
        prev_dead=$((prev_dead + 1))
        if [ "$prev_dead" -ge 2 ]; then
            _log "RUNNER_DEAD poll=$i — snapshot finale: $line"
            _log "DONE runner_dead"
            exit 0
        fi
    else
        prev_dead=0
    fi
    [ "$i" -lt "$_n_polls" ] && sleep "$POLL_S"
done

_log "DONE max_min raggiunto (${MAX_MIN}m)"
