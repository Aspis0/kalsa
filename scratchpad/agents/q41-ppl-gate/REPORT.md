# q41 — Marco B′ IQ4_NL trunk: pre-registered perplexity gate

PC-only. No device. No git push. `BigMoeOnEdge/` sources not edited (llama-perplexity was **built** into the existing `build-llama-pc` Ninja tree).

**Pre-registered criterion** (`PREREG.md`, locked **before** source re-download and before any PPL run):

Let `d = 100 * (P_IQ4_NL − P_control) / P_control` on wikitext-2-raw **test**.

| d | verdict |
|---|---|
| d ≤ +0.5 % | PASS |
| +0.5 % < d ≤ +1.0 % | GREY |
| d > +1.0 % | FAIL |

**Verdict: FAIL.** Wiki PPL control **9.5915**, IQ4_NL **10.0013**, **d = +4.273 %** (584 chunks). Q4_0 **10.3646**, **d = +8.060 %** (not the gate; worse). IQ4_NL-trunk is **not** ship-viable on this gate.

---

## 1. What was measured

Marco from-source KEXP **control** (Q5_K trunk, experts Q2_K+Q3_K) vs **IQ4_NL trunk** (same experts) vs **Q4_0 trunk** (second data point). Cook path = q37 `gen_recipes` / `cook_model.py` from re-downloaded Q8_0 + imatrix.

Control was **reused**, not recooked: `gguf/marco/…-trunk-control.gguf` 6 385 238 912 B, sha256 `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea`.

---

## 2. Source re-download

`scratchpad/agents/q37-bprime-from-source/dl_marco.ps1`, detached (`logs/dl-q41-marco.pid.txt`). Python hashlib (not `Get-FileHash`).

| file | bytes | sha256 | match SOURCE.md |
|---|---:|---|---|
| `Marco-Mini-Instruct.Q8_0.gguf` | 18 356 453 952 | `3287457af7a6632cce7b9e9dd37a7bce72f6e61c3d64eb79deea474bda5e6f1c` | yes |
| `Marco-Mini-Instruct.imatrix.gguf` | 81 548 704 | `f05d4d4a7b043904728a1fed6496715e5348b4bd825e47eda5cbdc97fb8aec23` | yes |

