---
name: jelly-keepalive-via-adb
description: Il Jelly resta vivo oltre i 20 min solo con lo schermo tenuto acceso via adb; da Termux quella chiamata è vietata
metadata: 
  node_type: memory
  type: project
  originSessionId: 0e5e48cb-1b53-436f-a35a-c661b00ea052
  modified: 2026-08-19T15:08:37.302Z
---

**Il Jelly moriva dopo ~20 minuti perché lo schermo si spegne e Android uccide il
process group di Termux. La cura è tenere lo schermo acceso VIA ADB.**

Da Termux non si può: `settings put system screen_off_timeout` viene **rifiutato**
(`INTERACT_ACROSS_USERS`) — provato e documentato in
`results/dropsweep_jelly/REPORT.md:113`. Sugli altri due telefoni la stessa cosa si fa
via adb da anni di campagna (S23 `scripts/staccato2_host_watch.sh`, Xiaomi PREREG
emendamento 3). **Sul Jelly non era mai stata applicata perché ci si arriva via ssh.**

**Il Jelly È raggiungibile in adb**: serial `JELLYS0000053795` (USB). Ricetta, dal PC:
```bash
adb -s JELLYS0000053795 shell settings put system screen_off_timeout 7200000
adb -s JELLYS0000053795 shell svc power stayon true
adb -s JELLYS0000053795 shell input keyevent KEYCODE_WAKEUP
```
Verifica: `dumpsys power | grep mWakefulness` deve dire `Awake`.
Il default del Jelly era **1800000** (30 min).

**CONFERMATO il 2026-08-19 (conferma piena, non più preliminare):** con la ricetta
applicata, `mWakefulness=Awake` ininterrotto per **~83 min** e Termux mai ucciso, durante
le tre celle cache rifatte (harness reale, non solo heartbeat). Contro i ~20 min fatali.

⚠️ **Staccato dalla corrente il Jelly NON ha USB**: il serial `JELLYS0000053795` esiste
solo col cavo. Per le run tok/s (che richiedono unplugged) la ricetta va applicata via
**wireless debugging** (`adb connect 192.168.1.82:<porta>` — porta effimera, cambia a
ogni pairing; il 19/08 era 39591).

⚠️ **Nulla era mai stato rimosso da git.** heartbeat + pulse nei cooldown + watchdog con
rilancio furono **aggiunti** il 17-18/08 per i drop-sweep e **mai portati** negli
orchestratori KEXP/REAP/TTFT (`run_kexp_jelly_orch.py`, `run_reap50_jelly_orch.py`), che
restano `ssh` sincrono per cella, senza detach né resume: lì una morte del telefono perde
la run. Se serve una cella lunga su quei path, o si porta il watchdog o si usa l'S23.

Vedi [[jelly-dies-in-idle-sleep]] e [[adb-from-git-bash]] (MSYS_NO_PATHCONV=1 sempre).
