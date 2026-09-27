#!/bin/bash
# dryrun.sh — fixture matrix for d_run.sh against dryrun-adb.sh (fake adb).
# One responsibility: orchestrate the matrix and print the summary; the
# helpers live in dryrun-lib.sh and the fixtures are split BY TOPIC:
# dryrun-core.sh (happy path, orders, proofs, fingerprints),
# dryrun-stops.sh (safety stops, polling, kill verification),
# dryrun-paths.sh (lifecycle: stale state, timeout, decode, restore, signals).
# All sourced in one shell so the PASS/FAIL counters are shared. Mac only;
# no device, no phone, no QDC.
set -euo pipefail
# Byte-oriented parsing like the driver: some REAL device logs carry
# non-UTF-8 bytes (raw/s23-calib-3/...calnpu.load.log is "Non-ISO
# extended-ASCII"), and awk/sed/grep must treat them as bytes on both
# the Mac and the fake.
export LC_ALL=C
CELL="$(cd "$(dirname "$0")" && pwd)"
source "$CELL/dryrun-lib.sh"
# arm_fingerprint/arm_parse_proof are exercised against the COMMITTED real
# S23 calib logs (dryrun-core's real-log fixture) — sourced for that.
source "$CELL/arm.sh"
source "$CELL/dryrun-core.sh"
source "$CELL/dryrun-stops.sh"
source "$CELL/dryrun-paths.sh"

echo
echo "dryrun summary: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
