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

## Delta re-audit (post-fix)

M1 — PARTIAL. Composer gate/90%/composer_len.txt/retype-once/never-retype-in-retries all real
(parse.sh:52-61,63-67,99-106,113-143; ui_rc 2→row_void at d_run.sh:271), but a short-composer B
row still ABORTS: the B-gate block runs on na fields — d_run.sh:285 `[ "$decode_engine" = CPU ]
|| status=1; … [ "$thermal" != na ] || status=1` — status=1 → session abort; VOID-not-abort
holds only for A rows. Fix: `if [ "$arm" = B ] && [ "$row_void" -eq 0 ]`.
M2 — CONFIRMED-FIXED. PREREG.md:66-75 oracle-PASS pairs + `engine_prefill=GPU`/`FAST` only,
WARM excluded/reported separately, "Require ≥2 such pairs … otherwise descriptive only".
M3 — CONFIRMED-FIXED. PREREG.md:75-78 dual expectations ≥3× and ≈1.6× (band 1.4–1.9×) with the
explicit "which one the data supports" rule.
M4 — CONFIRMED-FIXED (with M1 caveat). 938 pre-registered (PREREG.md:31); new_tokens_a from
send-anchored `reusing X/Y` (parse.sh:6; d_run.sh:277, guarded), new_tokens_b = chunk_sum
(parse.sh:69-74); band gate d_run.sh:280 `n>=938*0.9&&n<=938*1.1`; 17-column header (:18) and
row printf (:286) match in count and order.
m1 — CONFIRMED-FIXED. Reuse pattern in the filter (d_run.sh:274) + new_tokens_a column.
m2 — CONFIRMED-FIXED. dryrun stub varies UI dumps (short 100-char at count 2, full at 3) and
asserts INPUT_TEXT_COUNT==2, `attempt=initial actual=100`, `attempt=retype actual=5142`, and
`attempt=2` — retype and retry paths exercised.
m3 — CONFIRMED-FIXED. type_prompt.txt logs initial/retype totals (parse.sh:86-106); turn-1
>150 s aborts, pre-registered (PREREG.md:56-57).
m4 — CONFIRMED-FIXED. load_prompt before device (d_run.sh:26-27 vs SER at :88).
m5 — CONFIRMED-FIXED. 3 send attempts kept; retries never retype.
set -u — clean: no `local a=$1 b=${a}`; all new globals pre-initialized; chunk_sum failure
→ "na"; new_tokens arithmetic pre-guarded; awk-gate failures void, never crash.
Destructive-action checks — clean: no check chained with a destructive side effect in one `&&`;
clear_composer failure → return 2 → VOID (safe direction).
LF — clean: `file` + `\r`-grep on all four files: 0 CRLF.
dryrun coverage — covers short composer + retype + send retry, but no B-VOID scenario — exactly
the path where the M1 bug lives; add a stub short-composer B turn asserting return 0.

## Delta verdict

GO-WITH-FIXES. 0 blockers, 1 major (M1 B-row VOID aborts: guard d_run.sh:285 with
`[ "$row_void" -eq 0 ]`), 0 minor — then the PREREG is lockable.


## Delta re-audit #2 (F1/F2)

