# AUDIT — PART3_CAMPAIGN_KIT.md (hostile)

Audited 2026-08-25 against `docs/reports/HARNESS_FINDINGS.md` (§STATE block + cited sections),
`docs/architecture/KALSA.md` (§4/§6/§7/§8/§10), and the code it leans on (`src/rules/gateAuditLog.ts`,
`src/rules/calendarGate.ts`, `src/context/windowProfile.ts`).

Bottom line: the kit honors the standing traps (thinking=default + verify, positive controls,
no LLM judge, §1.1b check) — but its decision gate is **structurally unreachable as written**,
its wall-clock arithmetic is **~8× off** its own citation, its calendar gate-3 metric is
**unobservable from the script as specced**, and it launches without a smoke run on a build
whose load policy (§7.52) invalidates the baselines it budgets from.

---

## 1. Findings

| # | Status | Finding | Evidence |
|---|---|---|---|
| F1 | **CONFIRMED** | Gate 1 ("H beats A … Holm-corrected across the factorial contrasts") is **unreachable by construction** for a literal H-vs-A test. Exact two-sided permutation on 4v4 has minimum p = 2/C(8,4) = **0.0286** (KALSA §8: "exact two-sided permutation tests on per-seed arm means"); Holm first-rank threshold is 0.05/7 = **0.00714** (or 0.00625 if H-vs-A is an 8th test). Even perfect 4-0 separation cannot pass. n=6/cell is the minimum for a Holm'd pair (p-floor 0.00216). The 7 pooled factorial contrasts (16 obs per side) have p-floor 3.3e-9 and *are* reachable — so the kit must pre-register that gate 1 means the pooled main-effects sign test, not "H beats A" | PART3 §5 gate 1; HARNESS §8 analysis rule; computed floors above |
| F2 | **CONFIRMED** | Wall-clock/battery arithmetic contradicts its own citation. KALSA §2.1 (2.6B-QAD S23, the campaign's own model row): "Battery 99 % → 75 %" over 16 turns = **1.5 pts/turn**; §7: "~30 %/h … ~2.3 h per discharge". A forced 24-turn conversation consumes ~36 pts ≈ **72 min**; 9 arms × 2 modes × 4 seeds = 72 conversations ≈ **86 h of inference + ~30 charge cycles**. Primary mode alone ≈ 43 h + ~19 cycles. Kit says "~5–6.5 h total, 1–2 recharges" and schedules "S23 day 1 / day 2". Off by ~8×. Real per-turn wall is ~3 min (§7.41's row), not the 20 s the kit's tok/s arithmetic implies; thinking=default (tokens on, fase4 measured with thinking off), forced eviction (every turn re-prefills after turn ~6 — §7.41's 232–553 ms state-cache hits stop), and memory arms (+40 %, and `clearCache()` every turn, KALSA §4) all push the other way | PART3 §5 seeds para; KALSA §2.1, §7 |
| F3 | **CONFIRMED** | Gate 3 (calendar block-rate) is **unmeasurable as scripted**: (a) the conversation script (§4) plants **zero calendar-agenda turns** → denominator 0; (b) the calendar rule is inert without memory facts — `calendarGate.ts`: "if (facts.length === 0) return false" — so blocks can only occur in G/H (memory on), never in D/F, making the toolhelp leg's only behavioral effect invisible in the arms meant to isolate it; (c) the audit log is append-only, capped at 500 (`GATE_AUDIT_CAP`), **never cleared** between arms on a phone that "never uninstalls" — rotation silently drops earlier arms' records; (d) at ~12 calls/arm, power to even *trip* the ">20 %" threshold at a true 20 % rate is ~44 % (P(X≥3|Bin(12,0.2))); needs ~40 calls/arm for 80 % | PART3 §4, §5 gate 3; src/rules/calendarGate.ts:30-34, gateAuditLog.ts:11-13 |
| F4 | **CONFIRMED** | A′ is **mislabeled** "today's shipped regime". Shipped default is `off` (derived window, no digest, web gate) = arm A (KALSA §4: "off … yes, this is the default"); v42 was deleted (KALSA §10) and `anchored` is the unshipped successor built "on" its `boundaryIndex` — its question is exactly §STATE open item #2, already assigned to a rerun campaign ("Campaign `32514162034` reruns it with `winbudget` set low"). A′ re-buys that question at 8 conversations of phone-hours (~10 h) with no gate on its own question, and its required positive control (`boundaryByTurn` advances; `promptTokens` stops growing, §7.35 corrective-run wording) is absent from the kit's control list | PART3 §2, §3; KALSA §4, §10; STATE open #2 |
| F5 | **CONFIRMED** | No smoke step. §3.3's smoke doctrine, §8's "check probe density and that the arm can differ at all before spending a run", and §7.35's corrective-run acceptance exist precisely because three campaigns were burnt this way. The kit goes 0→72 conversations with a new script variant (24 turns, winbudget, flags mapping, new result.json fields) on a build whose **per-model load policy has never been exercised on an S23** (§7.52 found `mmap = false` on every load on the Jelly; STATE: "Anything about memory measured before 2026-08-24 predates it") — meaning §7.41's baselines (RssAnon 1.8 GB, state-cache prefills, decode) may not transfer. The kit records policy activity "once", after the fact, instead of verifying pre-run | PART3 §6; HARNESS §3.3, §7.52, §8; STATE trailer |
| F6 | **CONFIRMED** | Secondary mode ("expected ≈ null") is over-budgeted: §7.35 established a 16-turn conv ≈ 7 653 chars fits the 11 059-char ciswire budget — the null is *guaranteed*, yet it runs 9 arms × 4 seeds ≈ 30+ h of phone time. Two conversations (A, H) re-anchor the vacuity | PART3 §3; HARNESS §7.35 |
| F7 | **PLAUSIBLE** | winbudget=3000 is a guess dressed as derivation. The windowProfile-derived budgets are **(8192−2048)×3 × 0.75/0.6 = 13 824 / 11 059 chars** (§7.35 quote); the bench default 16 000 is an override, not a derivation; 3000 is ~¼ of the ciswire budget, justified by "~530 chars/turn" arithmetic from a 16-turn fase4 conversation that ran a different script with thinking OFF and no digest overhead. "Evicts from ~turn 6" is unverified for the 24-turn script (thinking=default inflates reply chars → eviction earlier). Note at 3000 chars the window holds ~4-6 messages: post-eviction every turn re-prefills (LFM2.5 has no rollback), so forced-mode conversations cost ≥2× §7.41's per-turn time — un-budgeted and also exactly why F2's numbers are a floor | PART3 §3; HARNESS §7.35; windowProfile.ts |
| F8 | **CONFIRMED** | Jelly n=3 cannot be significant, ever: min two-sided permutation p = **0.1** (3v3). No Jelly contrast can reach p<0.05 even uncorrected; the kit gates nothing on the Jelly (good) but never says the subset is descriptive-only, so a Jelly "difference" will be quoted | PART3 §5; KALSA §8 |
| F9 | **PLAUSIBLE** | Power at n=4 (pooled contrasts): every 2³ contrast uses 16 obs/side, SE = σ·√(2/16) = 0.354σ; 80 % power (Holm rank-1, two-sided) needs δ ≥ **1.25σ** → 0.10 at σ=0.083 (ciswire-like) … 0.44 at σ=0.35 (bare-like). Historical digest deltas: 2B +0.635, 8B +0.312, 4B +0.209 (KALSA §6 Q1) — the two smaller ones sit at ~50-70 % power unless the 2.6B's within-cell sd is at the low end. Interactions share the SE but typically smaller δ: only δ ≥ 1.25σ interactions are visible. "Blank-rate ≤ A" and "no RAM regression" are unpowered diagnostics at n=4, not gates | KALSA §6, §8 |
| F10 | **PLAUSIBLE** | "Explicitly-requested search must stay 100 % on every arm" is either rigged or contradicted: with 1 such turn per conversation (n=4/arm), one miss = 25 %; and §3.5 says echo-of-context "is deliberately UNCHANGED and still has the defect described in §1.1: it blocks legitimate searches" (gate-on recall 0.43-0.71, §1.1b). 100 % is only achievable by choosing a query the defective rule passes — which then measures nothing. Pre-specify the query and arm-specific expectation | PART3 §5; HARNESS §1.1b, §3.5 |
| F11 | **PLAUSIBLE** | Default-flip scope: the campaign's evidence is single-model (2.6B-QAD); the §STATE shipping model (8B-A1B) cannot load on either 8 GB phone, and KALSA §6 Q5 says ciswire helps most "whichever model holds context worst — that is the shipping MoE". Gate 1's "flip defaults ON" must state which (model, phone) configs it licenses, or S6 leaks a 2.6B verdict onto the unresolvable 8B config | KALSA §6, §2 |
| F12 | **PLAUSIBLE** | Gate 2's instrument is unspecified: §3.3b documents three separate ways the memory counters lied (fire-and-forget race, abort suppression, reset-before-emit). The kit names no fields; the gate needs the settled line's numeric outcomes (`extractParseOutcome`, `extractGateSource`, `extractStopReason`) in result.json, else gate 2 re-runs a known-broken instrument. Also, the +40 % (measured 83 vs 59 min, §3.3) plus `clearCache()` re-prefill per turn (KALSA §4) is nowhere in the budget — feeds F2 | PART3 §5 gate 2, §6; HARNESS §3.3, §3.3b |
| F13 | **MINOR** | "KV session restore between arms (1.8 s)" is the **Jelly** number (§7.30: 120.8 s → 1.8 s, pre-policy); the S23's own restore is 33–45 ms (KALSA §7). Also: restore is pointless after memory arms (cache cleared every turn) | PART3 §5; HARNESS §7.30; KALSA §7 |
| R1 | **REFUTED** | Suspicion "kit re-opens a closed road / contradicts §STATE": no. It uses the char-budget gate, not the dead "≥12 turns" rule; thinking=default with a verify-before-start check (fase4's hardcoded off is explicitly overridden); positive controls include digestChars>0 + reuseFrac drop (§7.35's exact lesson); "no LLM judge" honors the five-judge-defect line; stop rules, ≥30 % floor, charge-invalid timings, never-uninstall all match KALSA §7 | PART3 §1, §3, §4, §6; STATE |
| R2 | **REFUTED** | Suspicion "audit log doesn't exist / can't report per-tool block rate": the log exists with `toolName/ruleId/action/outcome` (+turnId) and web_search/calendar rows are distinguishable. The gap is operational (F3), not structural. Likewise the winbudget key exists (harness item (b) is honest about the missing matrix entry) | src/rules/gateAuditLog.ts; PART3 §6(b) |

