# MANDATO — REAP multilingua di CalaQwen su RunPod (one-shot, ~$30-80)

Potare gli esperti di CalaQwen (Qwen3.6-35B-A3B) con REAP calibrato sulle
**5 lingue prodotto** (corpus `corpus/multi5/` del trial — EN/ES/FR/IT/ZH),
poi la NOSTRA recipe quantize, poi i gate sul device. Obiettivo: working set
−25/30% → hit ↑, I/O ↓, file 12.5→~9 GB, atteso +5-10% decode. RunPod è
autorizzato (spegnere il pod a fine uso — regola fissa).

**Regole:** il CAMPAIGN binario e i modelli sul telefono NON si toccano fino ai
gate; Q8_0 sorgente sul PC NON si cancella; costi pod annotati nel report;
STOP ai gate; mai `complete_goal`.

## FASE A — REAP sul pod

1. Pod GPU (1×A100/H100 80GB basta per calibrazione+slicing di un 35B-A3B in
   BF16/Q8 con offload; annotare tipo/costo orario).
2. Sorgente: upload del Q8_0 (37 GB dal PC) o re-download HF sul pod (più
   veloce: rete pod ≫ upload casalingo — scegliere e annotare; sha256 verificato
   in ogni caso).
3. Tool: REAP ufficiale (Cerebras, repo del paper ICLR 2026 — verificare licenza
   d'uso) o implementazione equivalente dichiarata. Calibrazione: le 5 slice
   multi5 (byte-identiche a quelle del trial, sha a verbale), campioni bilanciati
   per lingua.
4. **Ratio 0.25** (256→192 esperti/layer) come primo punto — prudente; 0.30 solo
   se il paper/nostri dati suggeriscono margine. Router renorm ON.
5. Output: checkpoint pruned (BF16 o Q8) + **imatrix RICALCOLATA sul modello
   pruned** (llama-imatrix sul corpus multi5 — quella di Unsloth non mappa più
   dopo lo slicing degli esperti).

## FASE B — recipe e verifica (pod o PC)

1. Recipe KEXP-style: dense replicati (tipi identici al KEXP), esperti
   gate/up→q2_k, down→q3_k, con la NUOVA imatrix.
2. Dump per-tensor di verifica (la lezione: mai fidarsi del nome).
   Size attesa ~9-9.5 GB. Sha256.
3. Download sul PC, pod SPENTO (verificare e annotare).

## FASE C — gate su device (quando il telefono è disponibile)

1. **bpb sulle 5 slice** (in carica OK) vs CalaQwen non-pruned al default A:
   gate = macro-bpb entro +0.03 E nessuna lingua oltre +0.08 (il pruning non
   deve costare una lingua).
2. **Velocità staccato**: A/B ABBA vs default A, gate = ≥ +4% decode mediano
   (sotto, il pruning non paga il dossier).
3. Smoke KV.

| esito | conclusione |
|---|---|
| entrambi i gate passano | CANDIDATO CalaQwen-REAP: dossier a gualt (file più piccolo + più veloce a qualità tenuta) |
| qualità ok ma velocità < +4% | archiviato MA il file −3.5 GB può valere da solo per lo storage della lineup a due: dossier comunque, decisione gualt |
| qualità fuori gate | REAP chiuso su questo modello, a verbale |

## Deliverable

`reports/moe-reap-multilingua.md`: costi pod, ratio, tabelle bpb e velocità,
verdetto. Artefatti `results/reap/` (no GGUF su git). **STOP — adozione di gualt.**
