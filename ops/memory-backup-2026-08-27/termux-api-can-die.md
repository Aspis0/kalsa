---
name: termux-api-can-die
description: Il servizio Termux:API sui telefoni muore silenziosamente (Android lo killa); batt/temp tornano -1 e gli harness fanno STOP_BATT falsi — termux-api-start prima di ogni (ri)avvio harness
metadata: 
  node_type: memory
  type: feedback
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-14T21:11:37.141Z
---

2026-08-14, Jelly: l'harness K-F si è fermato con STOP_BATT a batteria 84%
perché `termux-battery-status` falliva (`batt=-1 temp=-1`) — il servizio
Termux:API era morto (probabilmente killato da Android quando il wake-lock
del run precedente è caduto). Su Jelly il fallback sysfs
(`/sys/class/power_supply/battery/*`) è Permission denied, quindi senza
API non c'è nessuna lettura batteria.

**Why:** i floor batteria sono safety-critical: con lettura -1 l'harness
DEVE fermarsi (comportamento corretto), ma il retry cieco spreca ore.

**How to apply:** (1) prima di ogni avvio/riavvio harness via ssh:
`termux-api-start; sleep 3; timeout 10 termux-battery-status` e verificare
JSON valido. (2) Nelle probe ssh ricordare SEMPRE
`export PATH=/data/data/com.termux/files/usr/bin:$PATH` — senza, il
comando "non esiste" e sembra un guasto. (3) Un STOP_BATT a minuti
dall'avvio con batteria nota alta = API morta, non batteria scarica.
Vedi anche [[device-scripts-lf-only]] per l'altra trappola del giorno.
