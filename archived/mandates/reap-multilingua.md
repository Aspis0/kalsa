# MANDATO — REAP multilingua di CalaQwen su RunPod (v2 POST-AUDIT)

> v2 riscritta dopo audit ostile (`scratchpad audit-reap`, 2026-08-10): 4 BLOCKER
> corretti (toolchain ibrida, formato sorgente, convert mancante, leak di
> calibrazione) + attese ricalibrate. L'audit ha inoltre imposto una FASE 0 a
> costo zero che valida convert+runtime PRIMA di accendere qualunque pod.

Obiettivo: potare ~25% degli esperti di CalaQwen (256→192/layer) con REAP
calibrato sul dominio multilingua, poi recipe KEXP, poi gate device.
**Attesa ONESTA (post-audit): decode +0-5% (siamo compute-bound; REAP non riduce
gli esperti ATTIVI) — il valore certo è il file ~9.5 GB (−3 GB) per lo storage
della lineup a due modelli.** Il ramo "storage-only" è il più realistico.

**Regole:** CAMPAIGN binario e modelli telefono intoccati fino ai gate; Q8_0 PC
non si cancella; pod **on-demand** (no spot), **spento** a fine uso; budget:
floor $40, **soft-cap $120, STOP a $150** senza checkpoint utile; $/h reale a
verbale; STOP ai gate.

## FASE 0 — validazione a COSTO ZERO (PC + device, prima di qualunque pod)

Scaricare un GGUF community REAP di Qwen3.6 già esistente (es. derivati RangerX
ratio 0.2/0.3 — Q4 o simile, sha a verbale) e:
1. smoke load col binario CAMPAIGN + 1 generazione (il runtime legge `n_expert`
   dagli hparams: verificare che 192/205 esperti streamino davvero);
2. bpb rapido su 2 slice (EN+IT) — NON è un giudizio su REAP-nostro (calibrazione
   coding altrui = upper bound pessimo), è la prova che convert+runtime+metro
   funzionano sul formato pruned.
**Se la FASE 0 fallisce → STOP e riportare: il problema è pipeline, non REAP.**

## FASE A — REAP sul pod (solo dopo FASE 0 verde)

1. **Toolchain PINNATA (BLOCKER F1)**: fork REAP con supporto
   `Qwen3_5Moe`/packed experts dichiarato — repo + commit URL nel report. Il
   Cerebras ufficiale as-is è VIETATO (MODEL_ATTRS non ha la nostra arch:
   crash o hook silenziosamente mancato). Prima del job full: smoke
   forward+observe su 1 layer.
2. **Sorgente (BLOCKER F3)**: SOLO checkpoint HF BF16 `Qwen/Qwen3.6-35B-A3B`
   scaricato SUL pod (~70 GB; il Q8_0 GGUF non è un input REAP valido).
3. **Pod**: 1×A100 80GB on-demand, **disk ≥250 GB**, path **layerwise**
   obbligatorio (`pruning-layerwise-cli.sh` o equivalente del fork — full-model
   observe non sta in 80 GB). Se layerwise fallisce sull'ibrido → STOP e
   riportare con stima multi-GPU, NON escalare da soli.
4. **Calibrazione (BLOCKER F6)**: dataset **≥1024 sample** multilingua
   bilanciati (EN/ES/FR/IT/ZH; chat+prosa, fonti dichiarate), **DISGIUNTO da
   multi5** — multi5 resta SOLO gate (calibrare sul metro = leak). Ratio
   **0.25**, router renorm ON.
5. Checklist post-prune (F5): `config.json num_experts=192`, router rows
   sliced, shared expert intatto.

## FASE B — convert e recipe (pod; BLOCKER F4 corretto)

```
HF pruned BF16 → convert_hf_to_gguf.py (arch qwen35moe) → GGUF BF16/Q8
  → llama-imatrix sul GGUF pruned (corpus di calibrazione, NON multi5)
  → llama-quantize recipe KEXP (tensor_types patterns riusati) + imatrix nuova
  → dump per-tensor verifica (esperti q2_k/q3_k ×192, dense identici) + sha
  → download PC → POD OFF (verificato e annotato)
```

## FASE C — gate su device (config = default A, k6d065)

1. bpb 5 slice multi5 vs CalaQwen default A: macro entro +0.03, nessuna lingua
   oltre +0.08. **Se fail: cella di ablazione a k8/drop0** (F16: il triplo
   taglio REAP+k6+drop065 non è ortogonale — capire chi rompe cosa).
2. Velocità ABBA vs default A: **gate +4% dichiarato AMBIZIOSO** — sotto, vale
   il ramo storage-only (dossier comunque: −3 GB è valore autonomo).
3. Smoke load + KV.

| esito | conclusione |
|---|---|
| qualità+velocità passano | CANDIDATO CalaQwen-REAP (dossier completo) |
| qualità ok, velocità flat | dossier STORAGE-ONLY (file −3 GB per la lineup) — decisione gualt |
| qualità fuori anche a k8 | REAP chiuso su questo modello |

## Deliverable

`reports/moe-reap-multilingua.md`: FASE 0, toolchain pin, costi orari e totali,
tabelle bpb/velocità, ablazione se servita, verdetto. `results/reap/` (no GGUF
su git). **STOP — adozione di gualt.**

## Correzione documentale (dall'audit, F20)

Il PLAN contiene la frase "REAP già esteso all'architettura Qwen3.5" riferita
all'upstream: è FALSA (estensioni solo community). Corretta dal coordinatore.
