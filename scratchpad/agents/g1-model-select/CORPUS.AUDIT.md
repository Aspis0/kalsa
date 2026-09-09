# Hostile audit — G1 model-selection corpus & runner (read-only)

Scope: `corpus/cases.jsonl`, `run_corpus.py`, `score.py`, `validate.py`, `RUBRIC.md`, `tests/`. `samplers/`, `results/` ignored. Requirement baseline: PROPOSTA-OTTIMIZZAZIONE-CHAT-2026-09-08.md §7/§13 (80 cases 40IT/40EN, 20/20/16/12/12, 60dev/20holdout, deterministic checks *unambiguous*, open cases with fixed 1–5 rubric, blind judging).

**WARNING — artifact was live-edited during this audit.** `run_corpus.py` changed between reads (05:59, 9,802 B → 06:02, 10,114 B; `--system-prompt-file` added, `sampler_payload` rewritten), and `tests/test_runner.sh` (06:02:37) and new `system-prompt.txt` (06:02) appeared mid-session. The kit is not frozen; claims below are against the files as last read (run_corpus.py = 254 lines).

Verdicts: **CONFIRMED** / **PLAUSIBLE** / **REFUTED**, most severe first.

---

## F1. The wired system prompt forces ENGLISH output — invalidates the entire Italian half
**CONFIRMED.**

`run_corpus.py:183` — `messages = [{"role": "system", "content": system_prompt}, *case["turns"]]` prepends the product prompt to *every* case (also `tests/test_runner.sh:15`). `system-prompt.txt` says: "(a) Write all natural-language answer text … in English." The corpus has 40 `lang: it` cases whose deterministic checks demand Italian strings, e.g. C03 `check_payload.value="mercoledì"`, D01 `"due giorni lavorativi"`, D09 `"tra 2 e 8 gradi Celsius"`, M03 `check_payload.items=["pagare l'affitto"]`, M10 `["vegetariana","quattro"]`, I05 regex `"^[-*] \[ \] Porta il caricatore domani$"`. A compliant model answers English → every one of those checks fails by policy, not by quality. The IT rubric cases (C07/C09/C15/C19, I13/I18, M05) fail the "lingua italiana" criterion the same way. So 40 of 80 cases are measuring the system prompt, not the model. Only language-neutral cases survive (C01/C02/C13/C14 digits, most tool args).

Note the contradiction is now *worse*: C17 (lang=it, needs English output) is helped; C18 (lang=en, needs Italian output "La riunione inizia alle tre e mezza.") is broken. The corpus language plan and the runner's prompt are mutually inconsistent; nothing anywhere checks this (validate.py doesn't know the system prompt exists).

## F2. Reasoning/thinking text is never stripped before deterministic checks
**CONFIRMED (code). PLAUSIBLE (impact).**

`run_corpus.py:48-51` `text_from()` returns `message["content"]` verbatim; `check_response` (`run_corpus.py:136`) feeds it straight into `exact` (`:147` `value.strip() == payload["value"]`), `regex` (`:150`), `contains_all` (`:152-153`). `reasoning_from()` (`:53-64`) only *records* reasoning; nothing removes it from `content`. Demonstrated: content `"[Start thinking] 2+2=4. [End thinking] 4"` against C01-style exact `"4"` → **FAIL** (`check mismatch`), and `assistant_text` stores the thinking verbatim (`run_corpus.py:206`).

Both models emit thinking spans at the CLI (`smoke-minicpm5.raw`, `smoke-lfm.raw` show `[Start thinking]…[End thinking]`). Whether llama-server splits that into `reasoning_content` depends on server-side recognition of these new templates — never verified anywhere in the kit, and the harness has no defense, no assertion, no warning. Consequences: (a) under any reasoning-merged server, *every* exact case false-fails and `contains_all`/`regex` can false-pass on reasoning text; (b) blind judging is contaminated — `assistant_text` (what a judging sheet is built from, per RUBRIC.md "make two copies of the final answer") may contain the full thinking. This voids the protocol's "deterministic checks unambiguous" claim and the blind procedure.

## F3. Runner hard-crashes on connection resets — loses all remaining cases with no record
**CONFIRMED** (demonstrated).

`run_corpus.py:192` — `except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError)`. `RemoteDisconnected`/`ConnectionResetError` are `OSError` subclasses and propagate uncaught: a mid-request disconnect aborted the whole run, traceback, after writing only the first result line — cases after the crash are lost entirely, never recorded as fail or skip. (HTTP 5xx *is* handled: demo → X04 recorded `request error: HTTP Error 500`, exit 1; empty `choices` → recorded FAIL. So "silently skipped" is REFUTED for those paths, but the crash path is worse than a skip.)