F1 — CONFIRMED-FIXED. d_run.sh:285 `if [ "$arm" = B ] && [ "$row_void" -eq 0 ]; then … fi`.
Status/exit writers between :271 and :288 on a ui_rc=2 B row (row_void=1, status=0):
:272 poll short-circuits → telemetry_rc=1, no status write; :273 lmkd_all_after — flips only if
the fallback dump left no file (connectivity = pre-registered abort); :274 skin_after — flips
only on invalid thermo (pre-registered); :285-286 B-gate — SKIPPED (the fix); :286 lmkd count —
0 on the VOID row, flips only on a counted kill (pre-registered); :287 force-stop/uninstall —
flips only on non-clean uninstall (pre-registered); :288 exit 3 — setter guarded
`if [ "$row_void" -eq 0 ] && [ "$arm" = A ] && …` (d_run.sh:283). Verdict: no statement fires on
a clean VOID row; only the four pre-registered abort categories (adb death, invalid thermo,
counted kill, uninstall failure) can flip status — "VOID never aborts" holds.
Dryrun proof is real, not tautological: dryrun.sh:114-117 runs FULL run_observation B 1 with
VOID_MODE stubbing every UI dump short (dryrun.sh:50-52) so the REAL ui_send returns 2 from the
post-clear check (`[ "$cleared_len" -le 3 ] || return 2`, parse.sh:112) → row_void=1, B-gate
skipped, `status=0` asserted, TSV row asserted `$16=="na"&&$17=="VOID"` (dryrun.sh:115), then
`run_observation A 2` returns 0 — continuity proven. Nit: `[ "$FINAL_RC" -eq 0 ]` (dryrun.sh:116)
is vestigial (nothing writes FINAL_RC); B_RC==0 is the operative proof.
F2 — CONFIRMED-FIXED. parse.sh:63-65 `clear_composer() { adbT … input keycombination
KEYCODE_CTRL_LEFT KEYCODE_A || return 1; adbT … input keyevent KEYCODE_DEL }`; call site
:75-112: `clear_composer || return 2; dump_ui "$cleared_file" || return 2; cleared_len=$(…);
[ -n "$cleared_len" ] || cleared_len=0; printf 'attempt=cleared …'; [ "$cleared_len" -le 3 ] ||
return 2` — post-clear check strictly before the single retype (:112-121); one retype, send
loop (:123-151) never types; every failure path returns 2 (clear, cleared-dump, cleared_len>3,
retype rc, retype check) — none aborts except the pre-registered turn-1 >150 s → return 1.
set -u: `cleared_len` declared (:86 `local composer_ok cleared_len`), zero-guarded;
PROMPT_EXPECTED_CHARS init 0 (d_run.sh:12), set by load_prompt before ui_send. PREREG.md:64-65
matches verbatim (keycombination, redumps, "requires actual ≤3 before retyping once"). Dryrun
asserts `attempt=cleared actual=0` from the count-3 empty dump (dryrun.sh:56) — fixture-driven.
No regressions: keycombination is valid on Android 16; stub returns 0 for it; A1 full-text
(count 4) and send-retry (count 5) fixtures still line up.

## Delta verdict #2

GO. 0 blockers, 0 majors, 0 minors. F1's VOID-never-aborts contract holds and is genuinely
exercised by the stub; F2's clear-before-retype, single-retype, all-return-2 semantics, set -u
safety, and PREREG wording all check out. The PREREG is lockable.

## Delta re-audit #3 (run-1 fixes)

