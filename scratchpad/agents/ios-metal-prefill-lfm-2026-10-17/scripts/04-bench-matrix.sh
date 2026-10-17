#!/bin/bash
# Config matrix on this Mac's Metal, mirroring the app's llama.cpp settings.
# (a) app config: q8_0/q8_0 KV, fa auto  (b) f16/f16 KV
# (c) fa off + f16 KV                (d) ub 512
# Runs -p 2048 -n 0 (prefill) and -p 0 -n 128 (decode), 3 reps each.
set -u
BENCH=/tmp/lcpp-upstream-b11517/bin/llama-bench
MODEL=/Users/marco/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf
OUT="$1"
COMMON="-m $MODEL -ngl 99 -b 512 -t 4 -r 3 -o json"

run () {
  local tag="$1"; shift
  echo "===== $tag : $* =====" >> "$OUT"
  # warm the shader cache once per binary is already done; here just run
  "$BENCH" $COMMON "$@" 2>/dev/null >> "$OUT"
  echo "exit=$?" >> "$OUT"
  echo >> "$OUT"
}

: > "$OUT"
run "a_app_q8_faauto"  -ub 256 -fa auto -ctk q8_0 -ctv q8_0 -p 2048 -n 0
run "b_f16KV"          -ub 256 -fa auto -ctk f16  -ctv f16  -p 2048 -n 0
run "c_f16KV_faoff"    -ub 256 -fa off  -ctk f16  -ctv f16  -p 2048 -n 0
run "d_ub512_q8"       -ub 512 -fa auto -ctk q8_0 -ctv q8_0 -p 2048 -n 0

run "a_app_q8_faauto_tg"  -ub 256 -fa auto -ctk q8_0 -ctv q8_0 -p 0 -n 128
run "b_f16KV_tg"          -ub 256 -fa auto -ctk f16  -ctv f16  -p 0 -n 128
run "c_f16KV_faoff_tg"    -ub 256 -fa off  -ctk f16  -ctv f16  -p 0 -n 128
run "d_ub512_q8_tg"       -ub 512 -fa auto -ctk q8_0 -ctv q8_0 -p 0 -n 128

echo "ALLDONE" >> "$OUT"