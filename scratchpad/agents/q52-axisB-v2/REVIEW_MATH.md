# q52 axis-B v2 — hostile pre-bank audit of measurement cell (REVIEW_MATH)

Auditor run: 2026-08-24 (read-only; sole write = this file).
Cell being banked: **FAIL** → kills KEXP-Q8 (B′ trunk) as production recipe.
Scope: PREREG letter vs detector, independent re-compute (420 rows), gate
arithmetic, false-positive hunt on the 4 escalation true_loop rows, integrity.

---

## 0. Evidence snapshot (what the cell rests on)

| quantity | value | source |
|---|---|---|
| PREREG commit lock | `1a1c9a19` (2026-08-24 16:10:42Z); disk == commit (diff empty) | git |
| First llama-cli spawn | 16:22:54Z (after lock) | run.log `RUNNER_START` |
| Frozen prompts sha | `56574436…aacfb9`, 60 prompts (6 zh), file unedited | verified |
| GGUFs | control `f3e2826f…`, q8_0 `bd63fc0f…`, re-verified at both runner starts | run.log, RUN_LOG |
| Base matrix | 400 runs, seeds {101,102,103} ∪ {201..210}, 200 pairs × 2 arms, rc=0 × 400 | run_manifest.json |
| Escalation matrix | 20 runs, long_it_04 × 301–310 × both arms, rc=0 × 20 | escalation_manifest.json |
| Files | 420 `gen/<arm>/<id>_s<seed>.txt` = matrix keys ∪ esc keys, bijective, 0 empty | inventory |
| Base counts (CSV) | loop=1: 3; true_loop=1: 3; L_B=2, L_C=1 | machine_checks.csv |
| Esc counts (CSV) | true_loop=1: 4 q8_0 (s303, s306, s308, s309), 0 control; L_B=4, L_C=0 | machine_checks_esc.csv |
| Final verdict recorded | FAIL | REPORT.md |

---

## 1. DETECTOR vs PREREG letter — **CONFIRMED**

Letter (PREREG ¶"Machine check"): loop = "a 20-gram (20 whitespace-separated
tokens, or 20 CJK chars for zh) occurring ≥ 3 times, OR a 20-token run
repeating consecutively ≥ 2 extra times"; true_loop = loop AND "the last
occurrence of the repeated block ends within the final 50 characters of the
response". Implementation (`machine_check_q52.py`) matches letter point by
point:

- Tokenization `\S+` = whitespace-separated tokens, positions from regex
  match offsets. No off-by-one: 20-grams over `len(values)−20+1` windows,
  overlapping occurrences counted (letter does not forbid overlap; q49
  reference semantics reproduce below).
- CJK branch selected by **prompt** `lang=="zh"` (6 zh prompts; all others
  token mode). CJK range `\u3400-\u4dbf \u4e00-\u9fff \uf900-\ufaff`
  (Ext-A + main + compatibility) is the standard "CJK chars" set. zh outputs
  are short (≤ 111 chars); no zh row flags — consistent with letter intent.
- Consecutive branch: 3 consecutive copies checked as
  `v[s:s+20]==v[s+20:s+40]==v[s+40:s+60]` = 1 original + **≥ 2 extra**
  ✓ exact.
- Tail anchor: per-block `last_end = end of 20th unit of max-start
  occurrence`; anchored iff `last_end ≥ len(text) − 50`. Letter-boundary
  ambiguity (±1 char: "ends within the final 50 chars" could be read as
  `last_end ≥ len−49`) exists in theory but is **empirically moot**: all 7
  true_loop rows have margin 0 (the repeated block ends exactly at the last
  character of the file), and **no `loop=1, true_loop=0` row exists at all** —
  the anchor never discriminated, so no row can flip on a boundary reading.
- "exactly as q49 machine check #1": q49 has no saved check script; I
  reproduced the q49 `loop` column from `pairs/*.md` + `key.json` with an
  independent implementation of the identical definition: **120/120 q49 rows
  agree** (q49 loop rows: code_en_05 q8_0; long_it_04 control; long_it_04
  q8_0 — consistent with the q52 PREREG narrative).

No divergence. Minor note (not a divergence): `repeated_blocks` treats the
two conditions as alternatives per block via set-union of starts; a block
qualifying under either condition is handled, and the anchor uses max-start
per block then max end across blocks — equivalent to the letter's "last
occurrence of the repeated block".

## 2. Independent re-computation — **CONFIRMED** (0 row-level disagreements)

Fresh implementation (dict-of-lists counting + three-window consecutive
comparison, no shared code) over all 420 rows, fed the **same input the CSV
used** (`read_text(utf-8, errors="replace")`, universal newlines):

