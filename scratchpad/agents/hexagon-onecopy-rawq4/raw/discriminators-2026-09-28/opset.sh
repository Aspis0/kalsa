#!/bin/sh
# HTP execute-op counts on the real batches (ops whose dims contain the ubatch size, default 128;
# the 2-token warmup is excluded), by op and destination name with layer indices removed.
# Two runs place ops identically on HTP iff their tables match. Usage: opset.sh LOG[.gz] [UBATCH]
set -eu
case "$1" in *.gz) cat_log="gunzip -c" ;; *) cat_log="cat" ;; esac
$cat_log "$1" | grep -a 'execute-op ' | awk -F'|' -v ub=":${2:-128}" '{
    op = $1; sub(/.*execute-op /, "", op)
    d = $2; sub(/.* -> /, "", d); gsub(/-[0-9]+$/, "", d); gsub(/[0-9]+/, "#", d)
    if (index($3 " ", ub " ") || index($3, ub ":")) print op, d
}' | sort | uniq -c
