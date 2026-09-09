# Pinned llama.cpp build

Source worktree:

- Repository: /Users/marco/Projects/kalsallama
- Detached worktree: /Users/marco/kalsa-mac/kalsallama-67c73d26c
- Requested branch: kalsa/gemm-f32-mul-q4k
- Commit: 67c73d26cb4ce53d8f04b199b523bf05d18fbd61

Worktree creation:

~~~sh
git worktree add --detach /Users/marco/kalsa-mac/kalsallama-67c73d26c 67c73d26c
~~~

Configuration:

~~~sh
cmake -S /Users/marco/kalsa-mac/kalsallama-67c73d26c \
  -B /Users/marco/kalsa-mac/build-kalsallama-67c73d26c \
  -DGGML_METAL=OFF -DGGML_BLAS=OFF -DCMAKE_BUILD_TYPE=Release
~~~

Build command and captured shell exit code:

~~~sh
cmake --build /Users/marco/kalsa-mac/build-kalsallama-67c73d26c \
  --target llama-cli llama-server llama-perplexity llama-bench > build.log 2>&1; echo $?
~~~

Build exit code: 0

Targets present:

- /Users/marco/kalsa-mac/build-kalsallama-67c73d26c/bin/llama-cli
- /Users/marco/kalsa-mac/build-kalsallama-67c73d26c/bin/llama-server
- /Users/marco/kalsa-mac/build-kalsallama-67c73d26c/bin/llama-perplexity
- /Users/marco/kalsa-mac/build-kalsallama-67c73d26c/bin/llama-bench

Full build output: [build.log](/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/g1-model-select/build.log)

The fork was not patched.
