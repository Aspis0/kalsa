#!/usr/bin/env bash
# Campaign supervisor. Modes: --dry-run (3 turns), --phase0 (implemented,
# not invoked unless asked), --run (full factorial; implemented, not invoked
# unless asked).
#
#   scripts/campaign/supervisor.sh --config campaigns/ciswire.json \
#     --script campaigns/ciswire/script-dry.json --dry-run
set -euo pipefail

_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$_HERE/../.." && pwd)"
CAMPAIGN_ROOT="$_HERE"

# shellcheck source=../device-share-send.sh
source "$REPO/scripts/device-share-send.sh"
source "$_HERE/flags.sh"
source "$_HERE/conversation.sh"
source "$_HERE/logcat.sh"
source "$_HERE/watchdog.sh"
source "$_HERE/recovery.sh"
source "$_HERE/turn.sh"
source "$_HERE/oneTurn.sh"
source "$_HERE/phase0.sh"
set -euo pipefail

CONFIG=""
SCRIPT=""
MODE=""
SEED=""

usage() {
  echo "usage: $0 --config FILE --script FILE --dry-run|--phase0|--run [--seed N]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --config) CONFIG="${2:?}"; shift 2 ;;
    --script) SCRIPT="${2:?}"; shift 2 ;;
    --dry-run) MODE=dry-run; shift ;;
    --phase0) MODE=phase0; shift ;;
    --run) MODE=run; shift ;;
    --seed) SEED="${2:?}"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
done
[ -n "$CONFIG" ] && [ -n "$SCRIPT" ] && [ -n "$MODE" ] || usage
CONFIG="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"
SCRIPT="$(cd "$(dirname "$SCRIPT")" && pwd)/$(basename "$SCRIPT")"

node "$CAMPAIGN_ROOT/config.mjs" "$CONFIG" >/dev/null

_json() {
  python3 -c '
import json,sys
c=json.load(open(sys.argv[1],encoding="utf-8"))
p=sys.argv[2].split(".")
x=c
for k in p:
    if k.isdigit(): x=x[int(k)]
    else: x=x[k]
if isinstance(x,(dict,list)): json.dump(x,sys.stdout)
else: print(x if x is not None else "")
' "$1" "$2"
}

export PKG="$(_json "$CONFIG" pkg)"
export ANDROID_SERIAL="$(_json "$CONFIG" device)"
export CAMPAIGN_SERIAL="$ANDROID_SERIAL"
export BENCH_TARGET=device
export MODEL_ID="$(_json "$CONFIG" model)"
export LOCALE_VAL="$(_json "$CONFIG" locale)"
CAMPAIGN_TURN_TIMEOUT_MS="$(_json "$CONFIG" watchdog.turnTimeoutMs)"
CAMPAIGN_TELEMETRY_GAP_MS="$(_json "$CONFIG" watchdog.telemetryGapMs)"
CAMPAIGN_POLL_MS="$(_json "$CONFIG" watchdog.pollMs)"
CAMPAIGN_THERMAL_PAUSE="$(_json "$CONFIG" recovery.thermalPause)"
CAMPAIGN_THERMAL_MAX_C="$(_json "$CONFIG" recovery.thermalMaxC)"
export CAMPAIGN_TURN_TIMEOUT_MS CAMPAIGN_TELEMETRY_GAP_MS CAMPAIGN_POLL_MS CAMPAIGN_THERMAL_PAUSE CAMPAIGN_THERMAL_MAX_C

DATE_STAMP=$(date +%Y-%m-%d)
RESULTS_REL="$(_json "$CONFIG" resultsDir)"
[ -n "$RESULTS_REL" ] || RESULTS_REL="results/ciswire-campaign"
# device-share-send.sh defaults OUT=out/device/share-send; always overwrite
# unless the caller set CAMPAIGN_OUT.
OUT="${CAMPAIGN_OUT:-$REPO/$RESULTS_REL/$DATE_STAMP}"
mkdir -p "$OUT"
export OUT

