> Archived full history: archived/ALIVE-2026-09-full.md (7773 lines, mixed IT/EN, frozen 2026-09-20).

# Kalsa: ALIVE (living measured state)

Owner decision 2026-09-09 (recorded at `archived/PLAN-2026-09-full.md:1`): two living documents
only, `PLAN.md` and this one. The full diary
(every dated cell, table row and verdict to 2026-09-20) is in
`archived/ALIVE-2026-09-full.md`. This file keeps only the short measured state and the pointers
to the records.

## How to read this file

Each row names what is proven and the artefact that proves it. Nothing here is a summary of a
summary: where the record is a dated document, this file points at the document and does not
restate its numbers. Numbers that move under concurrent work are not copied here; the command or
document that produced them is named instead.

## Proven, with the record

| what | record |
|---|---|
| The engine pin the app ships is `llama.rn@0f313bab` → `kalsallama` `8537d097c` (`b11010-merge`), and the q4_K MoE OpenCL mask fix is inside it | `PLAN.md`, "The q4_K MoE OpenCL fix is in the shipped engine"; `vendor/VERSIONS` at `0f313bab` |
| The migration to upstream's `vendor/` layout: the measured upstream bump, the gates, the repaired consumers | `analysis/FORK-VENDOR-MIGRATION.md` |
| ciswire char-3-gram retrieval: recall, KV and prefill behaviour, and device thermal on S23 and Jelly | `analysis/CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md` |
| Xiaomi/Qwen: the fit-gate vision refusal, the ciswire char-vs-token overflow, and what did run | `analysis/XIAOMI-QWEN-FITGATE-AND-CISWIRE-TOKEN-OVERFLOW-2026-09-20.md` |
| The governor KV session contract (deferred commit, watermark, invariants) | `analysis/README-governor-kv-contract.md`; the `file:line` pins in its header are stale, so re-pin before quoting |
| How to run the Qwen `<think>` replay probe | `analysis/README-qwen-think-replay.md` |
| The governor device plan, rewritten in English on 2026-09-20, and the audited Italian body | `analysis/GOVERNOR-DEVICE-PLAN.md`; `archived/GOVERNOR-DEVICE-PLAN-2026-09-audited.md`; re-verification at `scratchpad/agents/governor-audit-recheck/REPORT.md` |
| Per-cell preregistration, raw evidence and reports | `scratchpad/agents/<cell>/` |
| Measurement method and rules for the lab | `PLAN.md`; `README.md` in this repo |

## Standing cautions

- The governor plan was re-verified and rewritten on 2026-09-20. It states its sourcing rule and
  applies it: every number carries an artefact citation or an explicit UNSOURCED label. The audited
  Italian body is archived byte-for-byte and is not a current source.
- The `README-governor-kv-contract.md` line pins were written against older trees and no longer
  match the current commits; re-pin before quoting a `file:line`.
- A device number is only as good as the phone state it was read in. The archived diary carries
  the per-run provenance, including the thermal and DSP-daemon caveats that travel with every S23
  number.

## The full diary

`archived/ALIVE-2026-09-full.md`, 7773 lines, English narrative with Italian table rows, frozen
2026-09-20. Read it from the tail. `archived/PLAN-2026-09-full.md` holds the matching plan
history.
