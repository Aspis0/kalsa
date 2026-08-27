---
name: detached-children-need-own-process-group
description: "Detachare il runner padre NON basta: i figli (llama-cli) senza CREATE_NEW_PROCESS_GROUP condividono la console e muoiono 0xC000013A quando un'altra shell del PC viene uccisa in timeout"
metadata: 
  node_type: memory
  type: project
  originSessionId: fb93e819-e435-40c3-bc33-28d06827a559
  modified: 2026-08-24T16:52:22.369Z
---

Visto il 24/08/2026 su q52: runner Python lanciato detached (Start-Process
hidden) ma figli spawnati solo con `IDLE_PRIORITY_CLASS` → dopo 50 run pulite,
2 llama-cli consecutivi morti `rc=3221225786` (0xC000013A =
STATUS_CONTROL_C_EXIT) nell'istante in cui un git commit di UN'ALTRA shell
veniva ucciso al timeout dei 2 minuti. L'evento CTRL di console si propaga ai
figli che condividono la console del padre, anche se il padre è detached.
Un output era troncato ma non-vuoto (88 char): il resume "skip se non-vuoto"
lo avrebbe tenuto come dato buono — **dato marcio silenzioso**.

**How to apply:**
1. Ogni figlio di un runner detached: `creationflags = IDLE_PRIORITY_CLASS |
   CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP` (0x40|0x08000000|0x200).
2. Il runner ignora SIGINT/SIGBREAK.
3. Policy fallimento: rc≠0 → CANCELLA l'output (mai fidarsi di file scritti da
   processi morti a metà), retry ×1, poi FAILED-SKIP e si continua — mai STOP
   dell'intero harness per una run.

Classe parente: [[background-kills-at-compaction]] (il confine uccide la
shell, non il lavoro — qui la shell uccisa ammazzava il lavoro ALTRUI),
[[git-push-survives-shell-kill]].
