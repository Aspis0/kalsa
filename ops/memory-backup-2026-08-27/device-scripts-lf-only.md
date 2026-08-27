---
name: device-scripts-lf-only
description: "Script bash pushati sui telefoni Termux DEVONO essere LF; bash Windows tollera CRLF (bash -n passa!) ma Termux muore subito a \"set: pipefail: invalid option name\""
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-14T20:54:09.342Z
---

2026-08-14: l'A/B K-F sul Jelly è rimasto morto per ~1.3h in silenzio: un
grok su Windows aveva riscritto `run_kf_jelly.sh` con CRLF, lo scp l'ha
portato su Termux, e il bash del device è morto alla riga 5
(`set: pipefail: invalid option name` = `pipefail\r`). Push loggato rc=0,
STATUS.txt mai creato, nohup.out con l'errore.

**Why:** il bash di Git-Windows (MSYS) tollera i \r, quindi `bash -n`
locale passa ed è una FALSA conferma. Il bash di Termux no.

**How to apply:** prima di ogni scp di uno script .sh verso un telefono:
`sed -i 's/\r$//' file && grep -q $'\r' file && ABORT`. Meglio: metterlo
dentro gli script push_and_start_*.ps1. Dopo ogni start remoto, verificare
entro pochi minuti che STATUS.txt esista e un processo giri — "push rc=0"
non significa "harness partito" (vedi [[watchers-verify-pid]]).
