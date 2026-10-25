#!/system/bin/sh
# ABBA A/B of the expert-drop policy on a streaming MoE, on ONE build and ONE harness.
#
#   A = streaming + drop policy   (--n-expert-used 6 --drop-cold-experts 1.0 --drop-no-renorm)
#   B = streaming, lossless       (model's own top-k, no drop)
#
# Both arms stream. The question is NOT "does streaming work" — it does — but whether the drop
# policy pays on THIS model, and that is regime-dependent: it is decided by the cache hit rate.
# Where the expert set nearly fits the cache there is nothing cold to drop and every drop level
# is a net loss (LFM2.5, 93.5% hit); where half the reads are re-reads of bytes already paid for,
# dropping is the recipe (Marco, ~50% hit). Read the hit rate in the output before reading the
# ratio — it is what says which regime you are in.
#
# --ubatch is NOT passed: 512 is llama.cpp's own default, and it is a closed lane with a number
# against it, so naming it here would dress a no-op up as part of the recipe.
#
# ABBA, not A-then-B: consecutive-run variance on this bench has reached +-50%, so a single pair
# cannot separate a result from drift. The order reversal cancels a monotone thermal trend
# instead of letting it land on whichever arm ran second.
#
# COOL_DC gates each run on battery temperature (deci-degrees C, e.g. 300 = 30.0C); 0 disables it.
# Needed on a phone with thermal headroom to boost: on an S23 one arm swung 5.69 -> 2.38 tok/s
# inside a single block over 2C, which no amount of ABBA ordering can cancel. A phone with no
# headroom (the Jelly) runs flat and does not need it -- its series was taken with the gate off
# and stays valid, because the gate changes when a run STARTS, not what it measures.
#
# Args: MODEL THREADS NGEN BLOCKS [CACHE_MB] [COOL_DC] [MAX_WAIT_S]
set -u
MODEL="$1"; THREADS="$2"; NGEN="$3"; BLOCKS="$4"; CACHE="${5:-2000}"
COOL_DC="${6:-0}"; MAX_WAIT="${7:-600}"
D=/data/local/tmp/bmoe
OUT=$D/abba.csv
LOGDIR=$D/abba
mkdir -p "$LOGDIR"
cd "$D" || exit 1
echo "block,order,arm,tok_s,s_per_tok,read_mib_per_tok,cache_hit_pct,rereads_per_tok,batt,temp,rc" > "$OUT"

PROMPT="Explain in one short paragraph why a mixture-of-experts model is large on disk but cheap per token."
BASE="--moe-stream --cache-mb $CACHE --dense-weights anon --overlap --io-threads 4"

run_arm() {  # block order arm
  b="$1"; o="$2"; arm="$3"
  log="$LOGDIR/b${b}_${o}_${arm}.log"
  if [ "$arm" = "A" ]; then
    extra="$BASE --n-expert-used 6 --drop-cold-experts 1.0 --drop-no-renorm"
  else
    extra="$BASE"
  fi
  if [ "$COOL_DC" -gt 0 ]; then
    waited=0
    while [ "$waited" -lt "$MAX_WAIT" ]; do
      t=$(dumpsys battery 2>/dev/null | grep "^  temperature" | awk '{print $2}')
      [ -z "$t" ] && break
      [ "$t" -le "$COOL_DC" ] && break
      sleep 20; waited=$((waited + 20))
    done
    echo "  cooldown ${waited}s -> ${t:-NA}"
  fi
  batt=$(dumpsys battery 2>/dev/null | grep "^  level" | awk '{print $2}')
  temp=$(dumpsys battery 2>/dev/null | grep "^  temperature" | awk '{print $2}')

  LD_LIBRARY_PATH=. ./bmoe-cli -m "$MODEL" -t "$THREADS" -c 4096 -n "$NGEN" \
    --temp 0 $extra -p "$PROMPT" > "$log" 2>&1 </dev/null
  rc=$?

  toks=$(grep 'generation:' "$log" | sed -n 's/.*(\([0-9.]*\) tok\/s.*/\1/p')
  spt=$(grep 'generation:' "$log" | awk '{print $4}')
  rd=$(grep 'moe-stream:' "$log" | sed -n 's/.*(\([0-9.]*\) MiB\/token).*/\1/p')
  hit=$(grep 'moe-cache:.*hit' "$log" | sed -n 's/.*: \([0-9.]*\)% hit.*/\1/p')
  rr=$(grep 'moe-cache:.*re-reads' "$log" | sed -n 's/.*(\([0-9.]*\)\/token).*/\1/p')
  echo "$b,$o,$arm,${toks:-NA},${spt:-NA},${rd:-NA},${hit:-NA},${rr:-NA},${batt:-NA},${temp:-NA},$rc" >> "$OUT"
  echo "b$b $o $arm -> ${toks:-NA} tok/s  hit=${hit:-NA}%  rc=$rc"
}

b=1
while [ "$b" -le "$BLOCKS" ]; do
  run_arm "$b" 1 A; run_arm "$b" 2 B; run_arm "$b" 3 B; run_arm "$b" 4 A
  b=$((b + 1))
done
echo "--- $OUT ---"; cat "$OUT"
