# GOVERNOR TRI-ENGINE — HOSTILE AUDIT (docs/GOVERNOR-TRI-ENGINE-DESIGN.md, PLAN #24)

Audited 2026-08-26, read-only, no git. Sources opened and checked line-by-line: PLAN.md
(rows 24, 28, 28b, 28c, 28d, 28e, 29, 31, 32, 33, #16/#18/#20 chapters, top view),
docs/ALIVE.md (§1, §2, §5, §6 rows 9/11/12/13/15/16, §8), docs/PLAN-10DAYS-2026-08-28.md (all),
scratchpad/agents/q54-engine-router/SPEC.md (+ ledger §6), q55 PREREG/REPORT, q56 REPORT,
q57 PREREG/REPORT + thermal CSV, q58 PREREG/REPORT, q62 REPORT (via ALIVE §6 row 15),
q53 REPORT + INCIDENT_THERMAL.md, q48/q46 narrative in PLAN. Citations below are
`DESIGN:<line>` for the audited doc.

---

## 1. TRACEABILITY

**BLOCKER-1.1 — Exec summary misstates the certification ledger (the doc's own source of truth).**
`DESIGN:13`:
> "NPU prefill spike only when tokens ≤ 512 AND battery T ≤ 39.5 °C AND the lane is ON in the
> certification ledger; **today that means v75-class (R2 certified q55) and v73 dense/hybrid
> only** (R6/R7 hard OFF…)"
Self-contradictory and false against SPEC §6:
- v73 "dense/hybrid only" **is** R6, which the same sentence calls "hard OFF" (SPEC §6: R6 =
  "OFF — hard, thermal-shutdown incident"; R7 "OFF — hard, until a v73 lane survives a
  correctness cell").
- R2 is correctness-certified **but the lane is OFF**: SPEC §6 "R2 … OFF → flips ON with the
  app-side spike-lane cell + npu_fit model (memory), not before", and the design itself
  (§4 cross-ref) concedes npu_fit is still SPEC open item 3.
Therefore "today" the set of spike-eligible lanes is **empty**. The design is proposing itself
(+G-cells) as the missing app-side cell — that is legitimate — but the exec summary, the
most-read paragraph, must say it.
Fix: "today NO lane is ON. Eligible generations once the ledger flips: v75-class (R2,
correctness-certified) and v73 dense/hybrid (R6, reopens only via a time-budgeted spike
cell). This design + G1–G5 is that cell."

**MAJOR-1.2 — v75 prefill cell numbers attributed to the wrong PLAN row (#28c vs #28b).**
`DESIGN:31-32`: "CPU | 24.1 med (3 reps) [PLAN #28d] | **51.9 [PLAN #28c]** … | 165.4 med
(150.3–170.3) = 3.19× [PLAN #28c]".
PLAN.md:415 (row **#28b**, item 7) carries the banked cell: "pp512 HTP mediana 165.4 t/s
(range 150.3–170.3, 3 rep processo… ) vs CPU same-harness 51.9 → 3.19×". Row #28c
(PLAN.md:416) is the HVX-K-quant row and contains neither number. Same for DESIGN:32's
"117–128 t/s observed once [PLAN #28d caveat]" — those values live in row #28b
(fallback-trap re-test: "128.4 t/s vs 117.1"), not #28d. Values themselves are correct
(also in ALIVE §6 row 9) — this is the classic one-row misattribution.
Fix: cite [PLAN #28b] (or ALIVE §6 row 9) for 51.9/165.4/3.19× and for the 117–128 spread.

**MAJOR-1.3 — "2.5–4× lower heat at every size up to 2048" fails against the cited table.**
`DESIGN:14` and exec #3: "per-prompt heat 2.5–4× lower at every size up to 2048".
From the table the design itself prints (DESIGN:1.2, banked q58 process means):
2048: 5.15/2.2 = **2.34×** (< 2.5); 1024: 3.25/1.1 = 2.95; 128: 1.9/0.5 = 3.8; 512:
3.25/0.0 = undefined. So "2.5–4× at every size" is false at 2048 (and undefined at 512).
The error originates in PLAN #28c's q58 narrative ("2.5-4× … a OGNI taglia"), but the design
is the artifact being banked and recomputes nothing.
Fix: quote per-size ratios (3.8 / undef / 2.95 / 2.34) or claim "≈2.3–3.8×".

**MAJOR-1.4 — The 39.5 °C derivation is misdescribed; the arithmetic as written does not compute.**
`DESIGN:54`: "start-T ceiling 39.5 °C (= 40.0 − **mean ΔT 0.5** over sizes ≤ N_max)".
Per-run ΔT at n ≤ 512: 0.4, 0.6 (128) and 0.0, 0.0 (512). Mean over sizes ≤ N_max =
mean(0.5, 0.0) = **0.25 → 39.75 °C**, not 39.5. The banked value 39.5 equals 40.0 − 0.5
where 0.5 is the **n=128 per-size mean = max size-mean ≤ N_max** (q58 REPORT + REVIEW_DOC
correction: "40.0 − 0.5 = 39.5 is the value banked"; the PREREG's per-run max 0.6 → 39.4
was rejected by audit). The design's "(= mean ΔT 0.5…)" text is arithmetically wrong —
inherited from the q58 audit wording, but a future maintainer will re-derive 39.75 and
"correct" the wrong way.
Fix: write "40.0 − 0.5 (largest per-size mean ΔT below N_max; n=128)"; note the rejected
per-run-max variant (39.4) so the choice is visible.

**MINOR-1.5 — "cool_decode_ratio 0.81 (KEXP scope) [q55/#18]".** `DESIGN:174`. The 0.812 is
#18/ALIVE §6; q55 Part B (v75 pp512 spike) contains no 0.81. Drop q55 from the citation
(design's own §1.2 row cites it correctly as [#18 decision table, ALIVE §6]).

**MINOR-1.6 — CPU-ref 1.38 °C/min "[q57]" is not in the shipped q57 cell.** q57 REPORT.md
holds Arm A (2.33, 3.75 min, 41.4 — re-derived by me from thermal_armA_resume_1048.csv:
31.8→41.4 °C over 247 s = 2.332 ✓) and arms B/C. The 1.38 slope exists only in the PLAN
#28c narrative of the q57 session ("CPU-ref 1.38 °C/min (start diverso di 2.8 °C…)");
raw for the CPU-ref trace is not in the cell dir. Value traces to the authoritative PLAN
narrative (ALIVE header: PLAN wins) — acceptable, but flag "raw not in cell" before G3
anchors on it.

**MINOR-1.7 — "original 3-minute arms" (G3, DESIGN:188).** The #18 protocol's per-cell
duration is nowhere I could open (kexp-n5-session has no PREREG.md). NOT VERIFIED.

**NOTE-1.8 — 0.38 in "half-offload worst 0.38–0.45×" (DESIGN:12).** 0.45 = 7.90/17.55
(KEXP, #18, cited in §1.1). 0.38 = 10.53/27.69 (OLMoE B/C, ALIVE decision table, n10
build) — correct but uncited in §1.1; add the ALIVE citation.

**VERIFIED CLEAN (spot-checked vs sources, no discrepancies):** 84.0/24.1 = 3.49× and
reps; 686.2/142.2 = 4.82×; r = −0.02 % (q55 Part A); LFM-B′ 58.43/51.08 = 1.14×;
Marco-B′ 27.84/19.12 = 1.46× and J/token 0.86× (single replica); pp512 25→69 t/s and
2.76× (q44 sweep payload in #31); 2.477× prefill + 0.992 decode parity (phase d); KEXP
14.25/17.55 = 0.81×, OLMoE 20.03/27.69 = 0.72×, B 7.90 = 0.45×; Mellum2 0.216/0.223 = +3 %
(#23); q57 per-pass 0.45/1.125 (n=2 each); q58 0.5/0.0/1.1/2.2 vs 1.9/3.25/3.25/5.15 and
prompt-only 1.7/12.3 s, 23.2/81.6 s; −19 %/−2.75 °C @ CPU peak 40.0; OLMoE median gap
0.45 °C; −0.28 °C/min (34.3→29.9 over 15.8 min, unplugged, n=1); charging idle 35–41 °C
(reported, PLAN-10DAYS §0); >38 °C in ~2 min + 43.4 °C @ chunk ~7 (q53c s2/s3); ΔT ≤ 1.0 °C,
MAX ≤ 32.1 °C (q55 Part B); 2.48 s relaunch (ALIVE §1); ~25 s anon-load (PLAN #29);
3672/7074 (q46), 6360 LMK×2 (q44f2/#28c), 3.6 GiB HTP0-REPACK, 256 MB KV -nkvo (q55);
800 MiB + 1.05×bytes, k_set 1.74→1.05, 5 points, one device+model (q44/#31, ALIVE row 12);
6.6× and RLIMIT_MEMLOCK 64 MB (PLAN #29); WARN 40.0/KILL 43.0/poll 10 s/floor 45 %
(q56 + PLAN-10DAYS §0); session hard-cap 38.0 (q56 production_command); 8.2 GB free /
15.8 GB ggufs (q56/PLAN-10DAYS §0) and the 12 GB-free top-view note (PLAN:25);
Qwen3.5-4B file 3.50 GB incl. 672 MB projector (#31); Marco1c-KEXP 6.4 GB; LFM-B′ 3.58 GB
sha (q56 integrity MATCH); G4 grid + g* 900–1000 (PLAN-10DAYS §6a); ±50 % variance
(ALIVE §5).

---

## 2. STATE MACHINE LOGIC

**BLOCKER-2.1 — CRITICAL can never exit while plugged: the exit threshold is below the
plugged battery floor the design itself cites.**
`DESIGN:102,113`: CRITICAL exit "T ≤ 34.0 AND 10-min soak complete". The design's own
§1.2/exec#10: charging S23 idles at 35–41 °C battery, and the signed window is **10
consecutive plugged days** (PLAN-10DAYS §0). 34.0 < 35–41 ⇒ the soak is unreachable ⇒
after the first CRITICAL entry the governor aborts **every** generation for the rest of the
window. COOLMODE exit (≤36.5) likewise stalls near the floor. The design reasons about the
floor on the ceiling side only ("plugged windows rarely clear the 39.5 spike ceiling") and
never on exits. Note the 35–41 range is "reported", i.e. external — day 1 of the plan
measures the actual plugged idle; the deadlock is contingent on that measurement, but the
fix must be pre-committed either way.
Fix: plugged-aware exits: when `plugged=true`, CRITICAL exit = (idle_floor + 1 °C,
measured day 1) + soak, or require unplugged for CRITICAL recovery; COOLMODE exit = max
(36.5, idle_floor − 1). Golden-test the plugged CRITICAL trace (the design pins a CRITICAL
trace but not this branch).

**MAJOR-2.2 — The machine authorizes CPU prefills that the watchdog KILLs mid-run;
"overshoot into CRITICAL is one-directional and safe" is false.**
`DESIGN:116,198`. Per the design's own numbers, an n=2048 CPU prefill adds +5.15 °C
(q58). FAST tops at 37.9 → 43.05; WARM runs to 39.5 → up to 44.65: **both cross KILL 43.0
before the next 10-s poll can raise CRITICAL at 42.0**. The overshoot skips CRITICAL
entirely and lands in the watchdog kill path (process killed, generation aborted
ungracefully — same outcome as CRITICAL-abort minus the graceful cleanup the design
promises: "kill children per q56 semantics; drop HTP session"). "CRITICAL at 42.0 leaves
~1 °C above the fastest banked rise per 10-s poll" (DESIGN:105) is irrelevant to discrete
jumps. The NPU spike itself cannot kill (see NOTE-2.6) — the gap is CPU prefill > N_max at
high T.
Fix: gate CPU prefill length by state (e.g., prefill > 512 tokens disallowed at T ≥ 38.0,
or queue until WARM exit), or explicitly document the kill-with-relaunch path as the
designed behavior and say why. Compute the WARM→KILL exposure in G1.

**MAJOR-2.3 — "worst banked rise crossing it = 2.33 °C/min" is not the worst banked rise.**
`DESIGN:105`. 2.33 is the v73 **NPU** sustained slope (q57). Banked, faster: q53c session
2 (PLAN #28c narrative) — dense 4B CPU PPL on `-t 8` exceeded 38.3 °C in ~2 min from a
~31–32 °C start ⇒ average ≈ 2.6–3.6 °C/min (0.45–0.6 °C per 10-s poll), i.e. ≥1.5× the
cited value; the q53 session-3 CPU-ref reached 43.4 °C by chunk ~7. The "one guaranteed
margin" claim is overstated; the margin at 42.0 is ~1–2 polls, not "one guaranteed °C".
Safety still holds (10-s poll catches either slope); the stated rationale does not.
Fix: use the q53c-derived bound (or state both slopes) and call the margin ~0.4–0.6 °C/poll.

**MAJOR-2.4 — Hysteresis widths and exit gaps do not match the design's own table.**
`DESIGN:105`: "exits are set 3.0–3.5 °C below entries". Table (DESIGN:110-113): WARM
38.0→36.0 = **2.0 °C**; COOL 39.5→36.5 = 3.0; CRITICAL 42.0→34.0 = **8.0**.
`DESIGN:116,198`: "hysteresis widths (≥ 3.0 °C) exceed the largest observed single
GPU/NPU turn heat" — WARM is 2.0 °C; the largest NPU per-prompt ΔT banked is 2.2 °C
(n=2048, q58) > 2.0 (outside N_max, but the sentence is unqualified); GPU per-turn heat was
never measured (only a 3-min-arm peak delta −2.75). As written both sentences are
factually wrong; the *intended* claim (width 2.0 > spike heat ≤ 0.6 °C at n ≤ 512) holds.
Fix: state the real widths (2.0/3.0/8.0), justify WARM=2.0 against the N_max-bounded spike
heat, and relabel the GPU claim "unmeasured per-turn".

**MAJOR-2.5 — WARM→COOL trend trigger "+1.5 °C/min at T ≥ 38.5" is unsourced.**
`DESIGN:112`. Banked slopes: NPU 2.33, CPU-ref PPL 1.38, passive −0.28, q53c CPU ≥
2.6–3.6. Nothing banks 1.5. As an engineered constant it sits ambiguously between the CPU
turn rate and the NPU rate; either derive it (e.g., "above the measured CPU-PPL slope so
typical CPU turns do not trigger") or label it ENGINEERED-DEFAULT with the derivation, and
pin it in the golden tests.

**MAJOR-2.6 — INCIDENT_THERMAL's "plugged-in disallowed" rule is ignored by G5.**
INCIDENT_THERMAL.md rule 2 (banked): "NPU/HTP sustained runs on v73-class: OFF until the
owner decides; if ever resumed, 10-min run cap + watchdog + **plugged-in disallowed**
(charging adds heat)". G5 (DESIGN:191-194) schedules NPU spike runs in a "plugged-warm"
session. The design cites INCIDENT_THERMAL only for the shutdown precedent (§5.2); it never
processes the plugged prohibition or its re-authorization. PLAN-10DAYS §0 caps NPU-v73 runs
at 10 min but does not lift the plugged ban. G5's plugged NPU arm needs explicit owner
re-authorization recorded in the cell, or the "plugged-warm" session must be CPU-controls
only (the qualified-window-frequency question can be answered without NPU runs).

**MINOR-2.7 — "COOL→WARM re-entry … completed soak window" (DESIGN:116)**: COOLMODE exit
is ≤36.5 °C = below WARM's 38.0 floor ⇒ exit lands in FAST, not WARM; "soak" is CRITICAL's
term, COOLMODE has the 10-min dwell. Wording; fix alongside 2.4.

**MINOR-2.8 — LOWBAT <25 % (DESIGN:103) is unreachable under the carried-over 45 % battery
floor (DESIGN:16, §1.5) and its threshold is unsourced.** Two unreconciled floors: if the
45 % floor is product policy, LOWBAT never fires; if it is harness-only, say so and source
the 25 %.

**MINOR-2.9 — FAST "default after load" (DESIGN:101)**: after a hot load (plugged idle can
be 38+), the initial state must derive from the first poll (COOLMODE), not FAST. Pin the
load-time state semantics.

**NOTE-2.10 — Spike vs watchdog: no kill path, by the numbers.** Ceiling 39.5 + max
observed ΔT at n ≤ 512 (0.6 °C, q58 per-run) = 40.1 > WARN 40.0 — a transient WARN is
possible by design (the banked 39.5 uses the per-size mean 0.5, the audit-rejected variant
was the per-run max 0.6 → 39.4); KILL 43.0 needs ΔT ≥ 3.5, never observed. Back-to-back
spikes are blocked by state (second prompt sees ≥39.5 → COOLMODE). OK as designed.

**NOTE-2.11 — Flip-cap direction undefined.** "≤ 1 decode flip/hour, only on COOL entry"
(DESIGN:17,112) with "decode flips additionally gated by the hourly cap" (116): if "flip"
= CPU→GPU engagement, the design is self-consistent and the uncounted GPU→CPU exit flip is
free; if both directions count, a COOL window < 1 h violates the cap every cycle. State it.
With +5.15 °C turns and −0.28 °C/min cooling, the state can cycle COOL→FAST→COOL every
~11 min (10-min dwell); engine churn is then bounded only by the cap *as defined*.

---

## 3. DECODE BREAK-EVEN

**NOTE-3.1 — Formula is structurally correct.** `DESIGN:154`: time saved on τ tokens =
τ·(1/r_hot − 1/(0.81·r_cold)); pays iff > reload_s. Rearranged check: at r_cold = r_hot the
LHS is negative (< 0) ✓; at r_hot = 0.7·r_cold the saving is 0.194 s per token vs a ~25 s
reload ⇒ ~1300 tokens to amortize — plausible numbers. Unknown terms (rate_cpu(T), GPU
sustained slope) are honestly flagged UNKNOWN → G1/G3, and the interim rule
("switch whenever eligible on COOL entry") is coherent with the 25/08 precedent.

**MAJOR-3.2 — Banked throttle-adjacent data missed (grep PLAN/ALIVE).**
`DESIGN:155`: "no banked throttle curve exists for product decode. What exists: monotonic
16-turn decline confounded with context growth [PLAN #29], and adverse unplugged dense-PPL
cells…". The "what exists" list omits three banked datums directly relevant to G1 and to
cool_pays():
(a) PLAN #28e: v75 CPU decode rep at 1.69 t/s — "outlier da throttle sospetto" (single
rep, flagged);
(b) ALIVE §2: "CPU outliers were 29.5 and 18.8 t/s at **38–40 °C**" (750 prefill benches)
— banked evidence of CPU degradation in the 38–40 °C band;
(c) two banked **no-collapse sustained-decode** cells: Xiaomi Marco1c "sustained hot 6.84
… non c'è throttle — temp 33-35 °C" (PLAN:826) and Xiaomi CalaQwen "t4 sustained REGGE
4.392 (zero collasso)" (PLAN:827) — the strongest prior that product decode does not
degrade below ~35 °C, and that 8Gen3 throttles later.
No curve exists (G1 stands), but the priors set G1's expectation and the break-even's
default assumption; the design should cite them and set G1's hypothesis accordingly.

**MINOR-3.3 — The formula's τ is the remaining **hot** window's tokens, which is a function
of the hysteresis exits (2.1/2.4 above); the interim rule sidesteps it, G1/G3 must deliver
the coupled constant. Add one sentence in §2.4.**

---

## 4. ROUTER COMPOSITION (SPEC v0.2)

**MAJOR-4.1 — The decode-switch relaunch emits a LaunchConfig v0.2 cannot express; §3's
"additive by construction" claim is overstated.**
SPEC §4: `decode_engine: 'cpu' // constant in v0, by law 1`; SPEC §5: "Law 1 first: decode
→ CPU, always, every generation… The router never assigns decode elsewhere. Everything
below is PREFILL placement"; R8 itself is a **prefill-position** rule ("thermal fallback
for the NPU-incompatible subset"). DESIGN:§3 ("cool_mode: boolean — routes decode through
R8's predicate") silently reinterprets a prefill rule as the decode switch, and the §2.4
restart path must either produce decode_engine='gpu' — a value the v0.2 type forbids — or
launch outside the router, breaking "the router is the ONLY launch decision". Either way,
schema_version 2 must version the **LaunchConfig type** (decode_engine ∈ {cpu, gpu}) and
add golden tests for the COOLMODE relaunch; "Nothing else changes" (DESIGN:§3) is not
accurate. R1–R9 themselves are indeed untouched ✓, unknown-version→CPU ✓, fail-closed ✓,
fit_gate_unresolved ✓ — those hold.

**MAJOR-4.2 — R3 included in the spike lane table without its certification qualifier.
**`DESIGN:168` spike_lane_ids "R2, R3" for v75, vs q55: R3 = "10-chunk characterization
(r10 = +0.109 %), NOT a 32-chunk certification" (also SPEC §6). The columns
(512/39.5/≤1.0) are correctly labelled "provisional" for v75; the lane list is not
qualified. Add "(characterization-only)" and keep exec #2 consistent (see BLOCKER-1.1).

**MINOR-4.3 — "generation ∈ {v75+, …}" (DESIGN:124)**: "v75+" implies unmeasured
generations (v79/8xx) auto-qualify; SPEC: "unknown → CPU, always". The ledger gate saves
it, but write "v75-class only; 8xx rows are UNKNOWN until Phase 0".

**MINOR-4.4 — §6 claims "exactly one new mechanism class (bounded relaunch) and one
polling loop; everything else is data"** — the TURN exercise (per-prompt prefill placement
DESIGN:127-138) is a second mechanism (per-request placement switching, which SPEC §1's
non-goals explicitly excluded for the router). Either scope it as table-driven spike-gating
(a data lookup) or admit the second mechanism and its test surface.

---

## 5. CELLS G1–G5

**MAJOR-5.1 — G1's acceptance criterion is likely unsatisfiable in the declared plugged state.**
`DESIGN:180-184`: "45 min continuous" under "WARN 40/KILL 43" with "≥ 8 usable minutes per
2 °C bin", on a phone that idles plugged at 35–41 °C ("reported"; measured day 1). If
day-1 idle ≥ 38, the usable span is < 2 bins; if idle ~35, the q53c-class CPU rates
(≥ 2.6 °C/min worst) reach KILL in minutes, not 45. The bins must be defined over the
**traversed** range and a fallback acceptance pre-committed (e.g., "≥ 30 contiguous
minutes below WARN with at least the (start, WARN) band fully sampled") as a function of
the day-1 idle measurement. Without this the cell can fail its own gate before producing
the deliverable it exists for.

**MINOR-5.2 — G1 budget**: "production sampler t4/t6" reads as two configs × 45 min =
90 min > the 1-h envelope. Pin one sampler (Marco1c card is t4) or split into two cells.

**MINOR-5.3 — G5 arm balance**: 6 NPU : 4 CPU per size is 3:2, thermal-order imbalanced vs
q58's 2:2; σ(ΔT_NPU) survives, the CPU-control contrast weakens. Declare in prereg. And
the plugged NPU session conflicts with INCIDENT_THERMAL (MAJOR-2.6).

**MINOR-5.4 — G4 is the signed plan's own cell (PLAN-10DAYS §6(a)), re-listed as a governor
cell**: correct and flagged ("the only cell over the 1-h envelope (audit-reduced in the
signed plan)"), but mark it explicitly as an alias consuming no NEW device budget, or the
10-day scheduler will double-count it.

**NOTE-5.5 — G5's 32 °C threshold traces to PLAN-10DAYS §0 (cool-start contingency), not to
this device; with the "reported" 35–41 the trigger fires trivially. Fine — but say so.**

**NOTE-5.6 — G2's cpu→gpu relaunch for the 6.4 GB candidate**: gpu_fit(6.4 GB) ≈ 800 MiB +
6.7 GiB ≈ 7.5 GiB — above typical S23 MemAvailable; the governor may never authorize that
flip for the largest candidate. Pre-register the fit check per candidate.

**Most valuable cell: G1.** It resolves the single unknown (rate_cpu(T)) that gates the
governor's one active mechanism — cool_pays() — and its acceptance directly checks the
machine's WARM→KILL exposure (MAJOR-2.2). G3 is its pairing constant; G2 sizes the switch;
G4 is the signed plan's; G5 is availability-only. G1 also carries the highest execution
risk (5.1) — fix its acceptance before the window opens.

Non-duplicates confirmed: G1/G2/G3 have no banked precedent; G4 = signed-plan Phase 4(a);
G5 replays q58's n ∈ {128, 512} (legitimate repeatability) but adds the plugged question —
the only new content; the unplugged half is a replication, say so in the prereg.

---

## 6. RISKS OMITTED

Present and handled: 25/08 shutdown (5.2 ✓, but see 6.2), plugged-charging heat (5.3 ✓,
ceiling side only — see 2.1), Jelly idle deaths (5.5 ✓), LMK (5.5 ✓), battery-lag (5.4 ✓),
energy counter (5.6 ✓), cross-harness (5.7 ✓). Missing:

**BLOCKER-6.1 — plugged CRITICAL-deadlock (see BLOCKER-2.1) — omitted as a risk, it is the
design's structural hole.**

**MAJOR-6.2 — thermal shutdown irrecoverability inside the window.** PLAN-10DAYS §11: "a
thermal shutdown cannot be recovered until 07/09" (nobody can reboot/re-pair the device).
The design's §5.2 cites the precedent but not this consequence during the exact window the
cells run in; G1 (45-min), G3 (40-min) and G5 (NPU plugged) all escalate KILL-43 risk on a
device with no recovery path. Add: per-day kill budget and a cumulative-kill stop rule
(e.g., 2 watchdog kills → suspend governor cells until unplugged).

**MAJOR-6.3 — INCIDENT_THERMAL "plugged-in disallowed" (see MAJOR-2.6).**

**MINOR-6.4 — G3's "unplugged preferred" is infeasible in the window (10 days plugged);
deliverable degrades to relative-only slopes starting at 35–41 °C, compressing the T range
cool_pays() can be fitted over. State as a risk, not a parenthetical.**

**MINOR-6.5 — Sensor granularity at the accuracy the machine needs**: battery tenths of °C
(q56 format) with a 10-s dumpsys poll and a banked 40-s binder-unavailability window
(q56: sensor_failure_window_s=40, fail-closed = kill); the WARM band is 15 tenths wide. The
fail-closed semantics cover it, but the doc should note that a single dumpsys stall equals
a false KILL, and that the "plugged-warm" class will spend most of its life in WARM/COOLMODE
with thresholds ±2 tenths from the boundary.

---

## 7. NOT VERIFIED (could not be confirmed from the opened sources)

- q57 CPU-ref 1.38 °C/min raw (PLAN narrative only; raw not in the q57 cell dir).
- "original 3-minute arms" in G3 (no #18/N5 PREREG on disk).
- Charging-idle 35–41 °C: "reported" (externally sourced) in PLAN-10DAYS §0; measured
  day 1 — all plugged reasoning (BLOCKER-2.1) is contingent on that day-1 number.
- The q58 "mean ΔT 0.5" wording (see MAJOR-1.4).
- Everything else in §1 "VERIFIED CLEAN" was opened and checked.

---

## 8. SEVERITY ROLL-UP

- BLOCKER: 1.1 (ledger misstate in exec summary), 2.1 (CRITICAL exit deadlock plugged), 6.1
  (same as 2.1, listed as omitted risk).
- MAJOR: 1.2, 1.3, 1.4, 2.2, 2.3, 2.4, 2.5, 2.6, 3.2, 4.1, 4.2, 5.1, 6.2, 6.3.
- MINOR: 1.5, 1.6, 1.7, 2.7, 2.8, 2.9, 3.3, 4.3, 4.4, 5.2, 5.3, 5.4, 6.4, 6.5.
- NOTE: 1.8, 2.10, 2.11, 3.1, 5.5, 5.6.

The design's traceability discipline is genuinely strong (the §1.1/§1.2 tables survive
nearly every check, including the q57 CSV re-derivation of 2.33 and the q44 memory-gate
affine reading). What fails is concentrated in: (a) the exec summary's lane-availability
claim, (b) plugged-vs-exit interactions, (c) three arithmetic/attribution slips that the
design itself contains the data to catch, and (d) two banked rules (INCIDENT_THERMAL
plugged ban; q53c CPU slope) that the design cites in one place but ignores in another.
All fixable in text or in G-cell preregs; nothing requires new measurements to repair
except 5.1's acceptance rework.

## VERDICT: BANK-WITH-CORRECTIONS

Required before banking: fix BLOCKER-1.1 (exec #2 lane state), BLOCKER-2.1/6.1
(plugged-aware CRITICAL/COOL exits, contingent on the day-1 idle measurement), MAJOR-1.2
(#28b citations), MAJOR-1.3 (heat-ratio claims), MAJOR-1.4 (39.5 derivation wording),
MAJOR-2.2 (CPU-prefill kill path), MAJOR-2.3 (worst-slope claim), MAJOR-2.4 (widths/exits),
MAJOR-2.5 (1.5 °C/min source), MAJOR-2.6 (G5 plugged NPU authorization), MAJOR-3.2 (missed
throttle priors), MAJOR-4.1 (LaunchConfig decode_engine versioning), MAJOR-4.2 (R3
qualification), MAJOR-5.1 (G1 acceptance), MAJOR-6.2 (irrecoverability), MAJOR-6.3 (=2.6);
process the MINORs 1.5–1.7, 2.7–2.9, 3.3, 4.3, 4.4, 5.2–5.4, 6.4, 6.5 as listed.

---

# v2 RE-AUDIT (2026-08-26, appended)

Re-audited `docs/GOVERNOR-TRI-ENGINE-DESIGN.md` v2 against every BLOCKER/MAJOR of the v1
audit, plus the plugged-threshold re-derivation and a fresh untraceable-number sweep.

## 1. BLOCKER/MAJOR item status

**1.1 — FIXED.** Exec #2: "Current ledger: NO NPU lane is ON. R2 is correctness-certified but
OFF pending the app-side spike cell plus `npu_fit`; R3 is 10-chunk characterization-only,
not 32-chunk certification; R6 and R7 are hard OFF." Consistent with §2.4 ("Current result
is no open NPU session"), §3 table (spike_lane_ids "null; R6 future dedicated spike cell"),
golden test 1, and §4 ("No current NPU run is authorized by this document").

**1.2 — FIXED.** §1.1: 51.9 [PLAN #28b], 165.4 = 3.19× [PLAN #28b]; dedicated row
"117–128 t/s observed once [PLAN #28b fallback-trap re-test]". Correct rows now.

**1.3 — FIXED.** Exec #3: "3.8× at n=128, undefined at n=512 (CPU denominator 0.0),
2.95× at n=1024, and 2.34× at n=2048. The record does not support '2.5–4× at every size'."
Recomputed: 1.9/0.5=3.8 ✓; 3.25/1.1=2.954 ✓; 5.15/2.2=2.341 ✓.

**1.4 — FIXED.** §1.2: "39.5 °C = 40.0 − 0.5, where 0.5 is the largest per-size mean below
N_max (n=128); individual-max 0.6 would be 39.4 and was rejected." Arithmetic now correct
and the rejected variant is recorded.

**2.1 — FIXED** (subject to the plugged-profile re-check in §2 below). §2.2 plugged row is
relative to day-1 `T_idle`; "The plugged CRITICAL exit is never below `T_idle+1.0`"; the
refusal clause ("No plugged launch is allowed if `T_idle + 1.0 ≥ 42.0` or if an offset
would reach KILL before CRITICAL can abort") and risk 8 + golden test 6 close the v1
deadlock: 34.0 absolute is gone from the plugged path.

**2.2 — PARTIAL.** The 2048-kill arithmetic is fixed and admitted in the text: "Example: a
2048-token CPU prefill from 37.9 °C predicts 37.9 + 5.15 = 43.05 °C > 39.5 °C; it is
rejected before launch" (39.5 = T_limit = WARN 40.0 − margin 0.5), and golden test 5 pins
it. But the admission rule has an unspecified fallback for inputs **outside the banked
table**: `ΔT_table(prompt_tokens, engine)` covers only {128, 512, 1024, 2048}; the
semantics for n > 2048 (a 4096-token product prompt is plausible) or intermediate values,
and for the GPU-prefill engine (no GPU ΔT row exists), are not defined. If a table miss
defaults to "no delta → admit", the kill path reopens for oversized prompts (CPU ΔT is
monotone in the banked table, so a 4096-token prefill plausibly exceeds 5.15). Fix before
bank: pre-commit "n > 2048 → use the 2048 row (5.15) as a monotone floor and still gate on
T_limit; table miss / unknown engine → refuse; GPU prefill → use the CPU row". Also NOTE:
`gen_len_hint` is an input but admission gates prefill chunks only; decode-length heat is
unadmitted — this cannot reach KILL (no banked slope ≥ 6 °C/min, so the 10-s poll raises
CRITICAL at 42.0 first), so it is a WARN-zone gap, not a kill path.

**2.3 — FIXED.** §1.2 now banks the q53c-derived bound: "design safety slope 3.6 °C/min,
the worst edge of banked q53c CPU ≥2.6–3.6 °C/min; 0.43–0.60 °C per 10-s poll"
(2.6/6 = 0.433 ✓, 3.6/6 = 0.600 ✓); the rationale now reads "the margin is about 1–2
polls, not a guaranteed °C". Minor labeling NOTE: the 2.6–3.6 band is derived from the
rounded q53c narrative ("~2 min", "~31–32 °C"), so "banked" should read "derived from
banked narrative" — direction is conservative, no change needed to the number.

**2.4 — FIXED.** §2.2: "Unplugged widths are WARM 2.0, COOL 3.0, CRITICAL 8.0 °C. WARM's
2.0 °C exceeds the largest observed NPU per-run rise at n≤512 (0.6 °C); the n=2048 CPU
5.15 °C case is rejected by admission. GPU per-turn heat is UNKNOWN."

**2.5 — FIXED.** §2.3: "`+1.5 °C/min` is ENGINEERED-TUNABLE, not a banked slope; G1 must
report sensitivity to it and the golden tests pin the value." (Expression is now relative:
"trend ≥ +1.5 °C/min at WARM+0.5", which reproduces unplugged 38.5 ✓.)

**2.6 — FIXED.** G5: "replay q58 … **unplugged-only**. The plugged-warm session is
CPU-controls-only … without violating INCIDENT_THERMAL rule 2." §2.4: "NPU/HTP sessions are
unplugged-only, capped at 10 minutes with watchdog, and post-window under INCIDENT_THERMAL
rule 2." Risk 10 + exec #10 agree.

**3.2 — FIXED.** §2.4 "Banked priors…" cites #28e (1.69 t/s "outlier da throttle sospetto"),
ALIVE §2 (29.5/18.8 at 38–40 °C), "PLAN ≈1179" (CalaQwen 4.392 no collapse) and "PLAN
≈1201" (Marco1c 6.84 @ 33–35 °C; actual line is 1202 — the ≈ covers it), with the honest
conclusion "throttle appears only at ≥38 °C in this record".

**4.1 — FIXED.** §3: "**LaunchConfig v0.3** adds/changes: `decode_engine: "cpu" |
"gpu_coolmode"` (v0.2's CPU-only type becomes v0.3)"; "R8 remains the prefill thermal
fallback; it does not express the decode switch"; golden test 2 pins the v0.3 relaunch and
the v0.2/unknown-schema CPU fallback.

**4.2 — FIXED.** §3 table: "R3 10-chunk characterization-only" (also exec #2, §2.4).

**5.1 — FIXED.** G1: "Define 2 °C bins over the actually traversed range `[T_start,
min(T_end, WARN)]`"; primary acceptance "≥8 usable minutes in every fully traversed bin"
with a pre-committed fallback (partial result, ≥30 contiguous min below WARN, un-traversed
bins UNKNOWN); "If `T_start ≥ WARN`, classify G1 unavailable".

**6.1 — FIXED** (via 2.1). Risk 8 named; refusal path pre-committed.

**6.2 — FIXED.** Risk 9: "a thermal shutdown cannot be recovered until **07/09**. Set a
per-day kill budget; after 2 watchdog kills, suspend governor cells until unplugged and
owner review. G1/G3/G5 must stop cleanly."

**6.3 — FIXED** (via 2.6). Risk 10 states the ban verbatim.

Minor items 1.5–1.8, 2.7–2.11, 3.3, 4.3–4.4, 5.2–5.6, 6.4–6.5: all addressed as claimed
in the v2 change list (spot-checked; no regressions found).

## 2. Plugged-profile re-derivation (new-deadlock check)

Thresholds (v2 §2.2): plugged WARM `min(T_idle+3.0, 42.0)`/`T_idle+1.0`; COOL
`min(T_idle+4.5, 42.0)`/`T_idle+1.5`; CRITICAL `min(T_idle+7.0, 42.0)`/`T_idle+1.0`+soak;
KILL 43.0 absolute.

- **No new exit deadlock.** All exits are ≥ 1.0–1.5 °C above the measured plugged idle
  equilibrium, so passive re-approach is geometrically possible; CRITICAL exit is never
  below T_idle+1.0; the v1 34.0-below-floor deadlock is gone. Enter thresholds are
  monotone (WARM ≤ COOL ≤ CRITICAL); CRITICAL entry is capped at 42.0, leaving a 1.0 °C
  margin under KILL 43.0 (0.60 °C/poll worst ⇒ ≥1 poll, KILL still a hard backstop).
- **NEW FINDING — cap collapse of the COOL band (MAJOR).** For `T_idle ≥ 37.5`,
  `min(T_idle+4.5, 42.0)` = 42.0 = CRITICAL entry ⇒ COOLMODE is **never entered** at
  equality (any→CRITICAL wins), so the `gpu_coolmode` decode relaunch — the governor's
  headline mechanism — silently disappears in hot plugged sessions; at `T_idle ≥ 39` the
  whole WARM band also collapses (enter 42.0) and the machine degrades to FAST(<42)
  /CRITICAL(≥42) with admission refusing nearly all prefill. Refusal at high T_idle is
  announced (exec #10), but the COOL-band collapse is not. Fix: keep a staged band below
  CRITICAL (e.g., cap COOL at `min(T_idle+4.5, 41.5)`) or explicitly declare
  COOLMODE-unreachable for T_idle ≥ 37.5 and justify.
- **NEW NOTE — invalidity trigger undefined.** "If the measured idle makes the profile
  invalid, refuse …" — no rule says when a profile turns invalid (e.g., T fails to reach
  an exit threshold within X minutes, T_idle drift over 10 days of charging). Pre-commit
  the trigger (e.g., any exit threshold not reached within 2× dwell ⇒ refuse + re-measure
  T_idle).
- **NEW NOTE** — plugged CRITICAL width is 6.0 °C (7.0−1.0) vs unplugged 8.0; presumably
  intentional, but unsourced. One line of rationale.
- **2048-from-37.9 redo:** rejected pre-launch (> 39.5 limit) — the KILL path via the
  banked 2048 row is closed. Residual kill paths = table-miss/oversize semantics (item 2.2
  PARTIAL above) only; GPU prefill has no ΔT row (same fix).

## 3. New-number sweep

New constants introduced in v2: `margin = 0.5` (labeled ENGINEERED; consistent with the
frozen 39.5 derivation), T_idle offsets +1.0/+1.5/+3.0/+4.5/+7.0 (labeled "relative, not a
new absolute thermal claim"; widths mirror the unplugged 2.0/3.0 except CRITICAL 6.0),
"WARM+0.5" trend point (= 38.5 unplugged ✓), "2 watchdog kills → suspend", "≥30
contiguous minutes below WARN" (G1 fallback acceptance), "4 NPU + 4 CPU per size" (G5),
"gpu_coolmode" naming, T_idle+1.0 ≥ 42.0 refusal. All are either derived from banked
values or labeled policy constants; the two unlabeled derivations (CRITICAL width 6.0;
2.6–3.6 band labeling) are flagged above. No fabricated banked number found.

**Residuals required before banking:** (a) 2.2 table-miss/oversize/engine-miss admission
semantics — pre-commit to refuse; (b) the §2.2 COOL-band cap collapse at T_idle ≥ 37.5 —
restore a staged band or declare it; (c) profile-invalidity trigger — pre-commit.
Optionals: CRITICAL plugged width rationale; "derived-from-narrative" label on 2.6–3.6.

## VERDICT: BANK-WITH-CORRECTIONS <(a) admission fallback for table-miss/oversize/GPU-prefill ΔT must refuse, (b) plugged COOL band cap-collapse at T_idle ≥ 37.5, (c) profile-invalidity trigger>; all 17 v1 BLOCKER/MAJOR items otherwise FIXED.