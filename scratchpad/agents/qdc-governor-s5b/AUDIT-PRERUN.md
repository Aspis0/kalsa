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


## Delta audit #9 — runs 7+ multi-SoC

F1 — CONFIRMED, MAJOR. PREREG.md:134 "the ALIVE CLI speed priors are 11.0× (732), no speed
claim (740), 17.4× (750: 284.2/16.3), and 10.4× (735: 154.8/14.9)" — all three rest on ALIVE
CPU numbers ALIVE itself retracted: ALIVE:433 (#52) carries "CPU number is build-suspect…";
ALIVE:436 (#56) "Caveat CPU build-suspect invariato"; ALIVE:437 (#57, CPU-tuned) "la build
zoppa del mattino sottostimava ×6.1-6.9 il prefill (G3 refutata ovunque, caveat saldato,
vecchi numeri CPU RITIRATI). … G1 prefill: mid-tier CONTESTED (GPU solo 1.59× …), 750
confermato 2.87×"; ALIVE:438 (#58) "G4 291/98.97 = 2.94× prefill GPU". Corrected priors:
≈1.59× (732), ≈1.59× (735), ≈2.87-2.94× (750). Recomputing the bands on the corrected
priors: 1/(1.59×0.597-0.620) ≈ 1.01-1.05 (mid-tiers near-parity, NOT 0.147-0.161) and
1/(2.94×0.597-0.620) ≈ 0.55-0.57 (750) — the pre-registered bands are 3-4× too optimistic.
Fix: re-derive the bands or mark them reference-only.
F2 — CONFIRMED, MINOR. "17.4× (284.2/16.3)" is verbatim ALIVE:435 ("~17× la CPU di questa
build") but that cell flags the build and #57/#58 withdrew the CPU basis — cherry-picked
stale pair instead of the #58 2.94×.
F3 — CONFIRMED, MINOR. The 8-Elite greedy oracle differs by exactly one token (idx 29: A=640
vs B=1194, reconverge), reproduced in run 4 (raw/sa805734 ids :30) and run 6 (raw/sa806967 —
diffed: `30c30 < 640 --- > 1194`). Under the strict rule the endpoint can never be MET on the
8-Elite; PREREG.md:132-137 does not state this; mid-tier/750 oracle status is unknown.
Recommendation: pre-register per-board "PASS-1: exactly one differing index with
reconvergence of ≥2 following indices ⇒ PASS-1, counted toward the ≥2-pair rule only if
pre-registered", before any run-7 data.
F4 — CONFIRMED. device_tag (parse.next.sh:3-20): with product_name=pineapple the
`QRD*:*|SM*:*` alternatives can never match, so `*:SM8650`/`*:SM7675`/`*:SM8635` fire first;
kalama/SM8550 → branch 3; sun/SM8750 → branch 5; unknown → sanitized tag (:17-19). SOC
populated before use: d_run.next.sh:107 PRODUCT_NAME (`tr -d '\r'` ok) and the pre-existing
SOC line; :112-113 `BOARD=$(device_tag "$PRODUCT_NAME" "$SOC") || exit 6`.
F5 — CONFIRMED. Removed behaviour: only the 8650-gate → accept-all + device_tag; additions:
recon product.name, PRODUCT_NAME, tag log, three `void_reason=thermal` stints, session_pre
log text. Nothing else changed (diff verified).
F6 — CONFIRMED, MINOR. Fail-loud thermal (parse.next.sh:88-91 gate stamp + return 1; $gate in
scope) → callers status=1+void_reason=thermal (d_run.next.sh:263/268/279) → ABORT at the loop
— pre-registered (PREREG.md:90-91 "unparseable thermal skin after retries"), fires only after
3 tries/2 s, including the skin_after case (turn completed — abort is the pre-registered
rule). Coverage gap: dryrun asserts only the function level (:116 missing-mode), not the
run-level abort path.
F7 — CONFIRMED. `bash dryrun.next.sh > /tmp/dr9n.log 2>&1` → exit=0 (tail: holder_loop 143 /
cleanup 0). device_tag asserted for all five boards + unknown-sanitize (dryrun.next.sh:109),
thermal-missing path (:116) — genuine.
F8 — OPINION: dividing in-app by CLI ratio is a defensible single-point normalization ONLY on
valid baselines; the discount arithmetic is internally consistent (1.79/3=0.5967, 1.86/3=0.62;
1/(11×0.597)=0.1523 … ⇒ 0.147-0.152 / 0.155-0.161 / 0.093-0.096) but inherits the withdrawn
priors — with F1 it is numerology.

## Delta verdict #9

NO-GO. 1 major (F1: priors/bands rest on ALIVE's retracted CPU numbers; corrected ≈1.59× /
1.59× / 2.87-2.94× → near-parity mid-tier bands), 3 minor (F2 stale 17.4×; F3 strict oracle
unmettable on 8-Elite — pre-register PASS-1 per board; F6 run-level thermal abort not
dryrun-asserted), 2 clean (F4 device_tag; F5 no other removed behaviour; F7 dryrun.next
exit 0). Recommended order for runs 7+: QRD7675 (732) → QRD8635 (735) → HDK8550 (740, no
speed claim) → QRD8650 (750, oracle/descriptive only). Fix F1-F3 before run 7.


## Delta verdict #9b

F1 — CONFIRMED-FIXED. PREREG.md:135 quotes only the corrected priors ("#52 … CPU number is
build-suspect"; "#57 … vecchi numeri CPU RITIRATI, mid-tier CONTESTED (GPU solo 1.59×), 750
confermato 2.87×"; "#58 … G4 291/98.97 = 2.94×"; "732/735 use ≈1.59×, 740 no speed claim, 750
≈2.87–2.94×"). Bands recomputed: 1/(1.59×0.597)=1.0535, 1/(1.59×0.620)=1.0144 → "1.01–1.05"
✓; 750 extremes 1/(2.87×0.597)=0.5836, 1/(2.94×0.620)=0.5486 — printed "0.55–0.57"
understates the top (≈0.55–0.58), nit. "Near parity … legitimate bankable null" is right.
F2 — CONFIRMED-FIXED. `grep -c "284.2/16.3|11.0×|17.4×|10.4×" PREREG.md` = 0.
F3 — CONFIRMED-FIXED. PREREG.md:137: "For runs 7+, `PASS-1` means at most one differing token
index between the A/B 32-token greedy ids, with re-convergence on every later index; PASS-1
pairs count toward the endpoint. This does not apply retroactively to 8 Elite runs 4–6, which
remain strict; … exact index-29 difference `640` vs `1194` in run 4 and run 6" — pre-
registered, non-retroactive, motivated, unambiguous. The 750's 4-index divergence still
FAILs — consistent.
F6 — CONFIRMED-FIXED. dryrun.next.sh:175 asserts the run-level abort (rc≠0 + `status=1
.*void_reason=thermal` in status + gate stamp). `bash dryrun.next.sh > /tmp/dr9b.log 2>&1` →
exit=0.
Extra fact — PREREG.md:130 "always been reached within the cap (75–435 s in runs 4–5b)" is
FALSIFIED by run 6 B2 (`wait_s=900 skin=37.066`, cooldown_s=900, void_reason=hot after warm
A2). Does not change GO: first-run targets are exploratory with the per-device amendment
mechanism; add a B-side gate/warm-A→B target there. Nits: PREREG:130 qualifier + "0.55–0.58".


VERDICT: GO — 0 blockers, 0 majors, 2 nits (750-band top 0.58, "always reachable" clause vs run-6 B2); F1-F3+F6 fixed, dryrun.next exit 0, runs 7+ go.


## Delta audit #10 — run 7b device fixes

F1 (configure_screen) — CONFIRMED. parse.sh:23-34: previous timeout read BEFORE the change
and written to recon.txt (`screen_off_timeout_previous=%s` + `screen_stayon=true
screen_off_timeout_set=1800000`), then `svc power stayon true` + `settings put system
screen_off_timeout 1800000`, both `|| return 1`; d_run.sh:106 `configure_screen || {
log "SCREEN_SETUP_FAIL"; exit 2; }` — fail-fast pre-turn, defensible. Nits: the
`screen_stayon=true` line is printed before the svc call (claim-before-fact); no retry on the
settings-get (transient on fresh boot wastes the session); exit 2 aborts the whole run —
acceptable because typing_awake (F2) is the per-chunk fallback for stayon-ignoring builds.
F2 (typing_awake) — CONFIRMED mechanics, ONE risk. parse.sh:267-289: on `mWakefulness !=
Awake` → KEYCODE_WAKEUP + wm dismiss-keyguard + sleep 1 + re-dump with
`typing_chunk=… wake_before=… wake_after=…` logged to ui_attempts; failure → type_prompt
`|| { void_reason=composer; return 2; }` (parse.sh:306) → ui_send propagates rc 2 to
VOID(composer) (parse.sh:351) — aborts the typing attempt, not the run ✓. RISK: ≥11 extra
dumpsys calls per typing (~1-2 s each over the tunnel, +15-25% on the 73-s baseline) inflate
typing_total; on turn 1 the retype path (≈85+85 s apparent) can cross the pre-registered
`typing_total > 150 → return 1` ABORT (parse.sh:310,380) where the same typing previously
passed. Fix: exclude typing_awake overhead from typing_total or pre-register the cap as
input-time-only; verify first-turn timing before relying on it.
F3 (EMPTY_TEXT) — CONFIRMED. parse.sh:3 `EMPTY_TEXT="${EMPTY_TEXT:-}"`; reset per ui_send
(:336) and captured from the pre-typing edit dump (:342); emptiness test :234-235
`[ -z "$text" ] || [ "$text" = "$hint" ] || [ "$text" = "$EMPTY_TEXT" ]`. Encoding consistent:
raw/sa807321 cleared.xml has the literal `text="Ask a question…"` (0 `&#8230;` entities,
checked), and both comparison sides use the same attribute extractor. Mask-risk refuted: the
5142-char prompt can never equal the 17-char hint; a 17-char composer fails the exact gate
anyway; missing EditText → "" → empty. Three-field metrics parse correctly in composer_check
(:250-256) and ui_send (:365-372) with [ -n ] fallbacks.
F4 (run_as_retry) — CONFIRMED. parse.sh:35-70: chmod-771 per attempt; retry only on
`grep -qi 'readable or writable by others'` (output and err_file), sleep 2, 3 tries, `return
"$rc"` on non-40777/exhaustion; shell mode requires one arg, exec passes "$@"; stdout→output,
stderr→err_file (cat'ed into record); `: > "$output"` truncates only dedicated temp files —
record files are append-only, no caller append-target truncated; the `sh -c '… && …'` quoting
survives; all five call sites wrapped (d_run.sh:155,169-183; parse.sh:76,79,90,92-96); no
un-wrapped `run-as` remains (grep clean).
F5 (removed behaviour) — CONFIRMED. Only copy_model/pull_rkstorage relocated into parse.sh
with identical semantics (exec-out cat binary-safe); everything else additive; the 17-column
TSV header and row printf unchanged (not in the diff).
F6 (dryrun) — CONFIRMED. `bash dryrun.sh > /tmp/dr10.log 2>&1` → exit=0 (tail: holder_loop
143 / cleanup 0). Real assertions: configure_screen `screen_off_timeout_previous=60000`
(:148); copy_model retry `readable or writable by others: 40777` + `run_as_attempt=2`
(:159); hint_text `attempt=cleared actual=0.*hint_len=0.*empty_text_len=` + retype 5142 +
SEND_TAPS>0 (:194); doze_once `typing_chunk=1 wake_before=Dozing wake_after=Awake` (:195).
F7 (set -u) — CONFIRMED clean (EMPTY_TEXT init, err_file per attempt, guarded metrics
locals).
F8 (PREREG:139-145) — CONFIRMED. Citations verified: END.txt:1 exit_1 ✓; composer_len.txt:1
actual=3821 ✓ :2 actual=17/hint_len=0 ✓; cleared.xml literal ellipsis ✓; A_t2_model_copy.txt:1
= the 40777 message ✓; adb-exit.log:12-381 = the chmod/run-as activity window (the message
itself lives in the model_copy file — range citation loose but defensible). "unchanged
pre-registration at PREREG:132-138" ✓ — the diff touches only 139+.

## Delta verdict #10

GO. 0 blockers, 0 majors, 1 minor (F2: typing_awake overhead vs the 150-s turn-1 cap on the
retype path — verify first-turn timing, exclude the overhead or re-register the cap), 2 nits
(F1 claim-before-fact stayon line + no settings-get retry; F8 adb-exit range). Mechanics all
CONFIRMED, dryrun exit 0. Launch run 7b.


## Delta audit #11 — run 7c per-chunk typing

F1 (verify_typed_chunk :267-300) — CONFIRMED. Reads via composer_text_attr — SAME extractor/
encoding as composer_check: the prompt's apostrophes ("doesn't"…) are legal in double-quoted
XML attributes (no `"` in the prompt, no entities in these dumps — 7a cleared.xml literal
ellipsis) — no unescape needed, REFUTED as a risk. Classification exact/short/mismatch
correct (first-char loss is mismatch, not short). NIT: a FAILED dump (rc≠0) → actual="" →
prefix-match trivially true → "short" → the whole attempt discarded without a re-dump-once —
recommend one re-dump on dump_rc≠0.
F2 (first-loss :384) — CONFIRMED: chunk0-retype exactly once, clear_for_retry between,
`expected_len=${#chunk}; offset=…; chunks=1` consistent; a second loss falls to the ladder —
no infinite loop; with the 150-s cap gone the 7b post-retype rc=2 no longer aborts.
F3 (ladder/caps) — CONFIRMED, 2 nits. Ladder `for chunk_size in 500 200 100` (:355),
clear+break on mismatch, in-loop cap `[ "$elapsed" -ge 400 ]` (:367) vs the success post-check
`[ "$elapsed" -gt 400 ]` (:413) — INCONSISTENT operators; a finish at exactly 400 s passes
post-check rc=0 vs the in-loop ≥400 kill; unify to -ge. NIT: no deadline_check inside
type_prompt — worst case 3×400 s = 20 min typing/turn can breach the 85-min deadline and the
QDC session cap until the next per-turn checkpoint. The ladder's clear is not
EMPTY_TEXT-verified before restart, but verify catches residue as mismatch (self-healing).
F4 (return codes) — CONFIRMED: only rc=1 is the empty-prompt guard; all failures return 2 →
VOID(composer), run continues (CONT_RAW A8 dryrun proves it). NIT: an adb/transport failure in
a chunk ALSO returns 2 → VOID while the pre-registered abort list has "disconnect" — one
wasted VOID turn (≤20 min) before the next turn aborts.
F5 (records) — CONFIRMED: typing_chunks.txt `attempt=%s chunk=%s len=%s expected=%s
result=%s t=%ss`; type_prompt.txt `attempt=%s chunk_size=%s seconds=%s rc=%s`; TYPE_COUNTS/
TYPE_PROMPT_CALLS updated only on success (:416-417); d_run.sh has exactly one TYPE_ hit — the
:47 init — status printf untouched, consistent.
F6 (dryrun) — CONFIRMED: `bash dryrun.sh > /tmp/dr11.log 2>&1` → exit=0. Fixtures :203-205
drive the REAL type_prompt/verify (stub serves incremental prefix-of-expected or shifted/wrong
variants via TYPE_VERIFY_ACTIVE/tap-50-50): first_loss asserts chunk=1 mismatch AND chunk=1
exact; mid_mismatch asserts attempt1/500 rc=1 + attempt2/200 rc=0; always_mismatch asserts
three rc=1 lines + rc=2 + void_reason=composer + SEND_TAPS=0; CONT_RAW A8 returns 0 —
genuine.
F7 (set -u) — CONFIRMED: verify locals all declared; TYPE_VERIFY_* assigned before use;
`TYPE_ATTEMPT_NO=${TYPE_ATTEMPT_NO:-0}`; first_loss_expected per-iteration.
F8 (PREREG) — CONFIRMED: :140-146 re-cite raw/sa807321a/ (files exist — verified);
:147-151 numbers verbatim: composer_len.txt:1 `actual=3976 expected=5142 minimum=4627
hint_len=0 empty_text_len=17` and :2 `attempt=cleared actual=0 … empty_text_len=17`;
type_prompt.txt:1-2 `initial_seconds=133 rc=0` / `retype_seconds=55 rc=2 total_seconds=188`
(133+55=188 ✓); ui_attempts.txt:1-11 = the 11 Awake chunk records (17 Awake lines total, the
6 extra are the send-loop records); 3976/5142 = 0.773 ≈ 23 % loss ✓; "PREREG:132-138 remains
unchanged" ✓.

## Delta verdict #11

GO. 0 blockers, 0 majors, 2 minor (F3 -ge vs -gt cap inconsistency; no deadline_check in the
typing ladder), 3 nits (F1 dump-glitch = short without re-dump; F4 transport failure → VOID
vs pre-registered disconnect abort; ladder clear not EMPTY_TEXT-verified). Everything else
CONFIRMED; dryrun exit 0. Launch run 7c.


## Delta audit #12 — run 7d dump retry

1 (dump_ui, parse.sh:202-230) — CONFIRMED. 5 attempts / 3 s apart; `rm -f $DEVICE_TMP/
ui.xml` before EVERY dump (stale ui.xml can never be cat'ed), cat gated by
`[ "$rm_rc" -eq 0 ] && [ "$rc" -eq 0 ]` and `[ -s "$out" ]`; `: > "$out"` at entry;
per-attempt `attempt/rm_rc/rc` + cat lines to "${out}.dump.log". DUMP_UI_TRANSPORT=0 at
entry (:206), set on `case "$rm_rc:$rc" in *:124|*:255|124:*|255:*)` and cat_rc 124|255;
callers reset it before each call and read with `:-0`. The success `[ -s "$out" ] && return
0` is reachable on attempt 5; after the loop `return 1`. Nits: tr/mv failure returns 0 with
CRLF content (pre-existing pattern); any rc=255 classified transport (conservative).
2 (ui_send) — CONFIRMED. parse.sh:469 `sleep 3` once per ui_send after load. Edit-dump
failure (:476-482): `dump_fail stage=edit` logged; transport → `return 1`; else
`void_reason=composer; return 2`. d_run.sh:275 `if [ "$ui_rc" -eq 2 ]; then row_void=1;
elif [ "$ui_rc" -ne 0 ]; then status=1; fi` — 2 → VOID, 1 → ABORT (pre-registered) ✓.
Send-dump failure post-typing (:497): transport → 1, else 2 — typed-but-never-sent correctly
VOIDs; the end-of-row force-stop/uninstall still runs. Retry-loop dumps (:550) log
`dump_fail stage=send attempt=…`; after the loop transport → 1 else VOID 2 ✓.
3 (sleep 3) — CONFIRMED: one 3 s settle per ui_send before the first dump; the other sleeps
are inter-attempt/retry — no compounding.
4 (removed behaviour) — CONFIRMED: the old edit-missing `return 1` had no caller relying on
rc=1 (single caller d_run.sh:275 handles both); dryrun fixtures rebuilt for the new rc.
5 (dryrun) — CONFIRMED: `bash dryrun.sh > /tmp/dr12.log 2>&1` → exit=0. The two fixtures hit
the real code: DUMP_FAILS=2 → stub emits the real `ERROR: could not get idle state` twice
then succeeds — asserts `attempt=3 .*rc=0` in retry_edit.xml.dump.log and ui_send rc=0
(typing proceeds); DUMP_FAILS=5 → A 9 has `status=0 row_void=1` + `dump_fail stage=edit`,
then A 10 runs — continuation proven. Genuine.
6 (set -u) — CONFIRMED: DUMP_UI_TRANSPORT assigned before use, reads `:-0`-guarded;
edit_dump_rc/send_dump_rc/send_dump_transport declared.
7 (PREREG:153-156) — CONFIRMED vs raw/sa807902: edit.xml = 64 bytes with exactly `cat:
/data/local/tmp/kalsa-s5/ui.xml: No such file or directory`; load.txt has
`"promptMs":117820.522` (117.8 s ≈ "118 s"); "five times at 3 s intervals … VOID(composer)
rather than an abort" and "no 7c data are analyzed" match the code and run state.

## Delta verdict #12

GO. 0 blockers, 0 majors, 0 minors, 2 nits (tr/mv failure; conservative 124/255 transport
classification). Mechanics, VOID-vs-abort split, send-fail semantics, dryrun (exit 0), set -u
safety and PREREG:153-156 all CONFIRMED. Launch run 7d.


## Delta audit #13 — run 7e wake/AOD

1 (wake_tap, d_run.sh:61-76) — CONFIRMED, safe: LAST_EDIT_BOUNDS set from the last good
edit dump (parse.sh:515) and reset per turn (parse.sh:500, d_run.sh:301) — no stale leak;
fallback (540,2047), source logged; the tap fires only after locksettings-disable +
dismiss-keyguard (wake_sequence order) — an AOD/lockscreen tap is impossible; on home/app a
single mute tap (bottom-center/gesture zone). PLAUSIBLE-safe.
2 (transport) — CONFIRMED: WAKE_SEQUENCE_TRANSPORT per-command 124|255, reset at entry,
gates the final success; dump_ui propagates it to DUMP_UI_TRANSPORT; poll_load returns 1 on
ANY power_rc≠0 — MINOR: a transient (non-transport) power-dumpsys failure aborts the load
without retry — recommend 124/255-only fatal.
3 (dump_ui AOD, parse.sh:247-248) — CONFIRMED: `! grep -q 'package="com.kalsa.app"'` →
`attempt=%s aod` → continue in the 5-attempt loop (counts, sleeps 3, finite → VOID);
legitimate app dumps carry the package; only systemui-hosted overlays false-AOD (no
permission dialogs in these runs; worst case 5× then VOID, never hangs).
4 (poll_load) — CONFIRMED: the per-iteration dumpsys (~1-2 s/5 s) does not touch the
app-internal prewarm timer; a mid-load wake-tap neither disables the field nor types.
5 (removed behaviour) — CONFIRMED: diff additive; stayon/timeout/locksettings retained.
6 (dryrun) — CONFIRMED: `bash dryrun.sh > /tmp/dr13.log 2>&1` → exit=0; DUMP_AOD_FAILS=1
drives one systemui dump → `aod` in the .dump.log + ui_send rc 0; poll_load with
doze_load/LOAD_DOZE_REMAINING=2 → two wakes → `rewakes=2` asserted. Genuine.
7 (set -u) — CONFIRMED: all new globals/locals declared; dryrun runs set -u.
8 (PREREG:157-161) — facts CONFIRMED, MINOR citations: the 9.6 kB systemui edit.xml =
raw/sa807902b/7p-Gen-3_A_t1_edit.xml (9663 B, 48 systemui hits); mIsPowered=false/
mStayOn=false at sa807902b/wake.log:10,15 — but the amendment cites the now-absent
sa807902 paths; mLastSleepReason=timeout is uncited (orchestrator-live only).

## Delta verdict #13

GO. 0 blockers, 0 majors, 2 minor (poll_load non-transport power failure → abort; PREREG
citations sa807902→sa807902b + uncited sleep-reason), 1 nit. Mechanics, bounds reset,
transport propagation, finite AOD loop, dryrun exit 0, set -u all CONFIRMED. Launch 7e.


## Delta audit #15 — run 8 driver

F1 — CONFIRMED, MAJOR. d_run.sh:368-370 `if [ "$arm" = B ] && { [ "${fallback:-0}" -gt 0 ]
|| [ -z "$governor" ]; }; then row_void=1; void_reason=governor_fallback; fi` sits after
ui_send's composer/hot VOID: a B row already VOID for composer/hot (no governor line exists —
turn never sent) has `governor` empty → void_reason OVERWRITTEN composer/hot →
governor_fallback — the status reason lies for exactly the row classes run 8 expects;
recoverable from composer_len/cooldown files but the promised void_reason is wrong. Fix:
`[ "$row_void" -eq 0 ]` guard (or `&& [ "$void_reason" = na ]`). A rows untouched
(`[ "$arm" = B ]` ✓); dryrun's row fixtures (B+FALLBACK-line, B+completed-turn-no-governor,
A) don't cover the composer/hot-B overwrite.
F2 — MINOR (carried): poll_load `[ "$power_rc" -eq 0 ] || return 1` — persistent 3×
non-transport power-dumpsys failure still aborts the load; power_capture's retries shrink it.
power_capture (d_run.sh:70-87) — CONFIRMED: content-good rc=255 → has_wakefulness=1 →
rc 0 (the 7e rc-only trap FIXED); 3 bad → rc 1; POWER_CAPTURE_TRANSPORT=1 only when ALL THREE
rcs 124|255; per-attempt log to ${file}.log. Call sites: dump_ui (:212-220) keeps the
not-Awake → wake_sequence branch and propagates via POWER_CAPTURE_TRANSPORT; typing_awake
(:383/:393) `power_capture || return 1` with wake-on-Dozing intact; poll_load (:290) same
downstream.
set_prefs (d_run.sh:229-238) — CONFIRMED: `[ "$flag" -eq 1 ] && [ "$BOARD" = 8-Gen-3 ] &&
governor_force=1` (local init 0); INSERT now has `('kalsa.bench.governor_force',
'$governor_force')`; A/non-8Gen3 → '0'; dryrun sqlite assertions (:186-189) verify all four
combinations through the real push.
RAM gate (:50-58,164,176-178) — CONFIRMED: before install, BOARD= at :174 then :178
`gpu_fit_ram_gate "$BOARD" "$MEMTOTAL_KB" || exit $?`; unparsable → `return 0` fail-open
(acceptable — dead adb surfaces elsewhere; live path enforces the spec); boundary `-le
8388608` = 8 GiB exact; `|| exit $?` fires only on nonzero (2 → exit 2; rc-0 never reaches
exit — `||` short-circuits); `tr -d '\r'` ✓.
Removed behaviour — CONFIRMED: only dump_ui's single-attempt 124|255→DUMP_UI_TRANSPORT line
replaced by the 3×-rule; per-attempt power logging retained.
set -u — CONFIRMED: POWER_CAPTURE_TRANSPORT set at :73 before reads (`:-0`-guarded);
MEMTOTAL_KB/governor_force/BOARD assigned before use.
dryrun — CONFIRMED: `bash dryrun.sh > /tmp/dr15.log 2>&1` → rc=0; fixtures drive the real
functions (rc255_good single-attempt PASS; no_wake 3 attempts; force-key matrix; RAM gate
7864320→2/12582912→0/7p→0; governor-rows through real run_observation with synthetic logcat
including the A-row non-affection check).
Hot-path exits — CONFIRMED: none new on the turn path (gate exit 2 is pre-turn).

## Delta verdict #15

GO for launch (evidence chain intact) with F1 fixed before bank (one-line guard), ideally
before launch. 1 major (F1), 1 minor (F2), rest CONFIRMED; dryrun rc=0.

## Delta audit #15b

(1) Guard — CONFIRMED. d_run.sh:368 `if [ "$arm" = B ] && [ "$row_void" -eq 0 ] && {
[ "${fallback:-0}" -gt 0 ] || [ -z "$governor" ]; }; then row_void=1;
void_reason=governor_fallback; fi`. Traces: (a) B row VOID composer/hot earlier (ui_send rc 2)
→ `row_void` already 1 → the guard short-circuits → void_reason=composer/hot preserved ✓;
(b) B row that completed with a FALLBACK line or no `KALSA_GOVERNOR {` line → row_void=0 at
that point → guard fires → VOID governor_fallback ✓; (c) row_void cannot be unset at :368 —
it is a run_observation local initialized `row_void=0` before any turn path reaches the parse
section, and every prior write is conditional `=1` assignments ✓ set -u safe.
(2) The ±10% band-vs-guard ORDER — CONFIRMED, no mask. The guard (:368) runs BEFORE the band
gate (`awk … new_tokens_b … || row_void=1`, two lines below the reuse parsing): for the
completed-FALLBACK/no-governor B row the guard sets row_void=1 + governor_fallback FIRST, so
the band's `|| row_void=1` is a no-op and the reason survives — the run-7e B1 shape now
yields governor_fallback, not na. The reverse (band first) cannot occur. The residual
band-only case — a B row with a valid governor line but chunks outside 938±10% → row_void=1
with void_reason=na — is pre-existing, reason-tag-unlabelled but benign (the oracle column
VOIDs it; the band evidence is in new_tokens_b). Acceptable; a reason tag there would be
cosmetic.
(3) Dryrun — CONFIRMED and genuine: dryrun.sh:239 `run_observation B 3 || …
grep -q 'status=0 row_void=1.*void_reason=composer'` follows a DUMP_FAILS=5 setup (the edit
dump exhausts → ui_send rc 2 → VOID composer) — the guard's skip is exercised through the
real run_observation and the assertion proves void_reason=composer survives.
(4) Scope — CONFIRMED: git diff remains 70+/10- (only the guard and the fixture added since
#15; nothing else changed).
Ran `bash dryrun.sh > /tmp/dr15b.log 2>&1` → rc=0 (tail: cleanup 0 /
RESULTS=/tmp/kalsa-s5-dryrun.bFkhri/results.tsv).

## Delta verdict #15b

GO. 0 blockers, 0 majors, 0 minors — F1 correctly fixed (guard order verified, no masking,
reason preservation proven by the new dryrun fixture), dryrun rc=0. Launch run 8 on QRD8650.

## Delta audit #17 — fork bench_force_gpu_prefill

(1) Production safety — CONFIRMED. llama-governor-policy.cpp:153-158: the new `if
(params_.bench_force_gpu_prefill && params_.gpu_fit == llama_governor_fit::Fit) { return
llama_governor_engine::GPU; }` sits AFTER the full CPU guard (`!valid_schema(params_) ||
!profile_valid_ || !have_profile_ || state_ == CRITICAL || state_ == Invalid || state_ ==
LOWBAT || profile_.batt_level_pct < 45 → CPU`) and BEFORE the generation rules (V75/V79
measured, V73 MoE COOLMODE) — exactly the required placement. With the default false the new
branch can never fire, so every other path is byte-equivalent to HEAD~1 (the diff is 58+/0-,
touching only the struct field, the 3 policy lines, and the test). Generation readers: only
the three pre-existing policy branches (:163-168, :240); the runtime route is
n_tokens-based, not generation-based, and no route/assert on generation exists in
llama-governor*.cpp — forcing GPU on V73/Unknown changes only the prefill_engine label,
which is then TRUE (the prefill executes on the GPU handle) — no mis-label. decode_engine
and the expert rules are untouched.
(2) Schema — CONFIRMED: valid_schema (llama-governor-policy.cpp:17-20) checks only
schema_version==3 && capability_schema_version==2 && the admission-margin constant — a
default-false params bool needs no bump and no capability flag; the field is not serialized
or logged anywhere (grep: only the header, the policy, and the test) — its absence on the
app side is harmless until the pin maps kalsa.bench.governor_force → bench_force_gpu_prefill.
(3) Test — CONFIRMED, exercise through the real policy: (a) V73 Dense Fit force=true →
GPU; (b) Unknown Fit force=true → GPU; (c) force=true NoFit → CPU; (d) force=true
CRITICAL → CPU — reached via bench_thermo(420)=42.0 °C through the REAL update_thermal /
thresholds tuple {38.0,36.0,39.5,36.5,42.0,34.0}, not a fake state — a genuine thermal-guard
test; (e) force=false V73 Dense → CPU. Runs before the GPU skip in main (pure-policy — no
device needed), consistent with rc 77. NIT: only the temperature side of the guard is
exercised; the batt<45 branch is the same guard block and untested in isolation —
acceptable.
(4) Hot path — CONFIRMED: one bool compare in the policy; no allocation/throw.
(5) Clean code — CONFIRMED: comment "// bench-only: force GPU prefill when gpu_fit==Fit;
production leaves it false" accurate; no duplicated literal.

## Delta verdict #17

GO for pushing the fork and bumping the app pin. 0 blockers, 0 majors, 1 nit (batt-guard
untested in isolation). The lever is inert by default, correctly positioned after the thermal
guard, and the test proves the five required outcomes through the real policy path; the app
pin must map kalsa.bench.governor_force → bench_force_gpu_prefill for run 8's B rows to use it.

## Delta audit #19 — runs 9-11 driver

(1) type_prompt ladder — CONFIRMED. parse.sh:420 `for chunk_size in 200 100`, with
`first_rung=1` set BEFORE the loop and `first_rung=0` at parse.sh:488 after the attempt's
failure path (the success rc=0/rc=2 exits happen before it) — the first-char retype branch
(parse.sh:456 `[ "$chunk_no" -eq 1 ] && [ "$first_rung" -eq 1 ] &&
[ "$TYPE_VERIFY_TEXT" = "$first_loss_expected" ]`) fires ONLY on the 200 rung, never on the
100 rung; `first_loss_expected="${PROMPT_TEXT:1:TYPE_VERIFY_LEN}"` with a 200-chunk is
correct (a first-char loss at 200 yields actual_len=199 = PROMPT_TEXT[1:199]). set -u safe
(first_rung init 1). Both cap checks use the rung cap — parse.sh:433 (in-loop) and :479
(post-success) both `[ "$elapsed" -ge "$cap" ]` with `cap=$(type_cap_for_chunk
"$chunk_size")` (parse.sh:424; 200→400, 100→700, `*) return 1`) — the delta-11-era
-ge/-gt inconsistency is gone (both -ge). No 500 remains in parse.sh/dryrun (grep clean);
PREREG:150's "500 → 200 → 100" is the historical 7c text, not the current ladder.
(2) Gates — CONFIRMED. d_run.sh:54 `if [ "$memtotal_kb" -le 8388608 ]; then` — the RAM gate
now covers every device_tag (the 8-Gen-3 condition dropped), still called before any install
with MEMTOTAL_KB CRLF-stripped; dryrun:251 asserts rc=2 for 7p-Gen-3 at 7864320. d_run.sh:234
`[ "$flag" -eq 1 ] && governor_force=1` — arm A (flag 0) still writes '0'; every board's B
writes '1'; the sqlite INSERT pairing
`('kalsa.governor.enabled','$flag'),('kalsa.bench.governor_force','$governor_force')`
unchanged; dryrun's assert_governor_force (:150-157) covers all five boards × both flags
through the real set_prefs push.
(3) Measurement path — CONFIRMED: the diff touches only the typing ladder and the two gates;
anchor, telemetry parsing, oracle, cooldown, commit parsing untouched.
(4) dryrun — CONFIRMED: `bash dryrun.sh > /tmp/dr19.log 2>&1` → rc=0 (tail: holder_loop 143
/ cleanup 0). Fixtures drive real code: the 26-chunk counts (INPUT_TEXT_COUNT 52/130,
TYPE_COUNTS 26,26,…), the ladder fixtures now 200→100 (`attempt=1 chunk_size=200 .*rc=1` +
`attempt=2 chunk_size=100 .*rc=0`; the three-fail variant with no rc=2 escape), the force
matrix, and the RAM-gate rc=2 — all genuine.
(5) Time budget — CONFIRMED consistent: PREREG:260 "85-min run for 4 turns but not 6";
arithmetic: mid-case turn ≈ 340 s typing (26×200-chunks) + 2-8 min cooldown + ~90 s +
overhead ≈ 12-18 min → 4 turns ≈ 60-72 min < 85, 6 ≈ 96 min > 85 ✓; worst case at both
caps (400+700+900+90 ≈ 35 min) yields only ~2 turns — the PREREG states the expectation and
the deadline rule. Caps match PREREG:255 ("400 s at 200, 700 s at 100").

## Delta verdict #19

GO. 0 blockers, 0 majors, 0 minors, 1 nit (the worst-case-cap regime (~35 min/turn) can
underdeliver to 2 turns; the pre-registered "4 turns but not 6" holds at the mid-case only —
rows lost to the deadline stay reported as such per PREREG:260). Ladder, caps, first_rung,
gates, force matrix, dryrun (rc=0) all CONFIRMED. Commit and use for run 9 on QRD7675.

## Delta audit #25 — logit-oracle driver

F1 — CONFIRMED, MAJOR: DESCRIPTIVE masks FAIL in TF mode (and the helper's early returns
violate "any violation = FAIL; DESCRIPTIVE only when the data cannot be judged").
oracle_logit.py:70-77: the TF loop `if brow.get("forced") is not True: continue; arow =
a_rows.get(step); if arow is None or brow["tok"] != arow["tok"]: result("DESCRIPTIVE",
"R4", …); return 0` — it RETURNS at the FIRST forced step whose tok differs, so every later
comparable step is never R1/R2-checked. My adversarial case c (step 0 forced with a
different token, step 1 with margin(A)=0.40 ≥ 0.03 and a different top-1): the helper
prints `oracle=DESCRIPTIVE rule=R4 steps=0` — the step-1 R1-class violation is HIDDEN. Fix:
continue collecting (record the divergent steps separately), run R1/R2 on all comparable
steps, FAIL on any violation, DESCRIPTIVE only when zero comparable steps exist and at least
one divergence was seen; a later FAIL must win over an earlier DESCRIPTIVE.
F2 — CONFIRMED, MINOR: the G-mode divergence step is labelled R3 even when R1 applies.
oracle_logit.py:100-103: `valid = all(margin(arow) < margin_limit and brow["tok"] ==
arow["top"][1][0] for …)` → FAIL R3 — a divergence with margin(A) ≥ 0.03 FAILs (the owner's
principle holds — nothing passes) but the rule attribution should be R1 per the spec
("a divergence with margin ≥ 0.03 is R1 FAIL") — label R1 when margin ≥ the limit, R3 for
the margin<limit case. Note: R2 never applies to the divergence step in G (by design — the
post-divergence matching steps are also outside the comparable set per spec).
F3 — CONFIRMED: R1 is computed on A's own top-2 margin (`margin(arow) =
exp(top[0][1]) − exp(top[1][1])`, oracle_logit.py:27) ✓; R2 checks both parts (token-in-
B-top-5 with exp(pA) ≥ 0.02, |logpB−logpA| ≤ 0.10, and |pB(top1)−pA(top1)| ≤ 0.02 — the
third at :56-58 with the `prob_limit` bound ✓); "not in B top-5" is a FAIL, not a skip ✓;
R4's 32-comparable-step and forced=true+tok==A conditions ✓ (:62-77).
F4 — CONFIRMED: the limits (0.03/0.02/0.10) live only in the driver's invocation args; no
env override; loosening requires a source edit ✓. single place ✓ (the driver's
oracle_logit_eval call passes them as literals).
F5 — CONFIRMED (my adversarial runs through the real helper): (a) identical tokens, B
top-1 p drifted 0.60→0.50 → `FAIL R2 steps=32 max_dp1=0.1000` ✓; (b) A top-5 token 99
pA=0.05 missing from B top-5 → `FAIL R2` ✓. (Note: feeding interleaved A/B rows in ONE file
silently overwrites per step — the driver writes separate files, fine.)
F6 — CONFIRMED (driver): A_PROBS_FILE/A_IDS_FILE are per-turn (A rows reassign; the B side
guards on A_IDS_VALID — a VOID A turn yields no force_ids, oracle_mode=G ✓; ids_to_json
validates 32 numeric ids ✓; the `oracle_logit`/`oracle_rule` columns added to the 19-field
header and printf ✓; the strict `oracle` column untouched ✓; set -u init'd (ORACLE_MODE="",
A_PROBS_FILE="", oracle_mode local na) ✓; hot-path safety: a missing helper/py failure →
empty oracle_result → the `oracle_logit=DESCRIPTIVE/oracle_rule=R4` fallbacks — the turn
never aborts ✓; the parse.sh extraction strips ANSI/CR after the anchor ✓ (spot-checked in
the diff).
F7 — CONFIRMED: `bash dryrun.sh > /tmp/dr25.log 2>&1` → rc=0; the fixtures drive the real
helper + sqlite assertions (probs '1' for both arms; force_ids injected for B from the A ids
file, deleted when A invalid).

## Delta verdict #25

NO-GO for committing ORACLE_MODE=logit until F1's precedence is fixed (collect comparable steps; FAIL dominates DESCRIPTIVE; DESCRIPTIVE only with zero judgeable steps) and F2's label corrected (margin ≥ 0.03 → R1). The helper otherwise matches R1-R4, thresholds single-sourced, adversarial (a)/(b) FAIL correctly, dryrun rc=0, wiring sound.

## Delta audit #25b

Fix verified — lines as read: oracle_logit.py:64-71 (TF loop: divergent forced steps →
`coverage_bad = True; continue` — no early return; comparable steps appended and
step_rule'd), :74-84 (G loop: divergence with `margin >= margin_limit` → record R1; tok≠#2
→ R3; `len(divergences) > 1` → R3; comparable = pre-first-divergence), :92-96 (`if
violations: FAIL rule=min(violations)[2]` before `coverage_bad` — FAIL dominates), and
:36-53 (step_rule with in-step R1>R2 precedence; record tuples `(step, severity, rule)` so
min() picks the EARLIEST step's rule ✓).
Printed lines (my adversarial runs):
- tf_masked → `oracle=DESCRIPTIVE rule=R4 steps=0 …`
- g_div → `oracle=FAIL rule=R1 steps=10 divergences=1 first_div=10`
- g_2div → `oracle=FAIL rule=R1 steps=10 divergences=2 first_div=10`
- ident → `oracle=PASS rule=none steps=32 …`
- drift → `oracle=FAIL rule=R2 steps=32 … max_dp1=0.1000`
- missing → `oracle=FAIL rule=R2 steps=32 … max_dlogp=0.1823`
- tf31 → `oracle=DESCRIPTIVE rule=R4 steps=31 …`
- tf31r2 → `oracle=FAIL rule=R2 steps=31 …` (FAIL dominates DESCRIPTIVE ✓ — the core of the
  fix)
- `bash dryrun.sh > /tmp/dr25b.log 2>&1` → rc=0.

F1 — CONFIRMED, MAJOR (residual): the R1-class masking in TF is NOT cured. My case (1) —
TF with step 0 forced+wrong token and step 1 margin-0.40 disagreement — prints
`DESCRIPTIVE R4 steps=0`, not FAIL R1. Root cause: in TF the comparable condition requires
`brow["tok"] == arow["tok"]` while R1's trigger is `a1 != b1` — the two predicates are
mutually exclusive, so R1 is STRUCTURALLY UNREACHABLE in TF mode; any divergent step is
coverage_bad → R4-descriptive, and a run whose only deviations are high-margin disagreements
reports DESCRIPTIVE — a wrong thing passing per the owner's principle. Fix (choose one):
apply the G-style divergence check in TF too (divergence with margin ≥ 0.03 → R1 FAIL), or
pre-register the spec decision ("TF divergent steps are R4-descriptive by definition") —
the latter still leaves the wrong-thing hole and requires the PREREG to say so explicitly.
F2 — CONFIRMED: the R2-class masking is fixed (tf31r2 → FAIL R2 with 31 compared steps);
compared excludes only the tok≠A steps and never skips a comparable one; min(violations)
tuple order (step-first) verified; max_dlogp/max_dp1 recomputed over compared ✓.
F3 — CONFIRMED: g_div → FAIL R1 (margin-0.40 divergence correctly labelled R1); the
second-divergence path records R3 (in my fixture the first divergence is itself high-margin
so R1 wins the earlier-step min — a low-margin-first fixture would surface R3); identical →
PASS 32; drift/missing → FAIL R2 ✓; tf31 → DESCRIPTIVE R4 ✓.

## Delta verdict #25b

NO-GO until the TF-R1 decision is made (F1): either the TF divergent steps get the R1
margin check (making case (1) FAIL R1) or the spec explicitly pre-registers them as
R4-descriptive. Everything else (FAIL-dominates-DESCRIPTIVE, R2, R3, min-step rule,
dryrun rc=0) is confirmed.
