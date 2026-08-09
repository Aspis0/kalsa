# MANDATO — DEEP RESEARCH WEB: kernel IQ2/IQ3 veloci su CPU ARM per il GEMV esperti

**Solo ricerca: zero codice, zero telefono, zero build.** Obiettivo: decidere se
"kernel i-quant a mano su CPU" merita il cantiere — con che approccio, che costo e
che soffitto realistico — dopo che la via GPU è stata ritirata (K2/K5,
`research-adreno-opencl.md`).

Contesto (dal PLAN): collo = CALCOLO (I/O esposto 20%); **GEMM esperti ≈ 50% del
calcolo** → ~40% del tempo di decode. Esperti nel nostro GGUF: **IQ2_XXS (80
tensori), IQ3_XXS (37), IQ4_XS (3)**, ~9.77 GB. Dense = Q5_K/Q6_K (NON in gioco
qui). Decode batch=1 → il carico è **GEMV** (matrice×vettore), prefill ubatch 512 →
GEMM. CPU: Snapdragon 8 Gen 2 (1× Cortex-X3 + 2× A715 + 2× A710 + 3× A510), il fork
gira con `-t 4`. Runtime: fork BigMoeOnEdge, submodule llama.cpp `5236140e5`; lo
streaming RIEMPIE i buffer esperti da flash (O_DIRECT/mmap → cache LRU): **il punto
di fill è nostro**, quindi un eventuale repack/layout alternativo al momento del
fill è architetturalmente possibile (rivaluta il vecchio verdetto "repack
irraggiungibile", che valeva per i buffer type di llama.cpp mainline).

**Regole di ricerca:** ogni claim con URL e data; [V] solo da fonte primaria
(repo/commit/PR/paper/codice locale); NON TROVATO invece di riempire buchi;
privilegiare 2024-2026.

## Killer questions (in ordine di potere-di-veto)

### K1 — Com'è fatto OGGI il path IQ2_XXS/IQ3_XXS su ARM in ggml
Nel nostro submodule (`BigMoeOnEdge/llama.cpp`, locale) e in mainline attuale:
`vec_dot` / `mul_mat` per IQ2_XXS e IQ3_XXS su ARM NEON — è vettorizzato davvero o
è dominato da lookup di griglia scalari? Quanto è cambiato tra il nostro submodule
e mainline HEAD (se mainline ha già kernel migliori, il "cantiere" potrebbe essere
un cherry-pick)? SVE2/i8mm/SDOT: il 8 Gen 2 li ha? ggml li usa per le i-quants?

### K2 — Prior art: ik_llama.cpp e affini
**ik_llama.cpp (ikawrakow)** è il prior art centrale: kernel i-quant CPU molto più
veloci (iqk_mul_mat) e varianti repacked (es. `IQ2_XXS_R4`…). Documentare: speedup
PUBBLICATI su ARM (non x86) per IQ2/IQ3, GEMV (tg) e GEMM (pp) separatamente;
licenza e portabilità dei kernel nel nostro fork; quanto è invasivo il porting.
Altri: llamafile (jart) kernel ARM, KleidiAI (copre le i-quants o solo Q4/Q8?),
PR mainline 2024-2026 di ottimizzazione i-quant ARM.

### K3 — Il soffitto fisico: il GEMV IQ2 è compute-bound o memory-bound?
Aritmetica alla lastra: a 41 MiB/token coi byte che passano comunque per la DRAM/
flash, quanto margine c'è tra "tempo a leggere i byte" e "tempo a decodificarli e
moltiplicarli"? Se il dequant (lookup griglia) domina → un kernel migliore paga;
se siamo già vicini al limite di banda → il kernel non può pagare. Cercare numeri
pubblicati di GB/s effettivi dei kernel i-quant ARM vs banda LPDDR5X (~60 GB/s
teorici, molto meno sostenuti). Stimare l'upper bound end-to-end con la formula
S = 1/((1-f) + f/g): f ≈ 0.4 (GEMV esperti sul decode), g = speedup kernel.

### K4 — Il repack al fill: l'angolo che solo noi abbiamo
Il fork controlla il momento in cui i byte dell'esperto entrano in cache. Domanda:
esiste un layout repacked (stile _R4 di ik, o interleaving custom) che renda il
GEMV nettamente più veloce, ripagando un costo di trasformazione una-tantum al
fill? Costo di repack per MiB vs frequenza di riuso (hit rate 77-87%: ogni esperto
in cache viene riusato molte volte). La cache è 2000 MB: il repack cambia la
dimensione (overhead di footprint)?

### K5 — Numerica e gate di campagna
Kernel nuovi = ordine di accumulazione diverso = output NON byte-identici? Come
gestiscono ik/llamafile la riproducibilità? Impatto sul nostro gate 8/8
byte-identico e sul metro PPL (soglia cumulativa 0.15: un kernel esatto non
consuma budget, ma il gate di non-regressione andrebbe ri-baselinato — flag, non
soluzione).

### K6 — Costo del cantiere, onesto
Dall'evidenza (storia dei PR di ik, llamafile, KleidiAI): quante persone-settimane
è costato ottenere quegli speedup? Qual è la via più corta per NOI: (a) cherry-pick
mainline se già migliorato, (b) porting kernel ik nel fork, (c) scrittura ex-novo?
Per ciascuna: stima costo, rischio, speedup atteso [con fonte o dichiarato S].

## Sintesi richiesta

1. Tabella K1-K6 con verdetto VERDE/GIALLO/ROSSO + fonte.
2. Stima end-to-end onesta (aritmetica esplicita, GEMV e GEMM separati: il decode
   è il premio, il prefill è già a posto).
3. **Spike fail-fast raccomandato** con soglie GO/NO-GO — es.: S0 = build ik_llama
   vanilla su Termux e micro-bench GEMV IQ2_XXS sulle shape vere (2048×768?
   leggere le shape dal dump) vs ggml nostro, PRIMA di toccare il fork.
4. Se ROSSO: dirlo chiaro e motivare l'alternativa (integrazione Kalsa? attendere
   upstream?) — non addolcire.

## Deliverable

`reports/research-iq2-kernels.md`. Nessun altro file toccato. Commit del solo
report (Conventional, inglese), NO push. **STOP al report — GO/NO-GO di gualt.**
