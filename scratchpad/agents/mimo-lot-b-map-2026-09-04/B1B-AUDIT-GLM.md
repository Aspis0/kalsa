# B1B — Hostile Self-Audit (GLM)

**Date:** 2026-09-04
**Repo:** `/Users/marco/Projects/kalsa` (working tree, uncommitted; HEAD = `b28294b`, B1-A′)
**Map:** `B1B-UX-CLARITY-MAP.md` · **Impl:** `B1B-IMPL-REPORT.md`
**Scope B only:** Memory UX — toggle label/placement, cap hints, trunc note, full-memory feedback. Not edit-fact (C), not egress (A′).

---

## Verdict

The two mapped fixes are mechanically sound: the Switch is out of the CisWire panel and re-homed in the Memory panel under `memory.enabled` (label + a11y label), and the cap hint interpolates all four values correctly in both locales — verified empirically by running the shipped `applyParams` regex against the shipped catalogs. The store-level full-memory throw (`MemoryCapacityError`) is correct under the mutex and correctly surfaced. **No blocker: there is no data-loss, crash, or store-corruption path.**

But the change was executed with tunnel vision. **The CisWire panel's own hint copy — `settings.ciswireHint`, rendered two rows above where the Switch used to sit — still tells users to "Choose compaction, memory, and tool help independently" in the very panel from which B1B just removed the memory toggle.** The impl report never mentions it. Second: the new "Memory is full" notice survives deletion of a fact, so the UI can lie about a condition that no longer holds. Third: the verification section is hollow — the cited jest suite (3 tests) is the A′ sensitive-storage suite and exercises **zero** lines of the B1B diff; nothing tests `MemoryCapacityError`, the `MAX_FACTS` export, at-capacity behavior, or any UI. Everything else on this sheet is nits, but the instruction was to leave no nit unreported.

---

## Method (what this audit ran)

- Full reads: `SettingsScreen.tsx` (state lifecycle, handlers, Memory + CisWire panels), `MemoryStore.ts`, `src/i18n/index.ts` (translate/applyParams), `memoryPrompt.ts`, `dnaBounding.ts`, `en.ts`/`it.ts` memory + settings sections, `MemoryStore.test.ts`.
- Diffs: `git diff` on the four changed files; `git show b28294b` (A′) to establish what A′ deliberately touched and left.
- Empirical: executed the shipped `applyParams` logic (`/\{(\w+)\}/g`) against both catalogs with `npx tsx`; placeholder sets and rendered output quoted below.
- Reference renders: grep for every `memory.*` key, every remaining `ciswireMemory` reference (src + docs), every a11y label in the Memory panel.
- Reproduced impl-report claims: `npm run typecheck` → exit 0; `npx jest src/memory/MemoryStore.test.ts --runInBand` → 1 suite / 3 tests pass; `git diff --check` → exit 0. All three claims are true (relevance of the jest one critiqued below).

---

## CONFIRMED findings

### BUG

**G1 — The CisWire panel hint now directs users to a control this change deleted.**
`src/i18n/en.ts:95-96`, rendered at `src/screens/SettingsScreen.tsx:1136`:
```
"Choose compaction, memory, and tool help independently. New flags are off unless you enable them."
```
`src/i18n/it.ts:94-95`:
```
"Scegli separatamente compattazione, memoria e aiuto per gli strumenti. Le nuove funzioni sono disattivate finché non le attivi."
```
B1B removed the Switch from the CisWire panel (verified: the diff deletes the row after the compaction selector; `memoryEnabled` now binds only at SettingsScreen:1314). The panel now contains compaction mode + tool help — and a hint that promises a memory control it doesn't have, in both locales. The map's §1 told the impl to move the toggle and optionally "keep `settings.ciswireMemory` as a tooltip or subtitle"; the impl moved the toggle and never re-read the hint copy its move invalidated. Same-panel copy drift caused by the change itself, so it's in scope, not a pre-existing grudge.

**G2 — "Memory is full" notice persists after the user deletes a fact — the UI asserts a falsehood.**
`src/screens/SettingsScreen.tsx:569-590` (`handleDeleteMemoryFact`): the success path calls `removeFact` + `reloadMemory` and touches `memoryNotice` **only in the catch**. `handleToggleMemory` clears the notice (line 527: `setMemoryNotice("")`), `handleClearMemory` replaces it with `clearDone` — delete does neither. Sequence: at 40/40, tap Add → notice "Memory is full (40 facts)"; delete one fact → notice still says the store is full while 39/40 with a live add-form below it. The old notice inventory (addDone/saveError) made stale-notice persistence benign; the capacity warning made it actively wrong. `colors.accent` styling (line 1466) makes it read as a success banner, compounding it.

