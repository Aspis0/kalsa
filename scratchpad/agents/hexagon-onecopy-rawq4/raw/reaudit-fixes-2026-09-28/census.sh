#!/bin/sh
# Matmul census of the two S23 KLD logs. Run from the report dir:
#   sh raw/reaudit-fixes-2026-09-28/census.sh
# Batch = second dim of src1 in the dims field ("ne0:ne1 x ne10:ne11 -> ...").
set -eu
L=raw/device-correctness-2026-09-28
batch='{ split($3, a, " x "); split(a[2], b, ":"); split(b[2], c, " "); print (c[1] >= 32 ? "real-batch" : "warmup") }'
for run in rawq4 twocopy; do
    echo "== $run"
    echo "execute-op MUL_MAT lines: $(gunzip -c $L/$run-kld.log.gz | grep -ac 'execute-op MUL_MAT|')"
    gunzip -c $L/$run-kld.log.gz | grep -a 'execute-op MUL_MAT|' | awk -F'|' "$batch" | sort | uniq -c
    gunzip -c $L/$run-kld.log.gz | grep -ao 'fused MUL_MAT_NX (N=[0-9]*' | sort | uniq -c
    echo "real-batch lines naming ffn_gate / attn_q / token_embd (lm_head):"
    for w in ffn_gate attn_q token_embd; do
        n=$(gunzip -c $L/$run-kld.log.gz | grep -a "execute-op MUL_MAT|[a-z0-9.]*$w" | awk -F'|' "$batch" | grep -c real-batch || true)
        echo "  $w: $n"
    done
done
