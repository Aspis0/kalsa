# Report — chiusura dei tre bloccanti dell'audit loader-fix

**Data:** 2026-08-08  
**Mandato:** `mandates/fix-bloccanti-audit.md`  
**Audit di riferimento:** `reports/audit-loader-fix.md` (9317479)  
**Ordine eseguito:** A → C → B (obbligato)

---

## 1. Commit

| pezzo | hash | messaggio |
|---|---|---|
| fixup submodule (tri-stato) | `e5605f3bd3545867b2eb2581c96fd7042e243541` | `mmap: fix ABI compatibility of mmap_prefetch (tri-state int32_t)` |
| session.cpp (`-1`) | `5e6778c6dbee6e0e443b6e20f7f7a8c252e64c60` | `session: set mmap_prefetch=-1 when expert streaming is enabled` |
| bump puntatore submodule | `bd0cb35e256b0246abb9ed93afa32efd87d0e9cc` | `submodule: bump llama.cpp to tri-state mmap_prefetch fixup` |

Base del fixup: `206a8fe7f` (niente rebase/amend). Branch submodule: `kalsa/mmap-prefetch-opt`.

### Messaggio del fixup (testo integrale)

```
mmap: fix ABI compatibility of mmap_prefetch (tri-state int32_t)

Corrects the compatibility claim of 206a8fe7f. With the previous bool
encoding, aggregate/value-init (llama_model_params{} or incomplete
positional initializers) zeroed mmap_prefetch to false and silently
disabled whole-file prefault for callers that never touched the field.
That violated the stated invariant "everyone else is unchanged".

Encode the field as int32_t still appended at the end of
llama_model_params:

  0  = auto (prefault active, historic behavior)
  1  = prefault forced
 -1  = prefault disabled

llama_model_default_params() sets 0. load_tensors wires
ml.init_mappings(params.mmap_prefetch >= 0, ...), so prefault is off
ONLY on an explicit -1. Zero-init therefore reproduces the pre-patch
behavior, and callers that stream experts set -1.

Branch: kalsa/mmap-prefetch-opt (fixup on top of 206a8fe7f; no rebase).
```

### Wiring runtime

- `llama.h`: `int32_t mmap_prefetch` in coda alla struct (offset esistenti invariati).
- `llama_model_default_params()`: `0` (auto).
- `llama-model.cpp`: `ml.init_mappings(params.mmap_prefetch >= 0, …)`.
- `session.cpp`: dentro `if (cfg.moe.enabled)` → `mparams.mmap_prefetch = -1`.

---

## 2. GATE G-A — non-regressione 8/8

Config: identica al gate originale (`--moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8 --temp 0`). Prompt sha256 verificati prima del lancio (tutti coincidono con `results/f5.5/b/prompt_sha256.txt`). Binario: `bmoe-cli.ABI_FIX` (= CAMPAIGN).

| prompt | sha256 output (new = ref) | esito |
|---|---|---|
| short | `9a3f4175a08474fa9bf4339fac11b085449e3787cc23ed8ab848775d0cb3a008` | PASS |
| f45_1_esplicativo | `2424179fe22e5cfed996029c1b3646795af28950bed80c963a2240dca5915675` | PASS |
| f45_2_scrittura | `71216127365912c87c03f8908cee38d794b5f262e60092d6083fa6bf5616be13` | PASS |
| f45_3_istruzioni | `baadf7b31955c23a4bdc69058eccb23e662b595abfaeed08c34fbb727caaceb0` | PASS |
| f45_4_codice | `d9c57c56fa8af23b126b5e0e36f6b61a7f07895f1a250cae46ed0b9b0b621376` | PASS |
| f45_5_ragionamento | `9397d763d446894d37b46be3a6d26b8b8bd8c515d018fdbc7779d2d673e71741` | PASS |
| long_conversational_it | `64f6f2bd655ca0f5e50b51259fd67a4e0dca80569db1b09b8a4ef539be1f2d41` | PASS |
| d1_long | `50b17f329c6c19fcb269ead312504c25a18e9b5bbde5d7ae477855b0d93c21c6` | PASS |

**PASS=8 FAIL=0.** Il percorso runtime non cambia (solo codifica del campo).

---

## 3. sha256 dei binari

