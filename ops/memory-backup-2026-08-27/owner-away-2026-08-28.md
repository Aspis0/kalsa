---
name: owner-away-2026-08-28
description: "gualt via dal 28/08 al ~07/09/2026: solo S23 e Jelly disponibili, ATTACCATI al cavo (occhio alla temperatura); Xiaomi NON disponibile; comunicazione terse"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2fb8e59a-4ad7-403b-a321-8ee8ed388dfe
  modified: 2026-08-26T19:13:13.411Z
---

Detto da gualt il 26/08/2026: **parte il 28/08 per 10 giorni (rientro ~07/09)**.

**Vincoli device in sua assenza**
- **Xiaomi (houji, v75) NON disponibile** — parte con lui. Niente celle v75 (R2/R3, q62 follow-up,
  spike app-side su v75) fino al rientro: pianificarle DOPO il 07/09 o su QDC ([[qdc-device-cloud]]).
- **S23 (v73, 8 GB) e Jelly (8 GB, CPU-only) restano, ATTACCATI al cavo** → ogni run è "plugged
  declared" (registrarlo in ogni manifest; le celle unplugged-required non si fanno).
- **Temperatura**: attaccati scaldano di più e nessuno può staccarli fisicamente — watchdog
  intra-run OBBLIGATORIO ([[device-thermal-watchdog-mandatory]]: poll 10 s, WARN 40, KILL 43),
  cool-start ≤ 32 °C, cap 10 min sui run NPU v73, pause fra bracci. Il Jelly muore nei sleep
  inattivi ([[jelly-dies-in-idle-sleep]]) e nessuno lo riavvia a mano: keepalive via adb
  ([[jelly-keepalive-via-adb]]), niente sessioni multi-ora senza heartbeat. S23: Termux:API può
  morire ([[termux-api-can-die]]); USB da autorizzare al popup NON possibile → solo wireless adb
  già pairato ([[adb-from-git-bash]]).
- Nessuno può fare recovery fisica (reboot, re-pair, ricarica): un device perso resta perso
  fino al 07/09 → preferire celle corte e PC-side (es. q63 ricetta IQ4_NL-M, HTP memory model
  su carta, router impl).

**Piano dei 10 giorni FIRMATO da gualt (26/08 sera)**: `docs/PLAN-10DAYS-2026-08-28.md` v2
(commit `a3ffca83`, audit DeepSeek applicato). Ordine: QDC 8 Elite (kill-date giorno 4, drop
order) → baseline S23 plugged (ledger spazio: 8.2 GB liberi!, cool-start contingency) → picks
upstream (max 3, solo OpenCL) → ottimizzazione prefill q2/q3 (patch profiling + gate doppio) →
cella crossover router su Marco1c. **HVX (§8) solo con regola pre-delegata: v79 sopravvive agli
esperti ∧ q63 FAIL ∧ GO scritto.** Day-1 prep S23 lanciata 26/08 sera (Luna `ec8c5517`:
inventario, drop-chain PROPOSTA — cancellazioni solo dopo OK orchestratore, snapshot termico,
bozza prereg `s23-plugged-baseline`).

**Comunicazione** (richiesta esplicita 26/08): parlare e scrivere di MENO — report brevi,
niente riepiloghi non richiesti; i token sono preziosi.
