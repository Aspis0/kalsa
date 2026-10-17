#!/usr/bin/env bash
# usage: oparse.sh LABEL — KALSA_BENCH_PROBS rows -> LABEL-probs.jsonl; first 32 ids -> LABEL-ids.txt.
# Ids come from the KALSA_BENCH_TOKENS line when the turn finished. A turn killed at the 48 C stop never logs that line,
# so the ids fall back to the tok field of steps 0-31 of the probs rows (checked to be contiguous).
set -u; . "$(dirname "$0")/env.sh" 2>/dev/null || true
f=$OUT/$1-kalsa.txt
grep "KALSA_BENCH_PROBS " $f | sed 's/^.*KALSA_BENCH_PROBS //' | tr -d '\r' > $OUT/$1-probs.jsonl
if grep -q "KALSA_BENCH_TOKENS " $f; then
  grep "KALSA_BENCH_TOKENS " $f | tail -1 | sed 's/^.*KALSA_BENCH_TOKENS //' | jq -r '.ids[:32][]' > $OUT/$1-ids.txt 2>/dev/null
  src=tokens-line
else
  jq -s -r '[.[] | select(.step < 32)] | sort_by(.step) | .[].tok' $OUT/$1-probs.jsonl > $OUT/$1-ids.txt 2>/dev/null
  src=probs-rows
fi
contig=$(jq -s -r '[.[] | select(.step < 32) | .step] | unique | (if . == [range(0;32)] then "contiguous" else "GAP" end)' $OUT/$1-probs.jsonl 2>/dev/null)
echo "$1 ids=$(wc -l < $OUT/$1-ids.txt | tr -d ' ') from=$src probs=$(wc -l < $OUT/$1-probs.jsonl | tr -d ' ') steps0_31=${contig:-NA} tokens_lines=$(grep -c 'KALSA_BENCH_TOKENS ' $f)"
