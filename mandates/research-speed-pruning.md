# MANDATO — DEEP RESEARCH: tecniche di pruning/sparsità MoE orientate alla VELOCITÀ

**Solo ricerca web.** La domanda è diversa dalla ricerca REAP precedente (che
rispondeva a "si può potare il pool?"): qui si cerca **cosa riduce il CALCOLO
ATTIVO per token o accelera il decode MoE su CPU/ARM** — su edge, senza
infrastruttura di training pesante (LoRA-light su RunPod ok; pretraining no).

Contesto (numeri nostri): CalaQwen (qwen35moe ibrido, 256exp/k=6/drop 0.65)
~5.2 tok/s su S23, compute-bound, GEMV esperti ~40% del wall; Marco (qwen3moe,
256exp/top-8, A0.86B) in valutazione. Leve GIÀ chiuse o possedute: k statico
(6 vivo, 5 da provare), drop-cold cost-aware (miss-only), REAP pool-pruning
(+0-5% velocità: non paga), kernel ik (g<1 su nostro silicio), GPU OpenCL
(morta per ops/driver su S23; 750 in test), speculazione (C(k) rotto sul path
sessione, decomposizione in corso).

## Aree da coprire (per ciascuna: meccanismo, riduce i FLOP ATTIVI?, serve
training? quanto?, tooling pubblico?, applicabilità a qwen35moe/qwen3moe,
stima e2e sui NOSTRI numeri, costo)

1. **k dinamico / expert-skipping adattivo**: routing con k variabile per token
   (confidence/entropy-based; letteratura tipo Ada-K, AdapMoE, DynMoE, expert
   dropping at inference). Cosa funziona SENZA retraining? Che ΔPPL riportano?
2. **Drop-by-weight runtime** (la nostra variante candidata: scartare esperti
   marginali ANCHE se in cache): prior art, soglie, curve qualità.
3. **Expert merging** (MC-SMoE e famiglia): fondere esperti simili invece di
   potarli — riduce il pool E può ridurre k? one-shot o training?
4. **Pruning strutturato DENTRO gli esperti one-shot** (Wanda/SparseGPT-style
   su FFN esperti, senza healing): qualcuno l'ha fatto su MoE? A 2-3 bpw regge?
5. **Sparsità di attivazione runtime** (Deja Vu/PowerInfer neuron-level DENTRO
   gli esperti attivi — diverso dal predittore cross-layer che abbiamo chiuso):
   su SwiGLU (no ReLU) esiste qualcosa di praticabile?
6. **Layer-level**: mixture-of-depths, layer skipping, early exit a inferenza
   su MoE — senza training è mai stato fatto reggere?
7. **Router tricks**: fast-path shared-expert-only per token "facili";
   qualunque cosa 2025-2026 su MoE edge inference acceleration (survey recenti).

**Regole:** [V] con URL+data solo da fonti primarie; NON TROVATO dove manca;
stime e2e con la formula Amdahl esplicita sui nostri numeri; onestà su cosa
richiede training (e quanto costerebbe su RunPod) vs one-shot.

## Sintesi richiesta

1. Tabella tecniche × criteri con verdetto VERDE/GIALLO/ROSSO per fattibilità
   nostra (fork CPU, metro PPL/bpb, RunPod LoRA-light).
2. **Shortlist 1-3** con disegno di esperimento fail-fast ciascuna (gate
   dichiarati, costo, dove gira).
3. Onestà finale: se nulla batte "k=5 + drop-by-weight" (le due frecce già in
   faretra), dirlo.

## Deliverable

`reports/research-speed-pruning.md`. Commit del solo report, NO push.
**STOP al report.**
