---
name: pc-modern-standby-freezes-jobs
description: Il PC entra in Modern Standby quando è idle e congela i processi in attesa — i runner incatenati vanno armati solo se qualcosa tiene la CPU occupata
metadata: 
  node_type: memory
  type: project
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-17T13:05:31.137Z
---

Il PC entra in **Modern Standby** appena non c'è carico, e **congela tutti i
processi in background**, watchdog e runner incatenati compresi. Non li uccide:
li sospende, e riprendono all'uscita dallo standby.

Osservato il 2026-08-17: M4 finisce alle 07:45:07, il PC entra in standby verso
le 07:46, il watchdog del Jelly smette di scrivere il log alle 07:44:36 e riprende
alle 09:04:27 — 78 minuti di buco. Il processo risultava **vivo** per
`Get-Process` per tutto il tempo, quindi "processo vivo" non è prova che stia
lavorando. Conferma definitiva nel registro eventi:

```
Get-WinEvent -FilterHashtable @{LogName="System"; ProviderName="Microsoft-Windows-Kernel-Power"} |
  Where-Object { $_.Id -in 42,107,507,566 }
# Id=507 "The system is exiting Modern Standby" -> 07:46:23 e 09:01:11
```

**Come applicarla:**
- Un runner incatenato che *aspetta* (`Start-Sleep` in loop) sopravvive solo se
  qualcos'altro tiene la CPU occupata. Se la coda si svuota, il PC dorme e la
  catena si ferma finché qualcuno non tocca la macchina.
- Per diagnosticare un processo "vivo ma fermo": confrontare **l'mtime del suo
  file di log** con l'ora attuale, poi controllare gli eventi Kernel-Power. Non
  concludere che il codice sia bloccato prima di aver escluso lo standby — il
  2026-08-17 stavo per riavviare un watchdog perfettamente sano.
- Se un lavoro deve davvero durare tutta la notte a vuoto, serve che il PC non
  entri in standby (impostazione owner), oppure va accettato che le attese si
  allunghino.

Vedi [[jelly-dies-in-idle-sleep]] — stesso fenomeno sul telefono, causa diversa:
lì Android **uccide**, qui Windows **sospende**.
