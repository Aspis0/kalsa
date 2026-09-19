# qwen_think_replay_probe.py

Start the template server, then run the probe against a catalogue GGUF and a
captured `history2_final.json` from an e2e artifact:

```
llama-server -m <qwen3.5-4b.gguf> --jinja --reasoning-format none -c 512 -ngl 0 \
  --no-warmup --port 8899 --host 127.0.0.1 &
python3 analysis/qwen_think_replay_probe.py <qwen3.5-4b.gguf> <history2_final.json>
```

`--reasoning-format none` is not optional: it is what the app passes, and the
field is capable of changing how a message is serialised into the template.
Exit 0 means every case reused the whole cache; exit 1 names the ones that did
not and the token position where each broke.

Both positions are compared against the **same** live token sequence, so "older
and final both REUSES ALL" also means the prewarm render and the next turn's
render agree on that prefix — which is the property that makes prewarming worth
doing at all.

Measured 18/09/2026: 6/6 on the two real stored emissions plus the
closed-immediately `<think>\n\n</think>\n\n` shape. Counts only; no prompt text
is printed.
