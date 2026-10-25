# Plan: the harness notices when the model does not act (rev. 3)

Date: 2026-10-18. Branch: brain. Status: PLAN ONLY, no product code changed.
Owner (it): "l'app si deve accorgere che l'ai non riesce a cliccare o altro. harness pulito e giusto."
Rev. 3 answers the second audit (luna). The sidecar flag `filled_unsent` and `browser_state` are dropped.
Citations checked 2026-10-18; `crates/kalsa-browser`, `src-tauri/src/browser` and `BrowserConfirm.tsx` have
uncommitted edits from another stream: re-check line numbers before editing.

## 0. Decided (not open)
- The app's own record is the only source for the turn-end line. No sidecar state, no host-only tool.
- The forced continuation is out of the build. A flag and measurement could bring it back later, behind a
  fallback that is a fixed fact, never a nudge.
- Blocking happens only on native invalidity. Blanks are listed on the card and never block.
- A failed action is not run again in the same turn unless the page has changed since (section 2b).

## 1. Facts this plan rests on (verified on disk)
- `toolLoop.ts:109-112` noteRun records every run; `:200` text-only end returns silently; `:255-275` runs every call of
  a round serially; `toolCalls.ts:31` 16 calls per round.
- `runToolCall.ts:24-29` CallAnswer = {result, wire}; `:113` a Stop throws `aborted`; `:120` consumes `ok` only.
- `registry.ts:242-244` browser_open normalization; `:307-311` coded refusal text returned raw; `:317` catch-all.
- `browserCall.ts:64` wraps only a successful invoke in the fence; `:147` same for resume.
- `types.ts:29` `resultCode?: string` (open); `store.ts:295` persists any string.
- `host.rs:383-384` `is_error` → `BrowserError::Refused`, sidecar text dropped; `error.rs:98-101` generic copy, Failed says "try again".
- `session.rs:208` ANSWER_FAILED says "try again".
- `submit.rs:84` submit listener (capture); `submit.rs:239` Submission has no form or submitter identity.
- `input.rs:39-41` every write Enter can set off is non-GET and goes through the hold; `:93` CLICK_BODY; `:168` click; `:188` fill; `:201` Enter.
- `hold.rs:39` EXPIRY 300 s; `:53` Card; `:116` Outcome (Sent carries host only); `:384` hold(); `:421` take_outcomes; `:752` MAX_HELD 8.
- `mcp.rs:632` click; `:669` type_into; `:824` label::apply (card fields only).
- `confirm.ts:188` takeOutcomes; `:281` browserOutcomesNote (wording: "the person was asked… and answered" — not reused).
- Drains: `useChat.ts:893`; `phoneTurn.ts:195-198`. Phone: `:213` loop, `:280-283` abort → sink.fail.
- `BrowserConfirm.tsx`: working tree drops `Where` and shows `field.label ?? field.name` (security review).
- httpbin `forms/post`: three `<input type=radio name=size>`, no `required`.
- Not verified: the owner's device-log error text for (b).

## 2. Design

### 2a. (a) A line built from what Kalsa did, at every turn end
The app keeps its own record for the turn: the `ToolRun`s from `noteRun`, with `state` and a `resultCode` from the closed
enum (2d); the `held` code on a click or type that raised a card; and the outcomes drained for the conversation.