Log: `logs/dl-q37-marco.log` (script's inner log) + `logs/dl-q41-marco.outer.log`.

---

## 3. Recook + verify

Cooked **only** `iq4_nl` and `q4_0` (`cook_model.py marco iq4_nl q4_0`). Control not overwritten.

`verify_arms.py`: **all_ok True**. Expert sha `d84c4b43b24384648b1036e043973655b3092d4ebdf6cb62bb8de18f3cc2c74d` identical to control and to the shipped KEXP / q37. Types IQ4_NL 113 / Q4_0 113; experts 56×Q2_K+28×Q3_K.

| arm | bytes | sha256 |
|---|---:|---|
| control | 6 385 238 912 | `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea` |
| IQ4_NL | 6 343 771 008 | `b937ffe9f820d0daa419d43dd9f9595f9fb33f5841741b4c3bc07047f0350345` |
| Q4_0 | 6 343 771 008 | `7984d7d7fe5f90ec3552ef99d0f900be8f6f68ddef63c3f4b1eeef45226d5a16` |

---

## 4. Corpus

Primary (GATE): wikitext-2-raw **test**, llama.cpp CI zip. Not previously on disk. `CORPUS.md`.

| | |
|---|---|
| URL | https://huggingface.co/datasets/ggml-org/ci/resolve/main/wikitext-2-raw-v1.zip |
| zip sha256 | `ef7edb566e3e2b2d31b29c1fdb0c89a4cc683597484c3dc2517919c615435a11` |
| `wiki.test.raw` | 1 290 590 B, sha256 `173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08` |

Secondary (not the gate): `corpus/multi5/it.txt` **already on disk**, 45 747 B, sha `498a5f3b…` (Caffè v2; `SHA256SUMS` is stale). 26 chunks — **< 100**, directional only.

---

## 5. Binary and locked settings

`llama-perplexity.exe` was **missing**. Built this cell: `ninja -C build-llama-pc llama-perplexity` (VS 2022 BuildTools, amd64). Stub 10752 B + `llama-perplexity-impl.dll`. `--help` → `llama-perplexity-help.txt`. Default warmup left on.

Locked in `PREREG.md` **before** the first run:

```
llama-perplexity -m MODEL -f FILE -c 512 -b 512 -ub 512 -t 16 -ngl 0 --chunks -1 --ppl-stride 0
```

No `--n-expert-used` (flag absent). Native GGUF top-k. CPU. One process at a time. Wiki: **584 chunks** (≥ 100).

Warning on every arm (same): `control-looking token: 128247 '</s>' was not control-type` — tokenizer metadata, not a trunk effect.

---

## 6. PPL table (GATE = wiki)

From `logs/ppl-*-wiki.json`. `d = 100*(P−P_control)/P_control`. Arithmetic: `_math_check.py`.

| arm | PPL | ± | n_chunks | wall_s | d vs control | gate |
|---|---:|---:|---:|---:|---:|---|
| **control** Q5_K | **9.5915** | 0.07116 | 584 | 3014.1 | — | — |
| **IQ4_NL** | **10.0013** | 0.07556 | 584 | 2241.4 | **+4.273 %** | **FAIL** (> 1.0 %) |
| Q4_0 (not gated) | 10.3646 | 0.07895 | 584 | 2266.8 | +8.060 % | (worse than IQ4_NL) |

PASS bar = 9.5915×1.005 = **9.6395**. GREY bar = **9.6874**. IQ4_NL sits **0.362** PPL above PASS.

Italian secondary (26 chunks, **not the gate**):

| arm | PPL | ± | d |
|---|---:|---:|---:|
| control | 6.2585 | 0.19285 | — |
| IQ4_NL | 6.4725 | 0.20318 | +3.419 % |
| Q4_0 | 6.697 | 0.21215 | +7.006 % |

Same **order** (control < IQ4_NL < Q4_0) and FAIL-scale deltas, but N is too small to be the decision.

---

## 7. Runtime notes

- Wiki ~50 min/arm (control 50.2 min; IQ4_NL 37.4; Q4_0 37.8). ETA printed 6.06 s/pass × 584.
- Disk nadir this cell ≥ **124.95 GB** free during cook (`cook-marco.log`); start ~148 GB. Always ≥ 40 GB.
- `-ngl 0` warning "no usable GPU" — expected, CPU build.

---

## 8. Decision

**IQ4_NL trunk vs KEXP control: FAIL the pre-registered PPL gate (+4.273 % ≫ +1.0 %).**

Do not ship Marco B′ IQ4_NL on quality. Q4_0 is worse. Keep Q5_K trunk unless a different gate (or Road A kernels) says otherwise. q37's generation suite could not rank types; this PPL ranking is: **control ≪ IQ4_NL < Q4_0**.

Hostile audits: `REVIEW_MATH.md` (0 REFUTED), `REVIEW_DOC.md`.

---

## 9. Cleanup

After numbers were in: deleted **our** Q8_0 source, imatrix, IQ4_NL and Q4_0 GGUFs. **Kept** control + this cell's logs/corpus zip/report. `models/` and q36 GGUFs not touched. See `CLEANUP.md`.

---

## Trace

| claim | file |
|---|---|
| criterion | `PREREG.md` |
| corpus sha | `CORPUS.md` |
| control sha | `CONTROL_SHA.md` |
| verify | `verify_arms.txt` |
| wiki/IT PPL | `logs/ppl-*.json` |
| math | `_math_check.txt` |
| binary help | `llama-perplexity-help.txt` |
