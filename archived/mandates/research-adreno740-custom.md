# MANDATO — DEEP RESEARCH: LLM su GPU Adreno "vecchie" (740/7xx) SENZA il path Qualcomm

**Solo ricerca web.** Tesi di gualt da verificare: *qualcuno ha già fatto kernel
custom che fanno andare gli LLM sulla GPU dei vecchi Adreno* — aggirando il
problema che ha chiuso la nostra porta S23 (driver 0676.73 senza subgroup
broadcast → il path GEMM Adreno-ottimizzato di llama.cpp degrada e perde
contro la CPU).

Il punto tecnico da tenere fermo: il subgroup broadcast è un REQUISITO DEL
KERNEL di llama.cpp, non del silicio — un GEMM si scrive anche con tiling in
local memory. La domanda è: **c'è evidenza misurata che su Adreno 740/8 Gen 2
il decode LLM possa battere la CPU con kernel diversi?**

## Piste da battere (per ciascuna: numeri tg/decode su 7xx, quale driver,
tecnica kernel, licenza, portabilità verso il nostro stack)

1. **MLC-LLM / TVM**: kernel generati+autotunati per Adreno, demo su
   Snapdragon 8 Gen 1/2 dal 2023. Numeri DECODE (non prefill) su 740: quanto?
   vs CPU dello stesso device? Che tecniche usano (local memory? vectorized
   loads? img2col su texture?)?
2. **ML Drift** (arXiv 2505.00232, già citato nella nostra ricerca GPU):
   bench dichiarati su Adreno 740/750 — estrarre i numeri decode e la tecnica.
3. **MNN / MNN-LLM (Alibaba)**: backend OpenCL Adreno-tuned; numeri LLM su 7xx?
4. **CLBlast** (+ il vecchio backend CLBlast di llama.cpp, rimosso 2024):
   database di tuning per Adreno; qualcuno l'ha rimesso sotto un LLM di recente?
5. **Vulkan su 740**: il driver Vulkan è SEPARATO dal driver OpenCL — le
   subgroup ops Vulkan potrebbero esserci dove quelle CL mancano. Evidenza di
   llama.cpp Vulkan corretto+veloce su 740 con driver 2025-2026 (il "gibberish"
   era ott 2025 — è stato fixato?). Qual è lo stato del driver Vulkan del S23?
6. **Kernel custom community**: repo/blog/fork di chiunque abbia scritto GEMM
   OpenCL no-subgroup per Adreno con numeri LLM (anche cinesi: la scena
   MNN/mllm/InferLLM è attiva lì).
7. **Aggiornamento driver**: esiste QUALUNQUE via senza root per aggiornare il
   driver OpenCL/Vulkan su S23/OneUI (APK Qualcomm, moduli GSI, update OneUI
   che lo porti)? O il 0676.73 è il capolinea del device?

## Il numero che decide

Per ogni pista: **tg/decode tok/s su Adreno 7xx vs CPU dello stesso SoC**, con
fonte primaria. La tesi è provata se ESISTE un caso misurato GPU > CPU su
decode con un modello ≥1B. Se tutti i casi trovati sono prefill-only o GPU <
CPU, la tesi è refutata e la porta S23 resta chiusa per fisica-del-regime
(batch=1 decode), non per pigrizia di Qualcomm — dirlo senza addolcire.

## Sintesi richiesta

1. Tabella piste × (decode tok/s 7xx, vs CPU, driver, tecnica, licenza, costo
   di porting verso noi).
2. Verdetto sulla tesi di gualt: PROVATA / PARZIALE / REFUTATA, con la pista
   migliore.
3. Se provata: disegno fail-fast per il S23 (cosa buildare/misurare, gate).
   Nota: qualunque porting di kernel nel nostro stack = fork llama.cpp locale
   (policy AGENTS) — includere il costo di manutenzione nella stima.

## Deliverable

`reports/research-adreno740-custom.md`. Commit del solo report, NO push.
**STOP al report.**
