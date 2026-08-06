# F3-nowarmup summary

- model: `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` size=11522702304
- variant: nowarmup flags=`--no-warmup`
- threads=4 ctx=512 kv=q8_0 n_gen=32
- rows total=1 cold=1 warm=0
- median eval_tok_s cold: 0.10
- median eval_tok_s warm: NA
- protocol: cooldown=180s cool≤30.0 majflt_gate=50000 floor=40%
- binary: `/data/data/com.termux/files/home/src/llama.cpp/build-safe/bin/llama-cli` commit=67d5978
- finished: 2026-08-06T00:22:23-04:00

F3 is pure measurement — any recorded naive numbers (incl. OOM/lmkd) are PASS.
