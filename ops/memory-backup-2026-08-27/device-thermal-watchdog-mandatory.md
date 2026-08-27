---
name: device-thermal-watchdog-mandatory
description: "25/08/2026: l'S23 si è spento bollente e non riparte dopo una PPL HTP sostenuta su v73 — ogni run device >2 min DEVE avere un watchdog termico intra-run (poll 10 s, kill a 43 °C); il gate pre/post non basta"
metadata:
  type: feedback
---

Il 25/08/2026 il Galaxy S23 si è spento surriscaldato e non si è più riacceso
durante la perplexity HTP dell'ibrido Qwen3.5-4B (grafo intero su NPU v73,
batch 2048, decine di minuti senza pause). Due "adb offline" nella stessa
corsia erano in realtà due spegnimenti termici: il primo era rientrato dopo
la ricarica, il secondo no. Il harness misurava la temperatura solo PRIMA e
DOPO ogni braccio (gate cool-start ≤35 °C) — nessun controllo DURANTE.

**Why:** un device è insostituibile per la campagna; un run lungo senza
soglia di abort può distruggerlo. Le corsie NPU v73 in più lasciano il DSP
in stati non governati dopo una morte del PD.

**How to apply:** ogni run device > 2 min gira sotto watchdog on-device
(`dumpsys battery` ogni 10 s, WARN 40 °C, KILL del binario a 43 °C, max temp
registrata nel manifest); run NPU sostenuti su v73 OFF fino a decisione owner
e comunque cap 10 min; watchdog anche sui bracci CPU delle perplexity.
Vedi [[jelly-dies-in-idle-sleep]] (l'altro device che muore di caldo) e
[[cpuset-gate-every-harness]] (stessa classe: gate obbligatori nel harness,
non nella testa dell'operatore).

**Regola di STOP — testo esatto da copiare nei brief (dopo DUE falsi stop il 25-26/08)**:
fermare un braccio SOLO su sottostringhe case-sensitive `CDSP0 CRASHED`, `dspqueue_read failed`,
`dspqueue_write failed`, `INTERNAL-ERROR`, `ggml_abort`, `GGML_ASSERT`, `Aborted`, `Segmentation`,
oppure rc ≥ 128 non causato dal guard. MAI parole generiche: "abort" matcha il warning benigno
`common_fit_params ... abort`; "cdsp"/"CDSP" matcha `Loading driver libcdsprpc.so` e
`_dom=cdsp` dell'apertura sessione. Un fallimento al load (rc 1, es. fastrpc_mmap della KV cache
da 256 MB con -c 2048 → fix `-nkvo`) NON è un crash: si diagnostica e si ritenta una volta.