**G3 — Verification theater: the cited jest suite exercises none of the change.**
Impl report: "`npx jest src/memory/MemoryStore.test.ts --runInBand` — exit 0; 1 suite, 3 tests." Those 3 tests are `addFact accepts a bare card number`, `applyExtractResults stores a bare card number`, `listFacts keeps a seeded sensitive fact` — pure A′ regression tests. The B1B diff introduced two new public API surfaces (`MemoryCapacityError`, `export const MAX_FACTS`) and one throw branch (`MemoryStore.ts:324`); test coverage of all three: zero. No i18n interpolation test, no at-capacity add test, no UI test. `typecheck` catches type drift, not behavior: e.g., a future edit swapping the `instanceof` to a string compare, or `>= MAX_FACTS` → `> MAX_FACTS` in the store, passes every check the report ran. The report's "Verification" section implies the change was tested; it wasn't.

### NIT

**N1 — Dead i18n keys retained; docs still document one of them.**
`settings.ciswireMemory` — `en.ts:101` `"CisWire Memory"`, `it.ts:100` `"Memoria CisWire"`. Grep across `src/` for render sites: **zero** (only the i18n files). The map's §5 explicitly listed it for deprecation. Worse, the dead key is still live in docs: `docs/ciswire-rollout/MAP_S1_S2_S5.md:109` "Toggle labels: `settings.ciswireMemory`, `settings.ciswireToolHelp`" — documentation now names a label that renders nowhere. `memory.disabled` (`en.ts:902`, `it.ts:873`) was flagged dead by the map, listed for deprecation, and left untouched (zero render sites; only a telemetry comment mentions the words).

**N2 — Scope deviation from the map, unacknowledged in the impl report.**
Map §6: "No changes to MemoryStore.ts, memoryPrompt.ts, dnaBounding.ts, LlamaService.ts, or any engine file." The impl modified `MemoryStore.ts` (new `MemoryCapacityError` class lines 31–38, `MAX_FACTS` export line 41, throw at line 324). The deviation is *justified* — the full-memory notice requires it, and it's 12 lines, store-local — but the impl report's checklist ("No edit-fact UI, drawer entry/export, engine cap, DNA bounding, or sensitive filter changes") never states that a file the map explicitly excluded was changed. A reviewer diffing report against map finds an undeclared delta.

**N3 — Duplicated constants + half-parameterized copy: the hint can be made to lie by editing one file.**
`SettingsScreen.tsx:153-154`:
```ts
const MEMORY_REPLY_FACT_CHARS = 120;
const MEMORY_REPLY_FACTS = 10;
```
These re-state private engine constants — `memoryPrompt.ts:9,11` `MAX_PROMPT_FACTS = 10` / `MAX_PROMPT_FACT_CHARS = 120` (not exported, hence the copy). If the engine changes, `tsc` passes, every test passes, and the UI advertises stale numbers. Meanwhile `truncNote` hardcodes the same 120 *inside the string* in both locales (`en.ts:901` "Facts over 120 chars...", `it.ts:871`) while the visibility condition uses the constant (SettingsScreen:1333) — half the message is parameterized, half is frozen. Change the constant to 100 and the note only appears above 100 but still says 120.

**N4 — extractPrompt copy contradicts the A′ product decision (copy inconsistency, per scope note).**
`en.ts:920-927` (unchanged by both A′ and B1B): `"Never extract passwords, tokens, API keys, card numbers, emails, phone numbers, IBAN, tax IDs, or medical details."` — against `MemoryStore.ts:8` (A′): `"Facts may contain sensitive data; privacy filtering belongs at egress."` and the A′ test literally named `"addFact accepts a bare card number"`. A′ rewrote `memory.note` for the new stance (verified in `git show b28294b`) but never reconciled the extraction prompt. Result: manual add stores a card number by design; the auto-extractor is forbidden from storing the same fact. The manual-vs-auto asymmetry may be intentional conservatism, but it is undocumented, and neither A′ nor B1B noticed they owned this string.

