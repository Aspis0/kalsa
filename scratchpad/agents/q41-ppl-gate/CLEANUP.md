# q41 cleanup (after PPL numbers were in)

Used `q37-bprime-from-source/cleanup_model.py marco control`.

Deleted (this cell's downloads/cooks only):

| path | bytes |
|---|---:|
| `…/src/Marco-Mini-Instruct.Q8_0.gguf` | 18 356 453 952 |
| `…/src/Marco-Mini-Instruct.imatrix.gguf` | 81 548 704 |
| `…-trunk-iq4_nl.gguf` | 6 343 771 008 |
| `…-trunk-q4_0.gguf` | 6 343 771 008 |
| **freed** | **31 125 544 672 (28.99 GB)** |

Kept:

- control GGUF 6 385 238 912 B (q37 + this cell)
- `scratchpad/agents/q41-ppl-gate/**` logs, corpus zip, report
- `models/Marco-Mini-Instruct-KEXP.gguf` (pre-existing)

q36 GGUFs not touched.
