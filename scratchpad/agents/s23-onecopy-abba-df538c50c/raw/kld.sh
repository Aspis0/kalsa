R=/data/local/tmp/govhtp
D=$R/onecopy-abba
export LD_LIBRARY_PATH=$R/lib
export ADSP_LIBRARY_PATH="$D/dsp;$R/lib"
M=/data/local/tmp/heat3way/ship.gguf
input keyevent 224
echo "== kld start $(date +%s)" > $D/kld.txt
env GGML_HEXAGON_VERBOSE=1 GGML_HEXAGON_OPFUSION=0 GGML_HEXAGON_RAW_HMX=1 GGML_HEXAGON_HOSTBUF=1 \
  $D/bin/llama-perplexity -m $M -f $R/input/kld_english_fixture.txt -c 512 -b 512 -ub 1 -ngl 99 \
  -dev HTP0 -lm none --no-warmup --chunks 2 \
  --kl-divergence-base $R/input/cause-cpu-base.logits --kl-divergence -lv 5 > $D/kld_onecopy.log 2>&1
echo "exit=$?" >> $D/kld.txt
grep -m1 -E "raw-row matvec paths" $D/kld_onecopy.log >> $D/kld.txt
input keyevent 224
echo "== kld after $(date +%s)" >> $D/kld.txt
