# B1A — Hostile Self-Audit (GLM)

**Date:** 2026-09-04
**Repo:** `/Users/marco/Projects/kalsa` (working tree, uncommitted; HEAD = `15ee404`)
**Map:** `B1A-PRIVACY-EGRESS-MAP.md` · **Impl:** `B1A-IMPL-REPORT.md`
**Product rule under audit:** memory store MUST accept sensitive facts; sensitive patterns MUST block `web_search` egress.

---

## Verdict

The mechanical half of B1A is clean: the memory-write rejection path is fully removed, telemetry stays counters-only, no dead code or i18n residue, all impl-report verification claims reproduce (`jest` 30 suites / 240 tests pass, `tsc --noEmit` exit 0, harness passes). **But the egress half — the only defense the product now has — is a regex transplant that was never re-validated for its new job.** The blocker: the IBAN/CF detector destroys word boundaries by stripping whitespace before matching, so the single most natural way a sensitive pattern reaches a query — `"my iban is DE89370400440532013000"` — **passes web_search unblocked**. The map's own gap analysis picked the one phrasing that works (bare IBAN at token start) and the test suite copied it.

---

## Method (what this audit ran)

- Full reads: `sensitivePatternGate.ts/.test.ts`, `toolGate.ts`, `runToolGate.ts/.test.ts`, `toolGateRegistry.ts/.test.ts`, `MemoryStore.ts/.test.ts`, `memoryTelemetry.ts`, `evaluate.ts`, `entityContainment.js`, `gateAuditLog.ts`, `SettingsScreen.tsx` diff, `AppShell.tsx` gate call site; diffs of `benchAggregate.mjs`, `benchGrade.mjs`, `memoryTelemetryHarness.mjs`, `ci-bench.sh`, `ciswireFlagsTelemetry.test.ts`.
- Parity: `git show HEAD:src/memory/MemoryStore.ts` diffed regex-by-regex against the new `containsSensitivePattern`.
- Empirical probes: the gate function extracted and executed against 50+ real phrasings (results quoted below).
- Reproduced impl claims: `npx jest --runInBand` → 30/240 pass; `npx tsc --noEmit` → 0; `node scripts/memoryTelemetryHarness.mjs` → pass; `git diff --check` → clean.

---

## CONFIRMED findings

### BLOCKER

**B1 — IBAN/CF detection fails whenever the pattern follows a word, because whitespace is stripped before `\b` is required.**
`src/rules/sensitivePatternGate.ts:57`
```ts
if (/\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/i.test(raw.replace(/\s+/g, ""))) {
```
The `replace(/\s+/g, "")` merges the preceding word into the IBAN token, destroying the leading word boundary the regex then requires. Verified empirically (all with the shipped code):

| query | `containsSensitivePattern` | verdict |
|---|---|---|
| `DE89370400440532013000` | true | blocked |
| `IBAN: DE89370400440532013000` | true | blocked |
| `my iban is DE89370400440532013000` | **false** | **NOT blocked** |
| `what is DE89370400440532013000` | **false** | **NOT blocked** |
| `transfer to DE89370400440532013000` | **false** | **NOT blocked** |
| `credit card IT60X0542811101000000123456` | **false** | **NOT blocked** |
| `my iban NO93860111179` (13-digit IBAN) | **false** | **NOT blocked** |
| `codRSSMRA85M01A001R` (bare CF glued to word) | **false** | **NOT blocked** |

Why every other branch also misses `"my iban is DE89..."`: digit run is 20 (>19, both CC branches), Luhn branch needs `\b` before digits (destroyed by the preceding word "is"), `containsSensitivePattern` keyword lists contain no `iban`. Same strip-then-`\b` defect at `sensitivePatternGate.ts:62` for codice fiscale; bare CF (`RSSMRA85M01A001R`) is caught only when standalone or punctuation-separated.

Context: identical flaw existed in old `isSensitiveFact` (HEAD `MemoryStore.ts:274` — same strip-then-`\b`), so this is **parity, not a regression**. But the audit verdict stands on the product rule: after B1A, the egress gate is the *sole* defense for patterns in queries, and the map's §2 "critical gap" example is only caught in its leading-token form. Exposure window is precisely the dangerous one — the turn in which the user supplies the data (memory facts from this turn are not yet injected, so `echo-of-memory-fact` cannot fire; only the broken regex stands there). Next-turn echoes get partial coverage via `echo-of-memory-fact` (an IBAN token is digit-containing → distinctive token signal in `entityContainment.js:100-113`), which makes the same-turn hole the live one.
The impl report's test suite covers only the leading-token form (`sensitivePatternGate.test.ts:4-8`, `"DE89370400440532013000 bic"`), so the hole is invisible to CI.

