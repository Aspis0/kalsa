#!/usr/bin/env bash
# Build the untested good endpoint, then the first classic-bisect midpoint.
set -u

readonly HERE="/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/qdc-npu-bisect-64"
readonly BUILDER="$HERE/build-kit.sh"
readonly REPO="/Users/marco/Projects/kalsallama"
readonly GOOD="022458a28b4539468f75b41ddbf10a2263e1f5a4"
readonly MIDPOINT="990e3bfee333dad19499722cfa4102a3478d7a8b"

printf '[%s] start good endpoint %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$GOOD"
if "$BUILDER" "$GOOD"; then
    printf '[%s] good endpoint complete\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
else
    rc=$?
    printf '[%s] good endpoint failed exit=%s; midpoint not started\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc"
    exit "$rc"
fi

printf '[%s] start midpoint index=12 %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MIDPOINT"
if "$BUILDER" "$MIDPOINT"; then
    printf '[%s] midpoint complete\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
else
    rc=$?
    printf '[%s] midpoint failed exit=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc"
    exit "$rc"
fi

git -C "$REPO" status --short --branch >/dev/null
