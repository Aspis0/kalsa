# MANDATO — SPIKE fail-fast: kernel i-quant ik_llama sul NOSTRO S23 (g misurato decide)

Obiettivo unico: misurare **g_kernel** = speedup TG di ik_llama.cpp vs llama.cpp
mainline sulle i-quants, **sul nostro silicio** (8 Gen 2 a frequenze termiche vere,
non M2-Max). Il numero decide se aprire il cantiere del port (4-10 p-settimane per
+10-15% decode) o chiudere il capitolo kernel. Base: `reports/research-iq2-kernels.md`.

**Regole fisse:** NON toccare il fork BigMoeOnEdge, né i binari CAMPAIGN/PREFAULT,
né `../ai-chat`. Tutto lo spike vive in directory separate (`~/src/ik_llama.cpp`,
`~/src/llama.cpp-ref`, `~/experiments/results/spike_iq2/`). Guardrail attivi
(lib con ABORT_MEM combinato post-knee), flight recorder, floor batteria 30%,
`screen_off_timeout` ripristinato a fine. STOP ai gate, mai `complete_goal`.

## S0 — setup (in carica va bene: sono build e download)

1. **ik_llama.cpp**: clone `https://github.com/ikawrakow/ik_llama.cpp`, build CPU
   Termux (path Android validato dal loro PR #336). Annotare commit sha.
2. **Riferimento mainline**: build `llama-bench` dal NOSTRO submodule
   (`~/src/BigMoeOnEdge/third_party/llama.cpp`, commit già noto) — è il confronto
   che conta: i kernel che il fork usa oggi. NON usare mainline HEAD come riferimento
   (quants.c è comunque byte-identico, verificato in ricerca).
3. **Modello di bench**: un GGUF DENSO piccolo in **IQ2_XXS** (~2-3 GB, es.
   Llama-3.1-8B o simile già quantizzato su HF; dichiarare repo+sha). Denso, non MoE:
   replica il metodo #164 e isola il vec_dot. Se esiste anche in **IQ3_XXS** a costo
   piccolo, scaricare pure quello (il nostro down_exps è IQ3_XXS).
4. `bash -n` sugli script; tutto sotto `~/experiments/results/spike_iq2/`.

## S1 — misure (STACCATO, batteria ≥ 40%: sono TIMING, la regola è la regola)

Config fissa: `-t 4`, stesso modello, stesso file, ordine **ABBA** (mainline, ik,
ik, mainline) per neutralizzare la deriva termica, die annotato a ogni run,
2 rep per cella. fadvise cold prima di ogni run (parità di stato pagine).

| ID | run | metrica |
|----|-----|---------|
| M1 | mainline `llama-bench -p 0 -n 128 -t 4` | tg128 t/s |
| M2 | ik `llama-bench -p 0 -n 128 -t 4 -rtr 1` | tg128 t/s |
| M3 | entrambi `-p 512 -n 0` | pp512 t/s (controllo GEMM, 1 rep basta) |
| M4 | (se IQ3_XXS scaricato) ripetere M1/M2 | tg128 t/s |

**g = mediana(M2) / mediana(M1)** per quant. Riportare anche i valori singoli e le
temperature: se le due mediane vengono da regimi termici diversi, dirlo.

## Regole di decisione (dichiarate ORA — le stesse della ricerca)

| esito g su IQ2_XXS (@ -t 4) | decisione |
|---|---|
| **g ≥ 1.30** | **GO**: si scrive il piano del port selettivo (iqk mul_mat/mul_mat_id per IQ2_XXS/IQ3_XXS + repack-al-fill) — mandato a parte, gualt decide |
| **1.20 ≤ g < 1.30** | GO **condizionato**: solo se il repack-al-fill si stima ≤1 p-settimana e l'e2e atteso ≥ +8% |
| **g < 1.20** | **NO-GO**: capitolo kernel CHIUSO, plateau ~4.4 = soffitto onesto flash+CPU |
| build ik fallisce su Termux dopo 2 tentativi seri | documentare errore esatto; GIALLO (blocco di build, non fisica) — STOP e riportare |

Il 4.7× su pp512 (M3) NON entra nella decisione: è controllo di sanità (se M3 non
mostra il gap atteso, qualcosa è storto nel setup) e upside prefill da annotare.

## Deliverable

`reports/moe-spike-iq2.md`: sha di ik e del modello, tabella M1-M4 run per run con
die e batteria, g per quant, verdetto secondo le regole, e (se GO) la lista dei
file/funzioni ik da portare con una stima aggiornata del costo. Artefatti in
`results/spike_iq2/` (+ mirror PC leggero, NO GGUF). **STOP al report — il GO al
cantiere è di gualt.**
