---
name: cpuset-gate-every-harness
description: "Il gate cpuset F4.3-bis (exit 93) e le covariate nproc/affinity_mask valgono per OGNI harness device, non solo run_bench.sh"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-18T19:40:37.411Z
---

`scripts/runs.schema.md:165` definisce il **Cpuset gate F4.3-bis**: hard fail exit **93**
se `nproc < 6`, cgroup background, o affinity popcount < 6; e dichiara `nproc` +
`affinity_mask` **covariate obbligatorie** ("senza di esse una riga non è
interpretabile a posteriori", lezione 2026-08-06: misure su cpuset background = 3
core A510).

Ma il gate è implementato **solo in `run_bench.sh`**. Gli harness più recenti
(`run_dropsweep_jelly.sh` e i suoi cloni) prendono `termux-wake-lock` e pretendono
`termux-api`, ma **non hanno il gate né le due colonne** — quindi producono celle
che non si possono validare dopo.

**Why:** senza quelle colonne una cella "buona" e una girata su 3 core piccoli sono
indistinguibili nel CSV; il 18/08 le tre celle S23 cache×drop sono finite in questo
stato e la conclusione "la reversal non replica su 8 Gen 2" è rimasta
**non verificabile**, non falsificata. L'errore era già a verbale dal 2026-08-06.

🔬 **MISURATO il 2026-08-18 sull'S23: `termux-wake-lock` NON promuove il cpuset.**
Sonda in tre tempi (prima del wake-lock / stessa sessione dopo / sessione ssh
nuova col lock già preso): **sempre `/moderate`, `Cpus_allowed_list: 0-2`,
`nproc=3`.** Topologia S23: cpu0-2 = 2016 MHz (A510), cpu3-6 = 2803, cpu7 = 3360.
Quindi il wake-lock — che l'harness prende a ogni lancio e che credevamo
sufficiente — **non apre la scatola**, e non serve nemmeno aspettare: non è un
declassamento temporaneo da idle, è persistente per la sessione ssh. Un
wait-and-retry sul gate è tempo morto in questo scenario.
`/dev/cpuset/*/cpus` non è leggibile da Termux (permesso negato, in silenzio).

**How to apply:** prima di lanciare QUALSIASI cella su device con un harness diverso
da `run_bench.sh`, verificare che quell'harness (a) faccia il gate cpuset sul PID del
binario, non sulla shell, e (b) scriva `nproc` e `affinity_mask` nel CSV. Se mancano,
portarli PRIMA di misurare — non dopo. Su S23 la shell ssh Termux idle sta in
`/moderate` (`Cpus_allowed_list: 0-2`, solo A510); `adb shell` sta in `/` (0-7).
Sondare la shell NON dimostra nulla sul processo misurato: va letto
`/proc/<pid-del-binario>/cpuset`. Vedi [[termux-api-can-die]] e
[[watchers-verify-pid]].

**MemAvailable MENTE nei fit-gate (23/08, lezione app-Claude, pagata cara da loro):**
legge 2-4 GB "disponibili" mentre MemFree è 0.08-0.53 GB, perché conta la page
cache reclamabile — e i pesi mmap del modello SONO quella cache: riporta la
residenza del modello come headroom. Per i fit-gate usare MemFree +
RssAnon/RssFile + majflt. Collegato: su ARM il repack copre q2_K solo AVX-512 e
q3_K mai (`repack.cpp:4627`) → esperti KEXP file-backed e sfrattabili; nel
motore streaming è by design (repack OFF, hard rule), in-app full-resident è la
causa dei collassi da fault-storm.

**Trappole residency (23/08, arm no-mmap dell'app):** (1) `use_mlock` su Android
retail NON funziona — RLIMIT_MEMLOCK 64MB soft+hard e llama.cpp degrada a
warning: l'arm "locked" rimisura silenziosamente l'arm mmap. Usare
`use_mmap=false` (stessa proprietà anon, zero privilegi). (2) `majflt` NON
discrimina da solo: l'arm veloce ne ha fatti 2.3× di più — leggerlo sempre
accanto a RssFile/VmSwap.

**CORREZIONE (23/08 sera, dall'app):** le due note sopra vanno lette per FASE.
(1) MemAvailable è INVALIDO solo A MODELLO GIÀ CARICATO (conta le pagine mmap
del modello come headroom); PRE-load resta LA metrica giusta per un fit-check —
MAI gate su MemFree (il kernel lo tiene deliberatamente ~0, 0.08-0.53 GB su
telefono sano e occupato: rifiuterebbe tutto). MemFree/RssAnon/RssFile/majflt =
diagnosi di un processo vivo, non decisione di load. (2) no-mmap NON è
mitigazione generale: i tipi ≥4bpw con repack sono GIÀ in anon (il flag compra
zero e costa ~25s di load); serve solo ai sub-4bpw senza repack — per quelli la
risposta spedibile è il kernel repack NEON (#29), non il flag.

**RAFFINAMENTO (23/08 sera, controllo a due telefoni dell'app, sostituisce le
note majflt/mlock sopra):** (1) majflt per-turno DENTRO un arm traccia bene il
collasso; è il confronto cumulativo TRA arm con pesi backed diversamente che
mente. (2) RLIMIT_MEMLOCK è PER-DEVICE (S23 64MB hard, Jelly unlimited) e va
letto da /proc/<app-pid>/limits — le shell adb/run-as ereditano i limiti della
shell, non dell'app. (3) tok/s per-turno confonde la LUNGHEZZA di generazione
(corr negativa con tokensPredicted in ogni arm): confrontare solo a lunghezze
appaiate, registrare sempre tokensPredicted. (4) Il degrado da crescita del
contesto (~1/3 in 16 turni) colpisce tutti gli arm: mai valutare un fix di
residenza su un decay% totale. (5) I rimedi di residenza valgono 6.6× dove il
device sfratta e ~1.0× dove non sfratta → ship gate su margine misurato, mai
default globale.
