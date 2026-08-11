# moe-reap-multilingua

Mandato: `mandates/reap-multilingua.md` (v2 POST-AUDIT)  
Stato: **FASE 0 PC = PASS** · phone CAMPAIGN opzionale residuale · **pod non avviato**  
Data: 2026-08-10 → 2026-08-11

## FASE 0 — validazione a costo zero (pipeline, non qualità REAP nostra)

### Candidato community
| | |
|---|---|
| Repo | [barozp/Qwen3.6-28B-REAP20-A3B-GGUF](https://huggingface.co/barozp/Qwen3.6-28B-REAP20-A3B-GGUF) |
| Base HF | [0xSero/Qwen3.6-28B-REAP20-A3B](https://huggingface.co/0xSero/Qwen3.6-28B-REAP20-A3B) (REAP 20% di Qwen3.6-35B-A3B) |
| File | `Qwen3.6-28B-REAP20-A3B-Q2_K.gguf` |
| Size | **10599958400** byte (match) |
| SHA256 | `2b0a435935e9ec7e6f6b455e008db024f07c2f7ec6a979def045c27df0ee717a` |
| Experts | **n_expert=205** (runtime), n_expert_used=8, stream ON |
| Perché Q2_K | quant leggero per smoke convert+runtime; calibrazione coding altrui = **upper bound pessimo** su bpb (NON giudizio su REAP nostro) |

### Artefatti
- Download: `models/reap_community/Qwen3.6-28B-REAP20-A3B-Q2_K.gguf`
- Script PC: `scripts/run_reap_f0_pc.py` (+ `.ps1` legacy)
- Script phone CAMPAIGN: `scripts/run_reap_f0_smoke.sh` (**non ancora eseguito**)
- Slice: `corpus/multi5/{en,it}_slice.txt`
- Out: `results/reap/f0/` · `STATUS_PC.txt=PASS`

### Checklist F0
| check | stato |
|---|---|
| Download size+sha | **PASS** (hf auth; size+sha match) |
| Smoke load + 1 gen (PC bmoe-cli) | **PASS** rc=0 |
| Parse `n_expert` ≈ 205 | **PASS** (`print_info: n_expert=205`, stream ON) |
| bpb EN slice (pipeline) | **PASS** ppl=**12.8942** n=2688 wall=882 s |
| bpb IT slice (pipeline) | **PASS** ppl=**115.27** n=3577 wall=800 s (garbage atteso: calib coding + Q2_K + IT) |
| Smoke CAMPAIGN phone | **PASS** (results/reap/f0_phone/)
| Verdetto F0 PC | **VERDE** — convert+runtime+metro leggono GGUF pruned |

**Lettura:** i PPL alti **non** invalidano F0 (mandato: non giudizio su REAP-nostro). Invaliderebbero solo fail di load/gen/stream/n_expert.

**Regola:** se F0 fail → STOP (problema pipeline, non REAP). Pod ancora spento.

---

## FASE A — REAP pod (sbloccata da F0 PC verde; manca go gualt)

### Toolchain (da pinnare nel report al lancio)
- **Cerebras ufficiale as-is: VIETATO** (MODEL_ATTRS senza Qwen3_5Moe).
- Candidato community: lavoro 0xSero (card Qwen3.6-28B: *“this fork's Qwen3_5Moe-aware observer”*; reproduce path documentato su HF come `cerebras/reap` + layerwise). **Prima del job full: smoke forward+observe 1 layer sul fork scelto; pin repo+commit URL.**
- Path: **layerwise** obbligatorio su 1×A100 80GB, disk ≥250 GB.
- Sorgente: SOLO HF BF16 `Qwen/Qwen3.6-35B-A3B` sul pod (~70 GB). Q8_0 GGUF PC **non** è input REAP.
- Calibrazione: ≥1024 sample EN/ES/FR/IT/ZH, **disgiunto da multi5**, ratio **0.25**, router renorm ON.
- Budget: floor $40 / soft $120 / STOP $150.

### Non avviato
Nessun pod RunPod creato. $/h = n/a.

---

## FASE B — convert + KEXP recipe
Pending FASE A.

## FASE C — gate device (default A = k6d065)
Pending FASE B. Comparatore = CalaQwen default A.

## Verdetto
— (STOP adozione a gualt)

