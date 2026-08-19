# Kernel lineage backups

- kalsakernel-v1.bundle — branch kalsa/kernel-s3-repack + tag kalsakernel-v1 (HEAD eaec5d884, the verified Adreno MoE restore fix, 19 Aug 2026).
  Prerequisite: upstream ggml-org/llama.cpp commit 22b69b6e9 (public merge-base).
  Restore: clone ggml-org/llama.cpp, then `git fetch kalsakernel-v1.bundle 'refs/*:refs/*'`.
