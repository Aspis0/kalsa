# LAB CALENDAR — 2026-10-05 — LFM2.5-VL-3B vs Gemma 4 E4B at calendar tools, "the model proposes, the code decides"

Lab measurement for the question: **can the two PC models drive calendar tools
correctly, and if LFM cannot, what makes it able?** Both models, the app's own
pinned files and argv (as in the receipts lab), one headless engine at a time
on the Lenovo (vulkan `kalsa-server` v1.1.5, RTX 4050 pin, hidden launch — the
receipts lab's finding about visible console windows applied throughout; zero
engine deaths this session). Temperature 0 in every request; Gemma ran with
`chat_template_kwargs {"enable_thinking": false}` (its thinking channel
otherwise eats the generation budget — receipts lab v2). Executors are mocks:
nothing touched a real calendar.

**Verdict, stated plainly: neither model is correct at ISO-date arithmetic
under the plain tools, and the relative-date schema (condition C) is what
makes both able — it moves the arithmetic into code.** For **LFM2.5-VL-3B**,
the plain tools fail in two named places: **wrong-day silent errors** (5 of 9
scored read windows confidently wrong — "cosa ho domani?" from Monday
2026-10-05 produced `fromISO 2026-10-11`, five days late; "martedì" anchors to
today's Monday) and **tool-choice confusion** (on 7 of 15 create requests it
called `calendar_agenda` instead of creating; 16 `web_search` calls across 48
items, 8 of 10 no-tool controls searched). Under C its field-exact creates go **5/15 → 7/15** (A and B are both 5)
with **zero silent create errors** and its reads improve to 5 covers + 5
wrong. For **Gemma 4 E4B** the plain tools fail differently: it **over-asks**
— 11 of 15 create requests became a clarifying question instead of a call,
and the 2 creates it did make were both silently wrong (field-exact **0/15**;
the Wednesday-for-Tuesday bug: "martedì" → 2026-10-07). Under C Gemma goes
**from 0/15 to 7/15 field-exact creates** with **zero silent create errors
and zero UNSURE**, and its read windows hold (4 covers incl. the
DST-switch day). **The answer to the owner's question:
LFM cannot drive the plain ISO tools reliably — C is what makes it able, and
it makes Gemma better too. The one thing C did not fix is tool CHOICE: LFM
still reads instead of creating and still over-searches, because C changed
the create tool's parameters, not the model's decision.**

## Method

