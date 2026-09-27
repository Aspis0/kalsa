# dryrun-lib.sh — fixture-runner helpers for the qdc-heat-3way dry-run.
# One responsibility: PASS/FAIL accounting, seeds, run_fixture, and the
# assertion helpers. Sourced by dryrun.sh (which sets CELL and the shell
# options); topic files consume these — no fixture lives here.

CELL="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0; RAW=""; RC=0; STATE=""
pass() { PASS=$((PASS + 1)); printf 'PASS  %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'FAIL  %s -- %s\n' "$1" "$2"; }
eq() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected=[$2] got=[$3]"; fi; }
ne() { if [ "$2" != "$3" ]; then pass "$1"; else fail "$1" "expected NOT [$2]"; fi; }
has() { case "$3" in *"$2"*) pass "$1" ;; *) fail "$1" "missing [$2] in [$(printf '%s' "$3" | head -c 200)]" ;; esac; }
count_is() { eq "$1" "$2" "$(grep -ac "$3" "$4" 2>/dev/null || true)"; }

seed_stale() { # A2 + audit3 A-N2: stale stop_request, END AND kill marker
  local name="$1"
  mkdir -p "$CELL/raw/dry-$name"
  printf 'fake\n' > "$CELL/raw/dry-$name/stop_request"
  printf 'END reason=stop_fake\n' > "$CELL/raw/dry-$name/END.txt"
  printf 'stale\n' > "$CELL/raw/dry-$name/kill_unverified"
}
seed_stayon() { printf '1\n' > "$STATE/stay_on_while_plugged_in"; }
# Pins for fixtures: valid keys + in-band rate (0.5 <= 10 <= 25), bound to the
# fake board (serial=fakes23, soc=SM8550) and the real model/kit hashes.
seed_calib_ok() {
  printf 'htp_ops_floor_per_tok=10.0000\nserial=fakes23\nsoc=SM8550\nmodel_sha=%s\nkit_sha=%s\nmeasured_npu_ops=80\nmeasured_npu_tokens=4\n' \
    'a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03' \
    'dccf0865753557eb76e253af0157cb53a70346978ea48184fdf0cd884424c7ea' > "$CELL/calib.ok"
}
seed_calib_mismatch() { # audit3 A-N6: pin from another board
  seed_calib_ok
  sed -i '' 's/^serial=.*/serial=otherboard/' "$CELL/calib.ok"
}
seed_calib_badrate() { # audit3 A-N5a: rate outside [0.5,25] ops/token
  seed_calib_ok
  sed -i '' 's/^htp_ops_floor_per_tok=.*/htp_ops_floor_per_tok=999.0000/' "$CELL/calib.ok"
}
seed_prior_restore() { # A-6: previous run SIGKILLed — state holds pre-run
  # values, the fake device still holds the mutations.
  printf 'SER=fakes23\nSCREEN_OFF_TIMEOUT=60000\nSTAYON=1\nJOB=dry-prevrun\n' > "$CELL/.restore-state"
  printf '1800000\n' > "$STATE/screen_timeout"
  printf '3\n' > "$STATE/stay_on_while_plugged_in"
}

run_fixture() {
  # arg3 (optional, no `=`): seed-function name, called after the state wipe
  # and before d_run; everything else is a DRY_*/tuning env assignment.
  local name="$1" order="$2" seed=""
  shift 2
  if [ "$#" -gt 0 ] && [[ "$1" != *=* ]]; then seed="$1"; shift; fi
  STATE="/tmp/qdc-heat3way-fake-$name"
  rm -rf "$STATE" "$CELL/raw/dry-$name"
  mkdir -p "$STATE" "$CELL/raw"
  # Fixture isolation for A-6/NEW-1: the driver must CONSUME a stale state
  # and a stale calib.ok must not leak between fixtures, so each fixture
  # starts with none unless it seeds one on purpose.
  rm -f "$CELL/.restore-state" "$CELL/calib.ok"
  [ -z "$seed" ] || "$seed" "$name"
  set +e
  # POLL_S intentionally NOT set here: fixtures run the PRODUCTION cadence
  # (15 s) unless they override it (A-10).
  env ADB_BIN="$CELL/dryrun-adb.sh" FAKE_ADB_STATE="$STATE" ADB_PORT=5037 \
      COOL_POLL_S=1 TAIL_S=0 SAMPLER_WAIT_S=0 BATT_TRUST_INTERVAL_S=1 \
      "$@" \
      bash "$CELL/d_run.sh" "dry-$name" "$order" 20 > "$CELL/raw/dryrun-$name.log" 2>&1
  RC=$?
  set -e
  RAW="$CELL/raw/dry-$name"
  # Every shell string above went through dash -n in the fake: a malformed
  # composition (run-2's double `&&`) must fail the fixture loudly.
  if [ -f "$STATE/shell_syntax_error.log" ]; then
    fail "$name shell-syntax" "$(head -2 "$STATE/shell_syntax_error.log" | tr '\n' ' ')"
  else
    pass "$name shell-syntax"
  fi
}
rows() { awk 'NR > 1' "$RAW/results.tsv" 2>/dev/null | wc -l | tr -d '[:space:]'; }
end_reason() { sed -n 's/^END reason=//p' "$RAW/END.txt" 2>/dev/null | tail -1; }
col() { awk -F'\t' -v r="$1" -v c="$2" 'NR == r + 1 { print $c }' "$RAW/results.tsv" 2>/dev/null; }
assert_end() { eq "$1 END" "$2" "$(end_reason)"; }
assert_no_end() {
  if [ ! -f "$RAW/END.txt" ]; then pass "$1 no-END (pre-trap exit)"; else fail "$1 no-END" "$(end_reason)"; fi
}
assert_restore() {
  if [ -f "$RAW/restore.log" ] && grep -aq 'state=1 .*rc=0' "$RAW/restore.log"; then
    pass "$1 restore-ran"
  else
    fail "$1 restore-ran" "$(cat "$RAW/restore.log" 2>/dev/null || echo missing)"
  fi
  eq "$1 timeout-restored" 60000 "$(cat "$STATE/screen_timeout" 2>/dev/null || echo missing)"
}
assert_clean_shell() {
  if [ -f "$STATE/unknown_shell.log" ]; then
    fail "$1 no-unknown-shell" "$(head -3 "$STATE/unknown_shell.log")"
  else
    pass "$1 no-unknown-shell"
  fi
}
trust_verdict() { sed -n 's/^untrusted=//p' "$RAW/battery_trust.txt" 2>/dev/null | tail -1; }
all_ok() { awk -F'\t' 'NR>1 && $4!="OK"{printf "%s ", $2}' "$RAW/results.tsv" 2>/dev/null; }
log_ts() { sed -n "s/^\[\([0-9:]*\)\] $2.*$/\1/p" "$1" 2>/dev/null | head -1; }
ts_epoch() { date -j -f '%H:%M:%S' "$1" +%s 2>/dev/null; }