---

## 2. The arithmetic, recomputed (F2, F1, F9)

- **S23 phone-hours.** Citation math: 24-turn conv = 24 trn × 1.5 pts/trn (§2.1 row 99→75/16 trn) = 36 pts ≈ 72 min at 30 %/h (§7). Primary 36 conv ≈ 43 h; all modes 72 conv ≈ 86 h; charge cycles ≈ 2160 pts/70 ≈ 31. Kit's "5–6.5 h, 1–2 recharges, 2 days" is not a rounding error. Jelly side is roughly right (0.63 pts/trn, §7.42: 15 pts/24-trn conv; ~12-13 h + ~3-4 charges for 18 conv) — the kit's "6-8 h" covers primary only.
- **Statistics.** 4v4 pair: p-floor 0.0286 > Holm 0.0071 → H-vs-A unreachable **at any effect size**; needs n=6/cell. Pooled factorial contrasts (16v16): p-floor 3.3e-9, 80 % power at δ = 1.25σ (0.10-0.44 over the observed σ range). Interactions: same SE, underpowered below δ≈1.25σ. Jelly 3v3: p-floor 0.1 → descriptive only. ABBA smears thermal drift but cannot fix battery-state endogeneity at n=4 (§7.41's own −26 % decay is thermal×context confounded).
- **winbudget.** Production derived budgets: 13 824 (no digest) / 11 059 (ciswire) at n_ctx 8192. 16 000 (bench default) and 3 000 (kit) are both bench overrides; 3000 ≈ ¼ of the ciswire budget, calibrated on an unmeasured script. Hypothesis, not derivation → calibrate in smoke.

---

## 3. Must fix before launch

1. **Re-specify gate 1**: pre-register the 7 pooled factorial contrasts (main-effect sign test, Holm family of 7) as the decision test; demote literal H-vs-A to a descriptive contrast with its 0.0286 floor stated. State the power curve (δ ≥ 1.25σ) and the σ source. No analysis plan, no launch.
2. **Re-plan phone-hours honestly**: trim to a defensible budget — e.g. primary forced mode on A/B/H × 4 seeds on S23 (≈ 14 h + 6 cycles), A/H smoke first, secondary at n=1-2 per arm, Jelly as decided. Or accept ~43-86 h and a ~2-week calendar. Either way, the runbook's "day 1/day 2" is fiction until the battery row is respected.
3. **Smoke run before launch** (A and H, forced mode, S23): acceptance = `windowStartIndex` advances / `promptTokens` plateaus, `digestChars > 0` from the expected turn, reuseFrac drop on first eviction, gate audit rows present with correct ruleIds, memory settled-line counters present, thinking=default in result.json, load-policy flags (mmap/repack) for 2.6B-QAD recorded and compared against §7.41 vs §7.52 baselines. Then calibrate winbudget (F7) on the smoke's chars/turn.
4. **Fix gate 3's observability**: add 2-3 legit calendar-agenda probe turns (with planted events) *and* 2 MUST-BLOCK calendar turns (agenda query carrying a memorized name — the leak side of the containment defect is open, HARNESS line 1178 "STILL OPEN"); snapshot + clear the audit log per conversation; pre-specify that calendar block-rate is G/H-only (facts required) and that D/F arms can prove only nullity. ~40 calls/arm needed for the 20 % trip-wire to have 80 % power — say so in the kit.
5. **Sort A′ out**: relabel (it is not "today's shipped regime"; that is arm A), add `boundaryByTurn` + promptTokens-plateau controls, and either commit to it as the open-item-#2 rerun (with its own gate) or delete it and its 8 conversations.
6. **Scope the flip**: gate 1 / S6 must name (model, phone) coverage; the 8B-A1B config inherits nothing from 2.6B evidence.
7. **Name gate 2's instruments**: the settled-line extraction counters (§3.3b field names) as required result.json fields, else gate 2 is unreadable.

## 4. Can adjust mid-campaign

1. Label the Jelly subset descriptive-only (p-floor 0.1) in the kit and in any report quoting it.
2. Keep winbudget=3000 if the smoke confirms eviction at ~turn 5-7 and per-turn cost ≤ 2.5× §7.41; otherwise move it (e.g. 3500-4000) and document.
3. Gate 3 as decision-support, not a hard gate: report exact binomial CI per arm; ">20 %" is a trip-wire, not a test, at planned n.
4. "Search success 100 %" → per-arm expectation (toolhelp arms may legitimately overblock, §1.1b/§3.5); pre-specify the query text.
5. "Blank-rate ≤ A" and "no RAM regression" → diagnostics; state they carry no rejection power at n=4.
6. Attrition protocol: pre-declare minimum valid n (≥3) and void rules — §7.35 lost 6/40 jobs to a survivor sample; on-device dropout is worse, and an arm landing at n=3 is descriptive.

## 5. What survives the audit

The scientific spine is right: forced-eviction exposure of the digest, production-length null as the §7.35 correction, positive controls before any speed number, thinking=default with verification, no LLM judge, the §1.1b search check, and per-arm seeds ≥4 (raise to ≥5 if attrition bites). The defects are in the statistics' reachability, the phone-hour budget, and the calendar leg's script — all fixable before launch without changing the design's shape.
---

## RE-AUDIT REV2 — 2026-08-25 (hostile re-check of F1–F8, F12 + new issues)

Re-verified against KALSA §2.1/§4/§6/§7/§8, HARNESS §STATE/§1.3/§3.3b/§3.5/§3.7/§7.35/§7.41/§7.42/§7.52/§8,
`src/rules/calendarGate.ts`, `src/rules/entityContainment.js`, `src/rules/gateAuditLog.ts`. All
binomials/permutations exact.

| # | Verdict | Evidence |
|---|---|---|
| F1 | **PARTIAL** | Balance ✓ verified 2-ON/2-OFF per factor. p-floor ✓: all reachable variants clear Holm 0.0167 — 24v24 perm 6.2e-14, 24-pair sign 1.2e-7, 12-pair sign 4.9e-4, 6v6 per-seed perm (KALSA §8 house style) 2.2e-3. **But the test is not defined**: a "sign test across n_seed×2 conversations per side" could pair 24, 12, or 6 units; the 6-pair sign variant has floor 0.031 > 0.0167 — unreachable, rev1's disease at smaller n. "p-floor ≈ 1e-5" is not derivable without an unstated pairing; pre-register it (recommend 24 pairs = same seed × arm-pair × conv-index, or 24v24 exact permutation). Power ✓: sign test m=24, α=0.0167 (reject ≤6/≥19, actual α=0.0066), δ=+0.635 (KALSA §6 Q1): p_win=Φ(0.635/σ√2) → σ=0.083: 1.00 · σ=0.2: 1.00 · σ=0.35 (bare-like): **0.973**. Adequate at both ends of the observed sd range. "δ<1.25σ invisible" is stale (that was family-of-7 at n=16; 80 % point now ≈0.93σ mean / ≈1.15σ sign) — conservative, fine. **Aliasing disclosure NOT honest**: I=−ABC (verified: all four arm sign-products −1) → each main effect = truth ± ½·the other two factors' interaction; "unbiased for main effects" holds only under additivity, and memory×toolhelp is *structurally* present — `calendarGate.ts:30-34` returns false with no facts, so toolhelp's calendar behavior exists only in memory-ON arms. "Interactions NOT claimed (δ<1.25σ invisible)" conflates power with estimability: interactions are not estimable AT ALL in Res-III, and gate 3's own metric depends on the aliased term. One sentence fixes it. Cut-to-5 contingency ✓ (10v10 perm floor 0.0079, still Holm-reachable) |
| F2 | **PARTIAL** | Same premises: 1.5 pts/trn, 30 pts/h → 24-tr forced = 36 pts = **72 min** (kit's 70 ✓), 16-tr sanity = 48 min. Recompute: 30 forced (24+2 smoke+4 R5) + 8 sanity = 36.0 + 6.4 = **42.4 h base**; memory-ON arms (R2/R4/R5: 16 forced + 4 sanity) at +40 % (KALSA §4; §3.3 83-vs-59; `clearCache()` per turn) → +9.0 h → **≈ 51 h, ≈ 21 charge cycles** (1272 pts+). Kit says 37 h — understated ~40 %, and "24 + 8 (smoke/H-add-on) ≈ 32" doesn't add up (24+2+4=30; sanity is either inside the "8" with a wrong label or missing entirely). 4–5 sessions → 10.3–12.8 h *attended* per day. Jelly: 9 conv ≈ 6.5 h at the audit's own §7.42-derived rate (0.63 pts/trn, 15 pts/24-tr); "18–24 h attended" = 2–2.7 h/conv is **3× the citation-consistent rate**, unit unexplained. Order of magnitude restored (rev1 ~8× off; now ~40 % + named-but-unquantified) — close it by re-summing §7 |
| F3 | **PARTIAL + NEW-ISSUE** | Observability fixed: ≥3 agenda turns, 2 fact-overlapping, audit-log clear between arms (`clearGateAudit()` exists), per-arm block rate, facts planted so the rule is non-inert. **Trip-wire power** (X~Bin(48,p), trip iff X≥16): p=0.20→0.021 · 0.25→0.123 · 0.30→0.358 · **0.33→0.535** · 0.35→0.648 · 0.40→0.863 · 0.45→0.963 · ≥0.50→≥0.993; 80 % power at p≈0.39. Legit conjunct (Y≥3 of 24, >10 %): 0.44/0.72/0.89 at p_l 0.10/0.15/0.20 → joint trip at (0.40,0.15) ≈ 0.62. As a screen it works only ≥40 % — but the axis is wrong: (i) audit must-fix #4's MUST-BLOCK leak probes should be blocked ~100 % (the §3.7 STILL-OPEN leak side); high block-rate on them is *success*, and the kit's 33 % trip on "overlap-probes" either inverts that or, read as legit probes, fires ~certainly (the rule blocks deterministically on any distinctive fact token — `containsPrivateData`) — no leak-side acceptance exists anywhere in gate 3; (ii) "48 calls/side" pools memory-OFF arms (structural zero: `facts.length===0 → return false`) into the compaction/toolhelp sides — R4 at 100 % + R3 at 0 % = pooled 50 % → trips on containment working. Denominator must be memory-ON conversations (R2/R4/R5, still 48 calls) |
| F4 | **RESOLVED** (one residual: §0 still promises S6 "remove anchored / flip defaults" on a gate pass, but no anchored arm remains in the kit — "remove anchored" is now licensed by nothing here; the rerun campaign `32514162034` owns it. Scope S6 or cross-reference) |
| F5 | **PARTIAL** | The four named items are genuinely covered — flags reach app, digestChars>0, dna* populated, winbudget calibrated, §7.52 mmap policy + MemAvailable curve (right answer to the STATE trailer; the §2.1 S23 2.6B row predates 2026-08-24 so policy flags per run are mandatory and now planned). Missing vs audit must-fix #3's own acceptance list: the eviction positive controls (`windowStartIndex` advances / `promptTokens` plateaus / reuseFrac drop at first eviction — §7.35's exact criterion), settled-line counters presence, `thinking: "default"` in the smoke's result.json. Three bullets |
| F6 | **RESOLVED** — 2 conv/arm × 4 arms = 8 × 48 min ≈ 6.4 h (+1.3 mem) vs rev1's ~30 h. (Cost still absent from §7's headline — see F2) |
| F7 | **RESOLVED** — calibration moved into Phase 0; ≈¼ of the measured derived window lands ≈2 765 vs the old 3000, now measured not assumed. Residual: "¼" is still arbitrary — add the acceptance (`windowStartIndex` advancing from ~turn 5–7) |
| F8 | **RESOLVED** — gate 4: directional only, p-floor 0.10, "never decide defaults" ✓ |
| F12 | **RESOLVED** — §5 names `extractParseOutcome`/`extractGateSource`/`extractStopReason` on the settled line (§3.3b) ✓ |
| F10 / F11 (carried) | **UNCHANGED** — §4 still demands search success 100 % on every arm with no pre-specified query (echo-of-context still blocks legit searches, §3.5 "UNCHANGED"); §0 still doesn't scope the flip to (model, phone) configs. Audit can-adjust #4/#5 wording applies verbatim |

### NEW issues introduced by rev 2

1. **Run order is now unspecified.** ABBA is gone with nothing replacing it — no randomization, no
   interleaving of arms across the 4–5 sessions / 3–4 days, no arm-cycle per recharge block. With
   the measured −26 % in-session decay and thermal drift (§2.1, §7.41), arm × session/day
   confounding can mimic or mask a main effect at n=6. Pre-register: cycle R1–R4 within each
   session, spread seeds, fixed start state.
2. **Recharge segmentation vs arm continuity.** 36 pts/conv against 69 usable (99→30) means conv
   #2 of a "recharge every 2" pair ends at ~27 % — below the floor; and a conversation crossing a
   charge voids its timings (§7: "timings invalid while charging") but §5's "charge-segmented
   wall clock" implies it may happen. State: start every conversation ≥ 66 %, never span a
   recharge mid-conversation, void per-turn timings if it happens anyway.
3. **Pseudo-replication risk.** "6 seeds × 2 conversations per arm" — same seed twice in a cell
   would make the 2 convs matched duplicates (effective n=6/side for an unpaired test). State:
   48 independent draws; seeds used only for cross-arm pairing.
4. **A′-adjacent wording** (F4 residual, above).

### Verdict: **FIX-AGAIN** — text-level only, ~1 h, no design change

The structural blocker (F1's reachability) is genuinely fixed and the math behind it is sound at
δ≈0.635 (power ≥0.97 at the pessimistic σ). What still blocks launch is pre-registration
discipline: (1) pin the sign-test unit + floor (§2), (2) rebuild gate 3's trip-wire on the
memory-only denominator with the leak-side acceptance added (success = must-block probes ~100 %
blocked; trip axis = legit probes only), (3) re-sum §7 to ~51 h incl. sanity + memory overhead,
(4) add Phase 0's three missing acceptance bullets, (5) pre-register run order + battery/charge
rules, (6) scope the S6 "remove anchored" clause. Design shape (fractional factorial, phases,
dropped A′, Jelly-as-directional) survives intact.

## REV3 CONFIRM — 2026-08-25 (rev 3 text re-verified; all permutations/binomials computed exactly)

Items 1, 3, 4, 5, 6-ABBA/unit/§10(f), and §2's floor + aliasing (I = −ABC ✓, four sign-products −1; floor 2/C(12,6) = 0.002165 < Holm 0.0167 ✓) all PASS as scoped — **verdict: FIX-AGAIN, two blockers**. Minor residuals: §2's "48 conversations total, 24 per side per factor" parenthetical has no referent (Phase 1 = 24 / 6 per arm per §3+§8); §8's "4 H-add-on forced" names an arm (H/R5) undefined in rev 3; memory-ON +40 % "inside variance" vs REV2's +9.0 h re-sum; leak-side ≥50 % acceptance is weaker than the audit's ~100 % suggestion (25–50 % band un-tripped).

B1 — §2 power claim is REV2's m=24 sign-test figure transplanted onto another statistic: "0.97–1.00 across σ ∈ [0.083, 0.35]" is false for the pre-registered conversation-level 6v6 exact permutation — empirically 1.00 / 0.98 / **0.59** at σ = 0.083 / 0.2 / 0.35 (generous per-seed reading: 1.00 / 1.00 / 0.90). At bare-like σ=0.35 the primary test misses a real δ=+0.635 effect ~40 % of the time. Restate honestly, or move the primary test to the audit-recommended 24-pair sign statistic (0.973 at σ=0.35).

B2 — §9's recharge rule contradicts §8's own burn (1.5 pts/turn × 24 = 36 pts, 72 min): a 2-conversation seed-pair consumes ≈72 pts → ends at ≈27–28 % from 99–100 %, below the 30 % floor and the claimed "≥ 35 % by budget"; "2 × ~18 pts" is a 2× understatement, REV2's new-issue-2 recompute still stands unadopted. Fix as REV2 prescribed: one conversation per charge segment, start every conversation ≥ 66 %.

## REV4 CONFIRM — 2026-08-25 (blocker-scoped re-check; power re-simulated 300 000 reps, battery math re-derived)

B1 PASS — §2 now quotes the true 6v6-permutation power, re-simulated here as 1.000 / 0.983 / 0.585 at σ = 0.083 / 0.2 / 0.35 (per-seed generous reading 1.000 / 1.000 / 0.897), with the σ ≥ 0.35 no-result outcome stated honestly, σ̂ estimated in Phase 0, and the m = 24-pair sign-test fallback (0.973 at σ = 0.35) pre-declared and promoted only before Phase 1 sees data. B2 PASS — 24 × 1.5 = 36 pts/conv against a 99→30 budget of 69 pts: a ≥ 66 % start ends at exactly 30 %; a 2-conv pair (72 pts) provably ends at 27 % < 30 %, so one-per-charge is the only floor-compliant plan; recharge between conversations, seed-pair state via KV restore, and Phase-2 two-per-charge at ≥ 90 % ends at 42 % ≥ 30 % (16 turns = 24 pts ✓). §8 R5 = all-legs-on arm defined (4 convs, descriptive vs R1) and memory overhead bound +9 h (16 forced + 6 sanity memory calls × 40 % ≈ 9.6 h) sits inside the 5–6-session margin. Residuals, none blocking: sign-test 0.973 pairs with region ≤6/≥19 (α = 0.0227; the Holm-compliant ≤5/≥20 region gives 0.915 — restate if the region is ever written); §8's "12 memory-arm forced calls" should be 16 (R2+R4+R5); the pre-existing §2 "48 total / 24 per side" vs §3/§8 "6 per arm / 24 Phase-1" n-referent fuzz and F13's 1.8 s KV figure (Jelly number) carry over unchanged from REV3. Verdict: **LAUNCH-READY**.
