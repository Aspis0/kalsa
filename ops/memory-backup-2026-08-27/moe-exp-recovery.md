---
name: moe-exp-recovery
description: Come recuperare lo stato del progetto moe-experiments a inizio sessione (PLAN.md STATO CORRENTE + registro + logs in-flight)
metadata: 
  node_type: memory
  type: project
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-21T18:59:43.011Z
---

Progetto Kalsa/moe-experiments (MoE 35B da flash su Galaxy S23 8GB, fork BigMoeOnEdge).

**Procedura di recovery a inizio sessione (struttura post-secondo-sfoltimento 2026-08-20):**
1. `PLAN.md` (root repo, ~1500 righe): a riga 15 **⭐ STATO CORRENTE — vista compatta** (~170 righe: dove siamo in una frase, capitoli trans4/K2/qk23 chiusi, oomwall, audit upstream, fatti operativi, coda aperta numerata 1–16, correzioni a verbale) — è LA vista, basta quella per orientarsi. Engine head = tag kalsakernel-v4 (`ec7235af`) su kalsa/kernel-s3-repack. Seguono TL;DR lanes, scheda prodotto, regole operative, §8 telemetria.
2. Il **Registro checkpoint** in coda a PLAN.md (~riga 657+): voci recenti, più recente in cima — leggere le prime 1-2. Lo storico è in `PLAN-archive.md` (⚠️ minuscolo, GitHub è case-sensitive): PARTE I = piano V1 + checkpoint ≤11/08; **PARTE II (da ~riga 4737) = la cronaca integrale di STATO CORRENTE fino al 20/08** (l'intera saga trans4, verbatim). Non leggerlo se non per archeologia. Regola: nuovi verdetti si appendono alla vista compatta; oltre ~300 righe si archivia di nuovo in coda a PARTE II.
3. Lavoro in-flight: guardare `logs/` per mtime recenti (`ls -lt logs/ | head`) — i run lunghi girano detached con `.pid.txt`; i risultati vivono in `results/<fase>/` e ogni fase ha un report in `reports/moe-*.md`. Verificare i PID degli agenti detached, non solo i watcher (vedi [[watchers-verify-pid]]).
4. Il PC può spegnersi/riavviarsi durante i run notturni (successo 2026-08-12: rc 0x40010004 / 0xC000026B = logoff): esistono script `resume_*.ps1` in `scripts/`.

**Why:** senza questa mappa ogni recovery ricomincia da zero; prima dello sfoltimento PLAN era 400KB e superava il limite di Read.
**How to apply:** Read di PLAN.md righe 1-220 (TL;DR + STATO CORRENTE), poi prime voci del registro (grep `^- \*\*2026-` per gli offset), poi `git log -8` + `git status` + logs per l'in-flight.

Regole operative chiave (da PLAN.md, vincolanti): misure di velocità SOLO a telefono staccato; da 2026-08-13 anche colonna mWakefulness nei runs.csv (Doze falsa i numeri — caso Xiaomi); in questo repo si committa liberamente e spesso (MAI i GGUF); una variabile alla volta; ogni run → riga CSV; report per fase con verdetto DONE/BLOCKED.