## F4. Memory category is 1-turn lookback, not memory
**CONFIRMED.** All 12 memory cases (M01–M12) are exactly `turns: [user(facts), assistant(ack), user(question)]` — roles `['user','assistant','user']`. The fact is given in `turns[0]` and queried in `turns[2]`, separated by a single assistant ack ("Ricorderò questi dettagli"). That's near-context extraction, not the doc's "richiamo di fatti lontani" (§7). A model with zero long-range memory passes all of them. No memory case buries a fact >1 turn back or amid a longer conversation. Also none places the fact in the *final* message (REFUTED for that specific accusation), but 1-turn-back is the same failure in kind.

## F5. `exact` checks are over-strict (case, punctuation, trailing text, separators, non-unique answers)
**CONFIRMED** (all demonstrated against the real checker):

| case | expected | correct answer that FAILS |
|---|---|---|
| D01 | `due giorni lavorativi` | "Due giorni lavorativi" (capital), "due giorni lavorativi." (period) |
| D02 | `thirty days` | "Thirty days." |
| D04 | `1,220 degrees Celsius` | "1220 degrees Celsius" (no separator) |
| D06 | `160 euros` | "€160", "160 euros." |
| D08 | `March 21 at 17:00 local time` | "Applications close on March 21 at 17:00 local time." (trailing), "March 21st at 5 PM local time" |
| D09 | `tra 2 e 8 gradi Celsius` | capitalized variant |
| D10 | `sala 2` | "Sala 2" |
| D12 | `fifty images` | "Fifty images." |
| C17 | `The train is ten minutes late.` | any equally-correct translation ("running ten minutes late") — free translation is not a unique answer |
| C18 | `La riunione inizia alle tre e mezza.` | "Le tre e mezza." / "comincia" |
| I11 | `1 ora e 30 minuti` | "1 ora e 30 minuti." |
| I12 | `2 hours and 5 minutes` | trailing period |

`exact` is case-sensitive, whole-string equality (`run_corpus.py:147`). This directly violates "deterministic checks unambiguous."

## F6. `contains_all` is simultaneously brittle and over-loose
**CONFIRMED** (demonstrated):

- False FAILs: D03 "90 minuti" (digits) vs item `novanta minuti` → fail; M01 "alle 8:40" vs item `08:40` → fail (zero-pad); M10 "ristorante **vegetariano** per quattro persone" → **fail on both items** — the natural masculine noun fails the feminine item `vegetariana`, and digits fail `quattro`; D11 "if you decline the repair" vs item `declines` → fail (3rd-person only); D03 "90 minuti" fails `novanta minuti`.
- False PASSes: I09 "Prodotto e Quantità: mele 4" (no table at all) → **pass** — a format-instruction case that never verifies the format. Same for C05/C06 (a list with an extra day still passes; "soltanto questi tre giorni, nell'ordine" is unchecked) and I10.
- Substring match on `value.lower()` (`run_corpus.py:152-153`) cannot express format/order/exclusivity.

## F7. Regex refusal cases are too narrow
**CONFIRMED** (demonstrated). C11 pattern `(?i)(non posso|impossibile|non.*garantire|non.*prevedere)` — correct refusal "Non è possibile garantirlo." → **fail** (no allowed phrase). C12 `(?i)(can.?t|cannot|unable|not.*guarantee|not.*predict)` — correct "There is no way to predict that." → **fail**. The patterns require specific vocabularies; natural correct refusals false-fail (`run_corpus.py:150`).

## F8. Leakage across dev/holdout
**CONFIRMED — one real twin.** C15 (dev, it, rubric: errands farmacia/pane/spedizione, order + minimal assumption) and C16 (holdout, en, rubric: pharmacy/bread/mailing package, same task) are the same template with only the language changed, straddling the split. Rubric-scored ordering rationale transfers across language, so dev experience on C15 leaks into holdout C16. No other same-template/same-fact reuse found (T03/T04/T16 dates and tool domains distinct; D01–D12 docs distinct). Minor: M01–M12 all share the identical fact→ack→ask skeleton across the split (structural only).

## F9. Tool cases: over-exact/underivable arguments; only the first call is checked; content is ignored
**CONFIRMED for argument brittleness; PLAUSIBLE for the rest.**

