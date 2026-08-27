---
name: qdc-device-cloud
description: "Qualcomm Device Cloud (qdc.qualcomm.com) — gualt ha minuti GRATIS (22/08); farm vendor con device Snapdragon reali: candidata per validazione Adreno 8xx, Hexagon v75/v79 (pista NPU) e matrice compiler E031 multi-device del dossier #8"
metadata: 
  node_type: memory
  type: reference
  originSessionId: cbe9d83a-a5b8-43e7-ae45-f5e24f47293c
  modified: 2026-08-22T20:56:45.295Z
---

**https://qdc.qualcomm.com/home** — Qualcomm Device Cloud. gualt ha **minuti
gratuiti** (segnalato 22/08 sera, account suo).

Perché conta per Kalsa:
1. **Adreno 8xx**: la ricerca mercato (docs/research-adreno-vs-mali-8xx-2026-08.md)
   dice "cloud farm first, hardware fisico solo per questioni termiche" — QDC è
   la farm del vendor, meglio di Firebase/AWS per silicio Qualcomm.
2. **Pista NPU**: device con Hexagon v75/v79/v81 per i gate ggml-hexagon senza
   comprare telefoni.
3. **Dossier #8**: matrice compiler E031 su N device/generazioni (già provato che
   E031.41 e E031.45 rompono cose diverse) = argomento fortissimo.

Prerequisito operativo da verificare: le sessioni devono dare **adb
interattivo/binari custom** (non solo APK) perché la nostra pipeline
(test-backend-ops, llama-bench, sha256 on-device) funzioni as-is. Recon
22/08 in `scratchpad/agents/q29-qdc-recon/` (se completata).

Vedi [[kalsa-campaign-ops-lessons]] (interessi gualt), [[adreno-moe-two-defects]].
