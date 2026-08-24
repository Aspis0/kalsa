# Q47 abort capture

The app team's Android tombstone was **not** available on this PC
(stderr lost; stack was `lm_ggml_abort <- load_all_data+3708`).
The abort **string** was captured on Jelly via the CLI harness against
the pre-fix kernel (same `set_tensor` fence, same mmap+CPU_REPACK path).

Source: `pre-fix-loader-set.err` (RC=134 / SIGABRT):

```
C:/Users/gualt/Desktop/Kalsa/moe-experiments/worktree-repack-q23k/ggml/src/ggml-cpu/repack.cpp:5339: GGML_ASSERT(size == src_nbytes) failed
```

178 ms in the app log is the pack of `blk.2.ffn_gate_exps` (Q2, 64-aligned)
before `blk.2.ffn_down_exps` (Q3) hits that assert. Not independently
timestamped in these files; `cli-repack-final.err` shows ~111 ms for the
same gate pack on this device/build.
