#!/usr/bin/env bash
# usage: oparse.sh LABEL — from raw/$BOARD/LABEL-kalsa.txt: ids (first 32 of KALSA_BENCH_TOKENS) -> LABEL-ids.txt, KALSA_BENCH_PROBS jsonl -> LABEL-probs.jsonl
set -u; . "$(dirname "$0")/env.sh" 2>/dev/null || true
f=$OUT/$1-kalsa.txt
sed 's/^.*KALSA_BENCH_TOKENS //' <(grep "KALSA_BENCH_TOKENS " $f | tail -1) | jq -r '.ids[:32][]' > $OUT/$1-ids.txt 2>/dev/null
grep "KALSA_BENCH_PROBS " $f | sed 's/^.*KALSA_BENCH_PROBS //' | tr -d '\r' > $OUT/$1-probs.jsonl
echo "$1 ids=$(wc -l < $OUT/$1-ids.txt | tr -d ' ') probs=$(wc -l < $OUT/$1-probs.jsonl | tr -d ' ') tokens_lines=$(grep -c 'KALSA_BENCH_TOKENS ' $f)"
