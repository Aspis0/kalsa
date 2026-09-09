# MANDATO — 1c: fabbricare il GGUF che non esiste (esperti k-quant, dense invariato)

Il buco 1 ha provato il meccanismo (g_formato=1.297 sul nostro silicio) ma il file
pronto non esiste (1b: il "Q2_K_XL" ha esperti i-quant). Lo fabbrichiamo noi:
requant CHIRURGICO dei soli esperti da sorgente Q8_0 con l'imatrix di Unsloth,
dense replicato identico al nostro IQ2_M. Aspettativa a verbale: **+5-10% decode**
(GO_CONDIZIONATO), PPL entro +0.02 a parità di drop.

**Regole fisse:** binario CAMPAIGN `1ca51420…` INVARIATO (il file cambia, il codice
no); PREFAULT intatto; il GGUF di campagna IQ2_M NON si tocca né si sposta; lavoro
pesante su PC; device solo per i gate; guardrail+flight; floor 30%; timing solo
staccato; PPL in carica OK; non toccare `../ai-chat`; STOP ai gate.

## FASE A — fabbricazione (PC; verificare PRIMA ~55 GB liberi sul disco)

1. **Download** (PC, `moe-experiments/models/` o disco con spazio):
   - `unsloth/Qwen3.6-35B-A3B-GGUF → Qwen3.6-35B-A3B-Q8_0.gguf` (36 903 140 320 B,
     sha vs LFS oid);
   - `imatrix_unsloth.gguf_file` (192 223 904 B, sha).
2. **Recipe per-tensore**: generare `results/requant1c/tensor_types.txt` DAL dump
   `results/gguf_ud-iq2m_dump.txt`: ogni tensore NON-expert → il tipo esatto che ha
   in IQ2_M (Q5_K/Q6_K/Q4_K/F32); esperti → override:
   - `ffn_gate_exps` / `ffn_up_exps` (IQ2_XXS in IQ2_M) → **q2_k**
   - `ffn_down_exps` (IQ3_XXS) → **q3_k**
   (verificare la sintassi accettata da `--tensor-type-file` nel quantize.cpp del
   submodule prima di generare; se il matching è per pattern e non per nome pieno,
   usare i pattern e VERIFICARE sul dump di output che il mapping sia quello voluto).
3. **Quantize** (host build del submodule): `llama-quantize --imatrix <imatrix>
   --tensor-type-file <recipe> [--allow-requantize se richiesto da sorgente Q8_0]
   Q8_0.gguf → Qwen3.6-35B-A3B-KEXP.gguf <tipo base coerente>`. Annotare il comando
   esatto e il log.
4. **Dump di verifica del file prodotto**: esperti = Q2_K/Q3_K, dense = identico a
   IQ2_M tipo per tipo. Qualunque divergenza → correggere la recipe e rifare, non
   procedere. Size attesa ~13.5-14 GB. Byte/esperto nuovi a verbale (impatto slot
   cache 2000: attesi ~−14% slot).
5. Sha256 del file, push sul telefono (`~/experiments/models/`), spazio flash
   verificato prima.

## FASE B — gate qualità (device, IN CARICA ok: tutto deterministico)

Col binario CAMPAIGN e config di campagna, `--ppl-decode` sullo stesso subset 10k:
- PPL(KEXP, F=0) vs **2.0955**;
- PPL(KEXP, drop 0.65) vs **2.19992**.

| esito | conclusione |
|---|---|
| entro **+0.02** a parità di drop (o migliore) | GO alla FASE C |
| tra +0.02 e +0.05 | GIALLO: riportare, decide gualt se vale la velocità |
| oltre +0.05 | **1c CHIUSO**: il k-quant a questi bpw non tiene la qualità degli i-quant — a verbale e stop |

Smoke KV (due turni, n_past=71) col file nuovo: il fix KV non dipende dal quant,
ma va verificato.

## FASE C — gate velocità (device, STACCATO, batteria ≥ 45%)

A/B protocollo standard (ABBA per prompt, cold per run, 2 prompt × 2 rep, n=200,
drop 0.65 per ENTRAMBI): A = IQ2_M, B = KEXP. Metriche solite + MiB/tok e hit
(il file più grosso paga in I/O e slot: è nel conto).
Sostenuto n=512 con B (1 run): eval + die.

| esito decode (mediane pooled E per-prompt a verbale) | conclusione |
|---|---|
| B ≥ A + **5%** su entrambe le viste | **CANDIDATO CAMBIO MODELLO** — dossier a gualt (nuova baseline PPL, budget lossy riazzerato sul file nuovo, curva drop da rifare) |
| B ≥ A + 5% solo pooled | dossier con la vista onesta, decide gualt |
| B < A + 5% | 1c chiuso: il +30% di GEMV non sopravvive a I/O+hit — a verbale con la scomposizione |

## Deliverable

`reports/moe-requant-1c.md`: comando quantize esatto, dump verifica, PPL con Δ,
tabella A/B, scomposizione onesta (GEMV guadagnato vs I/O/hit pagati), verdetto
per fase. Artefatti `results/requant1c/` (no GGUF su git, solo sha e meta).
**STOP ai gate — il cambio modello è di gualt.** Il Q8_0 sul PC NON si cancella
senza ok di gualt (serve per eventuali recipe successive).
