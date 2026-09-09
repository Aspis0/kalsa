# SUBSET-24 — on-device G1 case subset (written rule)

Source: `corpus/cases.jsonl` (80 cases), **dev split only**, documents
excluded by declaration (library import is tested separately), no holdout.
Rule implemented in `make_subset.py` (single source of truth); `subset-24.txt`
and `subset-24.cases.jsonl` are its output.

## The rule

For each category, take ids in corpus order until the per-language quota is
met:

| category | quota | ids | lang | checks |
|---|---|---|---|---|
| conversation | 4 IT + 3 EN | C01 C02 C03 C04 C05 C06 C07 | it en it en it en it | exact, regex ×5, **rubric (C07)** |
| instructions | 4 IT + 7 EN | I01 I02 I03 I04 I05 I06 I07 I08 I10 I12 I14 | it en it en it en it en en en en | json_schema ×6, regex ×3, exact ×1, **rubric (I14)** |
| memory (multi-turn, 4 user turns each) | 2 IT + 2 EN | M01 M02 M03 M04 | it en it en | regex ×4 |
| tools | offline-capable only | T09 T11 | it it | device_toolcall (see below) |

Totals: 24 ids, **12 IT / 12 EN**, 22 deterministic + 2 rubric (C07, I14 —
blind rubric per RUBRIC.md, no tuning on holdout).

## Tool restriction (why 2, not 6 — measured gap, not an omission)

The quota "6 tools restricted to offline-capable tools (device_calc,
device_info, write_note, create_miniapp)" cannot be met from the dev split:
every dev tool case except T09/T11 declares a tool the APK does not expose
(`weather.get_current`, `calendar.create_event`, `reminder.create`,
`shipping.track`, `finance.exchange_rate`, `web.search`, `music.play` —
CORPUS.AUDIT.md T01–T16 already flags the name conflict). Of the app's four
offline tools, corpus coverage is:

- `device_calc` ← T09 (`calculator.calculate`, expression `18 / 3`) ✓
- `write_note` ← T11 (`notes.save`, title `Idee weekend`) ✓
- `device_info`, `create_miniapp` — **no corpus case exists** ✗
- **no EN offline tool case exists** ✗ (T10 EN is `web.search`; not offline)

The four missing EN tool slots are re-allocated to the first four EN
**instructions** ids in corpus order (I08, I10, I12, I14): deterministic
one-turn format cases. Deviation from the 7/7/6/4 structure is 2 extra
instructions + 4 missing tools, on both sides of the IT/EN balance; recorded
here so the comparison cannot silently shift category weights.

## On-device tool contract (adaptation)

`subset-24.cases.jsonl` keeps the corpus id/lang/category/turns, and for T09 /
T11 replaces `tools` + `check` with the app contract:

- prompt: corpus text unchanged (T09 already names the calculator and the
  exact `expression='18 / 3'`; T11 the note title/body);
- expected call: `app_tool` = device_calc / write_note, checked from the
  per-turn `KALSA_TOOLCALL` logcat line (`toolNames` contains the name and
  `executed ≥ 1`). Argument equality is **not** verifiable on-device: tool
  telemetry is privacy-safe by design (`toolCallTelemetry.ts` — names and
  counters only, never arguments). Declared limit, not a silent check change.
- the corpus `json_schema` payload (fictional `tool_name` const) is not
  applied on-device; row `adaptation` records the reason per case.

## What each case measures on-device

- conversation C01–C06: language/idempotence (exact/regex) — C07 rubric.
- instructions: format adherence (JSON object/array, Markdown checklist and
  two-column table, exact hour format) — the product surfaces these in chat
  rendering, so raw model text is what is scored (same as the Mac runner).
- memory M01–M04: 3 filler user turns between the to-remember fact and the
  question (conversation stays open; KV reuse is exercised across turns, and
  each new share delivery re-enters the app through the share path).
- tools T09/T11: tool selection + execution evidence in the APK.