- loop / true_loop / chars: **420/420 identical** to
  `machine_checks.csv` + `machine_checks_esc.csv`. Zero disagreements.
- A second variant (raw bytes, no newline translation) also produced
  identical loop/true_loop for all 420 rows (chars differ only by CRLF
  counts — see §5).
- Aggregates reproduced: base L_B=2, L_C=1; esc L_B=4, L_C=0.

## 3. Gate arithmetic — **CONFIRMED**

- Base: L_B=2 ≥ L_C+1=2 and L_B>L_C → not PASS; L_B=2 = L_C+1 → **ESCALATION**
  exactly per letter ("Escalation iff L_B = L_C + 1").
- Per-prompt excess arbitration: code_en_05 B′=1 (s207) / C=1 (s201) →
  tied, no excess → **excluded**; long_it_04 B′=1 (s201) / C=0 → excess →
  **only** escalation prompt. (Reading "excess" as strictly
  B′_prompt − C_prompt > 0; alternate readings would escalate code_en_05,
  but the tied interpretation is the natural one and is what the letter's
  "the B′ excess" refers to — the +1 that triggered escalation.)
- Escalation set = long_it_04 × seeds 301–310 × both arms = 20 generations;
  all 20 present in `escalation_manifest.json`, rc=0, non-empty; no
  code_en_05 escalation runs (documented: "0"); base has no seed ≥ 300.
- Escalation counts: L_B=4, L_C=0. Letter: "PASS iff B′ true_loops ≤
  control true_loops within the escalation set, else **FAIL**". 4 > 0 →
  **FAIL**. The recorded verdict (REPORT.md "Final cell verdict: FAIL")
  follows the frozen letter exactly.
- Consequence mapping (FAIL → Q5_K trunk stays; B′ NPU-only) is the frozen
  consequence of this verdict — arithmetic side is correct.

## 4. False-positive/negative hunt on escalation true_loop rows — **CONFIRMED**

Read every flagged output and paired control in full (tails below are
verbatim, truncated):

| row | evidence in tail | verdict |
|---|---|---|
| s303 q8_0 (3064 ch) | `- Dott. Giuseppe Bianchi` … cyclic 12-name list (Giuseppe, Luigi, Carlo, Roberto, Giorgio, Vincenzo, Luca, Stefano, Francesco, Antonio, Giovanni ⊗) repeated to cap; file ends mid-cycle at `-` | **genuine degeneration** |
| s306 q8_0 (2803 ch) | cyclic 14-name list (Antonio Fabbri, Giuseppe Conti, Luigi D'Angelo, Marco Fabbri, Stefano Bianchi, Vincenzo Neri, Francesco D'Angelo, Dario Fabbri, Alessandro Neri, Luigi Conti, Antonio Bianchi, Giuseppe Fabbri, Roberto Neri, Carlo Bianchi ⊗) repeated to cap, ends mid-cycle `- Dott.` | **genuine** |
| s308 q8_0 (2856 ch) | cyclic 17-name list (Giorgio Mazzini … Roberto Serra ⊗) repeated to cap, ends mid-cycle | **genuine** |
| s309 q8_0 (2462 ch) | cyclic 15-initial list (Vittorio P., Livia R., Alessandro F., Maria D., Luigi M., Anna S., Francesco B., Giuseppe R., Elena P., Marco C., Roberto L., Elena V., Gianna C., Carlo M., Silvia B. ⊗) repeated ≥3×, ends mid-cycle at `- Dott.` | **genuine** |

Paired controls (s303, s306, s308, s309 **control**) — all coherent
verbali that close properly (vote tallies, firme, Nota, or, for s309, a
structured per-floor cost table whose **rows differ numerically** — repeated
*structure* but no repeated 20-gram; correctly **not** flagged by the
detector — a good near-miss disambiguation). All controls: loop=0,
true_loop=0. **Clean.**

Base-set rows (context): code_en_05 s201 **control** (L_C=1) is a genuinely
degenerated `die()` shell pipe chain (`… echo "die" | awk 'print $0' |
xargs…` to the cap) — the control arm's one true loop, recorded honestly and
correctly; code_en_05 s207 q8_0 (endless `tr ' ' ' ' …` argument chain) and
long_it_04 s201 q8_0 (cyclic `Signor X, Signora X` pairs) are genuine B′
degenerations. All 7 flagged rows end with the repeated block **exactly at
the last character of the file** (margin 0), i.e., the model never recovered
— tail anchoring is faithful to the letter's intent.

Result: no false positives among flagged rows; no missed degeneration in the
escalation controls.

## 5. Integrity — **CONFIRMED** (with two nits)