**N5 — truncNote over-reports on two axes.**
Condition at SettingsScreen:1333 fires if *any* stored fact exceeds 120 chars — including facts among the oldest 30 that will never be injected (`memoryPrompt.ts:39` `slice(-MAX_PROMPT_FACTS)` keeps newest 10), and it renders **while memory is OFF**, when no injection ever happens. The note can tell a user their replies shorten facts the model never sees and when the feature is disabled. Conservative direction (no false reassurance), but inaccurate.

**N6 — capHint is wrong while memory is OFF.**
The hint (`memory.capHint`, SettingsScreen:1321–1329) renders unconditionally: "…up to 10 used per reply…" — false when the toggle next to it is off and nothing is used per reply. It stacks directly above `disabledNote`, so an OFF user reads "up to 10 used per reply" then "Memory is off: facts are not used or updated" — the panel argues with itself.

**N7 — Stale count, two ways.**
(a) `memoryFacts` initializes `[]`, so `capHint` flashes "0 / 40 facts saved" on users who have facts until the mount-time `reloadMemory` resolves (SettingsScreen:230, 243–259). (b) The screen never re-syncs after mount; a delayed extraction job released after the last chat turn can call `applyExtractResults` while the settings overlay is open (it only unmounts on back), leaving `capHint`'s count and the pre-check at 544 stale. PLAUSIBLE low-frequency, CONFIRMED no re-sync mechanism exists.

**N8 — a11y/visual nits in the new UI.**
- `memoryNotice` Text (SettingsScreen:1466) has no `accessibilityLiveRegion`/announcements — "Memory is full" and save errors are silent to screen readers; it's the only interactive feedback in the panel.
- The "full" warning inherits `colors.accent` (1466) — the same color as the "Fact saved" success message (1459-area); warning and success are chromatically identical.
- At 40/40 the Add button remains enabled (`disabled={memoryBusy || !memoryDraft.trim()}`, line 1430) — the design makes the user type, submit, and read a notice rather than disabling input with the (already-shipped) `memory.full` copy nearby.

**N9 — UI busy-guard is a state-closure race (cosmetic only).**
`SettingsScreen.tsx:543`: `if (!text || memoryBusy) return;` — `memoryBusy` is React state captured in the callback; two taps inside one render frame (Pressable fires both before the `disabled` prop re-renders at 1430) both pass. Data-wise harmless: the store mutex serializes, `addFact` re-reads under lock, identical text dedupes silently, and overflow throws `MemoryCapacityError` which is caught → correct localized notice. Consequence is limited to notice flicker ("Fact saved" then "Memory is full" on a different-text double-tap). Related: the UI pre-check (544–547) can block an add the store would accept (stale-high count after a forget-list extraction, see N7b) — the store throw was the correct single guard; the pre-check adds a second, staler one.

**N10 — (pre-existing, unaddressed) 200-char store ceiling remains invisible.**
`maxLength={200}` (SettingsScreen:1410) duplicates the private `MAX_TEXT_LEN = 200` (MemoryStore.ts:42); no counter, no hint. The map's §3 offered an inline per-fact "x/120 →" affordance as an alternative to the panel note; neither was implemented. Out of B1B's mandated fix list, but the map raised it and nothing moved.

**N11 — (pre-existing) no telemetry for manual at-capacity rejections.**
`factsRejectedFull++` (MemoryStore.ts) counts only extraction-path rejections. The new UI pre-check short-circuits *before* the store, and store throws aren't counted either, so bench telemetry cannot measure how often users hit the cap the B1B UX is built around.

---

## PLAUSIBLE findings

**P1 — Stale-full block of a legitimate add (N7b/N9 corner).** If a forget-list extraction lands while settings is open, `memoryFacts.length` stays 40-high; the pre-check then shows "Memory is full (40 facts)" for a store that actually has room, and nothing self-heals until the user toggles, clears, or leaves and returns (remount reloads). Store truth is never consulted in that path. Low probability (requires extraction settling during an open settings overlay), low severity (no data loss), but the mechanism is real.

---

## REFUTED items

**R1 — "i18n missing placeholders" (angle 2): REFUTED.** Ran the shipped `applyParams` (`/\{(\w+)\}/g`, single-brace named) against both catalogs with `{count:37, max:40, perReply:10, chars:120}`:
```
en capHint: "37 / 40 facts saved — up to 10 used per reply (120 chars each)"
it capHint: "37 / 40 fatti salvati — fino a 10 usati per risposta (120 caratteri ciascuno)"
en full:    "Memory is full (40 facts). Delete a fact before adding another."
it full:    "La memoria è piena (40 fatti). Elimina un fatto prima di aggiungerne un altro."
placeholders capHint (en,it): chars,count,max,perReply   placeholders full (en,it): count
```
All params passed at SettingsScreen:1322–1327 and 545/561. Placeholder sets identical in both locales; key sets identical (`it-memory-keys === en-memory-keys: true`; `it` is typed `LocaleStrings = typeof en` so structural drift is a compile error). The map's draft `capHintIt`/double-brace form was abandoned for the correct single-key + params design.

