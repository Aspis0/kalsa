#!/usr/bin/env bash
# Resilient campaign launcher — keeps the campaign alive by re-launching the
# supervisor whenever it exits, for ANY reason. Safe: the supervisor resumes
# from the checkpoint (no data loss, no duplicate turns). Stops only when
# the run-order is exhausted (every cell is 'skip'), the device is gone for
# a long backoff window, or a deterministic crash-loop exceeds the cap.
#
# Usage: CAMPAIGN_OUT=<out-dir> bash scripts/campaign/resilient.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CONFIG="${CAMPAIGN_CONFIG:-$HERE/../../campaigns/ciswire.json}"
SCRIPT="${CAMPAIGN_SCRIPT:-$HERE/../../campaigns/ciswire/script.json}"
OUT="${CAMPAIGN_OUT:-$(pwd)/results/ciswire-campaign/$(date +%Y-%m-%d)}"
STOP_FILE="${OUT}/.campaign-done"
# Device-loss backoff (L3): 30s → 300s per attempt, give up after the cap
# (owner accepts cooldowns of hours: 3 min was fatal on any reboot).
DEVICE_BACKOFF_MAX_S="${DEVICE_BACKOFF_MAX_S:-300}"
DEVICE_LOSS_GIVE_UP_S="${DEVICE_LOSS_GIVE_UP_S:-21600}"       # 6h total
# Crash-loop cap (M2): N consecutive supervisor exit!=0 → backoff until the
# window, then give up loudly instead of relaunching every 5s forever.
CRASH_LOOP_CAP="${CRASH_LOOP_CAP:-10}"
CRASH_BACKOFF_MAX_S="${CRASH_BACKOFF_MAX_S:-600}"

log() { printf '[launcher] %s\n' "$*" >&2; }

# ---- single-instance lock (mkdir is atomic; prevents parallel launchers
# from fighting over the same device/out dir — the mistake that caused the
# triple-launch earlier). M1: release is OWNER-CONTROLLED: a refuser (exit 3)
# must NOT delete the running launcher's lock (that re-opened the race), and
# takeover only happens when the recorded PID is provably dead. The trap also
# kills the child supervisor before releasing, so no orphan keeps writing. ----
LOCK_DIR="${OUT}/.launcher.lock"
SUPERVISOR_PID=""
# N5: pidfile del supervisor figlio — il takeover deve rilevare anche orfani
# (launcher morto con supervisor ancora vivo = doppio supervisor se si rilancia).
SUP_PIDFILE="${OUT}/.supervisor.pid"

lock_owner() {
  local owner
  owner=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
  if [ -n "$owner" ]; then
    if kill -0 "$owner" 2>/dev/null; then
      echo "$owner"
      return 0
    fi
  fi
  return 1
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "$LOCK_DIR/pid"
    return 0
  fi
  if owner=$(lock_owner); then
    log "another launcher alive (pid $owner) — refusing to start. OUT=$OUT"
    exit 3
  fi
  # stale lock: owner dead (or pid unreadable). Race-safe take over: rename
  # instead of rm+mkdir so a concurrent takeover cannot both succeed.
  if mv "$LOCK_DIR" "${LOCK_DIR}.stale.$$" 2>/dev/null; then
    mkdir "$LOCK_DIR" 2>/dev/null && echo "$$" > "$LOCK_DIR/pid"
    if [ ! -f "$LOCK_DIR/pid" ]; then
      # N5a: mv riuscito ma mkdir perso (race) — il launcher non possiede il
      # lock; riprova da capo invece di proseguire senza protezione.
      rm -rf "${LOCK_DIR}.stale.$$"
      log "lock race on takeover — retrying"
      sleep 1
      acquire_lock
      return 0
    fi
    rm -rf "${LOCK_DIR}.stale.$$"
    log "stale lock taken over"
    return 0
  fi
  log "lock raced — retrying acquire"
  sleep 1
  acquire_lock
}

# N5b: vero supervisor orfano vivo? (pidfile scritto dal launcher padre, kill -0)
supervisor_orphan_alive() {
  local sp
  sp=$(cat "$SUP_PIDFILE" 2>/dev/null || echo "")
  [ -n "$sp" ] && kill -0 "$sp" 2>/dev/null
}

release_lock() {
  if [ -n "$SUPERVISOR_PID" ] && kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
    log "killing child supervisor $SUPERVISOR_PID before releasing lock (no orphan writes)"
    kill "$SUPERVISOR_PID" 2>/dev/null || true
    sleep 1
  fi
  rm -f "$SUP_PIDFILE" 2>/dev/null
  local mine
  mine=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
  if [ "$mine" = "$$" ]; then
    rm -rf "$LOCK_DIR"
  fi
}
# N5c: trap espliciti oltre EXIT (TERM/INT/HUP) — il launcher uccide sempre il
# figlio prima di uscire, così niente supervisor orfano.
trap 'exit 130' TERM
# INT/HUP ereditano il trap EXIT; TERM segue il percorso EXIT con codice 130.
trap release_lock EXIT
acquire_lock