- 400/400 base outputs non-empty (0 missing, 0 empty), 20/20 escalation
  non-empty. run.log census: 402 `" DONE "` generation lines = 400
  successes + 2 failed attempts; 2 summary lines (`ALL_GEN_DONE`,
  `ESC_ALL_GEN_DONE`); 0 `failed_runs` in either manifest. **The brief's "3
  retries" is not supported by the evidence: it is 2** — the incident pair
  (fact_en_04 s102, both arms, rc=3221225786 = 0xC000013A STATUS_CONTROL_C_EXIT)
  was deleted and regenerated rc=0 (records match the regenerated files
  byte-for-byte via `read_text`-normalized sha, attempt=1, ts 16:50:02/16Z;
  exactly 2 stderr files carry 2 attempt markers, both = the incident pair).
- No duplicate (id, seed, arm) in either CSV (400/400, 20/20); escalation
  rows disjoint from base (seeds 301–310 ∩ {101–103, 201–210} = ∅; 0 key
  overlap); 420 files ↔ 420 manifest keys bijective.
- Manifest ↔ files: **full reconciliation** — for all 420 records,
  `sha256(read_text(path).encode()) == output_sha256` and
  `len(read_text(path)) == output_chars` (0 failures), and CSV chars ==
  manifest output_chars (0 disagreements). An early apparent "content
  drift" in my audit was fully explained by Python `write_text` Windows
  newline translation (outputs stored with CRLF): the byte-level sha of
  stored files ≠ manifest sha for exactly the 215 multiline outputs (195
  base + 20 esc; the 205 single-line files match byte-identically). **Nit
  N1:** manifest shas describe the *logical* content, not the stored bytes;
  a byte-hash verifier ("Python hashlib over the file") will report 215
  mismatches. Reproducibility requires `read_text`/normalization. No
  tampering, no concurrent rewrites (mtimes = generation times, sub-second
  consistent with record timestamps).
- All 420 outputs valid UTF-8 (0 invalid bytes, 0 U+FFFD); files' polling
  stable across repeated reads.
- **Nit N2:** REPORT.md's integrity table (400/400, 403/402/1) reflects the
  pre-escalation census; the final log today contains 424 DONE-containing
  lines (402 gen + 2 summaries + 20 ESC_DONE; `" DONE "` still 402). The
  escalation section was appended without refreshing that row — cosmetic
  staleness, no verdict impact.
- Minor cosmetics recorded, no data impact: run.log SKIP lines label
  `existing_output_chars=` but print `st_size` bytes; REPORT.md "Initial
  verdict"/arbitration wording differs from the literal base-script output
  (orchestrator hand-edit of REPORT.md; machine CSVs untouched).

## 6. Residual risks (not findings)

- The pre-incident runner's exact command construction is not recoverable
  (script overwritten); its 50 records lack the `attempt` field. Their
  outputs reconcile fully with manifest chars/shas and their verdicts were
  re-derived identically — consistent, but the flag-level command line of
  those 50 runs rests on RUN_LOG testimony rather than code.
- The ±1 tail-anchor boundary reading is unresolved in the letter but
  empirically irrelevant here (all margins 0; no boundary rows).

---

## Summary

| # | finding | verdict |
|---|---|---|
| F1 | Detector matches PREREG letter exactly (tokens, CJK-by-lang, ≥3 overlapping, consecutive ≥2 extra, 50-char anchor; q49 reference 120/120) | **CONFIRMED** |
| F2 | Independent re-computation: 420/420 rows identical (loop, true_loop, chars) | **CONFIRMED** |
| F3 | Gate: L_B=2, L_C=1 → ESCALATION; arbitration excludes tied code_en_05; esc set 20/20; L_B=4, L_C=0 → FAIL per letter | **CONFIRMED** |
| F4 | Escalation true_loop rows 303/306/308/309 = genuine unbounded degeneration; paired controls clean; no false positives/negatives | **CONFIRMED** |
| F5 | Integrity: 400/400 non-empty, 2 (not 3) incident retries reconciled, 0 duplicate rows, esc disjoint; manifests ↔ files reconcile after newline normalization (nit N1); REPORT census row stale (nit N2) | **CONFIRMED** |

BANK-CLEAN — the FAIL verdict is faithful to the frozen PREREG letter and
re-computable from the artifacts: an independent implementation of the
frozen detector reproduces every one of the 420 machine-check rows, the gate
arith- metic (2/1 → escalation; 4/0 → FAIL) follows the letter exactly, and
all four escalation true_loop rows are verified genuine degenerations running
to the generation cap while their controls are clean. Recommending the cell
be banked as FAIL. (Two non-blocking nits: record N1 in the manifest/report
that output shas are logical-content shas — byte-hash verification of the
stored CRLF files will otherwise mismatch on 215 multiline outputs; and
refresh the REPORT integrity census row if the cell is re-banked later.)