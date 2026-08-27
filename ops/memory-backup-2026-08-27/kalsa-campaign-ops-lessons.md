---
name: kalsa-campaign-ops-lessons
description: "Lezioni operative 21-22/08: archiviare FISICAMENTE i binari pinnati al lock delle prereg (sha da soli non bastano); aggiornare ALIVE.md a OGNI bank (gualt legge quello, non PLAN); ox-alpha muore alla scrittura finale → report-su-file PRIMA del summary; 'idle' dopo send_agent_prompt è una race"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: cbe9d83a-a5b8-43e7-ae45-f5e24f47293c
  modified: 2026-08-22T20:18:31.185Z
---

**1. Prereg: i binari pinnati si archiviano FISICAMENTE al momento del lock.**
Il 22/08 la sessione ship #18 ha trovato l'opencl pinnato (`b9d99fa8`)
INESISTENTE: sovrascritto su PC e device dai rebuild dei capitoli successivi.
Solo lo sha nel doc non protegge niente. → Al lock di ogni prereg: copiare gli
artefatti in una dir tipo `results/<cella>/pinned/` (come
`oomwall_s23/staging/` che ha salvato noextra e stock). L'emendamento pre-run
(v1.2, repin al set deployato device-verificato) è la pezza legittima, ma va
evitata a monte.

**2. ALIVE.md (docs/ALIVE.md) si aggiorna a OGNI bank, non solo PLAN.**
Correzione diretta di gualt (22/08: "Ma dove? Non vedo quello che intendi!"):
gualt segue lo stato su ALIVE; un giorno intero di risultati bancati solo in
PLAN per lui non esiste. ALIVE è derivativo ma obbligatorio, stessa commit.

**Why:** l'owner decide sulla vista che legge; se la vista è stantia le
decisioni si prendono su dati vecchi.
**How to apply:** ogni commit di bank tocca PLAN.md E docs/ALIVE.md.

**3. Free coder (pi/openrouter/stealth/ox-alpha) muore alla SCRITTURA FINALE.**
Due volte il 21-22/08: audit completato in testa, stream morto mentre scriveva
il report (idle timeout / no finish_reason). → Nei prompt agli agenti pi:
"scrivi il report su file INCREMENTALMENTE (skeleton subito), il summary in
chat per ultimo". Il resume sul contesto vivo funziona (send_agent_prompt con
"riprendi da dove eri").

**4. `send_agent_prompt` può tornare `status:"idle"` per race** anche quando
il prompt è preso in carico: verificare con `get_agent_status` (turno attivo)
prima di dichiarare l'agente morto. Vale il contrario di sempre: gli agenti
muoiono anche silenziosi → [[paseo-ops-lessons]].

**5. Interessi prodotto di gualt registrati (22/08):** (a) governor termico
CPU↔GPU (coda #24 — partire CPU, switch a GPU cool-mode su soglia skin temp,
isteresi, J/token con charge_counter da misurare: l'ipotesi race-to-idle "CPU
veloce ≈ energia della GPU lenta" è un ricordo, non una misura); (b) voglia di
"roba strafiga": NPU (bocciata con numero: HTP carica 0.67 MiB) e le "proposte
pazze" tipo images nei vecchi PLAN doc → coda #25: rileggere PLAN-archive e
curare una shortlist con criteri di riapertura. **Sera 22/08, tre direttive
esplicite**: (i) **Mali datate = mercato mondiale libero** (Africa/SEA; paper
arXiv 2410.03613: <3% ALU util = gap nel kernel) → coda #26, gate economico sul
Jelly (È un Mali-G57) prima di scrivere kernel; aspettativa onesta: prefill +
cool-mode, NON decode (memory-bound); (ii) NPU per SPIKE compute-bound
(TTFT/embeddings/vision encoder), mai per decode — desk research 22/08 (GO):
backend Hexagon upstream supporta **v73** (S23 dentro), quant SOLO
Q4_0/Q4_1/Q8_0/IQ4_NL/MXFP4 (**K-quant/KEXP mai su HTP**), riferimento 461
tok/s prefill v73 upstream #26094 (caveat nseq≠1→fallback silente), VTCM 8MB
= scratchpad non limite (il "0.67MiB bocciatura" era artefatto da quant non
supportato, non prova di capacità); (iii) "AI-ISP per immagini" → tradotto:
encoder vision su HTP, l'ISP vero è chiuso ai terzi. E "cerchiamo di
sbrigarci": il ritmo conta.

Vedi [[adreno-moe-two-defects]], [[profile-list-is-law]],
[[moe-exp-recovery]].