### BUG

**G1 — False-positive classes are now load-bearing on every web_search, and the impl report never quantified them.** The doc comment (`sensitivePatternGate.ts:1`, `:21` "False positives are preferred here because callers use this for egress") transplants the *memory-write* rationale (rejecting a 200-char fact is cheap) onto a rule that can now veto any search. Verified blocked today:

- Address regex (`sensitivePatternGate.ts:88-96`), digits are `\w` so `{2,30}?\d{1,4}\b` swallows trailing years/numbers: `"street food tour 2024"` → blocked; `"wall street 1987 movie"` → blocked; `"road trip 10 days italy"` → blocked; `"road bike size 56"` → blocked; `"the road home 2009"` → blocked; `"via app store pricing 2024"` → blocked; `"send via train in 10 hours"` → blocked.
- Bare medical keywords (`:107-109`): `"anxiety meditation techniques"` → blocked; `"diabetes diet plan"` → blocked; `"allergy medicine for kids"` → blocked. (Note the list is singular-exact: `"symptoms of flu"` passes because `\b(symptom)\b` fails on "symptoms" — while `allerg\w*` is wildcarded. Inconsistent and untested.)
- Bare credential keywords (`:26-34`): `"token ring network history"`, `"JWT token vs session cookie"`, `"secret menu mcdonalds"`, `"how to pin a message in discord"` → all blocked.
- CF abbreviation `c\.?\s*f\.?` (`:61`): `"cf. Smith 1999"` → blocked.

These were tolerable when the regexes only gated fact writes; on every query they are feature-defeating. The impl report never states the FP cost or gets a product sign-off on it. (Deliberate-per-doc-comment, so BUG-with-decision-needed, not silent.)

**G2 — Only the first candidate card number is Luhn-checked.** `sensitivePatternGate.ts:46-52` uses `raw.match(...)[0]`. Verified: `"1234567812345678 meeting 4111111111111111"` → false (first run Luhn-invalid, second is a real card) — NOT blocked. Inherited from HEAD (`MemoryStore.ts:266-272`), so parity; still a hole in the only egress defense.

**G3 — Card numbers with double-space or newline grouping, without card keywords, are not detected.** Verified: `"4111  1111  1111  1111"` → false; `"4111\n1111\n1111\n1111"` → false. Branch 1's 4×4 confirm regex runs on `raw` (original separators), branch 2's `[ -]?` accepts a single separator char only; the pre-replace normalization in branch 1 only feeds the digit-run count, not the confirm. Parity with old code. Low real-world probability from a model, but it is the canonical "reformatting dodges the gate" family.

### NIT (all of them)

