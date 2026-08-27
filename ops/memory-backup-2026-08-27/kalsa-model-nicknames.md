---
name: kalsa-model-nicknames
description: "Nickname → GGUF mapping dei modelli della campagna (CalaQwen = il Qwen 35B nostro quantizzato, già sui telefoni)"
metadata: 
  node_type: memory
  type: project
  originSessionId: fb421f6e-808c-4488-b008-5b732da526a8
  modified: 2026-08-20T01:40:05.238Z
---

Soprannomi usati dall'owner per i modelli della campagna Kalsa:

- **CalaQwen** = il nostro Qwen3.6-35B-A3B quantizzato (variante telefono, UD-IQ2_M;
  su PC c'è anche il Q4 KEXP `models/Qwen3.6-35B-A3B-KEXP.gguf`, arch `qwen35moe`,
  ibrido attention+GDN, 40 layer). GIÀ SHIPPATO sui telefoni: S23 ~5.86 tok/s,
  Xiaomi ~4.75 (lineup 3 telefoni in PLAN.md). Quindi "il 35B non è sul telefono"
  è FALSO — errore già fatto il 2026-08-15.
- **Marco / Marco1c** = Marco-Mini-Instruct-KEXP.gguf (qwen3moe, 28 layer,
  256 esperti; il modello campagna di Jelly e delle celle K-F).
- **Mellum2** = il modello del PPL gate multilingue su PC (F1 Q4) —
  `models/Mellum2-12B-A2.5B-Instruct-Q4_K_M.gguf`: esperti in famiglia K.

**Ricetta KEXP (verificato al gguf, 2026-08-20 su LFM2.5-8B-A1B-KEXP):
esperti = Q2_K + Q3_K, tronco = Q5_K/Q6_K/F32.** Vale per la lineup KEXP
(LFM2.5, Marco, CalaQwen-Q4KEXP). Conseguenza: la lineup di produzione non
tocca MAI i tipi trans4 (q4_0/q4_1/q5_x/mxfp4) su OpenCL; q2_K/q3_K su
MUL_MAT_ID non sono supportati dal backend (fallback CPU by design);
gpt-oss invece è MXFP4 = trans4-gated. Vedi [[adreno-moe-two-defects]].

**Why:** l'owner usa i soprannomi in chat; il mapping non è ovvio dai filename e
scordarlo produce risposte sbagliate su cosa gira dove.

**How to apply:** prima di dire "modello X non è sul device Y", controllare la
lineup in PLAN.md ([[moe-exp-recovery]]).

Device RAM (verificato con owner 25/08): **Xiaomi houji = 12 GB** (non 16), S23 = 8 GB (MemTotal 7074 MiB), Jelly Star = 8 GB (7.97 GB).

**Correzione gualt 27/08: NON esiste 'il denso di default'.** La scelta del modello denso dell'app dipende da RAM e telefono (lineup per-device); Qwen3.5-4B e' UNA delle opzioni, non il default universale — nella lineup densa ci sono anche LFM 2.5/2.6 (tier piu' bassi). Conseguenza: ricette tipo IQ4_NL-M (q63) vanno gateate per OGNI membro della lineup densa, non solo Qwen (→ q69 per LFM).

**Fatto verificato 27/08 (sorgente ai-chat main)**: l'APP oggi e' SOLO-DENSA — registry (src/engine/ModelRegistry.ts) = catena qwen3.5 per tier RAM (4B high / 4B-Q3 mid / 2B low) + Gemma 4 E2B + whisper-tiny + e5-small; ZERO riferimenti Marco/MoE/streaming/expert nel codice app, nessun selettore GGUF custom. Streaming e KEXP vivono nei binari CLI (bmoe-cli), non nell'app: l'integrazione MoE in-app e' lavoro futuro (sessione app), non una regressione del pin engine. Il pin kalsallama (eaee200b) da' all'app densa mmap-prefetch + porta i kernel q23k pronti nelle lib per quando il MoE entrera' nel prodotto.
