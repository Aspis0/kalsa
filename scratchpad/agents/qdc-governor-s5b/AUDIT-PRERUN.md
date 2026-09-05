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


## Delta re-audit #4 (run-2 fixes)

U1 — CONFIRMED-FIXED. d_run.sh:182 adds `('kalsa.web.enabled','false'),
('kalsa.tools.device','false'),('kalsa.tools.calendar','false')`. Keys exact: AppShell.tsx:313
`WEB_TOOLS_ENABLED_KEY = "kalsa.web.enabled"`; toolToggles.ts:3-4 DEVICE/CALENDAR keys. "false"
⇒ OFF for all three: AppShell.tsx:704-705 `if (raw === "0" || raw === "false") {
setWebToolsEnabled(false); …}`; toolToggles.ts:10-11 `if (raw === "0" || raw === "false")
return false;` (device defaultOn=true, calendar false — both → false). Reads: web at boot
(AppShell.tsx:~697-708 mount effect); device/calendar via `refreshToolFlags()` at :745 (boot)
and :5318 (event path) — same persisted "false"; injection precedes `am start`, typing ~59 s
later, so no lazy read can see "true".
U2 — CONFIRMED-FIXED. d_run.sh:272 `tool_call=$(last_json_after 'KALSA_TOOLCALL ' "$logcat");
structured_calls=$(json_field "$tool_call" structuredCalls); … if [ "$structured_calls" -gt 0 ];
then tool_calls="$structured_calls"; void_reason=toolcall; row_void=1; fi` (+ numeric
case-guard). Prereq d_run.sh:280 `if [ "$row_void" -eq 0 ] && [ "$arm" = A ] && [ "$turn" = 1 ]
&& [ "$telemetry_rc" -eq 0 ] && [ -z "$bench" ]` — toolcall A1 ⇒ row_void=1 ⇒ exit 3 blocked.
Anchoring: TOOLCALL parsed at ANCHOR_EPOCH (turn-start), not SEND_ANCHOR_EPOCH — equivalent
here: per-turn `logcat -b all -c` (d_run.sh:262) makes stale lines impossible and a toolcall
line is only emitted post-Send at round end. TSV 17/17 (header :31 vs printf :283); status
gets structuredCalls/tool_calls/void_reason.
U3 — PARTIAL. Genuine scenario: TOOL_LOG (dryrun.sh:15-16) has BOTH telemetry
(tokensPredicted:1) and `KALSA_TOOLCALL {"turnId":"3","structuredCalls":1}`; stub cats it in
TOOL_MODE (:44); dryrun.sh:136 runs the REAL run_observation A 3, asserts status=0 row_void=1
structuredCalls=1 tool_calls=1 void_reason=toolcall, no PREREQUISITE.txt, A4 continues; the
sqlite assertion (:110) checks the three keys='false' in the pushed DB captured by the stub's
push branch (:53). BUT turn=3: runtime_prereq fires only on turn 1, so the no-PREREQUISITE
assertion would pass even with the OLD condition — the exact run-2 regression (A1 toolcall +
telemetry + no bench ⇒ exit 3) remains unproven. Fix: run TOOL_MODE at turn 1.
U4 — CONFIRMED-FIXED. PREREG.md:113-118 run-2 amendment: A1 excluded with numbers
(5,142/5,142 in 59 s, 11 chunks, new_tokens_a=1,016, promptMs=6,581.954, decode=28.36), no
oracle/speed result, fixed factors named, "tool-call rows are VOID, not prereq exits". Lock
line PREREG.md:2 unchanged; analysis (PREREG.md:68-83) untouched.
U5 — design note, not a blocker. A1 toolcall-VOID ⇒ B1 oracle=VOID: acceptable — turn 1 is
off-plateau, medians need ≥2 PASS pairs in turns 2-4 (pre-registered), oracle is secondary for
S5b. Recommendation: do NOT retry A1 (breaks the fixed order/adjacent pairing); the toggles
should stop future tool calls; keep the VOID net; ≥2 plateau toolcalls ⇒ descriptive-only,
pre-declared. No abort-on-VOID beyond pre-registered categories (thermo, kill, adb death,
uninstall, typing budget); B-gate skipped via row_void (d_run.sh:281).

