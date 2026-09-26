# forced_decode.sh — fixed decode length for heat arms via kalsa.bench.force_ids.
# Why (2026-09-26 run): greedy output length diverged by backend (CPU 96 vs
# GPU 42 tokens, same prompt) so decode work was not common mode. The GPU
# prefill logits differ slightly from CPU (documented f16-GEMM residual:
# gemm-f32-ship median |dp1| 0.0014, same-top 94.8%), and greedy amplifies
# that into different answers and different EOS points. Forcing the token id
# list pins the generated length exactly on both arms: the native loop ends
# when the list is exhausted (kalsa.rn rn-completion.cpp:1908-1910) and forced
# ids bypass sampling and natural EOS (JSIParams.cpp:517-543 validates against
# n_vocab; an invalid list stops the completion cleanly at zero tokens). The
# list is one benign token derived from the measured model itself, repeated
# FORCED_DECODE_N times; its piece ("heat") cannot match any stop word.
# App side: readBenchOracleParams (benchSampling.ts:38) reads the key; the
# oracle is applied only in greedy mode (LlamaService.ts:4464) — the driver
# always sets kalsa.bench.sampling=greedy.
FORCED_DECODE_N="${FORCED_DECODE_N:-128}"
FORCED_IDS_JSON=""
forced_ids_build() {
  case "$FORCED_DECODE_N" in ''|*[!0-9]*) log "FORCED_DECODE_FAIL bad n=$FORCED_DECODE_N"; return 1;; esac
  [ "$FORCED_DECODE_N" -ge 1 ] || { log "FORCED_DECODE_DISABLED n=$FORCED_DECODE_N"; return 0; }
  command -v llama-tokenize >/dev/null 2>&1 || { log "FORCED_DECODE_FAIL no llama-tokenize on host"; return 1; }
  [ -f "$MODEL" ] || { log "FORCED_DECODE_FAIL model missing $MODEL"; return 1; }
  local id ids_digest
  id=$(printf 'heat' | llama-tokenize -m "$MODEL" --stdin --ids --no-bos 2>/dev/null \
       | tr -d '[]' | awk -F, '{gsub(/ /,"",$1);print $1}')
  case "$id" in ''|*[!0-9]*) log "FORCED_DECODE_FAIL unparseable token id"; return 1;; esac
  FORCED_IDS_JSON=$(awk -v id="$id" -v n="$FORCED_DECODE_N" 'BEGIN{s=id;for(i=1;i<n;i++)s=s","id;print "["s"]"}')
  ids_digest=$(printf '%s' "$FORCED_IDS_JSON" | /usr/bin/shasum -a 256 | awk '{print $1}')
  printf 'n=%s\nid=%s\nids=%s\n' "$FORCED_DECODE_N" "$id" "$FORCED_IDS_JSON" > "$RAW/forced_ids.txt"
  log "FORCED_DECODE n=$FORCED_DECODE_N id=$id ids_sha256=$ids_digest"
}
