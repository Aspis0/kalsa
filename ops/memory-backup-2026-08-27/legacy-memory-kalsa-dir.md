---
name: legacy-memory-kalsa-dir
description: "La memoria storica del progetto (27 voci, sessioni fino all'11 ago 2026) vive sotto il project path della dir padre Kalsa — leggerla a inizio sessione"
metadata: 
  node_type: memory
  type: project
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-12T13:40:38.200Z
---

Le sessioni precedenti erano aperte da `C:\Users\gualt\Desktop\Kalsa` (dir padre), quindi la loro memoria vive in:
`C:\Users\gualt\.claude\projects\C--Users-gualt-Desktop-Kalsa\memory\` (indice: `MEMORY.md`, 27 voci).

Voci più rilevanti per moe-experiments:
- `use-grok-cheap-agents.md` — **direttiva HARD di gualt**: MAI subagenti Claude (reviewer/sonnet-coder/Explore/mechanic). Prima `Skill(cheap-agents)`: codice → Grok; review/esplorazione/meccanico → `pi -p --provider opencode-go` (TUTTO su opencode-go, il provider diretto deepseek è deprecato). Roster 2026-08-12: deepseek-v4-flash (default), luna-5.6-pro (il più forte ma si impalla: 1 retry poi hy3), hy3 (fallback), mimo-v2.5-pro (scarso, solo banalità). Il log vuoto di `pi` NON è un blocco (bufferizza fino alla fine; guardare report.md + CPU del processo). Questa direttiva PREVALE sulle regole agenti del CLAUDE.md globale.
- `s23-remote-control.md`, `s23-orchestrate-delegate.md` — controllo remoto S23 e stile di lavoro (orchestrare, non chiedere).
- `runpod-authorized.md` — RunPod senza conferma, spegnere a fine uso; mai numeri di performance.
- `android-rescueparty.md`, `protocol-rules-vs-physical-limits.md`, `kalsa-threads-finding.md`, `kalsa-jellystar-findings.md` — guardrail e lezioni device.
- `kalsa-moe-state-aug11.md` — stato campagna all'11/08 (ormai superato da PLAN.md, vedi [[moe-exp-recovery]]).

**Why:** la memoria è per-directory: aprire Claude in `moe-experiments` non vede quella scritta da `Kalsa`.
**How to apply:** a inizio sessione leggere anche l'indice legacy; per lo stato campagna fa fede PLAN.md (più fresco), per direttive di metodo (Grok/cheap-agents, S23, RunPod) fa fede la memoria legacy.
