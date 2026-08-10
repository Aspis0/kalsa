# MANDATO — DEEP RESEARCH: la nuova ondata di MoE a basso attivo come candidati campagna

**Solo ricerca: zero build, zero telefono.** Obiettivo: matrice comparativa dei MoE
2026 "totale grosso / attivo piccolo" come possibili successori di Qwen3.6-35B-A3B
nella campagna, con shortlist motivata per un TRIAL sul nostro banco (metro PPL IT
+ celle velocità con harness esistente). Il target di prodotto dichiarato da gualt:
**15-20 tok/s su S23** → serve attivo ≤2.5B; il vincolo di campagna: totale che NON
entra in 8 GB di RAM a 2-4 bpw (lo streaming resta il punto); il vincolo Kalsa:
la multimodalità pesa (Qwen la dava via mmproj).

**Candidati da valutare (lista di gualt, estendibile se emergono pari-classe):**
SenseNova U1-A3B-MoT · JetBrains Mellum2-12B-A2.5B-Thinking ·
moondream/moondream3.1-9B-A2B · nc-ai-consortium/VAETKI-20B-A2B ·
LiquidAI/LFM2-24B-A2B (+ nota: LFM2-8B-A1B è già sul telefono, arch lfm2 già
supportata dal nostro stack — è il floor di paragone naturale).

**Regole:** [V] solo da fonte primaria con URL e data; NON TROVATO invece di
riempire; privilegiare 2026. Ogni candidato una riga per criterio.

## Criteri (colonne della matrice, in ordine di veto)

1. **Arch in llama.cpp**: supportata in mainline/nostro submodule? (nome arch GGUF,
   PR/commit). Ibrida (SSM/SWA)? Vincoli noti (rollback KV, ops mancanti)?
2. **Attivo/totale**: parametri attivi per token (target ≤2.5B), totale, sparsità,
   n_experts/k, dimensioni esperto (rilevanti per streaming e cache slot).
3. **Footprint**: GGUF disponibili? A che quant? Size a ~2-4 bpw → sta sopra gli
   8 GB (streaming necessario) o ci entra (campagna diversa)?
4. **Italiano**: multilingua dichiarato/benchmark; tokenizer (vocab, fertilità
   sull'italiano se documentata). Mellum=code-first e VAETKI=KR-first: verificare
   se l'IT è di prima o terza classe.
5. **Multimodalità**: visione nativa o mmproj; stato del supporto llama.cpp.
6. **Velocità attesa su ARM**: numeri pubblicati su smartphone/ARM per la famiglia;
   in assenza, stima dal conto attivo×bpw (dichiarata [S]).
7. **Licenza** e disponibilità pesi (BF16 per la nostra recipe? imatrix?).
8. **Segnali di qualità** (benchmark indipendenti, non vendor-only, con caveat).

## Sintesi richiesta

1. Matrice completa candidati × criteri con verdetto VERDE/GIALLO/ROSSO per cella.
2. **Shortlist 1-2 candidati** per il trial sul banco, con motivazione e con la
   lista esatta dei file da scaricare (repo, file, size, sha se esposti).
3. Disegno del TRIAL (fail-fast): quali celle del nostro harness girare (PPL
   decode-path sul corpus IT — nota: serve tokenizzare il NOSTRO corpus col
   tokenizer del candidato, le PPL non sono confrontabili cross-tokenizer:
   dichiarare come normalizzare, es. bits-per-byte sul corpus), velocità n=200
   ABBA vs KEXP, streaming smoke sul fork (arch discovery).
4. Onestà: se nessun candidato batte il percorso "KEXP + griglia + REAP-IT"
   su qualità-IT×velocità attesa, dirlo — cambiare modello costa un dossier
   intero e si fa una volta sola.

## Deliverable

`reports/research-lowactive-moe.md`. Commit del solo report, NO push.
**STOP al report — la scelta modello è di gualt.**
