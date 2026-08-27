---
name: pc-stability-over-throughput
description: "26/08/2026 gualt: 'occhio a non ingolfare il PC — se si resetta o si blocca mentre sto fuori, è la fine' → con l'owner via, la stabilità del PC batte qualunque throughput: UN solo job pesante alla volta, niente build/download in parallelo alle PPL"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 2fb8e59a-4ad7-403b-a321-8ee8ed388dfe
  modified: 2026-08-26T20:56:25.364Z
---

Detto da gualt il 26/08/2026 sera, mentre avevo 3 agenti in campo + una PPL da 13 h: "occhio a
non ingolfare il PC :) … se per esempio si resetta o si blocca mentre sto fuori, è la fine".
Nessuno può riavviare il PC dal 28/08 al ~07/09: un freeze/reset = tutta la campagna ferma.

**Why:** il PC è il singolo punto di guasto della campagna in sua assenza (orchestrazione,
Paseo, adb wireless, runner detached). Già visto: Modern Standby congela i job
([[pc-modern-standby-freezes-jobs]]), lo scrollback del terminale mangia 33 GB
([[terminal-scrollback-eats-ram]]), sessioni Paseo che si incastrano con chiamate parallele
(HARD RULE #0).

**How to apply:**
- **Un solo job pesante alla volta** (PPL/quantize/build/download grossi): se gira q63 (PPL
  `-t 8`, 6.7 GB), niente build Android, niente download da GB, niente seconda PPL. Le prep
  PC-side si fanno DOPO, in coda, non in parallelo.
- Agenti concorrenti: max 2–3 e solo se leggeri (doc, adb verso device, letture). Prima di
  spawnare guardare `Get-Process` (CPU totale, RAM) — sotto ~50 % CPU e con ≥ 8 GB liberi.
- Priorità Idle per tutto ciò che è batch; `-j2` massimo per build quando il PC è libero.
- Verificare che il PC non vada in standby (piano energetico) e che i runner siano detached
  con process group proprio ([[detached-children-need-own-process-group]],
  [[background-kills-at-compaction]]).
- In dubbio: rimandare. Meglio una notte di calcolo persa che il PC bloccato per 10 giorni.

Vedi [[owner-away-2026-08-28]].

**27/08 sera — la regola 'un job pesante alla volta' e' CROSS-SESSIONE**: il floor RAM dei miei
build e' scattato due volte per `recon_bench.exe` (~15.8 GiB) della sessione Devboule
(new-devboule-02) — due sessioni Claude sullo stesso PC che lanciano pesi alla cieca si
affamano a vicenda. Protocollo: prima di ogni job >4 GiB stimati, (1) guardare i top consumer
(Get-Process WS), (2) se il peso e' di un'altra sessione → SendMessage di coordinamento (mai
kill), (3) sequenziare. I watcher di build devono loggare CHI teneva la RAM al momento di uno
stop, non solo quanta ne restava.