- **N1 — `priority: 5` is inverted relative to `evaluateTurn` semantics.** `src/rules/evaluate.ts:41-46` sorts **priority DESC** (`b.rule.priority - a.rule.priority`); the map said "priority 5, above echo rules" assuming ASC. The sensitive rule is evaluated **last** of the four. No behavioral impact today (all four actions are block; block short-circuits via `fired.find(...)` at `evaluate.ts:99`; and `blockText` in `runToolGate.ts:37-42` maps every non-empty-query reason to the same `webSearchPrivacyBlocked` message) — but in toolhelp mode the audit log credits `echo-of-context` (20) instead of the sensitive rule when both fire. Cosmetic attribution error.
- **N2 — Map-mandated test missing:** `B1A-PRIVACY-EGRESS-MAP.md` §4 lists `memory.listFacts no longer filters sensitive` (pre-existing sensitive fact survives the migration rewrite). `src/memory/MemoryStore.test.ts` has only 2 tests (`addFact` card, `applyExtractResults` IBAN); no test seeds AsyncStorage with a sensitive fact and asserts `listFacts()` keeps it. The old filter lived at HEAD `MemoryStore.ts:458` (`const withoutSensitive = current.filter(...)`); today's `listFacts` (`MemoryStore.ts:285-312`, `migrated = dedupeAndCap(current)` at `:288`) has no guard against a re-introduced filter.
- **N3 — Non-discriminating test case:** `MemoryStore.test.ts` `"applyExtractResults stores sensitive text"` uses `"My IBAN is DE89370400440532013000"` — a string the OLD `isSensitiveFact` also accepted (verified: no branch fires on it; IBAN regex fails post-strip, Luhn branch needs `\b`, digit run is 20). It passes under both regimes; only the `addFact` 4111 test actually discriminates. Misleading as a regression signal.
- **N4 — Thin test suite for the new load-bearing detector:** `sensitivePatternGate.test.ts` = 4 strings (3 positive, 1 innocent). No FN tests that would have caught B1 (`"my iban is ..."`), no FP-envelope tests, no empty/non-string input tests, no Luhn boundary (13/19), no CF/address/GPS/phone cases. The only innocent test is `"weather in Milano"`.
- **N5 — Working tree mixes B1A with unrelated campaign edits:** `campaigns/ciswire.json` (`thermalMaxC 45→43`), `scripts/campaign/{datastore.mjs,oneTurn.sh,recovery.sh,resilient.sh,supervisor.sh}`. Not mentioned in the impl report; a wholesale `git add` would smuggle them into the B1A commit. (`ci-bench.sh` comment updates and `ciswireFlagsTelemetry.test.ts` field removal *are* B1A-adjacent and correctly done.)
- **N6 — Updated settings copy still overpromises:** `src/i18n/en.ts:912` / `it.ts:881` note says "Everything stays on this phone — nothing is ever uploaded." After B1A the store holds strictly more sensitive material and facts can reach egress via query echo (blocked only heuristically — near-verbatim containment or sensitive-pattern hit). Not a regression (old copy made the same claim), but the store/gate change makes the claim more strained.
- **N7 — Gate kill-switch fully disables the only egress defense:** `AppShell.tsx:1997` — `kalsa.bench.toolgate=0` bypasses `runToolGate` entirely; with B1A there is no privacy fallback behind it. Pre-existing flag, but B1A makes it the single point of privacy enforcement; the impl report doesn't note it.
- **N8 — `luhnCheck("")` returns true** (`sensitivePatternGate.ts:3-16`: sum 0 → `0 % 10 === 0`). Currently unreachable (callers enforce length ≥ 13), latent.
- **N9 — Branch 1 vs branch 2 CC logic overlaps** (`:41-52`): two separate digit-run scanners with different separator tolerance; a unified normalize-then-scan would remove the G3 class. Style/robustness.
- **N10 — Impl report "Key diffs" block shows abbreviated pseudo-code with a `// CC/Luhn, IBAN, ...` comment as if it were the function body** — cosmetic, but "diffs" that aren't diffs invite trust without reading the real file.
- **N11 — `web_fetch` ungated** (`toolGateRegistry.test.ts:23-24` asserts `resolveToolGateTable("web_fetch", true)` undefined; no scan in `webFetchTool.ts`). Correctly disclosed as follow-up in the impl report; per audit brief §8 this is a follow-up, not a blocker — but note it is now *more* urgent: with B1A, the registry's per-tool exemption is the reason an IBAN can ride in a `web_fetch` URL/query param while `web_search` gets blocked. Adding `web_fetch` to the registry with a URL+args sensitive scan is ~20 lines if trivially scoped; doing it right (allowlist ordering, redirect URLs, query params) is not trivial.

---

## PLAUSIBLE

- **P1 — phone-prefix rule false positives on innocuous `00` sequences.** `sensitivePatternGate.ts:80-85`: `(?:\+|00)[\d\s-]{8,15}\d\b` + 9–13 digits. Verified it accidentally *blocks* `"routing it60x0542811101000000123456 please"` (the `00` inside the IBAN + following digits = 12 "prefix digits"). Cute (it papers over B1 for some IBANs) but it proves the phone rule will also fire on innocent digit-rich text containing `00` (serials, invoice series, sports scores written with leading zeros). Needs one realistic query to escalate; not confirmed.

---

## REFUTED (checked, holds, no finding)

