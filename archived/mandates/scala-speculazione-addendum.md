# ADDENDUM alla scala speculazione — la macchina è GIÀ nel submodule

Scoperta a valle della lettura Muse Glimmer (2026-08-10): il NOSTRO submodule
(`third_party/llama.cpp`, pin `5236140e5`) contiene già l'intero stack speculativo:
`docs/speculative.md`, `src/models/dflash.cpp`, `--spec-type
{draft-simple,draft-eagle3,draft-dflash,draft-mtp,ngram-*}`, flag di scheduling
eterogeneo (`--spec-draft-device`, `--spec-draft-ngl`, `--spec-draft-cpu-mask`),
statistiche di acceptance stampate (`draft acceptance rate = …`), e il conversion
script con `_Qwen35MtpMixin` (teste MTP Qwen3.5/3.6 → naming nextn standard).
I GGUF MTP del nostro esatto modello esistono (unsloth Qwen3.6-35B-A3B-MTP-GGUF;
ggml-org Q8_0-MTP 37.8 GB). Questo cambia la scala così:

## N2 potenziato → misura DIRETTA con la macchina vera (PC, llama-server vanilla)

Invece del solo confronto artigianale draft-vs-testi:
1. Build host `llama-server` dal submodule (vanilla, zero patch — regola AGENTS).
2. **N2-mtp**: scaricare su PC un GGUF MTP del nostro modello (taglia gestibile dal
   PC: anche IQ1_M 11.37 GB va bene per MISURARE L'ACCEPTANCE — non la qualità;
   annotare il caveat: acceptance su quant più povera = stima conservativa... e
   se il PC regge, meglio una quant più alta). `--spec-type draft-mtp` sui prompt
   IT di campagna (stessi testi f5.5), leggere le statistiche stampate:
   **acceptance rate + token accettati per draft**.
3. **N2-eagle3/dflash**: cercare su HF un drafter EAGLE-3 o DFlash trainato per
   Qwen3.6-35B-A3B (o famiglia compatibile — la lista in docs/speculative.md
   include Qwen3-a3B). Se esiste: convertire con `--target-model-dir` e misurare
   come sopra. Se non esiste: NON TROVATO a verbale, resta il draft semplice.
4. **N2-draft-simple**: il piano originale (piccolo denso stessa famiglia, hash
   tokenizer verificato) resta come terza colonna del confronto.

Deliverable N2 aggiornato: tabella acceptance per meccanismo (mtp / eagle3-dflash
se esiste / draft-simple / ngram-mod come floor), stessa soglia: **α ≥ 60%** per
il VERDE. Il meccanismo vincente informa il cantiere.

## N3 ricontestualizzato

`--spec-draft-device` e `--spec-draft-ngl` esistono già: se il draft è un modello
separato, il wiring GPU è config, non codice. N3 resta la misura del tok/s draft
su Adreno (invariata). Se invece vince **draft-mtp**, N3 cambia natura: il costo
draft è la testa MTP sul CPU (attaccata al forward del target) — da misurare come
overhead per token draftato, non come modello separato.

## Nota per il futuro cantiere (non per questa scala)

- La macchina spec vive in llama-server/common, non nell'API che il fork usa
  (`core/` usa l'eval-callback + API pubbliche; regola AGENTS: mai patch in-tree).
  Il cantiere dovrà portare il loop draft/verify nella session bmoe — la scala
  deve dire SE conviene, il come è del cantiere.
- Rollback su GDN ricorrente: verificare come llama-server gestisce il reject di
  draft su modelli ibridi Qwen3.5/3.6 (checkpoint di stato?). Un run N2-mtp su PC
  che produce testo CORRETTO (confronto greedy vs non-spec) è già la prova
  empirica che il rollback ibrido funziona nella macchina stock — aggiungere
  questo check di byte-identità al protocollo N2.
- Se 1c (requant esperti) passa i suoi gate: la stessa pipeline può rifare il
  quant dalla sorgente **Q8_0-MTP** → un solo file con esperti k-quant E testa
  MTP. Le due porte compongono in un file solo. Da valutare DOPO i verdetti.
