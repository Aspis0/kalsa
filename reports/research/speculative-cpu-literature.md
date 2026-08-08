# Perché la speculazione perde su CPU (e su MoE streamato perde tre volte)

**Data:** 2026-08-08 · **Fonte:** ricerca letteratura a valle della chiusura F6
(A/B tre bracci `ai-chat` su Qwen3.5-4B + nostro trace F5). Questa nota è l'epitaffio
motivato di F6: tre meccanismi indipendenti, ciascuno con letteratura a supporto.

## 1. Roofline: il "pranzo gratis" esiste solo in regime memory-bound

Su GPU il decode batch=1 è fortemente memory-bound (tensor core con TFLOPS enormi vs
bandwidth HBM): verificare K token invece di 1 usa compute che sarebbe rimasto fermo —
quasi gratis. Su CPU il rapporto compute/bandwidth è molto più basso: verificare K token
costa ~K× il compute.

- **Nightjar** (arxiv.org/pdf/2512.22420): in prospettiva roofline la speculazione alza
  l'intensità aritmetica sfruttando il regime memory-bound; vicino al regime compute-bound
  l'overhead di verifica può *ridurre* il throughput.
- **OpenInfer** (openinfer.io, 2025-08-05): sui sistemi compute-bound la speculative
  decoding peggiora le prestazioni; l'overhead del draft rallenta l'inferenza.

**Il nostro caso**: compute-bound conclamato — expert GEMM = 50.5% del compute, ceiling
7.8 tok/s, h* = 0.82 superato. Siamo esattamente nel regime dove la letteratura predice
la perdita.

## 2. DFlash e MTP sono progettati per GPU

- **NVIDIA** (developer.nvidia.com, DFlash su Blackwell): drafter block-diffusion che
  genera un intero blocco in un forward pass — lavoro block-parallel pensato per saturare
  i tensor core. Su CPU quel forward diventa lavoro seriale extra: paghi il drafter pieno
  senza il parallelismo che lo giustifica.
- I numeri "1.4-2.2×" per Qwen3.6 MTP (unsloth.ai/docs) sono misurati via vLLM/SGLang su
  GPU (backend NVFP4): fuori regime non sono mai stati validati. Il nostro risultato CPU
  non li contraddice — li estende fuori dal loro dominio di validità.

## 3. Expert scattering: il meccanismo specifico dei MoE (il più grave per noi)

Verificando K token in parallelo su un MoE, ogni posizione può instradare a esperti
diversi → serve l'**unione** degli esperti attivati dai K token.

- **MoE-SpeQ** (arxiv.org/html/2511.14102): l'unione gonfia drasticamente calcolo e
  accessi memoria dei layer MoE; applicare naively la speculazione ai MoE è spesso
  controproducente.
- **EcoSpec** (arxiv.org/html/2607.12696): la latenza di verifica scala linearmente col
  numero di esperti attivi — penalità rigida per ogni esperto extra.

**Il nostro caso è il caso limite**: ammortamento byte fra token consecutivi misurato =
**0.00%** sul nostro trace (miss@t ∧ miss@t+1, F5). L'unione è la somma piena: per noi lo
scattering non è un'attenuante statistica, è il massimo teorico della penalità.

## La controprova che delimita il confine (da NON dimenticare)

- **InventiveHQ** (benchmark CPU-only): drafter classico su **denso 3B** → 12.9 → 22.1
  tok/s (**1.72×**). Su CPU memory-bound con acceptance alta la speculazione PUÒ vincere.
- **dev.to (MTP)**: il fallimento più comune è acceptance < ~60% — paghi i draft senza
  token indietro.

Quindi la frase giusta non è "la speculazione su CPU non funziona": è **"funziona solo
memory-bound, con acceptance alta, e senza scattering MoE"**. Noi falliamo tutte e tre le
condizioni contemporaneamente: compute-bound (1), drafter GPU-native (2), scattering al
massimo teorico (3).

## Condizioni di riapertura di F6 (criteri, non sensazioni)

F6 si riapre solo se almeno una delle tre condizioni cambia regime:
1. verifica offloadata su GPU/NPU (Adreno/HTP) → torna l'headroom di compute;
2. drafter con acceptance dimostrata ≥60% sul nostro carico italiano;
3. routing con overlap fra token consecutivi ≫ 0 (altro modello o altro router) — da
   rimisurare col trace, non da assumere.
