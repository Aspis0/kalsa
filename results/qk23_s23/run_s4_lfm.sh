#!/system/bin/sh
# S4 LFM2.5-KEXP production smoke. noextra impl. Never HOST_REPACK/DUMP_Q.
DST=/data/local/tmp/s3oracle
cd "$DST" || exit 90
export LD_LIBRARY_PATH="$DST"
export GGML_OPENCL_LOG_KERNELS=1
unset GGML_OPENCL_HOST_REPACK
unset GGML_OPENCL_DUMP_Q
unset GGML_OPENCL_ORACLE
unset GGML_OPENCL_CVT_OPTS
unset GGML_OPENCL_MOE_OPTS
unset GGML_OPENCL_CVT_VARIANT
unset GGML_OPENCL_LOG_ALLOC
unset GGML_OPENCL_QK23_ORACLE
mkdir -p "$DST/logs"
OUT="$DST/logs/s4_lfm.out"
ERR="$DST/logs/s4_lfm.err"
MODEL=/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf
{
  echo "=== S4 LFM2.5-KEXP llama-bench smoke ==="
  date
  echo "unplugged_recorded_by_host"
  echo "LOG_KERNELS=1 HOST_REPACK unset DUMP_Q unset"
  echo "CMD=./llama-bench -m LFM2.5-KEXP -fa off -ngl 99 -t 4 -p 128 -n 64 -r 1 -o jsonl"
  echo "=== sha ==="
  sha256sum libggml-opencl.so libllama-bench-impl.so llama-bench
  echo "=== model ==="
  ls -l "$MODEL"
  sha256sum "$MODEL"
  echo "=== mem before ==="
  grep MemAvailable /proc/meminfo
} > "$OUT"
set +e
./llama-bench -m "$MODEL" -fa off -ngl 99 -t 4 -p 128 -n 64 -r 1 -o jsonl >> "$OUT" 2> "$ERR"
RC=$?
{
  echo "=== rc=$RC ==="
  echo "=== mem after ==="
  grep MemAvailable /proc/meminfo
  date
} >> "$OUT"
exit $RC