`browserRecap(record)` (new, pure, `chat/src/lib/browser/recap.ts`) returns one line of fixed copy, from the five tables:
- opened: the host of the URL Kalsa opened (our parse of the call's argument);
- typed: count of successful `browser_type` runs;
- clicked: count of successful `browser_click` runs;
- held: count of `held` codes with no outcome yet, "in attesa della tua risposta";
- sent / declined / expired: from `Outcome` for this conversation; `sent` names the host;
- stopped: runs with the stopped state.
Examples: "Kalsa ha: aperto httpbin.org · scritto in 3 campi · nessun clic";
"… · cliccato 1 volta · 1 invio in attesa della tua risposta"; "… · inviato a httpbin.org".

When it renders: at the turn boundary, after the loop returns or throws, so a Stop gets it too (`runToolCall.ts:113`,
`phoneTurn.ts:280-283`). It renders only when at least one browser run happened. It is the last line of the turn on the
desktop and in the phone's final event.

For the model: the same string goes on the next user message as a note, through the existing drain. It replaces
`browserOutcomesNote` (`confirm.ts:281`), whose wording is retired, so there is one formatter.

Why it cannot be false: every count is a run Kalsa executed. A request the page sends by itself is held by the route
(`input.rs:39-41`), so every sent request has an outcome. No page state is read, and a promised click that did not happen
shows as "nessun clic". Limit: it says what Kalsa did, not what the page did; a form filled and left alone shows as
"scritto in N campi" with no send, and that is the fact.

| option | verdict |
|---|---|
| sidecar `filled_unsent` flag | dropped: not bound to conversation or document; not consumed; lost on Stop or reload; not provable |
| forced continuation | out (section 0) |
| regex on prose | rejected: five languages, and prose is what we do not trust |
| **the app's own record, fixed copy** | **chosen**: the app saw every fact it states |

Person sees: one line at the end of a browser turn. Copy in five tables, plural forms as functions, as `moreWaiting` does.

### 2b. (b) A ledger on normalized actions, error codes carried back
Bridge, end to end:
1. sidecar: refusals and failures carry a stable code in `structured_content` (the mechanism of `view.rs:30-34`);
2. `host.rs:383-384` stops collapsing: the code and the sidecar's sentence travel;
3. `browserCall.ts:64` fences every sidecar text, success and coded refusal, so `registry.ts:307-311` never returns raw page text;
4. `registry.ts:307-317` returns `{text, ok: false, resultCode}`; `runToolCall.ts:24-29, :120` CallAnswer gains `failed` and `code`;
5. `toolLoop.ts:255-275` consumes them.

Key: `normalizedAction(name, args)`, extracted from `registry.ts:242-244`. browser_open → trimmed URL without fragment;
click → trimmed ref; type → trimmed ref and untrimmed text; read → whole page number. Key = name + normalized object,
sorted keys. Schema repair drops extra properties before the key is built.

Rules, per turn (decided):
- Same round: a duplicate reuses the first result; the tool runs once.
- After a failure, the same key is refused with the code's copy. There is no automatic retry, of any kind.
- The ledger is cleared when a page is opened or read successfully, because refs are only valid until the page changes.
- A key refused twice in a row ends the turn with `browserNotOpened` (code copy). No further model words.
- An unclear write is never run again.
- More than 4 browser calls in one round: the rest are refused with `tooManySteps`.

Person sees: "Kalsa non è riuscita ad aprire quella pagina: <reason by code>." once, and the recap line.

### 2c. (c) Request identity, native validity, blanks on the card

**c1 — duplicate by identity, not URL.** Identity = conversation + document generation + form path + submitter.
- The sidecar bumps a document generation on every navigation and load. Pending card with the same identity: the new
  submit is not held and gets "already waiting for the person's answer: awaiting confirm <id>. Do not send it again."
- The catcher records the form path and the submitter (path, name, type: `event.submitter`, `input[type=image]`).
  Implicit Enter submission has no submitter: "implicit". `Submission` (`submit.rs:239`) gains `form` and `submitter`.
- Decline or expiry removes the pending card; the next submit of the same identity is held again. A changed value while
  pending is refused until answered or expired (`hold.rs:39`).
- Test: decline, then resubmit → held.

**c2 — native validity blocks, and only that.**
- Checked before click (`input.rs:93`, `:168`) and before Enter (`:188`, `:201`).
- Runs only when the form does not have `novalidate` and the submitter does not have `formnovalidate`.
- If a control the browser validates is invalid (`willValidate` true, `validity.valid` false): no click, no key. The answer
  names the labels, fenced. Custom JavaScript validation is out of scope: the sidecar cannot see it, and the card and the
  copy say nothing about it.

**c3 — blanks are listed on the card, never block.** A blank is, among the controls in the submitted form that are visible,
enabled and not readonly: a text-like input (text, search, email, url, tel, number), a textarea, a select whose value is
empty, or a radio group (same name) with nothing checked. Not counted: checkbox, hidden, file, button, contenteditable.
Optional fields are listed too, never refused.
- The card gets a `blank` list (`hold.rs:53` gains a field). The window draws "Campi vuoti: …" (five tables).
- Precondition, from the security review of `BrowserConfirm.tsx`: restore the `Where` line (method, full address, query
  values masked) and `hideQueryValues` from commit 395a1a59; show `field.name` always, with the page label beside it; list
  every field sent, empty ones included, or state how many were omitted. Not rebuilt.

| option | verdict |
|---|---|
| block whenever a field is blank | blocks optional fields |
| never refuse; list only | the model never corrects itself |
| LLM judges "required" | rejected: a model judging a model |
| HTML5 only | misses radios with no `required` (httpbin) |
| **native validity blocks; blanks on the card** | **chosen, decided** |

Person sees: one card per form (c1); "Campi vuoti" on the card (c3); a plain refusal line for invalid fields (c2).

### 2d. Cross-cutting: codes, fences, host strings
- **Codes are a closed set.** A TypeScript union `BrowserCode` in `chat/src/lib/browser/codes.ts`. `store.ts:295` persists
  only members (`types.ts:29` stays a string on the wire; unknown → `browser.unknown`). Copy is keyed by code, never by text.
- **Fences.** Every sidecar text is fenced, success or refusal, in `browserCall.ts` (`:64` and the catch). Labels in
  error text are page text and reach the model only inside the fence.
- **Host strings** are display-only: our parse of a URL, length-capped, rendered as text nodes, never used as a code.

## 3. Files
- `chat/src/lib/browser/recap.ts` (new) — `browserRecap`. `chat/src/lib/browser/codes.ts` (new) — `BrowserCode`.
- `chat/src/lib/callLedger.ts` (new) — `normalizedAction`, key, failure and clear rules.
- `chat/src/lib/toolLoop.ts` — ledger at `:255-275`; per-round cap; no change to the silent end (the recap owns it).
- `chat/src/lib/runToolCall.ts:24-29, :120`; `chat/src/lib/tools/registry.ts:242-244, :307-317`; `chat/src/lib/tools/browserCall.ts:64`.
- `chat/src/lib/browser/confirm.ts:281` — `browserOutcomesNote` removed; `:188` drain unchanged.
- `chat/src/surfaces/useChat.ts:893` and `chat/src/lib/phone/phoneTurn.ts:195-198, :280-283` — recap at turn end; note on next turn.
- `chat/src/lib/chat.ts:134-143` and `chat/src/i18n/{en,it,fr,es,zh}/tools.ts` — recap copy, `browserNotOpened`, `tooManySteps`, `notSent`.
- `chat/src/components/browser/BrowserConfirm.tsx` (+ `.css`) — `blank` list; restored `Where`; name always visible.
- `crates/kalsa-browser/src/submit.rs:84, :239` — identity fields. `input.rs:93, :168, :188, :201` — validity check.
- `crates/kalsa-browser/src/mcp.rs:632, :669, :824` — codes, duplicate and invalid answers.
- `crates/kalsa-browser/src/hold.rs:39, :53, :116, :384, :421, :752` — EXPIRY, Card.blank, Outcome, dedupe, outcomes, cap.
- `crates/kalsa-browser/src/view.rs:13-34` — coded refusals. `src-tauri/src/browser/host.rs:383-384`, `error.rs:98-101`.

## 4. Tests and measurement

**Offline:** `chat/scripts/tool-stall.mjs` (pattern of `tool-refusal.mjs`: `loadApp`, stubbed fetch with SSE rounds, stubbed
browser invoke). Cases: (1) fill, no send → recap says "scritto in N campi"; (2) no fill, promised click → "nessun clic";
(3) fill, submit held → "1 invio in attesa"; (4) Stop mid-click → recap shows stopped; (5) six identical `browser_open`
with one code → one run, the rest refused, turn ends with `browserNotOpened`; (6) a read between two identical clicks clears
the ledger; (7) two identical clicks in one round → one run; (8) an unclear write is never retried; (9) plain chat → no recap;
(10) armed phone → no writes, recap unchanged.

**Rust, targeted:** `crates/kalsa-browser/tests/form.rs` on the `tests/common` fixture: same identity → one card; decline
then resubmit → held; different forms, same endpoint → two cards; generation bump → new card; native-invalid → no card,
labels in the answer; `novalidate` and `formnovalidate` → no check; optional blank → card with the list; Enter and
`input[type=image]`. Run: `cargo test -p kalsa-browser --test form > /tmp/form.log 2>&1; echo $?`. Use a clean base:
the tree has another stream's edits.

**Lab adapter (replaces the current lab for this question):** `dev/lab-browser/app-adapter.mjs` bundles the real
`streamChatCompletion` and `executeToolCall` through `chat/scripts/lib/app-bundle.mjs`, uses `BROWSER_TOOLS`
(`browserTools.ts`), stubs `available()` to true and routes `brain_browser_*` to the real `kalsa-browser` crate
(`dev/lab-browser-rs`, extended to take app tool names). Same fixture for both flags (`--recap on|off`). The current lab
(its own tools, its own loop, prose credited) is not evidence for this plan.

**Before and after, on Qwen 3.6, Gemma 12B, Gemma E4B:** a form-submit task (fixture and httpbin) and read-only tasks.
Measure: turns where the page was filled and the recap is missing (must be 0); held writes per form (1); repeated failing
calls per run; recap correctness against the fixture's real request log; added tokens and latency.

## 5. Risks
- **Recap accuracy depends on the record.** Anything Kalsa did but did not record shows as missing. Mitigation: the
  recap test compares it with the fixture's request log.
- **Dedupe refuses a legitimate second submit** of the same form while pending. Intended; expiry is 300 s.
- **Ledger clears on any successful read.** A model that reads between failures is re-trying on a new page: allowed.
- **Custom JavaScript validation** is not seen; a page that blocks in JS shows "scritto in N campi" and no send. Stated, not fixed.
- **Blank list is a best effort.** Controls outside the form, or widgets that are not native, are not listed.
- **Model text never reaches the UI:** every person-facing line is fixed copy keyed by a closed code.
- **Lab/app divergence** until the adapter exists: no lab number counts for this plan before then.
