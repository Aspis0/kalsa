# q43 — Marco B′ Q8_0-trunk: pre-registered MULTILINGUAL perplexity gate

**Locked 2026-08-24, BEFORE source re-download, before cook, before any PPL run.**
Owner rule in force (23/08): quality gates are ALWAYS multilingual — never a single
language again. This prereg supersedes the wiki-only shape of q41 while keeping its
locked settings and thresholds.

## Question

Is the last surviving B′ candidate — **Q8_0 trunk** (attn/trunk requantized from the
Q8_0 source, experts byte-identical Q2_K+Q3_K) — quality-equivalent to the shipped
KEXP control (Q5_K/Q6_K trunk)? If PASS, B′ revives at +1.95 % size and the NPU-on-KEXP
road (a) is open (Q8_0 is HTP-supported). If FAIL, #28c narrows to (b) HVX kernels
vs (c) no NPU for the lineup.

## Arms

| arm | definition |
|---|---|
| control | `scratchpad/agents/q37-bprime-from-source/gguf/marco/Marco-Mini-Instruct-KEXP-fromsrc-trunk-control.gguf`, 6 385 238 912 B, sha256 `f3e2826f78c78452afa0765613875c806f1ca3976f1f59ff4e8ff85bea5782ea` (NOT recooked, NOT overwritten) |
| q8_0 | cooked fresh: `cook_model.py marco q8_0` from re-downloaded source `Marco-Mini-Instruct.Q8_0.gguf` (18 356 453 952 B, sha256 `3287457af7a6632cce7b9e9dd37a7bce72f6e61c3d64eb79deea474bda5e6f1c`) + imatrix (sha256 `f05d4d4a…`), q37 pipeline unchanged |

**Hygiene gate (blocking, before any PPL run):** `verify_arms.py` must show experts
byte-identical between the two arms — expert region sha256
`d84c4b43b24384648b1036e043973655b3092d4ebdf6cb62bb8de18f3cc2c74d` (== control ==
shipped KEXP == q37/q41). If it differs, STOP: the cell is invalid.

## Corpora

1. **EN (gate)**: wikitext-2-raw **test** already on disk from q41
   (`scratchpad/agents/q41-ppl-gate/corpus/wikitext-2-raw/wiki.test.raw`,
   1 290 590 B, sha256 `173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08`),
   584 chunks at the locked settings.
2. **IT / ES / FR / ZH (gate, one corpus per language)**: NEW corpora, built for this
   cell BEFORE any PPL run: concatenated Wikipedia plain-text articles per language,
   target **≥ 100 chunks each** at c=512 (≈ ≥ 250 KB text per language; the q41
   `multi5/it.txt` at 26 chunks was declared non-decisional and is NOT reused as gate).
   Each file's byte size + sha256 + source article list recorded in
   `corpus/MANIFEST.md` **before** the first PPL run. Corpus content is frozen at
   manifest time; no edits after any PPL run has started.

## Reuse declaration (economy, declared up front)

The control arm's **wiki** PPL is REUSED from q41: **9.5915 ± 0.07116, 584 chunks**
(`q41-ppl-gate/logs/ppl-control-wiki.json`) — same gguf (sha-verified), same binary
(`build-llama-pc` llama-perplexity built in q41), same locked settings, math-reviewed
0-REFUTED. It is NOT re-run. If the binary on disk no longer matches the q41 build
(mtime/size check logged), control-wiki is re-run instead.
On the four NEW language corpora, **both** arms run fresh. The q8_0 arm runs fresh
on all five corpora.

## Locked settings (identical to q41)

```
llama-perplexity -m MODEL -f FILE -c 512 -b 512 -ub 512 -t 16 -ngl 0 --chunks -1 --ppl-stride 0
```

CPU only, one PPL process at a time, default warmup, native GGUF top-k.
sha256 via Python hashlib (never Get-FileHash). Disk guard: abort < 40 GB free.

## Criterion (per corpus, identical thresholds to q41)

`d = 100 * (P_q8_0 − P_control) / P_control`, computed per corpus from the JSON logs,
arithmetic checked by script (`_math_check.py` pattern).

| d | per-corpus verdict |
|---|---|
| d ≤ +0.5 % | PASS |
| +0.5 % < d ≤ +1.0 % | GREY |
| d > +1.0 % | FAIL |

**Overall verdict (locked):**
- **PASS** ⇔ PASS on **all five** corpora (EN + IT + ES + FR + ZH).
- **FAIL** ⇔ FAIL on **any** corpus.
- otherwise **GREY** → owner decision with the full table.

No corpus is privileged: a single-language failure kills the candidate (owner rule).
Expected direction is d ≤ 0 (Q8_0 trunk is strictly higher precision than Q5_K/Q6_K);
any d > +1.0 % on any language is disqualifying regardless of explanation.

## Outputs

`logs/ppl-{control,q8_0}-{wiki,it,es,fr,zh}.{log,json}` (control-wiki reused from q41),
`verify_arms.{py,json,txt}`, `corpus/MANIFEST.md`, `_math_check.*`, `REPORT.md`.
Hostile audit before bank: math pass (Reviewer Math = DeepSeek) + doc pass.
Bank = PLAN.md + ALIVE.md same commit. Cleanup after numbers: delete source + q8_0
variant per q41 CLEANUP.md pattern (control and logs kept).

## Non-goals

No device runs. No speed claims. No shipping decision beyond the gate itself
(ship still requires the #30 axis-A/B matrix discipline).