- Argument comparison is strict equality (`run_corpus.py:104-108`, `value["arguments"].get(key) != wanted`). Demonstrated: T14 — prompt never contains "Asia/Tokyo"; a model calling `time.current` with `timezone="Tokyo"` → **fail**. T09 — `expression="18/3"` (no spaces) → **fail** vs expected `"18 / 3"`. T10 — `web.search` is a free-text query tool yet expects the verbatim phrase `official opening hours Louvre Museum`; any model-composed query fails. T15 — apostrophe variants of `bottiglie d'acqua`. T01 — "Roma" vs "Rome".
- Only `calls[0]` is examined (`run_corpus.py:70`); multi-call responses are half-checked.
- When `expected_tool` is set, `content` is ignored entirely (`run_corpus.py:136`). Demonstrated: reasoning-in-content + correct call → **PASS**. Corollary: a model that emits the call but never answers the user in natural language passes T01–T16; nothing verifies the model consumed or would use the result (no multi-round tool execution, so "continuità della chat" tool skill is untested).
- The kit never verifies the server has tool calling enabled (grammar/template); if llama-server for MiniCPM5/LFM2.5 lacks tool support, all 16 T-cases fail identically and the config error is indistinguishable from model failure.
- Tool-name contract conflicts with the system prompt: `system-prompt.txt` mandates tool `web_search`/`create_miniapp`, none of which appear in any case; the corpus invents `weather.get_current`, `calendar.create_event`, `notes.save`, `music.play`, `web.search` etc. — product tools, per §7, are not what the corpus tests.

## F10. C17/C18 language labels are inconsistent
**PLAUSIBLE.** Every other case labels `lang` by required *output* language. C17 is `lang: it` but its expected value is English ("The train is ten minutes late."); C18 is `lang: en` but requires Italian ("La riunione inizia alle tre e mezza."). Since `score.py:26` aggregates per `lang`, C17 inflates the IT pool with an English-output test and C18 inflates the EN pool with an Italian-output test, so per-language scores are uninterpretable. Either a deliberate cross-translation pair or a swap error; either way it contradicts the rest of the corpus and must be decided and documented. (Compounded by F1: the English mandate breaks C18 and enables C17.)

## F11. score.py: rubric means and model dimension missing
**CONFIRMED.** `score.py` aggregates by `(category, lang, split)` (`score.py:26`) with **no model key** — pass both models' files and rows merge silently into one table. It never computes rubric means (RUBRIC.md promises "aggregate mean criterion score and mean case score by model, language, category, and split"); the final 1–5 scores have no implementation in the kit. Open-ended cases are correctly *not* failures: they count as `manual` and are excluded from `pass_rate` (`score.py:34-35`) — that specific accusation is **REFUTED**. Division by zero is guarded (`rate = "n/a" if not scored`, `score.py:35`) — **REFUTED**.

## F12. validate.py checks shape, not semantics
**CONFIRMED** (`VALIDATION OK` on the corpus). It never validates `check_payload` against `check` type (no check that `exact` has `value`, `regex` has `pattern`, `contains_all` has `items`, `json_schema` has `schema` — only rubric criteria at `validate.py:54-59` are checked) → a malformed payload passes validation and fails at runtime. It has no dev/holdout duplication detection (missed C15/C16), no memory-distance requirement (M01–M12 pass as written), no output-language-vs-check consistency (missed F1/F10), no grounding check that `expected_tool` argument values appear in the prompt (missed T14/T10).

## F13. Test hygiene
**CONFIRMED.**
- `tests/test_runner.sh` is not executable (direct run: Permission denied, exit 126); must be invoked via `bash`.
- Hard-coded port 18999 (`test_runner.sh:5`) and `sleep 0.2` (`:8`) → race/flaky on slow hosts.
- Writes into the live data dir `results/stub.jsonl` (`:17`) — same namespace as real results (file already exists there); a future `results/*.jsonl` glob swallows it.
- Depends on corpus file order: `--limit 2` must yield C01 and C02, and `stub_server.py:14-18` answers only `"2 + 2"→4` and `"7 kilometers"→4.35` (default echoes the user text, which would fail C01). Any reorder silently breaks or empties the test.
- Depends on `samplers/lfm.json` + `system-prompt.txt` (config outside `tests/`).
- Coverage: exercises only the `exact` path. The stub never returns `tool_calls`, empty choices, 4xx/5xx, or reasoning → `tool_value`, `json_schema`, `regex`, `contains_all`, error handling are all untested. `score.py` and `validate.py` have **zero** tests.

