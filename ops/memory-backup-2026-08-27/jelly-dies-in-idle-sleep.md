---
name: jelly-dies-in-idle-sleep
description: "Jelly Star kills the whole Termux process group during long idle sleeps, not at the screen timeout — keep a pulse during cooldowns"
metadata: 
  node_type: memory
  type: project
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-17T17:30:56.991Z
---

Sul Jelly Star l'harness muore **durante i `sleep` di cooldown, non durante le
run**. Due osservazioni indipendenti: 2026-08-16 ultima run finita 23:34:26, morto
nel cooldown seguente; 2026-08-17 ultima run finita 00:22:02, ultimo heartbeat
"cooldown before r2_d0.0", sparito entro tre minuti.

**Non è il timeout dello schermo** (le due morti sono a 30 min e 13 min dal
lancio, quindi nessun intervallo fisso), e non è la rete: al momento della morte
il telefono **rispondeva al ping con 0% di perdita mentre TUTTE le porte Termux
erano chiuse** (8022/22/18022/2222/8080) → è stato ucciso l'intero process group
dell'app, non solo sshd. `termux-wake-lock` era stato acquisito con successo.

Terza conferma il 2026-08-17 sulla cella CalaQwen: `r1_d1.0nr` finita alle
10:54:17, irraggiungibile alle 10:58:59 — di nuovo **nel cooldown**. **3 casi su 3.**

⚠️ **LA MIA SPIEGAZIONE È SBAGLIATA, O ALMENO INCOMPLETA.** Avevo ipotizzato
"Android congela l'app che resta inattiva, e un processo fermo in `sleep 120`
sembra idle". Ho implementato il rimedio (`cooldown_alive()`: `sleep 5` a impulsi
con heartbeat a ogni giro e wake-lock riacquisito ogni 30 s) e **la terza morte è
avvenuta lo stesso, col fix attivo**. Quindi un heartbeat ogni 5 secondi non basta
a farlo sembrare vivo, oppure la causa è un'altra.

**IPOTESI GUIDA (osservazione di gualt, 2026-08-17 — la migliore evidenza che
abbiamo): il Jelly entra in SUSPEND PROFONDO dopo qualche minuto.** Sintomo
riferito da chi ha il telefono in mano: *"quando lo prendo ci mette un po' a
riattivare lo schermo"*. Questo spiega tutto ciò che avevo osservato e non sapevo
mettere insieme:
- il **ping risponde** anche a telefono "morto" → lo gestisce il chip WiFi in
  offload mentre la CPU è sospesa, non l'OS;
- **tutte le porte rifiutano** → non c'è nessun processo a fare `accept`;
- gli intervalli non costanti (13, 31, 32 min) → dipendono da quando il sistema
  decide di scendere, non da un timeout fisso.

`termux-wake-lock` viene acquisito con successo e **non basta**: è un telefono con
power management vendor aggressivo (si vedono app di sistema `com.agold.*`).
L'ottimizzazione batteria per Termux era già su "Senza restrizioni" — quindi non è
quello.

Le mie due ipotesi precedenti erano sbagliate: (1) "processo idle nel `sleep`" —
smentita, il fix a impulsi funziona (heartbeat aggiornato ogni 2-3 s in
produzione) e il telefono muore lo stesso; (2) "battery optimization" — smentita
dall'owner, era già disattivata.

**Il pattern "muore nel cooldown" è solido e utile; la causa no.** Non spacciarlo
per risolto.

**Come applicarla:** mai un `sleep` lungo singolo in uno script sul device.
Spezzarlo in `sleep 5` con scrittura di un heartbeat a ogni giro e
`termux-wake-lock` riacquisito ogni ~30 s (`cooldown_alive()` in
`scripts/run_dropsweep_jelly.sh`). E dare per scontato che il canale possa
sparire: il watchdog lato PC deve ritentare all'infinito e **rispingere lo script
via scp prima di rilanciare**, se no rilancia fedelmente la versione che muore.

Corollario: senza adb sul Jelly (solo l'S23 è su adb, ed è riservato) **non esiste
canale fuori banda** — se Termux muore si è ciechi fino a che l'owner tocca il
telefono. Vedi [[watchers-verify-pid]], [[termux-api-can-die]],
[[pgrep-misses-exec-wrapper]].

**Vincolo operativo dall'owner (2026-08-18): la finestra utile del Jelly e' di
~20 minuti.** Passato quel tempo lo schermo si spegne e la sessione ssh cade. Quindi
qualunque lavoro sul Jelly va dimensionato **sotto i 20 minuti**, oppure spezzato in
blocchi con watchdog che rilancia — mai un job lungo lanciato e lasciato solo.
Corollario: le celle che durano ore (rerun cache sweep con covariata cpuset) NON sono
eseguibili sul Jelly in una sessione interattiva; o watchdog, o si usa l'S23.

**Sonda cpuset (2026-08-18): il Jelly NON ha il problema dell'S23.** Un processo che
brucia CPU davvero (`yes > /dev/null`, letto dopo 3 s sul suo PID) sta in `/top-app`
con `Cpus_allowed_list 0-7`, nproc=8 — mentre su S23 le sessioni Termux stanno in
`/moderate` (0-2). E' una differenza di ROM, non di silicio. Vedi
[[cpuset-gate-every-harness]] e [[adb-from-git-bash]].
Connessione: `u0_a225@192.168.1.82` porta **8022** (`scripts/run_kexp_jelly_orch.py:17`).