## Delta verdict #4

GO-WITH-FIXES. 0 blockers, 1 finding (U3 PARTIAL: add a turn-1 TOOL_MODE dryrun case to
regression-prove the exit-3 suppression that cost run 2). U1/U2/U4 CONFIRMED-FIXED by
inspection and app-source quote; launch run 3 after the dryrun case lands.

## Delta re-audit #5 (cooldown)

V1 — CONFIRMED-FIXED. cooldown_to_target (parse.sh:24-60): samples via thermal_record to
"${prefix}_cooldown.txt" with `printf 'wait_s=%s skin=%s target_c=%s'`; target
COOL_TARGET_C=36.0, COOL_POLL_S=15, COOL_MAX_S=600 (d_run.sh:47); loop with deadline_check,
`[ "$rc" -eq 0 ] || return 1` (parse.sh:37), exit-on `v <= target` (parse.sh:41-42), cap
`COOLDOWN_SECONDS="$COOL_MAX_S"; return 2` (parse.sh:61-62). Caller d_run.sh:258-259
`cooldown_to_target "$prefix"; cooldown_rc=$?; cooldown_s="$COOLDOWN_SECONDS"` inside the
status-0 block after fresh_install/copy/bootstrap_db (:256) and before skin_before/prefs/am
start (:261-266); rc2 → `row_void=1; void_reason=hot` — the row is skipped cleanly: :261/:266
are re-gated `[ "$status" -eq 0 ] && [ "$row_void" -eq 0 ]` so no skin_before/set_prefs/am
start/typing run; the empty-logcat guard `[ -f "$logcat" ] || : > "$logcat"` (d_run.sh:269)
keeps the parse section live; row written na+VOID, status=0, return 0, loop continues; rc1
(unparseable) → status=1 → pre-registered abort ("unparseable thermal skin after retries",
PREREG.md:90-91). set -u: COOLDOWN_SECONDS init "na" (d_run.sh:47) and set on every path
(entry, reached, cap; return-1 keeps the entry value), cooldown_s init "na" (:250) — VOID rows
written before cooldown (install failure) print cooldown_s=na, bound.
V2 — CONFIRMED-FIXED. thermal_record (parse.sh:11-22): retries 3× with `[ "$attempt" -lt 3 ] &&
sleep 2` (parse.sh:20); skin gate is parse-only: `awk -v v="$skin" 'BEGIN { exit !(v ~
/^[0-9]+([.][0-9]+)?$/) }'` (parse.sh:16-17); the return `[ "$rc" -eq 0 ] && [ "$skin_valid" -eq
1 ] || return 1` (parse.sh:22) has NO <42 clause. Caller d_run.sh:269 `skin_after=$(thermal_record
"$…_after") || { skin_after=na; status=1; }` — the || fires only on unparseable/dump failure;
42.547 returns rc0 and is recorded with status untouched; skin_before (:261) same shape and
ungated — the cooldown enforces ≤36 pre-turn, so no <42 gate is needed. No other ≥42 gate
exists in the driver or in PREREG's abort list (PREREG.md:89-91 now says "unparseable thermal
skin after retries", not skin ≥42).
V3 — CONFIRMED-FIXED. d_run.sh:7-15: usage includes `[deadline_minutes]`; validate 20-110
(`[ "$value" -ge 20 ] && [ "$value" -le 110 ]`, d_run.sh:9); default 40, 4th arg overrides;
d_run.sh:44 `DEADLINE_EPOCH=$((START_EPOCH + DEADLINE_MINUTES * 60))`. Dryrun: `record`
list adds validate_deadline_minutes (dryrun.sh:25); dryrun.sh:98 `validate_deadline_minutes 10
&& exit 1 || :; validate_deadline_minutes 200 && exit 1 || :; validate_deadline_minutes 85 ||
exit 1` — rejects 10/200, accepts 85.
V4 — CONFIRMED-FIXED, genuine and distinguishable. Stub serves per-call thermal sequences via
THERMAL_COUNTER + modes (dryrun.sh:45: `case "$THERMAL_MODE" in initial|ready|cool|never|
afterhot` — cool: call 1 → HOT(37.5) else READY(35.5); never: always HOT; afterhot: call 3 →
HOT_AFTER(42.5) else READY). Scenarios through the REAL run_observation: :145 cool asserts
`wait_s=0 skin=37.5`, `wait_s=15 skin=35.5`, `status=0 .*cooldown_s=15`; :146 never asserts
`status=0 row_void=1 cooldown_s=600.*void_reason=hot` + row na, with :147 ready-mode A5
continuing; :148 afterhot asserts col13 == "42.5" with `status=0 .*cooldown_s=0`. The OLD code
would fail all three: no cooldown call ⇒ no cooldown.txt/cooldown_s; the old <42 gate ⇒
after-42.5 → rc1 → status=1 (assertions demand status=0). Distinguishable.
V5 — CONFIRMED-FIXED. PREREG.md:117-120 amendment matches raw: TSV A1 5842.393 /
new_tokens_a=925 / decode 26.9251863562422≈26.93 / before 33.084 (results.tsv:2);
after_thermal.txt:64 `mValue=42.547`; ABORT at driver log [09:39:37]; probe file starts
09:43:08 skin=36.04 (42.5→36.04 ≈ 3.5 min after the 09:39:37 abort — consistent); tail
09:50:53 skin=33.227. A1 explicitly excluded; factors pre-registered (36.0/15 s/10 min/VOID
hot/skin_after not gated/85-min deadline); lock line PREREG.md:2 unchanged. Nits: "≈0.5
°C/min" overstates the file's 36.04→33.227 over 7.75 min ≈ 0.36 °C/min (design unaffected);
run 2's fixed-factor sentence and the tool-call clause are untouched.
Budget (V5 partial): measured per-turn ≈4 min + cooldown 2-4 min (worst 3.5) ⇒ 8 × ~6.5-8 min
≈ 52-64 min + setup ≈ 3-5 ⇒ ≈ 57-69 min — inside the 85-min deadline and a 90-min session
with ≈15-25 min slack; one VOID(hot) row (~13 min cost incl. the 10-min cap) still fits
(≈ 79-82 min worst); the 40-min default deadline would NOT fit — run 4 must pass 85 as the
4th argument (pre-registered).