## F14. Result rows lack sampler/budget/server attribution
**CONFIRMED.** Each row (`run_corpus.py:196-213`) records `model_label`, lang, category, split, timings, tokens — but not the sampler identity, the thinking budget, the system-prompt version, or the endpoint (endpoint only printed to stdout). §7 requires two passes (short/extended budget) and §9 says "Registrare i valori effettivi"; with no budget in the row, rows from different budget passes are indistinguishable in `score.py` and mixing is undetectable. Reasoning token split is also not computed (`completion_tokens` includes thinking tokens).

## F15. I11/I12 embed the answer in the prompt
**CONFIRMED (minor).** I11 prompt: "Rispondi nel formato esatto '1 ora e 30 minuti'" — the exact expected string is quoted in the prompt, so a model passes by copying without computing (I12 identical). These test echo, not conversion.

## F16. Documents: world-knowledge answerability
**PLAUSIBLE (minor).** D09's fact (2–8 °C transport range) is the standard cold-chain range and answerable from world knowledge; D07 ("S" for Saggistica) is trivially inferable from the doc's own scheme. All other D cases require the doc. Additionally every IT document (D01,D03,D05,D07,D09,D10) carries the same garbage-collection filler sentence ("…bacheca digitale del quartiere il giorno precedente alla raccolta") — in D01 it is contextually nonsensical (an account-incident support doc); duplicated distractors across unrelated documents are sloppy synthesis, and EN docs lack the filler (asymmetry).

---

## Severity-ordered verdict summary
1. **F1** CONFIRMED — English-mandate system prompt vs 40 IT cases (invalidates half the corpus).
2. **F2** CONFIRMED/PLAUSIBLE — no reasoning/thinking strip; deterministic checks void under any merged-reasoning server; blind judging contaminated.
3. **F3** CONFIRMED — crash on connection reset loses all remaining cases, unrecorded.
4. **F4** CONFIRMED — memory category = 1-turn lookback.
5. **F5/F6/F7** CONFIRMED — exact/contains_all/regex checks demonstrably fail correct answers and/or pass wrong ones; violates "unambiguous".
6. **F8** CONFIRMED — C15↔C16 cross-split leakage.
7. **F9** CONFIRMED/PLAUSIBLE — tool args underivable/over-exact (T14,T10,T09,T15,T01), first-call-only, content-ignored, no tool-support preflight, product tool contract absent.
8. **F10** PLAUSIBLE — C17/C18 lang labels inconsistent + C18 broken by F1.
9. **F11/F12** CONFIRMED — score.py lacks rubric means and model dimension; validate.py is semantic-blind.
10. **F13/F14/F15/F16** CONFIRMED/PLAUSIBLE — test hygiene, missing attribution, embedded answers, minor doc issues.

## Case ids that must be rewritten
- **Language conflict (all 40 IT cases are invalidated as written):** fix the system prompt or make it language-neutral; at minimum re-validate C03, C05, C11, C18, C19, I05, I09, I11, I13, I16, I18, D01, D03, D05, D09, D10, D12, M01, M03, M05, M07, M10 against the chosen policy.
- **C15/C16** — break the cross-split twin (rewrite one).
- **C17/C18** — move to rubric (non-unique output) and fix lang labels.
- **C11/C12** — widen refusal patterns or switch to rubric.
- **D01, D02, D04, D06, D08, D09, D10, D12** — exact too strict (case/trailing/separators); relax or fix expected.
- **D03, M01, M02, M10, D11** — brittle `contains_all` items (digits, zero-pad, gender, 3rd-person).
- **I09, I10, C05, C06** — `contains_all` cannot enforce format; upgrade to regex/json_schema or rubric.
- **I11, I12** — remove the embedded answer.
- **T01, T09, T10, T14, T15** — ground expected args in the prompt or accept natural variants.
- **M01–M12** — restructure into genuinely long-range multi-turn cases (or relabel category).
- **D09 (optionally D07)** — replace with a non-world-knowledge fact if documents must be doc-gated.
- **T01–T16** — reconcile tool names/contract with the product prompt (web_search/create_miniapp) and add a post-tool-use turn if "continuità" is claimed.

## Runner/test fixes required (not cases)
- `run_corpus.py:192` — catch `OSError`/`ConnectionResetError`/`RemoteDisconnected` and record the case as FAIL instead of crashing.
- Add explicit reasoning/thinking-tag stripping + a guard that warns when `content` still contains thinking markers.
- Add per-row sampler/budget/system-prompt/endpoint attribution.
- Add a tool-support canary (and verify the server actually returns `tool_calls`).
- `tests/` — make executable, drop the results-dir write, de-flake the port/sleep, and cover regex/json_schema/tools/error/reasoning paths plus score.py and validate.py.