T1 — CONFIRMED-FIXED. type_prompt (parse.sh:80-100): `chunk="${PROMPT_TEXT:$offset:500}"` cuts the
ORIGINAL text; byte/char consistency holds — LC_ALL=C (d_run.sh:3) makes ${#}/substring
byte-based and PROMPT.txt is pinned ASCII (sha 9109f585…, verified earlier as "ASCII text"), so
wc -m (composer checks) counts identically. Each chunk: `sed 's/ /%s/g'` (parse.sh:90), then
`sed "s/'/'\\\\''/g"` (parse.sh:91) — the classic `'`→`'\''` escape — then wrapped
`"input text '$escaped'"` (parse.sh:93). Chunk rc≠0 → `return "$rc"` (parse.sh:95); caller
trace (parse.sh:96-121): first failure → composer_ok=0 → clear → ONE retype → still failing →
`[ "$type_rc" -eq 0 ] || return 2` (parse.sh:139) → row VOID; the only 1/abort is the
pre-registered turn-1 `typing_total > 150` → return 1 (parse.sh:103,135-137). Last loop
statement `[ "$offset" -lt "$text_len" ] && sleep 0.5` (parse.sh:99): safe — set -e is NOT
enabled anywhere (d_run.sh:2 is `set -u` only; dryrun likewise) and all vars are bound; a
failed sleep is benign (best-effort pause). 150-s cap vs the measured payload: 11 chunks at
≈55–65 s nominal (PREREG.md:119), retype worst case ≈120–130 s < 150 — consistent. No set -u
crash: TYPE_PROMPT_CALLS/TYPE_COUNTS are initialized (d_run.sh:39).
T2 — CONFIRMED-FIXED. parse.sh:54-55 `if [ -z "$text" ] || [ "$text" = "$hint" ]; then
actual=0` — feeds BOTH the initial ≥90% check (composer_check parse.sh:62-70) and the
post-clear check (cleared_len parse.sh:129-133); hint_len recorded in both lines
(parse.sh:66, :133). The hint attribute is REAL, not hypothetical: S5 run-6 raw dumps contain
`hint="Ask a question…"` (raw/sa803609/8-Elite_A_t1_edit.xml) ✓. Empty-hint + empty text →
text="" → actual=0 ✓ still zero. A real prompt coincidentally equal to the 16-char hint is
irrelevant: it can never reach the 4,627-char gate, and a 16-char composer is a failed type
that correctly VOIDs.
T3 — CONFIRMED-FIXED. Retype exists exactly once (parse.sh:124-136, after
`[ "$cleared_len" -le 3 ] || return 2`); send loop (parse.sh:144-172) never types; all failure
paths return 2 (clear :122, cleared dump :123, cleared_len>3 :134, retype rc :139, retype check
:140); B-gate guard intact: d_run.sh:281 `if [ "$arm" = B ] && [ "$row_void" -eq 0 ]; then …`;
prereq guard d_run.sh:280; TSV 17/17 — header d_run.sh:31 and row printf d_run.sh:282 match in
count and order.
T4 — CONFIRMED-FIXED, genuine. The stub parses every call: dryrun.sh:49
`chunk_cmd=$(… sed -n "s/.*input text '\\(.*\\)'$/\\1/p")`, flags CHUNK_UNQUOTED when not
single-quoted (:52-53), CHUNK_BAD when >500 chars after %s→space (:55-56); assertions
dryrun.sh:124 require INPUT_TEXT_COUNT==22 (11 initial + 11 retype), TYPE_PROMPT_CALLS==2,
TYPE_COUNTS=="11,11,", CHUNK_CALLS==22, CHUNK_BAD==0, CHUNK_UNQUOTED==0 — the OLD one-shot code
would produce INPUT_TEXT_COUNT==2 / TYPE_COUNTS=="1,1," and FAIL — so the dryrun distinguishes
old from new ✓. Hint fixture genuine: dumps emit text="Ask a question…" hint="Ask a question…"
(dryrun.sh:61,65) and the test asserts `attempt=cleared actual=0.*hint_len=` ✓.
T5 — CONFIRMED-FIXED. PREREG.md:114-120: "Run 1 (sa804790) VOID — mechanism + fix" states the
measured numbers (1500→1073 = 71%; 5142 landed 1,046–1,221; 3×500→1,501; empty text=hint
16–17 chars; "11 chunks/expected ≈55–65 s (nominal ≈60 s); the 150 s cap is retained"); no
speed/oracle number claimed — raw/sa804790/results.tsv has 4 rows, all na for every endpoint
column (only skin/mem populated) ✓; the lock line PREREG.md:2 still names APK 8a56edc /
272f4547… and session S5b-8Elite-r1; the pre-registered analysis (endpoints, ≥2-pair median,
WARM exclusion, 1.4–1.9× band, 938±10%, oracle pairing — PREREG.md:68-83) is untouched.

## Delta verdict #3

GO. 0 blockers, 0 majors, 0 minors. Chunked typing matches the live measurement recipe
(≤500, 0.5 s pause, %s, quoted); hint-aware zero-length is backed by real hint attributes in
raw dumps; every failure path returns 2/VOID with the B-gate and prereq guards intact; the
dryrun would fail on the old one-shot code; the run-1 amendment is accurate and self-contained.
Launch run 2.
