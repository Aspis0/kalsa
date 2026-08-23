# REVIEW_DOC — hostile pass on q41 REPORT

## CONFIRMED (already in REPORT)

1. **Gate is FAIL at +4.273 %, not close.** Not a rounding artifact; 4.27 ≫ 1.0.
2. **k is native GGUF top-k, not campaign k=6.** Binary has no `--n-expert-used`. Fine for a *weight* gate; do not quote this as the shipped drop/k PPL.
3. **IT secondary is 26 chunks.** Directional only. `it.txt` on disk is 45 747 B Caffè v2, not the 50 054 B `SHA256SUMS` literary file.
4. **Building llama-perplexity re-linked ggml-base.dll / llama-common.dll** in `build-llama-pc` (Ninja restat). amd64 confirmed. Did not edit BigMoeOnEdge sources.
5. **Control reused** (sha `f3e2826f…`); IQ4_NL/Q4_0 recooked this cell.

## PLAUSIBLE

- Control wiki wall 50 min vs IQ4/Q4 ~37 min: first-run cache / NTFS; not a quality signal.
- `</s>` control-token warning: model tokenizer quirk, identical on all arms.

## REFUTED

None of the scoped claims (pre-reg before measure, 584 chunks, FAIL).