for checkpoint in "$REPO/$RESULTS_REL"/*/checkpoint.json; do
  [ -f "$checkpoint" ] || continue
  checkpoint_dir=$(dirname "$checkpoint")
  checkpoint_date=$(basename "$checkpoint_dir")
  case "$checkpoint_date" in
    ????-??-??) ;;
    *) continue ;;
  esac
  [ "$checkpoint_date" = "$DATE_STAMP" ] && continue
  checkpoint_backup="$checkpoint_dir/checkpoint.$checkpoint_date.json"
  [ -f "$checkpoint_backup" ] || cp "$checkpoint" "$checkpoint_backup"
done
if [ -f "$OUT/checkpoint.json" ]; then
  checkpoint_conv=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("conv") or "")' \
    "$OUT/checkpoint.json" 2>/dev/null || true)
  if [[ "$checkpoint_conv" == dry-* || ! "$checkpoint_conv" =~ ^c[0-9]+- ]]; then
    checkpoint_backup="$OUT/checkpoint.$DATE_STAMP.json"
    [ -f "$checkpoint_backup" ] || cp "$OUT/checkpoint.json" "$checkpoint_backup"
  fi
fi
if [ -z "${PHASE0_WINBUDGET:-}" ]; then
  for budget_file in "$OUT/winbudget.txt" "$(dirname "$OUT")/winbudget.txt"; do
    if [ -f "$budget_file" ]; then
      PHASE0_WINBUDGET=$(sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$budget_file")
      break
    fi
  done
fi
export PHASE0_WINBUDGET

python3 -c 'import json,sys; json.dump(json.load(open(sys.argv[1]))["telemetry"], open(sys.argv[2],"w"))' \
  "$CONFIG" "$OUT/.telemetry-schema.json"

CAMPAIGN_CONFIG_APK=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("apk") or "")' "$CONFIG")
export CAMPAIGN_CONFIG_APK
LEXICON_REL=$(python3 -c '
import json,sys
c=json.load(open(sys.argv[1]))
for s in c.get("scorers") or []:
    if s.get("lexicon"):
        print(s["lexicon"]); break
' "$CONFIG")
LEXICON_PATH="$REPO/${LEXICON_REL:-campaigns/ciswire/lexicon.json}"

log "supervisor mode=$MODE serial=$ANDROID_SERIAL pkg=$PKG out=$OUT"

campaign_ensure_device || die "device missing (serial=$ANDROID_SERIAL) — refusing to fake jsonl"
[ "$(campaign_adb_state)" = "device" ] || die "adb get-state is not device"
device_keepawake_begin
campaign_logcat_start "$OUT/logcat.txt"
trap 'campaign_logcat_stop; device_termux_wakelock_restore; _device_session_restore' EXIT

campaign_arm_begin() {
  campaign_write_flags
  campaign_wipe_chat
  campaign_logcat_clear_arm
  campaign_launch
  campaign_wait_ready || die "arm ${CAMPAIGN_ARM_ID:-}: never Pronto/Ready"
}

campaign_profile_jsonl() {
  node "$REPO/scripts/responseProfile.mjs" --lexicon "$LEXICON_PATH" "$1"
}

campaign_run_script_turns() {
  local script_json="${1:?}" n="${2:?}" start="${3:-1}" i user
  SCRIPT="$script_json"
  for i in $(seq "$start" "$n"); do
    user=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["turns"][int(sys.argv[2])]["user"])' "$SCRIPT" "$((i - 1))")
    # Robustness: a single turn must never kill the whole campaign loop (set -e).
    # A failed turn (non-zero from campaign_one_turn) must NOT advance the
    # conversation: return 1 so mode_run skips the profile write and the next
    # pass resumes from this exact turn. The old `|| true` silently burned
    # turns — c1-B completed 2/24 (the bug that pollutes profiles).
    campaign_one_turn "$i" "$user" || return 1
  done
}

campaign_run_script_intents() {
  local script_json="${1:?}" want="$2" i intent user
  SCRIPT="$script_json"
  i=0
  while IFS= read -r intent; do
    i=$((i + 1))
    case ",$want," in
      *",$intent,"*)
        user=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["turns"][int(sys.argv[2])]["user"])' "$SCRIPT" "$((i - 1))")
        campaign_one_turn "$i" "$user"
        ;;
    esac
  done <<EOF
$(python3 -c 'import json,sys
for t in json.load(open(sys.argv[1]))["turns"]:
    print(t["intent"])
' "$SCRIPT")
EOF
}

campaign_load_arm() {
  local arm_id="$1"
  read -r COMPACTION_VAL MEMORY_VAL TOOLHELP_VAL <<EOF
$(python3 -c 'import json,sys
c=json.load(open(sys.argv[1]))
a=next(x for x in c["arms"] if x["id"]==sys.argv[2])["flags"]
print(a["kalsa.context.compaction"], a["kalsa.memory.enabled"], a["kalsa.ciswire.toolhelp"])
' "$CONFIG" "$arm_id")
EOF
}

campaign_load_variant_params() {
  local vid="$1"
  FLAG_PARAMS=$(python3 -c 'import json,sys
c=json.load(open(sys.argv[1])); vid=sys.argv[2]
v=next(x for x in c["variants"] if x["id"]==vid)
for k,val in (v.get("params") or {}).items():
    print(f"{k}={val}")
' "$CONFIG" "$vid")
}

mode_dry_run() {
  CAMPAIGN_ARM_ID=R1
  CAMPAIGN_VARIANT_ID=B
  CAMPAIGN_CONV_ID=dry-1
  campaign_load_arm R1
  FLAG_PARAMS=""
  mkdir -p "$OUT/$CAMPAIGN_ARM_ID"
  rm -f "$OUT/$CAMPAIGN_ARM_ID/${CAMPAIGN_CONV_ID}.jsonl" \
    "$OUT/$CAMPAIGN_ARM_ID/${CAMPAIGN_CONV_ID}.profile.json"
  campaign_arm_begin
  local n
  n=$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["turns"]))' "$SCRIPT")
  log "dry-run $n turns arm=R1 variant=B"
  campaign_run_script_turns "$SCRIPT" "$n"
  local jsonl="$OUT/$CAMPAIGN_ARM_ID/${CAMPAIGN_CONV_ID}.jsonl"
  campaign_profile_jsonl "$jsonl"
  log "dry-run done jsonl=$jsonl"
}

mode_run() {
  local seed cells_file nconv nturns arm_id v conv_id action start_turn
  seed="${SEED:-}"
  cells_file="$OUT/run-order.json"
  if [ ! -f "$cells_file" ]; then
    node "$CAMPAIGN_ROOT/runOrder.mjs" "$CONFIG" "$seed" "$OUT"
  else
    log "resume: keeping $cells_file"
  fi
  nconv=$(node "$CAMPAIGN_ROOT/config.mjs" --n-per-variant "$CONFIG")
  nturns=$(_json "$CONFIG" turns)
  log "run nPerVariant=$nconv nturns=$nturns (48 conv if 8×2×3) file=$cells_file"
  local plan="$OUT/.resume-plan.txt"
  node "$CAMPAIGN_ROOT/resume.mjs" --root "$OUT" --cells "$cells_file" --nconv "$nconv" --nturns "$nturns" \
    >"$plan" || die "resume.mjs exit $?"
  # N1 (re-audit GLM): adb/sql calls inside the loop forward stdin, which is
  # the plan FILE itself (done < "$plan") — one call kills the loop after the
  # first cell. Read the plan into an array BEFORE the loop: the loop body's
  # stdin stays free, and no fd juggling (bash 3.2 closes function fds).
  plan_lines=()
  while IFS= read -r pline; do
    plan_lines+=("$pline")
  done < "$plan"
  for pline in "${plan_lines[@]}"; do
    read -r arm_id v conv_id action start_turn <<< "$pline"
    [ -z "$arm_id" ] && continue
    CAMPAIGN_ARM_ID="$arm_id"
    CAMPAIGN_VARIANT_ID="$v"
    CAMPAIGN_CONV_ID="$conv_id"
    campaign_load_arm "$arm_id"
    campaign_load_variant_params "$v"
    if [ "$action" = "resume" ]; then
      log "resume $arm_id $v $conv_id from turn $start_turn"
      campaign_restore_same_conv
    elif [ "$action" = "invalid" ]; then
      # N2/N3 (re-audit GLM): cell has holes — quarantine the jsonl (data
      # preserved, not analyzed), wipe the device chat, restart from turn 1.
      # Never restore_same_conv cross-cell (wrong chat on device) and never
      # resume inside a holey conversation (re-sends real turns).
      campaign_quarantine_conv
      campaign_arm_begin
      start_turn=1
      log "invalid $arm_id $v $conv_id — quarantined, restart from turn 1"
    else
      campaign_arm_begin
      start_turn=1
    fi
    # Robustness: one conversation (or one profile pass) must never stop the
    # campaign. Wrap the body so a cell failure logs and continues to the next
    # cell — the data for THIS cell is already written turn-by-turn by
    # campaign_store_turn, so a failure here only skips the profile.
    if campaign_run_script_turns "$SCRIPT" "$nturns" "$start_turn"; then
      campaign_profile_jsonl "$OUT/$CAMPAIGN_ARM_ID/${CAMPAIGN_CONV_ID}.jsonl"
    else
      log "WARN: conversation $CAMPAIGN_ARM_ID/$CAMPAIGN_CONV_ID did not complete cleanly"
    fi
  done
}

case "$MODE" in
  dry-run) mode_dry_run ;;
  phase0) campaign_phase0 "$SCRIPT" ;;
  run) mode_run ;;
  *) die "unknown mode $MODE" ;;
esac
