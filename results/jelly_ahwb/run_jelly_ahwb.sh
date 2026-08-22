#!/data/data/com.termux/files/usr/bin/bash
# Plugged-valid smoke: anon vs ahwb. Do NOT treat tok/s as a result.
set -u
OUT="${HOME}/experiments/jelly_ahwb"
BIN="${HOME}/bin/bmoe-cli.JELLY"
P2B="${HOME}/models/Qwen3.5-2B-Q4_K_M.gguf"
PLFM="${HOME}/models/LFM2.5-8B-A1B-Q4_K_M.gguf"
PROMPT='Explain mixture-of-experts routing in one short paragraph.'
mkdir -p "$OUT"
date -Iseconds | tee "$OUT/START.txt"
echo "PLUGGED_AC — times/joules INVALID; identity+RSS+stream-bytes only" | tee -a "$OUT/START.txt"
awk '/MemTotal|MemFree|MemAvailable/' /proc/meminfo | tee "$OUT/mem_pre.txt"
"$BIN" --version 2>"$OUT/ver.err" | tee "$OUT/version.txt"
sha256sum "$BIN" | tee "$OUT/bin.sha"

run_cell() {
  local name="$1"; shift
  local dir="$OUT/$name"
  mkdir -p "$dir"
  echo "=== $name ===" | tee "$dir/begin.txt"
  date -Iseconds | tee -a "$dir/begin.txt"
  awk '/MemTotal|MemFree|MemAvailable/' /proc/meminfo | tee "$dir/mem_before.txt"
  set +e
  "$BIN" "$@" -p "$PROMPT" -n 24 -t 2 -c 2048 --ubatch 256 --temp 0 \
    >"$dir/stdout.txt" 2>"$dir/stderr.txt"
  echo $? | tee "$dir/rc.txt"
  set -e
  awk '/MemTotal|MemFree|MemAvailable/' /proc/meminfo | tee "$dir/mem_after.txt"
  grep -E 'generation:|moe-stream:|moe-cache:|error:|ahwb|AHWB|dense|load ' "$dir/stderr.txt" "$dir/stdout.txt" \
    >"$dir/hits.txt" || true
  # generated text only (drop telemetry)
  grep -v -E '^(bmoe:|load |system_info|sampler |generate:|llama_|print_|main:|ggml_)' "$dir/stdout.txt" \
    | tail -n +1 >"$dir/gen.txt" || true
  date -Iseconds | tee "$dir/end.txt"
}

# Dense 2B
run_cell d2b_anon  -m "$P2B" --dense-weights anon
run_cell d2b_ahwb  -m "$P2B" --dense-weights ahwb

# MoE LFM2.5 free-tier shape
run_cell lfm_anon -m "$PLFM" --moe-stream --cache-mb 1500 --dense-weights anon \
  --overlap --io-threads 2 --n-expert-used 4
run_cell lfm_ahwb -m "$PLFM" --moe-stream --cache-mb 1500 --dense-weights ahwb \
  --overlap --io-threads 2 --n-expert-used 4

if command -v sha256sum >/dev/null; then
  sha256sum "$OUT"/d2b_anon/gen.txt "$OUT"/d2b_ahwb/gen.txt \
            "$OUT"/lfm_anon/gen.txt "$OUT"/lfm_ahwb/gen.txt \
    | tee "$OUT/gen.sha256"
fi
date -Iseconds | tee "$OUT/DONE.txt"
echo DONE
