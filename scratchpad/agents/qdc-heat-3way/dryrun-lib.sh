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
count_is() { eq "$1" "$2" "$(grep -c "$3" "$4" 2>/dev/null || true)"; }

seed_stale() { # A2: stale stop_request + END from a previous run of this job
  local name="$1"
  mkdir -p "$CELL/raw/dry-$name"
  printf 'fake\n' > "$CELL/raw/dry-$name/stop_request"
  printf 'END reason=stop_fake\n' > "$CELL/raw/dry-$name/END.txt"
}
seed_stayon() { printf '1\n' > "$STATE/stay_on_while_plugged_in"; }
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
  # Fixture isolation for A-6: the driver must CONSUME a stale state, so each
  # fixture starts with none unless it seeds one on purpose.
  rm -f "$CELL/.restore-state"
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
}
rows() { awk 'NR > 1' "$RAW/results.tsv" 2>/dev/null | wc -l | tr -d '[:space:]'; }
end_reason() { sed -n 's/^END reason=//p' "$RAW/END.txt" 2>/dev/null | tail -1; }
col() { awk -F'\t' -v r="$1" -v c="$2" 'NR == r + 1 { print $c }' "$RAW/results.tsv" 2>/dev/null; }
assert_end() { eq "$1 END" "$2" "$(end_reason)"; }
assert_no_end() {
  if [ ! -f "$RAW/END.txt" ]; then pass "$1 no-END (pre-trap exit)"; else fail "$1 no-END" "$(end_reason)"; fi
}
assert_restore() {
  if [ -f "$RAW/restore.log" ] && grep -q 'state=1 .*rc=0' "$RAW/restore.log"; then
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

