# Xiaomi (plugged, correctness only): localize the GPU-alone KL FAIL (mean 0.069) seen in run-xiaomi-correctness.sh,
# while GPU windows inside the npu/gpu/cpu rotation pass (~0.000006). Splits: repeat, gpu-first then cpu, cpu-first
# then gpu. Round 2: npu-then-gpu, gpu alone with xmem GEMM off, gpu alone with the plain Q6_K lm_head kernel.
R=/data/local/tmp/govhtp-xiaomi; M=$R/model/ship.gguf; B=$R/bin/governor-bench; REPORT=$R/gpusplit2_report.txt
export ADSP_LIBRARY_PATH="$R/dsp-rel"
shared() {
  env GGML_HEXAGON_HOSTBUF=1 GGML_HEXAGON_HOSTBUF_REPACK=1 GGML_HEXAGON_MBUF=832 GGML_OP_OFFLOAD_MIN_BATCH=1 \
      GGML_HEXAGON_ADMIT_OPS=7 GGML_OPENCL_TILE32_UNMEASURED=1 "$@"
}
skin() { dumpsys thermalservice | grep 'mName=skin' | sed -nE 's/.*mValue=([0-9.]+),.*/\1/p' | sort -n | tail -1; }
rm -f $REPORT; cd $R
for c in "ng npu,gpu" "xmem0 gpu" "q6plain gpu" "ngng npu,gpu,npu,gpu"; do
  set -- $c
  s=$(skin); s=${s%.*}; [ "${s:-0}" -ge 43 ] && { echo "STOP skin $s" >> $REPORT; break; }
  input keyevent 224
  case $1 in xmem0) X="GGML_OPENCL_ADRENO_XMEM_GEMM=0";; q6plain) X="GGML_OPENCL_HOST_Q6K_PLAIN=1";; *) X="KALSA_NOOP=1";; esac; if true; then
    shared env $X $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs $2 --logits-ref $R/twocopy.gbl --kld-max 0.01 -v > $R/split_$1.log 2>&1
  else
    shared $B --arm L -m $M -t 5 -r 1 --hop 32 --gen 128 --legs $2 --logits-ref $R/twocopy.gbl --kld-max 0.01 -v > $R/split_$1.log 2>&1
  fi
  echo "## $1 legs=$2 exit=$? skin=$(skin)" >> $REPORT
  grep -E '^leg_window|^kld' $R/split_$1.log | sed -E 's/ us=[0-9]+//' | cut -c1-200 >> $REPORT
  sleep 45
done
echo "== end" >> $REPORT
