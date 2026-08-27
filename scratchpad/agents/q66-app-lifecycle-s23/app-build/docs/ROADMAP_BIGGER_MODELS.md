# Roadmap tecnica: modelli più forti su telefono (2026-08-03)

Obiettivi dichiarati:
1. **Ambizioso**: far girare un MoE di classe 23-35B (Gemma 4 26B-A4B, Qwen3.6 35B-A3B) su un telefono da 8GB.
2. **Di prodotto (più importante)**: far girare *qualcosa di buono* su telefoni da **6GB+**, che sono il mercato di massa.

Regola: **non inventiamo nulla**, adattiamo tecniche pubblicate e già dimostrate.

---

## Il vincolo vero: banda, non capacità

L'intuizione naturale ("tengo i 3B attivi in RAM e il resto su SSD") sottovaluta un fatto: in un MoE
gli esperti attivi **cambiano a ogni token e a ogni layer**. Non esiste un sottoinsieme fisso da
tenere residente.

Qwen3.6-35B-A3B: 35B totali, **3B attivi**, 256 esperti (8 routed + 1 shared per token), architettura
ibrida Gated DeltaNet + Gated Attention (stessa famiglia del Qwen3.5 che l'app già usa).

| Grandezza | Valore |
|---|---|
| Parametri attivi per token | ~3B |
| Peso attivo a IQ2 (~2,5 bit) | **~0,9 GB per token** |
| Banda richiesta per 10 tok/s | **~9 GB/s** |
| UFS 4.0, lettura sequenziale | ~4 GB/s (accesso casuale: molto meno) |

→ Streaming ingenuo da flash = **1-3 tok/s**, inutilizzabile. Il collo di bottiglia è la **banda per
token**, non la RAM.

La via d'uscita pubblicata è la **località degli esperti**: token consecutivi riusano in larga parte
gli stessi esperti. Con una cache degli esperti caldi (hit 85-90%) il traffico effettivo cala di
5-10× e si rientra in banda. È il principio di PowerInfer-2 e della famiglia SmallThinker.

---

## Tecniche valutate

| Tecnica | Cosa dà | Maturità | Funziona con llama.cpp/llama.rn oggi? | Verdetto |
|---|---|---|---|---|
| **Quant IQ3/IQ2 con imatrix** | modello di classe superiore nello stesso ingombro | produzione | **sì** | **Fare subito** |
| **KV cache quantizzata (q8_0/q4_0)** | centinaia di MB sul contesto lungo | produzione | **sì** (già nel profilo) | **Già fatto, sfruttare meglio** |
| **MoE + expert offload/streaming** | modello molto più forte a RAM simile | sperimentale su mobile | parziale (mmap + override tensori) | **Esperimento misurato** |
| **SmallThinker-21B-A3B** (famiglia PowerInfer) | 15-23 tok/s su Snapdragon top, 8-11 GiB | open, nato per Android | motore proprio | **Candidato serio per il target 8GB** |
| **DraftExpert** (arXiv:2607.24434, lug 2026) | **1,45×** su MoE con expert offload; accettazione draft 84-87%, prefetch hit 86-88%; testato su DeepSeek-V2-Lite e Moonlight-16B-A3B, scenari CPU→GPU e **Flash→NPU mobile** | paper, **niente codice pubblico** | no (richiede training dei draft expert per distillazione) | **Secondo passo**, solo se il MoE gira |
| **PowerInfer-2 originale** | 47B su telefono | paper/demo | no | Scartato: richiede modelli sparsificati ad hoc, 16-24GB, stack custom |
| **antirez/ds4** | motore DeepSeek V4 Flash/PRO | maturo su desktop | no | **Scartato**: modello ~284B per macchine 64-512GB; offload RAM↔VRAM, non flash→NPU; port = riscrittura |
| **ZeRO Stage-3** | sharding memoria in **training** | produzione (server) | irrilevante | **Scartato**: tecnica di addestramento multi-GPU, nessun analogo su singolo telefono |
| **NPU nativa (QNN/ExecuTorch)** | velocità/consumi | frammentata | no (fuori da llama.rn) | Scommessa di piattaforma, non prossimo passo |

---

## Ordine di esecuzione consigliato

1. **IQ3/IQ2 nel catalogo** — aggiungere una voce di classe 7-14B quantizzata IQ3_M/IQ2_S e
   **misurarla col benchmark Fase 0/4 che ora esiste**. È l'unico modo onesto di sapere se
   "più grande ma più compresso" batte "più piccolo ma preciso" sul telefono reale.
   Riferimento qualità: Q4_K_M ≈ 99% del BF16, Q3 ≈ 95%, IQ2 ≈ 87% (eval Unsloth).
2. **Target 6GB** (priorità di prodotto): profilo dedicato con modello denso IQ3/IQ4 (~2-2,5GB),
   n_ctx conservativo, KV q4_0. Obiettivo: l'app *funziona bene* sulla fascia media, non solo sui top.
3. **Esperimento MoE con offload** su telefono, misurando tok/s reali con llama.cpp (mmap +
   override dei tensori degli esperti). Serve a rispondere a una domanda sola: **la banda regge?**
   Nessun porting richiesto per scoprirlo.
4. **Solo se (3) regge**: valutare SmallThinker/PowerInfer come motore alternativo (fork, non
   sostituzione) e **poi** DraftExpert come moltiplicatore di velocità.

## Fonti
- DraftExpert — https://arxiv.org/abs/2607.24434
- PowerInfer-2 (47B su smartphone) — paper e limiti discussi in `docs/` research notes
- SmallThinker / famiglia PowerInfer — motore open orientato ad Android
- Qwen3.6-35B-A3B, taglie GGUF e qualità per quant — schede unsloth/HF
- antirez/ds4 — https://github.com/antirez/ds4 (Metal/CUDA/ROCm, DeepSeek V4)