**R2 — "truncNote fires on empty list" (angle 3): REFUTED.** `memoryFacts.some(...)` on `[]` is `false`; the note is correctly hidden with an empty store. No "0 facts over 120 chars" nonsense is possible.

**R3 — "Store race double-add corrupts data at 40 facts" (angle 4): REFUTED at the store level.** `addFact` runs under `withMutex`; overflow throws `MemoryCapacityError` on a fresh read (MemoryStore.ts:324), and `writeFacts` → `dedupeAndCap` hard-caps at 40 regardless of caller. `SettingsScreen` catches the error and shows the localized `memory.full` (560–563). There is no interleaving in which the store exceeds 40 or a write is lost. The only residue is the cosmetic UI closure race (N9).

**R4 — "Switch still in the CisWire panel" (angle 1): REFUTED.** The diff deletes the row entirely from the CisWire panel; grep shows `memory.enabled` rendered only in the Memory panel (1311/1318), with the a11y label (1318) matching the visible label. `handleToggleMemory` is rebound unchanged — no orphaned state, no double render (contrast AUDIT_S1's old "dual memory UI" defect, now truly resolved).

**R5 — "memory.enabled still unused" (map's premise): REFUTED post-impl.** Rendered at SettingsScreen:1311 and 1318 as mapped.

**R6 — Impl-report verification claims are false: REFUTED — all reproduce.** `tsc --noEmit` exit 0; jest 1/3 pass; `git diff --check` exit 0. (Their *relevance* to the diff is critiqued in G3.)

---

## Ordered fix list

1. **G1** — Rewrite `settings.ciswireHint` in en+it to describe what the panel now contains (compaction + tool help only), or point to the Memory panel. Copy-only, two locales, zero risk.
2. **G2** — Clear (or replace with an ack) `memoryNotice` on successful `handleDeleteMemoryFact`; stop asserting "full" when the store has room.
3. **G3** — Add tests: `addFact` at capacity throws `MemoryCapacityError` (and `MAX_FACTS` export matches store behavior); `memory.full`/`capHint` interpolation snapshot in both locales; keep the A′ suite untouched. Update the impl report's Verification section to name tests that actually cover B1B.
4. **N3** — Export `MAX_PROMPT_FACTS`/`MAX_PROMPT_FACT_CHARS` from the engine (or a shared constants module); delete `MEMORY_REPLY_FACTS`/`MEMORY_REPLY_FACT_CHARS`; either interpolate `{chars}` into `truncNote` or accept-and-document the frozen 120.
5. **N1** — Delete `settings.ciswireMemory` and `memory.disabled` from en+it; update `docs/ciswire-rollout/MAP_S1_S2_S5.md:109`.
6. **N2** — Amend the impl report to declare the `MemoryStore.ts` deviation and why it was necessary.
7. **N4** — Reconcile `extractPrompt` with the A′ stance (either soften "Never extract…medical details" or document the deliberate auto-vs-manual asymmetry next to the `MemoryStore` contract comment).
8. **N5/N6** — Gate `truncNote` and the "up to 10 used per reply" clause on `memoryEnabled` (optionally compute over the newest-10 subset only).
9. **N7/P1** — Re-sync `memoryFacts` when the settings overlay opens/moves to foreground (focus effect) so capHint and the pre-check can't go stale.
10. **N8** — Warning color for `memory.full`/`saveError` notices; `accessibilityLiveRegion` on `memoryNotice`; disable the Add input/button at 40/40 instead of tap-to-see-notice.
11. **N9** — useRef-based busy guard on `handleAddMemoryFact` (and consider dropping the stale UI pre-check in favor of the store throw + catch).
12. **N10/N11** — Optional: char counter or 200-char hint on the input; telemetry counter for manual capacity rejections.

---
*Audit self-applied. No delegation. Every quote verified against the working tree at HEAD `b28294b`; empirical results produced by running the shipped code, not from the map's claims.*