# True when every cell in the run-order is a skip (campaign fully done).
campaign_finished() {
  local cells="$OUT/run-order.json"
  [ -f "$cells" ] || return 1
  python3 - "$cells" "$OUT" <<'PY'
import json, sys, os
cells = sys.argv[1]
out = sys.argv[2]
order = json.load(open(cells))
plan_file = os.path.join(out, ".resume-plan.txt")
if not os.path.exists(plan_file):
    sys.exit(1)
plan = [l.split() for l in open(plan_file) if l.strip()]
remaining = [p for p in plan if len(p) >= 4 and p[3] != "skip"]
sys.exit(1 if remaining else 0)
PY
}

# N9: serial derivato dal config (campaigns/*.json device) con fallback.
SERIAL="${CAMPAIGN_SERIAL:-$(python3 -c 'import json,sys
print(json.load(open(sys.argv[1]))["device"])' "$CONFIG" 2>/dev/null || echo "192.168.1.82:34037")}"
device_lost() {
  adb devices 2>/dev/null | grep -q "$SERIAL.*device"
}

log "resilient launcher: out=$OUT (serial $SERIAL)"
crash_streak=0
device_lost_total=0
# N6: no-progress detection — N pass senza che il checkpoint/record jsonl
# sia avanzato = livelock (che esce pure con 0) -> backoff -> give-up.
NO_PROGRESS_CAP="${NO_PROGRESS_CAP:-12}"
no_progress_streak=0
last_snapshot=""
progress_snapshot() {
  ls -l "$OUT"/*/*.jsonl 2>/dev/null | md5 2>/dev/null || find "$OUT" -name '*.jsonl' -newer "$OUT/checkpoint.json" 2>/dev/null | md5 2>/dev/null || echo "none"
}
while true; do
  if [ -f "$STOP_FILE" ]; then
    log "stop-file present — exiting (campaign completed or manually stopped)"
    exit 0
  fi
  if campaign_finished; then
    log "run-order exhausted (all cells skip) — campaign COMPLETE"
    touch "$STOP_FILE"
    exit 0
  fi
  if supervisor_orphan_alive; then
    sp=$(cat "$SUP_PIDFILE" 2>/dev/null)
    log "orphan supervisor $sp still alive — killing before takeover (prevents double supervisor)"
    kill "$sp" 2>/dev/null || true
    sleep 2
  fi
  if ! device_lost; then
    # L3: exponential backoff 30s..300s per attempt; overall cap ~6h.
    backoff=$((30 * 2 ** (device_lost_total > 4 ? 4 : device_lost_total)))
    [ "$backoff" -gt "$DEVICE_BACKOFF_MAX_S" ] && backoff="$DEVICE_BACKOFF_MAX_S"
    log "device missing — waiting ${backoff}s (loss window ${device_lost_total}s)"
    sleep "$backoff"
    device_lost_total=$((device_lost_total + backoff))
    if [ "$device_lost_total" -ge "$DEVICE_LOSS_GIVE_UP_S" ]; then
      log "device lost ${device_lost_total}s total — give up (need human)"
      exit 2
    fi
    continue
  fi
  device_lost_total=0
  pass=$((crash_streak + 1))
  nowsnap=$(progress_snapshot)
  if [ "$nowsnap" = "$last_snapshot" ]; then
    no_progress_streak=$((no_progress_streak + 1))
    if [ "$no_progress_streak" -ge "$NO_PROGRESS_CAP" ]; then
      log "no progress for $NO_PROGRESS_CAP passes (livelock?) — give up (need human)"
      exit 5
    fi
  else
    no_progress_streak=0
  fi
  last_snapshot="$nowsnap"
  log "--- launching supervisor (pass $pass, no-progress $no_progress_streak/$NO_PROGRESS_CAP) ---"
  bash "$HERE/supervisor.sh" --config "$CONFIG" --script "$SCRIPT" --run &
  SUPERVISOR_PID=$!
  echo "$SUPERVISOR_PID" > "$SUP_PIDFILE"
  set +e
  wait "$SUPERVISOR_PID"
  ec=$?
  set -e
  SUPERVISOR_PID=""
  rm -f "$SUP_PIDFILE"
  if [ "$ec" -ne 0 ]; then
    crash_streak=$((crash_streak + 1))
    if [ "$crash_streak" -ge "$CRASH_LOOP_CAP" ]; then
      cb=$((30 * 2 ** (crash_streak - CRASH_LOOP_CAP)))
      [ "$cb" -gt "$CRASH_BACKOFF_MAX_S" ] && cb="$CRASH_BACKOFF_MAX_S"
      log "supervisor crash ×$crash_streak — backing off ${cb}s (deterministic failure?)"
      sleep "$cb"
      if [ "$crash_streak" -ge $((CRASH_LOOP_CAP * 12)) ]; then
        log "crash-loop persists after long backoff — give up (need human)"
        exit 4
      fi
    else
      log "supervisor exited with code $ec (crash streak $crash_streak) — resuming loop"
      sleep 5
    fi
  else
    crash_streak=0
    log "supervisor exited cleanly (code 0) — resuming loop"
    sleep 5
  fi
done