| binario | sha256 | note |
|---|---|---|
| `bmoe-cli.CAMPAIGN` | `ad058660f42e7c4029cfe76979d891d38db341c631720237bb45e4b40e97cb17` | pin di campagna; `chmod a-w`; file `CAMPAIGN.sha256` |
| `bmoe-cli.PREFAULT` | `5c95cb5fe2cc97f3b7a0ae4245ccca4975236b2a29f1be393d9e33ca055f059d` | riverificato intatto; **non usabile** come ctrl post-ABI (SIGSEGV 139 con libllama nuova) |
| `bmoe-cli.G3P` | `a17e58ffb3e3b1bfdfb7c7c2086b4c2f6153e565ddb3a29f41a75deda034e050` | strumentale: stesso tree ABI, `mmap_prefetch=1` (prefault forzato). **Non** binario di campagna |
| `bmoe-cli.G3N` | `ad058660f42e7c4029cfe76979d891d38db341c631720237bb45e4b40e97cb17` | = CAMPAIGN (stesso tree, `mmap_prefetch=-1`) |
| `bmoe-cli.NEW` (pre-mandato) | `7354947b8a16cce01dbcaf9ac79c6a4b6f9f74a1fe29eabe4c53d315a69d1331` | predecessore bool; non toccato |

---

## 4. Pin del binario di campagna (Parte C)

### Script harness che lanciano `bmoe-cli` — elenco completo

Default path aggiornato a `…/bmoe-cli.CAMPAIGN` + assert pin (sha vs `CAMPAIGN.sha256`, abort se mismatch, override solo `ALLOW_UNPINNED=1`):

**Via `run_bench.sh` (pin centralizzato + colonna `bin_sha256`):**
- `scripts/run_bench.sh` — helper `lib_campaign_pin.sh`, default bigmoe → CAMPAIGN, colonna CSV in coda
- `scripts/run_f4.sh`
- `scripts/start_f4.sh`, `start_f4_3bis.sh`, `start_f4_4.sh`, `start_f4_compute.sh`

**Lancio diretto del binario (pin iniettato dopo `BIN=`):**
- `scripts/run_f5_4_bd2_only.sh`
- `scripts/f55a_ppl_baseline.sh`, `f55a_ppl_split.sh`, `f55a_regression.sh`
- `scripts/f56_run_scale_rest.sh`
- `scripts/start_f4_5_quality.sh`, `start_f4_7_batt_curve.sh`, `start_f4_9.sh`, `start_f4_9_b.sh`
- `scripts/start_f5_1.sh`, `start_f5_2.sh`, `start_f5_3.sh`, `start_f5_4.sh`
- `scripts/start_f5_4_resume.sh`, `start_f5_4_resume2.sh`, `start_f5_5_b.sh`
- `results/f5.5/b/start_f5_5_b.sh`
- `results/f5.6/run_scale_rest.sh`
- `results/f5.4/run_bd2_only.sh`, `results/f5.4/d1/run_d1_only.sh`

Helper: `scripts/lib_campaign_pin.sh`.

Esclusi di proposito (non misure di campagna): `build_bmoe_*.sh`, `preflight_llama_isa.sh`, `cold_model.sh`, `test_*.sh`, `status_tick*.sh`.

### Esempio riga `runs.csv` (colonna `bin_sha256` in coda)

Header (ordine invariato + append):

```
run_id,date,phase,model,quant,file_gb,runtime,runtime_commit,flags,threads,n_ctx,kv_type,n_gen,run_type,prompt_id,prompt_tok_s,eval_tok_s,ttft_ms,majflt_delta,minflt_delta,read_bytes_delta,vmrss_peak_mb,memfree_min_mb,batt_temp_start,batt_temp_end,battery_pct,expert_hit_rate,nproc,affinity_mask,notes,bin_sha256
```

Esempio (sintetico):

```
Qwen3.6-35B-…-20260808-145000,2026-08-08T14:50:00-0400,F5.x,Qwen3.6-35B-A3B-UD-IQ2_M.gguf,UD-IQ2_M,11.52,bigmoe,bd0cb35,--moe-stream …,4,4096,q8_0,200,warm,short,5.3,4.5,14146,0,12,11069036544,2707,,28.1,29.0,45,,7,0f,ok,ad058660f42e7c4029cfe76979d891d38db341c631720237bb45e4b40e97cb17
```

---

## 5. B0 (confine) e G-B (sampler)

### B0 — confine load→warm-up

**Riga scelta:** `bmoe: expert streaming ON  n_expert=…`  
(stampata da `expert_stream_source.cpp` a fine setup streaming, dopo dense-weights anon / drop mmap).

Verifica su **entrambi** i bracci (G3P e CAMPAIGN):
- la riga compare in stderr timestampato in entrambi i binari (`boundary_src=primary`);
- prima della riga: rate `read_bytes` ~0.9–1.1 GB/s (I/O sequenziale di load);
- dopo la riga: rate cala a ~0.4–0.5 GB/s (prefill/decode O_DIRECT per-token, non bulk prefault).

