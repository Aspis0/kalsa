---
name: pipette-liquid-benchmark
description: "Pipette (Liquid AI, ago 2026): suite open-source Apache-2.0 di benchmark on-device (llama.cpp CPU/Metal, NPU ESCLUSA) — dashboard pipette.liquid.ai, repo GitHub Liquid4All; segnalata da gualt 27/08"
metadata:
  type: reference
---

Blog: https://www.liquid.ai/blog/pipette-on-device-ai-benchmarking-by-liquid-ai — dashboard
https://pipette.liquid.ai — GitHub org **Liquid4All**: `pipette-mgmt` (catalogo), `pipette-clients`
(esecuzione device), `pipette-scores` (scoring). Apache 2.0.

Cosa misura: prefill/decode t/s, TTFT, latenza e2e, RAM di picco, qualità (IFBench, GPQA-D,
MATH-500); Pareto qualità vs velocità/memoria; context scaling 256–8192; 30+ modelli, 1000+ combo
modello×quant×runtime×device. Quant: Q4_0, Q4_K_M, Q5_K_M, Q8_0, IQ1_M, **Q2_g64**. Device:
M5 Max, iPhone 17 Pro, Galaxy S26 Ultra (AMD in arrivo). Metodo: 1 warmup scartato + 5 rep,
greedy, shape fisse, **gate termico di readiness pre-run** (pubblicano solo run che passano).

Rilevanza Kalsa: (1) **NPU esclusa "per copertura operatori insufficiente"** → il nostro lavoro
HTP v73/v75 è oltre la loro frontiera, il dato NPU resta un vantaggio; (2) il loro thermal-gate
valida la nostra guardia q56/cool-start (loro pre-run, noi anche intra-run che è più forte);
(3) niente energia né throughput sostenuto → i nostri dati termici/streaming non li copre nessuno;
(4) confronto utile per baseline CPU S23-classe e per la matrice quant (Q2_g64 da guardare vs
esperti Q2_K/Q3_K della ricetta KEXP, [[kalsa-model-nicknames]]); (5) i loro harness/client
Android sono da saccheggiare per idee (readiness check, metadata traceability).
