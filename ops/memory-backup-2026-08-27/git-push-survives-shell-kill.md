---
name: git-push-survives-shell-kill
description: "Su questa macchina un git push che va in timeout della shell di solito È RIUSCITO: il processo git sopravvive al kill e completa; il retry poi fallisce con 'cannot lock ref / is at X but expected Y' (race benigna)"
metadata: 
  node_type: memory
  type: project
  originSessionId: fb93e819-e435-40c3-bc33-28d06827a559
  modified: 2026-08-24T15:18:11.350Z
---

Visto 5+ volte il 24/08/2026 (rete lenta + PC sotto carico): il comando PowerShell
con `git push` va in timeout (exit 143), MA il processo git figlio sopravvive al
kill della shell e completa il push. Il retry successivo viene respinto con
`cannot lock ref 'refs/heads/main': is at <nuovo> but expected <vecchio>` — che
NON è un errore da risolvere: è la prova che il push originale è passato.

**How to apply:** dopo un timeout di push, MAI ritentare alla cieca. Prima:
`git fetch origin` + confronto `git rev-parse main` vs `origin/main`. Se
combaciano, finito. Il "cannot lock ref ... is at <il-mio-HEAD>" = successo
mascherato. Push lunghi: lanciarli con timeout largo o in background e
verificare SEMPRE con fetch, non col rc della shell.

Vedi [[background-kills-at-compaction]] (classe simile: il confine uccide la
shell, non il lavoro).
