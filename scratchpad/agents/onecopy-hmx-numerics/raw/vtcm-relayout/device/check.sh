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

# 0. Hash gate: every number below depends on these files, and $R/input/ is a directory shared with
#    other experiments, so the expected sha256 values live here rather than in the report's prose
#    (audit 4.5). Refuse to run anything on a mismatch. The pair's fourth artifact
#    (libggml-hexagon.a) is a host-side static lib, not on the device; its bytes are inside the two
#    host binaries hashed below.
sha_ok=1
hash_gate() { # hash_gate EXPECTED PATH : records the result in $D/check.txt, sha_ok=0 on any mismatch
  got=$(sha256sum "$2" 2>/dev/null | cut -d' ' -f1)
  if [ "$got" = "$1" ]; then
    echo "sha256 OK        $2" >> $D/check.txt
  else
    echo "sha256 MISMATCH  $2 expected=$1 got=${got:-missing}" >> $D/check.txt
    sha_ok=0
  fi
}
# new pair (tree of 7e4945582, REPORT-vtcm-relayout.md section 1)
hash_gate ca9086268b1b53ecc49b65f6d23dc049485c4ff19e0512450fbc8d5dddd66f77 $D/bin/llama-bench
hash_gate 43d8d829134dd042a5c21d7f84cf2a0e4970d8d2f76ed30ef4d5305d6f9241d1 $D/bin/llama-perplexity
hash_gate 717d26227240adfd773438d65c79316f3ecc350e8b6f11eb9a435217def29a71 $D/dsp/libggml-htp-v73.so
# the O arm's pair (df538c50c, s23-onecopy-abba-df538c50c/REPORT.md)
hash_gate 5bcb3f7478318157c52b1893d68937ea35db8497c13e4a6e396eabba71f840d9 $OLD/bin/llama-bench
hash_gate b357d834bdfcf164e2bf520c07038f24c415d49265a497d1ccedfc6d65aab245 $OLD/bin/llama-perplexity
hash_gate 2808f70f0ad480efef4b24c1bd0c327843fe26e2ce0045e9bf36ebc4e96fe7dd $OLD/dsp/libggml-htp-v73.so
# KLD inputs
hash_gate a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03 $M
hash_gate bca6ac9fd2d398f73bd21b7910e279d12f79c9744dfa49294cb810e781c06728 $R/input/kld_english_fixture.txt
hash_gate 5aa28ec2057f857ff96f463b3562a8ce9eb8f3b2f3186cb6dd06f01f23bcca6f $R/input/cause-cpu-base.logits
if [ "$sha_ok" -ne 1 ]; then
  echo "HASH GATE FAILED - refusing to run any check" | tee -a $D/check.txt
  exit 1
fi

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
