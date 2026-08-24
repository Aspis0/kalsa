# q49 — Marco B′ axis-B behavioral gate: VERDICT (unblinded by orchestrator)

**Cell verdict: FAIL, on gate (i) alone** — by the letter of the frozen PREREG.

## Gate application (frozen criteria, no post-hoc edits)

| gate | result | detail |
|---|---|---|
| (i) loops | **FAIL** | B′ `loop=1` on 2 rows: `code_en_05` (TRUE degeneration, `echo -e 'Error:'` repeated — control clean on same prompt) and `long_it_04` (both arms loop; the frozen letter counts any B′ loop) |
| (ii) language | PASS (instrument erratum) | the single `lang_ok=0` (`fact_es_02`) is a detector false negative — the text is correct Spanish in BOTH arms; verified by inspection; same flag both arms |
| (iii) blind preference | **PASS decisively** | from JUDGMENTS.csv unblinded with key.json: 53 TIE, decided 7 → **q8_0 wins 6, control wins 1**, `control_pref = 0.143` (« 0.60). No category reaches n_decided ≥ 5, none close to the 2/3 cap |

Note: the judge's summary-reply counts (7A/5B/48T) do not match its own CSV
(53 TIE, 7 decided); the CSV is the artifact and was recomputed by the
orchestrator from raw. Per-pair unblinded reasons in this file's source data.

## The full evidence picture (for the owner's decision)

- q43 PPL: B′ BETTER than control on all 5 languages (−0.57…−1.34 %).
- Blind pairwise: B′ preferred 6:1 where decided; 88 % of pairs indistinguishable.
- Blemish recorded: on `trap_es_01` B′ mixed Chinese characters (合并) into an
  otherwise-Spanish reply (judge-caught; machine lang gate did not fire).
- The failing datum: ONE true greedy degeneration on ONE code prompt at temp-0
  greedy — a decoding-dynamics artifact class, but a REAL behavioral difference
  between the trunks, which is exactly what gate (i) existed to catch.

## Recommendation (not part of the verdict)

Bank as FAIL v1. Propose a **v2 cell pre-registered with the app's PRODUCTION
sampler settings** (their temp/penalties, not greedy) targeted at the loop gate:
greedy loop propensity is partially a lab artifact, and production never runs
greedy. If v2 is clean, KEXP-Q8 proceeds with the (iii)+PPL evidence carried
over; if B′ loops under the production sampler too, the Q5_K trunk stays and
B′ remains an NPU-only lab variant.
