# Correctness and smoke checks of the new build. Source env.sh first, then: . $D/check.sh
# 1. KLD (ub 1, recipe of the 974a31e79 / df538c50c reports), unplugged. The paired dot makes the same bits
#    as the per-row one (hexagon-sim gate), so the one-copy numbers must EQUAL df538c50c's, to every digit:
#      mean KLD 0.004608 +- 0.000243, max 0.042651, same top p 97.059 +- 0.749 %, mean PPL(Q) 33.920876 +- 5.178269
#    (two copies: 0.005313 / 0.094590 / 97.059 % / 33.994233). The L arm (RAWROW_PROBE=8) must equal N.
# 2. -p 32 -n 2 (the 32-row warmup ubatch that died with `dsp-rsp INTERNAL-ERROR` on df538c50c): EXIT=0.
# 3. kernel tag: every decode Q4_0 matvec must still say hvx-rawrow (10,956 in the tg32 profile run), 0 hvx-flat.
export ADSP_LIBRARY_PATH="$D/dsp;$R/lib"
kld() { name=$1; shift
  input keyevent 224
  echo "== kld $name start $(date +%s) [$(st)]" >> $D/check.txt
  env GGML_HEXAGON_VERBOSE=1 "$@" $D/bin/llama-perplexity -m $M -f $R/input/kld_english_fixture.txt -c 512 -b 512 -ub 1 -ngl 99 \
    -dev HTP0 -lm none --no-warmup --chunks 2 --kl-divergence-base $R/input/cause-cpu-base.logits --kl-divergence -lv 5 > $D/kld_$name.log 2>&1
  echo "exit=$?" >> $D/check.txt
  grep -E 'Mean +KLD|Maximum KLD|Same top p|Mean PPL\(Q\)' $D/kld_$name.log >> $D/check.txt
  grep -c -E 'dsp-error|NO-SUPPORT|CRASH|GGML_ABORT|Segmentation' $D/kld_$name.log | sed 's/^/errors=/' >> $D/check.txt
  grep -c 'hvx-rawrow' $D/kld_$name.log | sed 's/^/hvx-rawrow-lines=/' >> $D/check.txt
  input keyevent 224; sleep 60; }
rm -f $D/check.txt
kld one   $ONE
kld two   $TWO
kld one8  $ONE GGML_HEXAGON_RAWROW_PROBE=8

smoke() { name=$1; shift
  echo "== smoke $name start $(date +%s)" >> $D/check.txt
  env "$@" $D/bin/llama-bench -m $M -p 32 -n 2 -ub 32 -r 1 -t 5 -ngl 99 -dev HTP0 --load-mode none > $D/smoke_$name.log 2>&1
  echo "exit=$?" >> $D/check.txt
  grep -E 'pp32|tg2' $D/smoke_$name.log >> $D/check.txt
  grep -c -E 'INTERNAL-ERROR|GGML_ABORT' $D/smoke_$name.log | sed 's/^/errors=/' >> $D/check.txt; }
smoke p32 $ONE
smoke p32v $ONE GGML_HEXAGON_VERBOSE=1

# 4. two dot bits at once (8 | 16) are refused with a WARN and the run falls back to probe 0
echo "== probe 24 (two dot bits) $(date +%s)" >> $D/check.txt
env $ONE GGML_HEXAGON_RAWROW_PROBE=24 $D/bin/llama-bench -m $M -p 0 -n 2 -r 1 -t 5 -ngl 99 -dev HTP0 --load-mode none > $D/probe24.log 2>&1
echo "exit=$?" >> $D/check.txt
grep -c 'ignoring invalid GGML_HEXAGON_RAWROW_PROBE' $D/probe24.log | sed 's/^/ignored-warnings=/' >> $D/check.txt
grep -c 'RAWROW_PROBE=0' $D/probe24.log | sed 's/^/probe0-init-lines=/' >> $D/check.txt

echo "== profile tg32 $(date +%s)" >> $D/check.txt
env $ONE GGML_HEXAGON_PROFILE=1 GGML_HEXAGON_VERBOSE=1 $D/bin/llama-bench -m $M -p 0 -n 32 -r 1 -t 5 -ngl 99 -dev HTP0 --load-mode none -v > $D/profile_N.log 2>&1
echo "exit=$?" >> $D/check.txt
grep -c 'hvx-rawrow' $D/profile_N.log | sed 's/^/hvx-rawrow=/' >> $D/check.txt
grep -c 'hvx-flat' $D/profile_N.log | sed 's/^/hvx-flat=/' >> $D/check.txt
