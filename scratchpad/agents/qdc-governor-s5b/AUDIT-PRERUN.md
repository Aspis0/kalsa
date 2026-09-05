# AUDIT-PRERUN — S5b hostile pre-lock audit

Date 2026-09-05, read-only except this file. Read: PREREG.md (103), d_run.sh (299), parse.sh (50),
dryrun.sh (91), PROMPT.txt; re-checked app constants (ModelRegistry lfm2.5-2.6b engineCtx 8192,
queueStaticPrefixPrewarm LlamaService.ts:704, bench keys), tokenized PROMPT.txt with the fork
llama-tokenize against the locked GGUF, `bash -n` on all three scripts (OK), PROMPT sha
9109f585… confirmed. No device access.

## Verified clean

- Inherited S5 fixes all present: set -u, fresh-board gate, logcat -b all -c + epoch anchor
  (d_run.sh:252-259), app-scoped lmkd after-anchor, HAL-skin extraction (d_run.sh:158), meminfo,
  wakefulness, 40-min deadline + END.txt, IME suspend, run-as-only, /data holder, QRD8650 gated
  off (d_run.sh:141-143), DEBUGGABLE gate, prompt sha/bytes identity (d_run.sh:276-282).
- No `local a= b=` hazards — all multi-variable locals are separate `local` statements
  (thermal_record d_run.sh:150; verified by the S5 line-90 crash history).
- 15-column TSV matches PREREG; B gate decode=CPU, FAST⇒GPU, WARM/CPU allowed (d_run.sh:299);
  governor_count anchored to SEND_ANCHOR_EPOCH (d_run.sh:297); Send anchor before tap (parse.sh:49-56).
- promptMs excludes typing: native timings copied at turn end (PREREG cites turnTelemetry.ts:164-177,
  LlamaService.ts:2787-2792,3174); S5 run-7 evidence (A1 205.416 ms for a typed prompt) proves the
  timer does not include typing. prefill_chunks sums the actually-prefilled B tokens.
- `input text` encoding: PROMPT is lowercase words + spaces only, sha pinned; %s escaping is the
  sole escape; no shell metacharacters; one 5,142-byte arg (~7,000 chars after %s) is within adb
  arg limits; adbT cap 300 s.
- Context fit: engineCtx 8192 (ModelRegistry.ts:328); ~1,319 + 938 ≈ 2,257 total fits; n_batch
  512 chunks 938 as 512+426 — partition path proven live (S5 runs 3 and 5-7).
- No kalsa.bench.prewarm key exists (prewarm always active, LlamaService.ts:704,1204-1219) — the
  cell honestly does not invent one; user boundary differs from the prewarm probe "." so the
  tail is new.
- dryrun exercises load_prompt, type_prompt, and full run_observation A1 with the HAL-skin
  assertion (37.25) built in.

## Findings

M1 — MAJOR, CONFIRMED. No composer-content verification before Send, and the retry path can
silently double the prompt. parse.sh:19-47: on any failed attempt the loop re-taps the EditText
and calls type_prompt again; if the first typing actually landed and only the Send lookup
failed (the exact S5 run-5/6/7 flake), the retype APPENDS a second copy of the 5,142-byte
prompt. Neither attempt verifies the EditText text length from the dumped XML, so a truncated OR
doubled prompt changes the endpoint without any status=1. Fix: after typing, extract the
EditText text from the send.xml dump, compare char count to 5,142 (tolerance, e.g., ±5%; the
uiautomator dump preserves the full text), fail the turn on mismatch, and clear the field
(select-all+delete) before any retype.
M2 — MAJOR, CONFIRMED. The speed-endpoint median rule is underspecified: "turns 2–4 as plateau"
but the PASS/B-A ratio is computed "for each valid cool B turn" — with a WARM B row in the
plateau (likely on the 8 Elite after 8 large prefills; run 6 rose 30.3→39.5 °C over 8 small
turns) the PREREG does not state how many FAST B rows are required, which A rows pair with the
B median, or whether the ratio is per-turn then median. WARM rows are declared "not GPU-speed
observations" but the exclusion rule, a minimum FAST count (e.g., ≥2 FAST plateau B rows, else
speed endpoint VOID/not-analyzable), and the paired-A definition are missing. Fix: pre-register
"median over FAST plateau B turns of (B prefill_ms ÷ paired A this-turn promptMs); A rows are
the same-turn A; <2 FAST rows ⇒ speed endpoint not analysable".
M3 — MAJOR, CONFIRMED. The ≥3× threshold contradicts the cell's own prior on the same SoC and
app: S5 run 6-7 measured the 8-Elite 1,024+−token prewarm at CPU/GPU ≈ 1.647× (A 6.60-6.82 s vs
B 4.06-4.32 s), and fork #38's ≈10× was a different backend whose CPU arm self-heated to
90-93 °C. A prefill of the same size in-app is unlikely to exceed 3×; the PREREG should either
re-baseline the falsifiable threshold against the 1.647× datum (e.g., ≥1.5×, or "report ratio,
compare to prewarm 1.647× reference") or keep ≥3× and pre-register that a 1.6-3× result is a
"refuted hypothesis, consistent with the prewarm prior" verdict — as written, the PASS bar is
almost certainly unreachable and the prior is ignored.
M4 — MAJOR, CONFIRMED. Token count not pre-registered: fork llama-tokenize on the locked GGUF
counts 938 tokens (5.48 B/tok; the 3.5-4 B/tok heuristic giving 1,300-1,500 is wrong). Fix:
pre-register 938 and a VOID band (chunk-sum/reuse new-count outside 938±10% ⇒ invalid); total
≈ 2,257 tokens stated.

## Minors

m1 — CONFIRMED. The A-side new-token derivation is not wired into the driver: the TSV/filter
pattern (`KALSA_|llama_model_loader`, d_run.sh:293) does not match the native "reusing X/Y"
line (RNLlama : loadPrompt:536), so the A-side count is post-hoc-only. Fix: add the reuse-line
pattern to the filter and a `a_reused/a_total` note column, or at least grep it into filtered.txt.
m2 — CONFIRMED. dryrun.sh never exercises the ui_send retry attempts (its adb stub always
returns Send and EditText), so the new retry/duplication path is untested even at stub level.
Fix: add a stub variant that withholds Send on attempt 1 and asserts the retype behavior (and,
post-M1, the length check).
m3 — CONFIRMED. Budget: ~4,300 injected chars at 1-3 min/turn × 8 + prefill/load/install ≈
30-40 min is inside the 40-min deadline only if typing is fast; nothing measures the typing
rate on turn 1 or aborts early on a slow IME path. Fix: record type_prompt wall time per turn
and abort the session if turn-1 typing exceeds ~2.5 min.
m4 — CONFIRMED. load_prompt (prompt identity) runs after device access (d_run.sh:306); a local
pre-device check would fail before burning the session. Fix: move the sha/bytes check above
`SER=`.
m5 — CONFIRMED. The A3-UI-flake history (3 aborts in runs 5-7) plus 5 kB typing means one Send
flake after a 2-minute typing burns the turn; M1 is the mitigation; keep 3 attempts as written.

## Verdict

GO-WITH-FIXES. 0 blockers, 4 major (M1 composer verification + clear-before-retype; M2
speed-median/WARM-exclusion rule; M3 threshold vs the 1.647× prior; M4 938-token
pre-registration + VOID band), 5 minor (m1-m5). The mechanism (large uncached tail, native timers, chunk sums, 8192 ctx) is sound and all S5
heritage is faithful; lock after M1-M4 are written into the PREREG.