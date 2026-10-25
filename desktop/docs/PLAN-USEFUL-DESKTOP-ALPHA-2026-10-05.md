# Plan — a useful desktop for the alpha (2026-10-05)

Owner, 2026-10-04 night: alpha only; top = mini apps on the desktop; do not
overengineer; stay close to the phone app; use the stronger PC models (Gemma E4B, Q8 where the
machine carries it).

The principle, from the receipts lab: **the model proposes, the code decides.** A small model picks
a template and fills bounded slots; code validates, computes and renders. The model never writes
HTML, never does arithmetic, never invents a UI.

## Where we are (read on disk 2026-10-05)

- The phone (origin/main) has `create_miniapp`: six templates (compare_data, quick_calculator,
  reading_quiz, kpi_strip, checklist, pros_cons), slot validation in
  `src/domain/miniappBuilders*.ts`, a no-eval calculator (`miniappCalculator.js`), the
  `miniapp_v1` normalizer (`askAssistant.js`). The domain half is plain TS/JS; the renderer
  (`AskAssistantMiniappRenderer.tsx`, React Native) is not portable.
- The six templates produce five block types: `data_table`, `calculator`, `quiz`,
  `metric_strip`, `timeline`.
- The desktop chat offers only `web_search` / `web_fetch`, behind the owner's switch
  (`chat/src/lib/tools/registry.ts` `offeredTools`). Tool results are text; there is no rich
  result path (`chat/src/components/Thread.tsx` renders `ToolActivity` + Markdown).
- The Room AI turn has no tools and replies in plain text (`crates/kalsa-door/src/room/turn.rs`,
  `docs/ROOM-PROTOCOL.md` `ai_message`). Unknown fields are ignored by clients.
- Gemma 4 E4B ships as **Q4_K_M with `q8: None`** (`crates/kalsa-catalog/src/manifest.rs`). The
  Q8 rule (≥200 GB/s, same gates) exists in `q8.rs` but E4B has no Q8 file to swap to.
- Lab numbers: small LFM models call tools well when needed (100%) but over-call when not
  (37.5–43.8% restraint, `docs/LAB-LFM-TOOLS-2026-10-04.md`). The receipts lab: LFM VL-3B reads
  totals but not long digit strings; validators catch it (it says UNSURE) — useless as an extractor,
  safe as a total-reader. Gemma result pending.

## Steps

### 1. Mini apps in the desktop chat (tonight)

Port, do not invent:
- copy the phone's domain modules (builders, calculator, normalizer, template ids) into
  `chat/src/lib/miniapp/`, same behaviour, same tests ported;
- `create_miniapp` in the desktop tool list, same schema and description as the phone; it runs
  locally (no network), so it is offered whenever the desktop app runs, independent of the web
  switch — the switch is about traffic leaving the machine;
- the built `miniapp_v1` rides on the tool run and is stored with the conversation;
- a small web renderer for the five block types, in the chat's own look; the calculator evaluates
  through the ported parser, never `eval`.

The model reads a short text summary as the tool result, as on the phone.

### 2. No Gemma E4B Q8 row

The chooser never serves E4B at ≥200 GB/s: at that bandwidth every machine with room for an 8 GB
E4B already gets Gemma 12B or bigger (grid run 2026-10-05, with `--lower-bound` for discrete GPUs).
A Q8 variant would be downloaded by nobody.

### 3. Measure restraint, then decide

A short lab on the Lenovo: the same no-tool / tool-needed prompts with `create_miniapp` offered,
LFM VL-3B vs Gemma E4B. If the weak model over-calls it, tighten the description ("only when the
person asks for a table, calculator, quiz, checklist, KPI strip or pros/cons") before shipping.

## Not in the alpha

CisWire on the desktop; receipts extraction as a feature (lab says LFM cannot read IBAN/P.IVA;
revisit with Gemma's numbers); miniapps inside the Room; translations.