Secondarie osservate (non usate come metrica): `set_abort_callback: call`, `dense-weights=anon — dropped … mmap pages` (immediatamente prima del primary).

**Nota PREFAULT storico:** `bmoe-cli.PREFAULT` (sha `5c95cb5f…`) con le libllama post-ABI va in **SIGSEGV 139** dopo `set_abort_callback` (stdout vuoto, stderr troncato a 1070 righe vs 1074). Per questo il ctrl di G3 è `bmoe-cli.G3P` (stesso tree ABI, solo `mmap_prefetch=1`), come previsto dal mandato quando la riga esistente non è affidabile sul binario storico.

### G-B — sampler locale ~200 ms

Loop **sul telefono** in Python: legge `/proc/<pid>/io` e `VmHWM` ogni `time.sleep(0.2)`; check termico solo ogni ~2 s (non nel hot path). Niente round-trip ssh per campione.

| metrica | valore |
|---|---|
| n intervalli (B0) | 197 |
| mediana | **0.201 s** |
| p95 | **0.221 s** |
| min / max | 0.200 / 0.570 s |
| istogramma `≤` | `{0.2:1, 0.3:195, 0.6:1}` (resto 0) |

**G-B PASS** (mediana ≤ 400 ms e p95 ≤ 600 ms).

---

## 6. Tabella G3 e verdetto

Config: cache pagina fredda (`cold_model.sh` / fadvise GGUF) prima di **ogni** run; prompt short inline del G3 originale (`Say hello in one short sentence.`); n=8; telefono in carica (conteggi citabili, secondi indicativi).

| braccio | rep | read_bytes_at_load | GiB | rchar | GiB | VmHWM MiB | wall_s (indic.) | n_samp | confine |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| CTRL (G3P, prefault ON) | 1 | 22 625 873 920 | 21.072 | 1 770 735 200 | 1.649 | 4653.6 | 25.6 | 126 | primary |
| CTRL (G3P) | 2 | 22 571 843 584 | 21.022 | 1 770 735 156 | 1.649 | 4618.0 | 25.1 | 123 | primary |
| NEW (CAMPAIGN, prefault OFF) | 1 | 11 064 815 616 | 10.305 | 1 770 735 227 | 1.649 | 2704.0 | 16.2 | 80 | primary |
| NEW (CAMPAIGN) | 2 | 11 073 257 472 | 10.313 | 1 770 734 822 | 1.649 | 2710.9 | 17.9 | 88 | primary |

**Mediane:**

| | CTRL | NEW | Δ |
|---|---:|---:|---:|
| read_bytes_at_load | 22 598 858 752 (21.05 GiB) | 11 069 036 544 (10.31 GiB) | **−51.0 %** |
| rchar_at_load | 1 770 735 178 (1.649 GiB) | 1 770 735 024 (1.649 GiB) | ~0 |
| VmHWM MiB | 4635.8 | 2707.5 | −41.6 % |
| wall_s (indicativi, in carica) | 25.4 | 17.0 | — |

Ripetizioni entro arm: scarto < 1 % su `read_bytes_at_load` → terza rep non richiesta.

### Verdetto (regole del mandato)

- nuovo < ctrl di **≥ 40 %** su `read_bytes_at_load` → **G3 CONFERMATO**
- riduzione misurata: **51.0 %**
- `rchar` del braccio nuovo ~ **1.65 GiB** (≈ F4.8 storico 1.6 GiB) → la contaminazione del G3 originale (rchar 3.2–3.4 GiB) era del vecchio sampler / confine sbagliato; annotato.

I numeri assoluti di questa tabella **sostituiscono** i vecchi di `reports/moe-loader-fix.md` / audit G3.

CSV grezzi: `results/g3-redo/raw/runs.csv`, per-run `results/g3-redo/runs/*.{io.csv,summary.txt}`, B0/B1 in `results/g3-redo/b0|b1/`.

---

## 7. Note operative / rischi

1. **`bmoe-cli.PREFAULT` non è più un ctrl valido** dopo il rebuild di `libllama.so` con tri-stato: il binario vecchio (bool) + lib nuova (int32_t) → SIGSEGV a fine load. Resta come via di ritorno storica (sha intatto); per misure serve G3P o un rebuild del tree prefault con le lib attuali.
2. Il pin di campagna è `bmoe-cli.CAMPAIGN` + `CAMPAIGN.sha256`; un `make` distratto non sposta più le misure senza `ALLOW_UNPINNED=1`.
3. G3P/G3N sono usa-e-getta (strumentali); non adottarli come default.

---

## 8. STOP

Nessuna adozione oltre quanto scritto. `PLAN.md` e `../ai-chat` non toccati. Mai `complete_goal`.
