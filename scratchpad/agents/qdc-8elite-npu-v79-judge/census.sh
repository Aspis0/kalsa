#!/bin/sh
if [ "$#" -ne 2 ]; then
    echo "usage: sh census.sh <ops_log.txt> <MUL_MAT|MUL_MAT_ID>" >&2
    exit 2
fi
out=$1.census.txt
/usr/bin/awk -v op="$2" -f "$(dirname "$0")/census.awk" "$1" > "$out"
status=$?
cat "$out"
exit "$status"
