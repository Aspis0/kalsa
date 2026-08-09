#!/usr/bin/env bash
# Dry-run harness: ABORT_MEM combinato
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$DIR/lib_guardrails.sh"
export GR_DRY_RUN=1
export GR_SAMPLE_DT_S=0.5
export MEM_ABORT_HOLD_S=10
FAIL=0

echo "=== CASE A: mem bassa (13 MiB) + die freddo (29 C) -> NO kill, solo MEM_LOW ==="
guardrails_reset
# 13 MiB = 13312 kB; 29 C = 29000 mc
# 10s hold / 0.5s = 20 ticks
for i in $(seq 1 22); do
  guardrail_tick 29000 13312
done
echo "  GR_ACTION=$GR_ACTION (expect CONTINUE)"
echo "  GR_LOW_MF_S=$GR_LOW_MF_S GR_MEM_COMBINED_S=$GR_MEM_COMBINED_S GR_MEM_LOW_LOGGED=$GR_MEM_LOW_LOGGED"
if [ "$GR_ACTION" != "CONTINUE" ]; then echo "FAIL A: expected CONTINUE got $GR_ACTION"; FAIL=1; else echo "PASS A"; fi

echo "=== CASE B: mem bassa (13 MiB) + die 86 C sostenuto -> ABORT_MEM ==="
guardrails_reset
# 86 C = 86000 mc (>85000)
for i in $(seq 1 22); do
  guardrail_tick 86000 13312
done
echo "  GR_ACTION=$GR_ACTION (expect ABORT_MEM)"
echo "  GR_LAST_DETAIL=$GR_LAST_DETAIL"
echo "  GR_MEM_COMBINED_S=$GR_MEM_COMBINED_S"
if [ "$GR_ACTION" != "ABORT_MEM" ]; then echo "FAIL B: expected ABORT_MEM got $GR_ACTION"; FAIL=1; else echo "PASS B"; fi

echo "=== CASE C: mem ok (500 MiB) + die 86 C -> NO ABORT_MEM ==="
guardrails_reset
for i in $(seq 1 22); do
  guardrail_tick 86000 512000
done
echo "  GR_ACTION=$GR_ACTION (expect CONTINUE)"
if [ "$GR_ACTION" != "CONTINUE" ]; then echo "FAIL C: expected CONTINUE got $GR_ACTION"; FAIL=1; else echo "PASS C"; fi

echo "=== CASE D: early combined (5s < 10s hold) -> no abort yet ==="
guardrails_reset
for i in $(seq 1 10); do
  guardrail_tick 86000 13312
done
echo "  GR_ACTION=$GR_ACTION GR_MEM_COMBINED_S=$GR_MEM_COMBINED_S (expect CONTINUE, ~5s)"
if [ "$GR_ACTION" != "CONTINUE" ]; then echo "FAIL D"; FAIL=1; else echo "PASS D"; fi

if [ "$FAIL" = "0" ]; then echo "ALL DRY-RUN PASS"; exit 0; else echo "DRY-RUN FAIL"; exit 1; fi