**Tools offered** (OpenAI `tools` array, native calling through the engine's
chat template — the fork serves these without `--jinja`, per the tools lab):
`calendar_agenda` **verbatim** from the phone
(`origin/main:src/agent/calendarTool.ts` `CALENDAR_AGENDA_TOOL`, fromISO/toISO
required); `web_search` **verbatim** from the desktop
(`chat/src/lib/tools/definitions.ts`) as a distractor; `create_calendar_event`
**new**, written in the phone's style — `{title, start, end, allDay,
location?}`, required `[title, start, end, allDay]`, "when the person does
not say an end, make the event one hour". Condition C replaces only the
create tool with a relative-fields variant: `{title, day: enum [today,
tomorrow, monday…sunday, date], date?: YYYY-MM-DD, week: enum [this, next],
time: HH:MM, durationMinutes, allDay, location?}` — **the model fills
relative fields, code computes the ISO instants** (`relative.mjs`).

**The clock and the date.** "Now" is fixed at Monday 2026-10-05 10:00
Europe/Rome (+02:00). The system prompt is the desktop's `promptBytes(false)`
verbatim plus one line with that clock. The phone passes the clock
differently — a `device_info` **tool** (`origin/main:src/agent/deviceTools.ts`,
"Local device clock, UI locale, and battery percent"); this lab mirrors the
desktop (no such tool) with the system line, per the lab's design.

**Items, 48** (23 Italian, 25 English as sent — odd ids Italian, even
English, even within each kind): 13 read, 15 create, 6 clarify, 10 no-tool,
4 traps. **Every ground truth is computed by code from the fixed now**
(`now.mjs`, `items.mjs`) — never by hand. Declared rules: weekday names mean
the next occurrence strictly after today; "this week" = Monday..Sunday of the
current week; "the weekend" = coming Saturday..Monday; an unspecified year is
the current one; an unspecified end = start + 60 minutes; a create with no
time and no all-day marker is a clarify. **"venerdì prossimo"/"next Friday"
(r03) is genuinely ambiguous** (Oct 9 or Oct 16): both windows are accepted,
declared here. **DST**: Rome switches at 03:00 local on 2026-10-25; the
offset is computed per local date-TIME (2026-10-25T00:00 is +02:00,
2026-10-25T03:00 is +01:00), so r13's window spans the switch
(`2026-10-25T00:00:00+02:00` → `2026-10-26T00:00:00+01:00`). GT for the
DST-adjacent items:

| item | expected |
|---|---|
| r03 | Oct 9–10 **or** Oct 16–17 (both accepted) |
| r06 | 2026-10-26T00:00+01:00 → 2026-10-27T00:00+01:00 |
| r12 | 2026-10-30T00:00+01:00 → 2026-10-31T00:00+01:00 |
| r13 | 2026-10-25T00:00**+02:00** → 2026-10-26T00:00**+01:00** |
| c11 | call Oct 27 15:00–16:00 **+01:00** |
| c15 | pulizia dei denti Nov 5 10:00–11:00 **+01:00** |

**Offset-less ISO is a valid call.** The phone's executor parses with
`new Date(raw)` (`calendarAgenda.ts` `parseIsoDate`), which reads an
offset-less string as **device-local** time; the harness mirrors that
(offset-less = Rome-local) and counts "no offset" separately. Titles match
leniently (case, articles stripped, containment or a shared ≥4-char token),
per language (`Dentista`/`Dentist`), and are outside the silent-error rule.

**Conditions.** A = plain tools. B = A + code validators (ISO parses,
end > start, the calendar date exists, within ±400 days of now, and when the
item NAMED a weekday — a lexical fact, not ground truth — the date IS that
weekday) with ONE named re-ask, then UNSURE. C = the relative schema; code
computes the instants and validates them the same way. The smoke's harness
fixes, all verified by re-run: the DST date-TIME offset (r13 was one hour
wrong), offset-less acceptance (Gemma's C reads no longer re-asked on a
harness artifact), per-language titles + the c12 prompt ("commissioni", not
"shoppers"), r03's two windows, midnight rollover for computed ends
(23:30+60 → next day 00:30), covers-width reporting, and a nameless
`tool_calls` stub counted as no call (Gemma emits one beside text answers).
C's `week: "next"` table, printed and checked — note **Monday**: the
next-occurrence rule cannot reach today, so this/next Monday are both
Oct 12:

| weekday | this | next |
|---|---|---|
| monday | 10-12 | 10-12 |
| tuesday | 10-06 | 10-13 |
| wednesday | 10-07 | 10-14 |
| thursday | 10-08 | 10-15 |
| friday | 10-09 | 10-16 |
| saturday | 10-10 | 10-17 |
| sunday | 10-11 | 10-18 |

Runs: 48 items × 3 conditions × 2 models = 288 exchanges plus re-asks, every
request/response kept as one JSON line (`/tmp/lab-calendar/lfm-full.jsonl`,
`gemma-full.jsonl`; smokes beside them). Native tool calls are NOT
grammar-constrained — **required-field omissions are counted per model**
(Gemma omitted the required `allDay` on its A-condition creates).

## Results

### LFM2.5-VL-3B Q8_0 (48 items per condition; s/item 0.8–1.2)

| | tool choice | silent errors | windows | creates (field-exact = start∧end∧allDay) |
|---|---|---|---|---|
| A | reads 9/13 right; creates right-tool 7/15, **7 agenda-for-create**, 1 search; clarify asks 1/6; traps 3 call-where-ask; **8/10 no-tool searched** | **10** (5 wrong windows, 2 wrong creates, 3 trap calls) | 4 covers, **5 wrong** (2 covers wider than the ask: r02 7d, r04 2d) | **5/15**; title 7r/8w, start 5r/10w, end 5r/10w, allDay 7r/8w; 0 omitted |
| B | identical to A (validators repair nothing the model will not redo) | 8 | identical | identical (**5/15** field-exact); 0 UNSURE |
| C | reads 10/13; creates right-tool 8/15, 7 agenda-for-create; traps 4 call-where-ask | **6** — see the breakdown below | 5 covers, 5 wrong (3 wider: r02 7d, r04 2d, r07 7d); 1 offset-less | **7/15 field-exact, 0 silent creates**; title 7r/8w, start 7r/8w, end 7r/8w, allDay 7r/8w; 1 UNSURE |

Named failures, quoted: **"cosa ho domani?" → `fromISO
"2026-10-11T00:00:00+02:00"`** (five days late, delivered confidently); the
trap **"metti una cena il 31 novembre alle 20" → `create_calendar_event
{"start":"2026-11-31T20:00:00+02:00","end":"2026-11-31T22:00:00+02:00"}`** —
a date that does not exist, confidently proposed (B/C validators refuse it);
`web_search` called for "quanto fa 17 per 24?" and 15 other items.

**LFM's six silent errors in C, honestly broken down:** **3 are wrong-DAY
errors** — r01 ("domani" → Oct 11, a Sunday, five days late), r03
("venerdì" → the same Oct 11), and the trap t04, where "il 32 ottobre" was
silently rolled to `calendar_agenda 2026-10-31T00:00:00+02:00` (wrong day,
wrong tool, and a trap let through). **2 are one-hour OFFSET errors around
the DST switch** — r06 read the right dates (Oct 26–27) but stamped both
bounds `+02:00` where Rome is `+01:00` after the switch, and r13 got the
start right but ended `2026-10-26T00:00:00+02:00`, one hour late. **1 is
harness strictness, not a model error** — r09 ("oggi pomeriggio") was
answered 12:00–17:00 against a strict 12:00–23:59 ground truth; a
five-hour "afternoon" is a plausible reading, and we score it wrong only
because the GT says so.

### Gemma 4 E4B Q4_K_M (enable_thinking:false; 1.5–2.3 s/item)

| | tool choice | silent errors | windows | creates |
|---|---|---|---|---|
| A | reads 6/13 right + 6 asks; creates **2 calls, both silently wrong (0/15 field-exact), 11 asks**, 1 search, 1 no-call; clarify 6/6 asks; **traps 4/4 asks**; no-tool 8/10 | **5** (3 wrong windows, 2 wrong creates) | 3 covers, 3 wrong; 2/6 offset-less | **0/15 field-exact**; title 2r/13w, start 0r/15w, end 0r/15w, allDay 1r/13w/**1 omitted (required!)** |
| B | same shape; 1 trap answered as text instead of an ask | 4 | identical | +1 UNSURE |
| C | reads 6/13 + 5 asks; **creates 7/15 field-exact, 7 asks, 0 silent**; traps 4/4 asks; no-tool 7/10 | **2** (2 wrong windows) | **4 covers** (r06, r12, r13 incl. the switch day), 2 wrong; **6/6 offset-less** | **7/15 field-exact**; title 7r/8w, start 7r/8w, end 7r/8w, allDay 7r/8w; 0 omitted; 0 UNSURE |

Named: the **Wednesday-for-Tuesday** silent create ("metti dentista martedì
alle 15" → `2026-10-07T15:00:00+02:00`). Its over-asking is a specific,
quotable behaviour: **with the clock line sitting in the system prompt it
still asks for the date it was given** — "What date is tomorrow?" (c02),
"a quale data si riferisce 'giovedì'" (c03), "avrei bisogno di sapere la
data di domani" (c05) — on 11/15 creates and 6/13 reads in A. It does not
use the date it was handed. C fixes creates for the plainest reason: **the
code resolves the date, and the model only names the relative day**. The
obvious next measurement (unmeasured here): a D condition with the date in
the USER turn, or an explicit "resolve relative dates yourself, assume the
current year" system line, or the phone's `device_info` tool — whether any
of those makes Gemma use the clock it already has. Its clarify discipline is
otherwise perfect in every condition (it asks rather than guesses — 33 asks
across A), and it caught all four traps by asking, in every condition. C
read windows are all offset-less (valid, counted separately) and include
both DST items.

### What C did not fix

Tool choice. LFM still calls `calendar_agenda` on create requests (7/15 in C
too) and still searches where no tool is warranted (15 `web_search` calls in
C). The relative schema changed what the model must COMPUTE, not WHICH tool
it picks — a harness cannot fix that with a schema; it would need the
model-proposes shape to include the intent, or a router.

## Raw data

`/tmp/lab-calendar/` on the Mac: `lfm-full.jsonl`, `gemma-full.jsonl` (144
lines each — every request body, both calls, usage, verdict), the four smoke
files, `run-*.log`. Lenovo: `C:\kalsa-bench\lab-calendar\` holds the two
engine logs (hidden launchers `lab-cal-lfm.ps1`, `lab-cal-gemma.ps1` in
`C:\kalsa-bench\`). Harness: `dev/lab-calendar/` (9 files — now, tools,
items, engine, validators, relative, score, run, summarize).

## UNMEASURED

- A second seed per item (temperature 0, but batching state is not
  bit-determinatic); phone-side behaviour of the same tools (this lab drives
  the engine directly, not the phone's executor); `calendar_agenda`'s
  second-round behaviour with real results fed back (executors are mocks).
- "Cosa ho oggi pomeriggio?" (r09) scored against a 12:00–23:59 window — a
  narrower "after now" reading is defensible; both models' outcomes on r09
  are in the raw files either way.
- Whether a tools-array WITHOUT web_search changes LFM's create-tool
  confusion (the distractor was present in every condition, per the design);
  whether an intent enum ("read"|"create") in a router layer fixes the
  agenda-for-create class — proposed, not measured.
- Gemma's 11 create-asks in A were not audited one by one for whether the
  ask was the minimal clarification (the scorer accepts any question-shaped
  reply with no call).

## Cleanup

Both engines killed by exact PID after their runs (0 kalsa processes at the
end); every scheduled task (`KalsaCalLFM…/KalsaCalGemma…`, six in all across
smoke and full runs) deleted within seconds of `/Run` and confirmed gone;
tunnels closed. Left in place: `C:\kalsa-bench\lab-calendar\` (engine logs)
and the launchers. One commit; no push; no product code touched.
