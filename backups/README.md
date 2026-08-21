# Kernel lineage backups

- kalsakernel-v1.bundle — branch kalsa/kernel-s3-repack + tag kalsakernel-v1 (HEAD eaec5d884, the verified Adreno MoE restore fix, 19 Aug 2026).
  Prerequisite: upstream ggml-org/llama.cpp commit 22b69b6e9 (public merge-base).
  Restore: clone ggml-org/llama.cpp, then `git fetch kalsakernel-v1.bundle 'refs/*:refs/*'`.
- kalsakernel-v2.bundle — full lineage incl. the convert-write fix (HEAD f63746555, tag kalsakernel-v2): all three trans4 defects fixed and byte-verified on device (raw readback 0, roundtrip 0 on all fills/types/arms). Supersedes v1 (kept for provenance).
- kalsakernel-v3.bundle — full lineage incl. the K2 workaround (HEAD c1bb48d32, tag kalsakernel-v3): q4_K/q5_K MoE MUL_MAT_ID `get_scale_min_k4` literal-mask miscompile site, fix = masks as kernel args. Device: 0/80+0/4 → 80/80+4/4, MUL_MAT_ID 391/391. Fourth independently reproduced compiler-failure site/workaround; whether a distinct compiler root cause from the three trans4 defects is unresolved. Supersedes v2 (v1/v2 kept for provenance). Same prerequisite 22b69b6e9; same restore (`git fetch kalsakernel-v3.bundle 'refs/*:refs/*'`).
