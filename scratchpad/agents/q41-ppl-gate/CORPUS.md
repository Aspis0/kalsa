# q41 corpora (recorded before PPL runs)

## Primary — wikitext-2-raw test (GATE)

Not already on disk. Downloaded this cell from the **llama.cpp CI URL**.

| | |
|---|---|
| URL | https://huggingface.co/datasets/ggml-org/ci/resolve/main/wikitext-2-raw-v1.zip |
| zip bytes | 4 721 645 |
| zip sha256 | `ef7edb566e3e2b2d31b29c1fdb0c89a4cc683597484c3dc2517919c615435a11` |
| `wiki.test.raw` bytes | 1 290 590 |
| `wiki.test.raw` sha256 | `173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08` |
| path | `scratchpad/agents/q41-ppl-gate/corpus/wikitext-2-raw/wiki.test.raw` |

Also unpacked: `wiki.train.raw` (not used), `wiki.valid.raw` (not used).

## Secondary — Italian (optional, not the gate)

Already on disk: `corpus/multi5/it.txt` as read this cell.

| | |
|---|---|
| path | `corpus/multi5/it.txt` |
| bytes (this cell) | **45 747** |
| sha256 (this cell) | `498a5f3b554fac4bb6f7eda4f7bdcea60f3ad6be30699f306a3255d8ba85545a` |

This is the Wikipedia Caffè v2 slice (`it_v2_wikipedia_caffe.txt` is the same size). `SHA256SUMS` still lists a 50 054 B literary `it.txt` (`0aeaa45c…`) — **stale vs the file on disk**. We hashed what llama-perplexity actually read.

Small (~46 KB → 26 chunks at ctx 512). **Not the gate.** Same CLI flags as wiki except `-f`.