## Delta verdict #5

GO. 0 blockers, 0 majors, 2 nits (0.5-vs-0.36 °C/min wording; two hot-VOIDs would consume the
90-min session — watch the wall clock and the deadline arg 85). V1-V4 CONFIRMED-FIXED by
inspection and dryrun assertions; V5 amendment accurate against raw/sa805443; launch run 4.

## Delta re-audit #6 (run-4 fixes)

logcat_all (parse.sh:9-28) — CONFIRMED-FIXED, genuine: `: > "$tmp"`; `adbT 120 … > "$tmp"`;
accept only `if [ "$rc" -eq 0 ] && [ "$tmp_size" -ge "$existing_size" ] && mv "$tmp" "$file"`
(parse.sh:22); 3 tries with `[ "$attempt" -lt 3 ] && sleep 3` (:25); each rejection logged to
"${file}.failures" (:23) with tmp cleaned (:24); LOGCAT_RC/LOGCAT_RETRIES recorded per attempt
(:21) and surfaced in the status printf (d_run.sh:281 `… void_reason=%s logcat_rc=%s
logcat_retries=%s`, args in order); init "na"/0 twice (d_run.sh:47 init, :254 per-row reset).
The roll-forward behavior is exactly the run-4 lesson: the last good file survives all failed
dumps; no mid-line truncation can land on the parsed file.
Cooldown constants — CONFIRMED-FIXED: d_run.sh:47 `COOL_TARGET_C=37.0; COOL_POLL_S=15;
COOL_MAX_S=720`; the status printf adds the two logcat fields (d_run.sh:281).
dryrun fixtures — CONFIRMED-FIXED and distinguishable: dryrun.sh:99 LOGCAT_MODE=fail
(`printf 'stub logcat failure\n'; return 7`) asserts rc≠0, file content unchanged
(`existing-log`), LOGCAT_CALLS==3, LOGCAT_RC==7, LOGCAT_RETRIES==3, `.failures` grep rc=7;
:100 LOGCAT_MODE=shrink (`printf 'x\n'`, rc 0 ⇒ 1 byte < 12-byte existing) asserts rejection,
file unchanged, 3 calls, RETRIES==3 — the OLD single-shot `>`-dump would overwrite the file
with the failure/shrunk content and never set RETRIES (set -u would crash the assertion), so
the old code fails these assertions. Genuine.
PREREG.md:122-124 — CONFIRMED-FIXED: "Run 4 recorded four VOID(hot) rows under
COOL_TARGET_C=36.0 °C and a 600 s cap: the post-GPU cooldown samples remained 36.3–37.7 °C,
while CPU-turn cooldowns reached 36.0 °C in 150–480 s" — matches A2/A3/A4/B4 600-s caps at
36.44/36.968/37.706/36.262 and B1/B3 150/480-s successes; "ten logcat -d -b all failures"
✓ (exactly 10); "the B2 overwrite left a truncated file" ✓ (15100 mid-line); the run-5
countermeasures (atomic tmp, rc==0 && size>=existing, 3×/3 s, parse last good only,
logcat_rc/logcat_retries, .failures retention, 37.0/720, VOID(hot) unchanged) all match the
code; lock line and analysis unchanged.
set -u sweep — clean: LOGCAT_RC/LOGCAT_RETRIES initialized in d_run.sh:47 and reset :254;
local vars in logcat_all all initialized (`existing_size=0` with the `[ -f ]` guard, `[ -n
"$existing_size" ] || existing_size=0`); dryrun LOGCAT_MODE/LOGCAT_CALLS init (dryrun.sh:7,35);
no `local a=$1 b=${a}` pattern anywhere.
Nits: (a) `requested_timeout="$1"` in logcat_all is dead — the adbT cap is hardcoded 120, so
callers' 60/300 requests are ignored (a 300-s final dump is now capped at 120; acceptable but
state it); (b) "CPU-turn cooldowns 150–480 s" is a loose label (B1's 150 s followed the A1 CPU
turn; B3's 480 s followed an idle/VOID stretch) — direction correct, wording imprecise.

## Delta verdict #6

GO. 0 blockers, 0 majors, 2 nits (dead timeout param; loose "CPU-turn" label). logcat_all is
atomic and evidence-preserving exactly as pre-registered, the dryrun proves the new behavior
and falsifies the old one, constants/status/PREREG agree; launch run 5.


## Delta re-audit #7 (exact composer, ring-buffer dump, epoch)

W1 — CONFIRMED-FIXED. logcat_all (parse.sh:22-39): `[ "$rc" -eq 0 ] && [ "$complete" -eq 1 ]
&& awk newer>=older && mv` (parse.sh:32) — no size comparison anywhere; complete = last byte
0x0a (:19-21); last_epoch `printf "%.3f"` — no exponent, missing/unparseable → 0 (:12-16); mv
atomic; .failures records rc/tmp_epoch/existing_epoch/complete (:33); LOGCAT_RC/RETRIES every
path (:28-29); delta-6 nit fixed: `timeout_s=$(( requested > 120 ? requested : 120 ))` (:25).
Dryrun (:108-111) through the real logcat_all: smaller-but-newer complete `'1001 new\n'` (8 B
vs 26 B, asserted) ACCEPTED with CALLS==1 ✓; truncated `'1002 truncated'` rejected 3×, file
kept, `complete=0` in .failures ✓; older `'1000 …'` rejected 3×, `tmp_epoch=1000` ✓; fail
rc=7 → RC=7/RETRIES=3 ✓. Old size-based code rejects the newer fixture → assertion fails —
distinguishable ✓.
W2 — CONFIRMED-FIXED. composer_check (parse.sh:134-145) `[ "$actual" -eq "$expected" ]` (:145),
exact + hint-aware; `minimum` diagnostic-only. ui_send gates before any Send tap: initial exact
(:217), clear (:223), cleared dump (:224), `cleared_len -le 3` (:231), retype rc (:242), retype
exact (:244) — only then the send loop; all five composer failures set `void_reason=composer`
and `return 2`. Dryrun genuine: (:157) exact mode serves 5141 at dump 2 / 5142 at dump 4 — real
ui_send retypes and taps (Send bounds ⇒ `input tap 150 50`, counted at dryrun.sh:71-72);
asserts actual=5141→5142, SEND_TAPS>0; (:159) exact_fail serves 5141 twice → rc=2,
void_reason=composer, SEND_TAPS==0 — the old ≥90% gate would have sent → fails — distinguishable
✓.
W3 — CONFIRMED. `git diff -- d_run.sh` = 0 lines; HEAD dd457086 (delta-6 era); the running
driver is the audited one.
W4 — CONFIRMED-FIXED. PREREG.md:122-128: run4→5 text now matches epoch/newline semantics; 5a
paragraph vs raw/sa806366 — first dump `existing_bytes=2034143`, 147 rc=0 rejections at
1.85-1.99 MB ✓; 5b paragraph vs raw/sa806366b — 5141 chars/73 s, tool-call VOID with
`toolNames":["document_chat"]`/structuredCalls=1, «covers non-web local tools», exact + VOID
(composer) + «≥90% diagnostic only», 3-dp last_epoch ✓. Clarification: the 5b logcat has three
reuse lines (841/1765, 843/1849, 1764/1929); the Send-anchored last_reuse_after picks the chat
line 1764/1929 ⇒ new_tokens_a=165 ✓ (the 841/1765 pair is the prewarm line, not the source).
Lock line + analysis unchanged.
W5 — clean. void_reason init "na" everywhere before use; metrics degrades to 0-safe on empty
fields; composer-VOID keeps status=0, guards intact, return 0, run continues; remaining aborts
are only pre-registered categories. set -u sweep: last_epoch guarded by `[ -s ]` early return +
regex fallback; logcat_all locals initialized; no `local a=$1 b=${a}`.

## Delta verdict #7

GO. 0 blockers, 0 majors, 0 minors. W1-W4 confirmed by inspection, verbatim raw cross-checks
(2034143/147 rejections; 5141/73 s/document_chat/1764→1929=165), and old-code-falsifying
dryrun assertions; W5 clean. Launch run 6.


## Delta audit #8 — run 6 per-arm cooldown + REPORT addendum

W1 — CONFIRMED overall. cool_target_for_arm (parse.sh:96-102): `A) printf '38.5\n' ;; B)
printf '37.0\n' ;; *) return 1`; call d_run.sh:257 `COOL_TARGET_C=$(cool_target_for_arm
"$arm") || status=1` — global (init :47), read by cooldown_to_target (parse.sh:85); safe under
set -u (no set -e; arm is always A|B). A-only gate d_run.sh:266 `[ "$status" -eq 0 ] &&
[ "$arm" = A ] && awk -v v="$skin_before" 'BEGIN { exit !(v > 38.5) }' … row_void=1;
void_reason=hot` — NOT redundant: enforces the pre-registered skin_before>38.5 VOID at the
second read (boundary noise; ~2 s gap, no heat source before launch). F2: the 38.5 literal is
duplicated at :266 instead of `awk -v v="$skin_before" -v t="$COOL_TARGET_C"` (parse.sh:98 is
the source) — latent drift. B counterpart absent: asymmetric but defensible (B's 37.0 always
reachable 75-435 s; plateau is A-only) — state it. Status d_run.sh:288 adds `cool_target_c=%s`
(19%19 ✓). ARM_ORDER d_run.sh:19 accepts ABABAB|ABABABAB ✓.
W2 — CONFIRMED: old cooldown rc handling (2→row_void=hot, ≠0→status=1) unchanged inside a
`[ "$status" -eq 0 ]` guard; nothing that previously ran on cooldown failure now differs.
W3 — CONFIRMED: ran `bash dryrun.sh > /tmp/dr8.log 2>&1` → exit=0 (tail: holder_loop 143 /
cleanup 0). Assertions real: :107 `cool_target_for_arm A = 38.5`, B = 37.0, `COOL_MAX_S -eq
900`; :154 A1 `wait_s=0 skin=35.5 target_c=38.5` + `cool_target_c=38.5`; :155 B1 `target_c=37.0`
+ `cool_target_c=37.0`; :163 A3 `wait_s=0 skin=39.5 target_c=38.5`; :164 never-mode
`wait_s=900 skin=39.5 target_c=38.5` + `status=0 row_void=1 cooldown_s=900
…cool_target_c=38.5…void_reason=hot` — fixture-driven through real run_observation.
W4 — CONFIRMED clean: cool_target_c/cooldown_s always bound; nit: a row failing before the
cooldown block prints the previous arm's cool_target_c (stale, harmless).
W5 (REPORT 72-93) — verified vs raw/sa806366b: rows table = results.tsv:2-7 (A1 7023.858/165/
28.4355/34.883→44.15; B1 3325.721/36.993→47.007/17b3765f/VOID; A2 na/37.072; B2 3324.109/
36.974→46.37; A3 na/37.23; B3 3325.665/36.956→47.007) ✓; statuses cooldown_s 0/435/75/120/720
✓; END.txt:1 `deadline_55_min` ✓ (deadline_check writes `"deadline_${DEADLINE_MINUTES}_min"`);
.failures 4+7+1+10+8=30 ✓; ratios computed: 3200.713/5945.225=0.538367, 3325.721/5945.225=
0.559394, reciprocals 1.85747/1.78765 → "0.54–0.56 / 1.79–1.86×" ✓ in band; cooldown line
citations exist verbatim (A2:49 `wait_s=720 skin=37.078`, A3:49 `37.248`, B1:30 `435/36.998`,
B2:6 `75/36.98`, B3:9 `120/36.962`) ✓; acceptance rule at PREREG:123/125 within "122-128" ✓.
A1: addendum table A1 skin "na→44.15" is wrong — results.tsv:2 has skin_c_before=34.883 (na is
correct only for A2/A3). A2: "VOID (oracle; row valid)" is accurate, not misleading.
W6 (PREREG.md:129) — CONFIRMED honest: "A now starts up to 1.5 °C hotter… in favour of B" —
direction right (hotter A ⇒ throttled CPU ⇒ bias toward PASS); matches the :266 gate. P1: the
6-turn ABABAB shrinks the plateau to turns 2-3 (2 pairs max) without restating the median rule
— the ≥2-pair rule still holds; pre-register the plateau set explicitly.
W7 — F2 (38.5 literal) is the only duplication; no duplicated loops.
W8 — CONFIRMED: hypothesis and endpoint definition unchanged; bands and ≥2-PASS-pair rule
untouched.

## Delta verdict #8

GO. 0 blockers, 0 majors, 4 minors (F2 38.5 literal; A1 "na" skin-before; P1 ABABAB plateau
unstated; B-gate asymmetry unstated) — textual/maintenance only; mechanics confirmed, dryrun
exit 0. Launch run 6.