- **No remaining memory-write rejection of sensitive text.** `addFact` (`MemoryStore.ts:307`), `applyExtractResults` (`:395`), `listFacts` (`:285`), `writeFacts`, `dedupeAndCap` — zero sensitivity logic; `SensitiveFactError`, `isSensitiveFact`, `luhnCheck`, the `listFacts` filter (HEAD `:458`), the throw (HEAD `:486-487`), the skip+counter (HEAD `:617-619`) all gone. `SettingsScreen.tsx:545-554` catch-all → `memory.saveError` only. Extraction prompts contain no "don't store sensitive" residue (grepped src + i18n + docs clean).
- **Bare CC blocks web_search without memory facts.** `toolGate.ts:58-63` rule `sensitive-pattern-in-query` priority 5 → `runToolGate.test.ts:107-121` asserts block + ruleId/reason with empty `memoryFacts`; path AppShell `executeTool` (`:1997-2006`: `runToolGate({ toolName: name, ..., memoryFacts: injectedFactsRef.current, ... })`) → `resolveToolGateTable("web_search")` → `TOOL_GATE_TABLE`. Confirmed live.
- **Telemetry counters-only, no fact text.** `memoryTelemetry.ts` interface is numbers-only (13 fields + optional `ciswireFlags`); `formatMemoryLine` enumerates by name; harness Test 5 (`memoryTelemetryHarness.mjs:280`) asserts `!("factsRejectedSensitive" in parsed)` and no fact-text leak; Test 1 updated to 9 fields. `benchAggregate.mjs` and `benchGrade.mjs`: field, accumulator, two rendered tables, and the "check sensitive filter" verdict copy all removed; no stale references anywhere (grep across src/, scripts/, docs = clean).
- **No dead exports / broken imports / i18n leftovers.** `tsc --noEmit` exit 0; `jest` 30 suites / 240 tests pass; zero references to `isSensitiveFact`/`SensitiveFactError`/`factsRejectedSensitive`/`memory.sensitive` repo-wide; `memory.note` rewritten in both locales; `memory.sensitive` key gone from both; new files (`sensitivePatternGate.ts/.test.ts`, `MemoryStore.test.ts`) exist and pass but are **untracked** — must be `git add`ed.
- **Luhn/regex regressions vs old `isSensitiveFact`: none.** Pattern table is byte-identical to HEAD `MemoryStore.ts:229-406` (side-by-side diffed). Only deltas: non-string input → `false` (was `true`) and empty → `false` (was `true`) — both correct for egress where `asString` guarantees a string and the `empty-query` rule owns empties. `luhnCheck` identical modulo a renamed variable. B1/G2/G3/F4 are **inherited quirks**, not regressions.
- **Impl report verification claims all reproduced:** targeted jest, full jest (30/240), tsc, harness, `git diff --check`.

---

## Ordered fix list

1. **BLOCKER B1:** fix IBAN/CF matching in `sensitivePatternGate.ts:57,62` — match against `raw` with whitespace tolerance (e.g. `\b[A-Z]{2}\d{2}[A-Z0-9\s]{10,30}\b` then re-verify ≥10 alphanumeric after de-spacing, or replace leading `\b` with `(?:^|[^A-Z0-9])` on the de-spaced string). Add the failing phrasings as tests: `"my iban is DE89370400440532013000"`, `"credit card IT60X0542811101000000123456"`, `"transfer to DE89..."`, `"codRSSMRA85M01A001R"` → must block.
2. **G1 (decision + code):** pick the egress FP posture. Minimum: require a digit/value co-occurrence for medical + credential keyword blocks (parity with intent: keyword *next to* a value), and either narrow the street-word regex (exclude when the matched number is a plausible year/context word follows) or accept documented feature loss with a written decision record. Whatever is chosen, add FP-envelope tests so the posture is pinned.
3. **G2:** loop `raw.matchAll(/\b\d(?:[ -]?\d){12,18}\b/g)` and Luhn-check every candidate.
4. **G3:** collapse separator runs before the card scan (`/\s+/` → single space; include `\n` in the separator class) so double-space/newline-grouped cards are caught on both branches.
5. **N2:** add the `listFacts` migration test (seed AsyncStorage with a sensitive fact → survives).
6. **N3:** change `MemoryStore.test.ts` applyExtractResults case to a string the old filter demonstrably rejected (e.g. `"My card is 4111111111111111"` through the extract path) so the test discriminates.
7. **N4:** grow `sensitivePatternGate.test.ts` to pin the FN/FP envelope (empty string, non-string, Luhn 13/19 boundaries, address/medical/CF/phone/GPS classes, the B1 phrasings).
8. **N1:** either bump `sensitive-pattern-in-query` above the echo rules (e.g. priority 25/35) or annotate `toolGate.ts` that the number is cosmetic under DESC sort — so the map's "above echo rules" intent isn't silently lost. No behavior change either way.
9. **N5:** stage B1A files only; commit the campaign-script edits separately.
10. **N6/N7:** one-line edits — qualify the settings note ("facts stay on this phone; searches are blocked when they would carry private data") and note the `kalsa.bench.toolgate` bypass in the impl report/ARCHITECTURE.
11. **Follow-up (tracked, not B1A):** register `web_fetch` in `TOOL_GATE_REGISTRY` with a URL+args sensitive scan; keep the registry test as the spec.