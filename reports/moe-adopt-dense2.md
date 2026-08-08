# Report — adozione DENSE2 (re-pin) + esperimento mincore sul residuo

**Data:** 2026-08-08  
**Mandato:** `mandates/adopt-dense2.md`  
**Decisione gualt:** DENSE2 adottato (dominanza stretta su ogni asse vs CAMPAIGN pre-pin).

---

## PASSO 1 — re-pin

| | sha256 |
|---|---|
| **VECCHIO** CAMPAIGN | `ede3ac7cc91af03da3fcee883c22c6b99d246ae0b0a5c9426674a09608b03178` |
| **NUOVO** CAMPAIGN (= DENSE2) | `cab204321d478931be1332f816fe5ed6a6fa26bde632dde45af9bf002fa0d6c8` |
| DENSE2 (copia nominata, resta) | `cab204321d478931be1332f816fe5ed6a6fa26bde632dde45af9bf002fa0d6c8` |
| PREFAULT (intatto) | `5c95cb5fe2cc97f3b7a0ae4245ccca4975236b2a29f1be393d9e33ca055f059d` |
| KVFIX rimosso (superseded) | `ede3ac7cc91af03da3fcee883c22c6b99d246ae0b0a5c9426674a09608b03178` |

Procedura: `chmod u+w` → `cp bmoe-cli.DENSE2 → bmoe-cli.CAMPAIGN` → `chmod a-w` → `CAMPAIGN.sha256` aggiornato **dopo** verifica che lo sha del file copiato = `cab20432…` del report dense2.

### Smoke post-pin

Config lampo: `-t 4 -c 2048 -n 32 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --session`  
Prompt sha256 `a8471e81e2320558b64760b8ab354277330afe79c7456970cab1a962180f5cc9` (newline finale).  
Input: t1 `clear_kv=true`, t2 `clear_kv=false`. Binario: `bmoe-cli.CAMPAIGN` (nuovo pin).  
Batteria PLUGGED_AC 100 %, die pre-start ~43 °C, nproc≥6.

| turno | clear_kv | n_prompt | n_past | tokens | prefill_s | n_common |
|------:|----------|---------:|-------:|-------:|----------:|---------:|
| 1 | true | 39 | 71 | 32 | 4.232 | 0 (atteso) |
| 2 | false | **41** | 144 | 32 | 3.946 | **71** (= 144−41−32) |

**Smoke a — PASS** (`n_common=71`, `n_prompt(t2)=41`). Testo t1≡t2 (temp 0).

**Smoke b — PASS** (stderr load):

```
bmoe: expert-mmap: dropped 9313 MiB
bmoe: dense-anon: memcpy=1029 odirect=635 ranges_fallback=458
```

Firma DENSE2 presente sul pin.

Artefatti: `results/adopt_dense2/smoke/`.

---

## PASSO 2 — DIAG2 mincore a fine capture warm-up

Domanda: la metà non-residente del dense sparisce **durante** il warm-up o **dopo** (tra fine warm-up e conversione)?

- Build usa-e-getta `bmoe-cli.DIAG2` (base tree DENSE2 + **una** riga temporanea in `session.cpp` subito dopo la costruzione del vettore dense, **prima** di `set_dense_tensors` / `source.init` → quindi prima di rebind esperti, drop expert-mmap, conversione anon).
- Piano: `pio::vm_resident_sample` su ogni `DenseTensorRef` (mincore page-by-page sul range mmap ancora live).
- Log: `bmoe: DIAG dense-resident-at-warmup-end: <MiB> / 1664`
- 1 run cache fredda (`cold_model.sh` / fadvise), config G-A campagna, prompt `short`, `-n 8`.
- Sorgente ripristinato da backup; DIAG2 scartato; rebuild pulito senza stringa DIAG.

| misura | valore |
|---|---:|
| **DIAG dense-resident-at-warmup-end** | **899 / 1664 MiB** |
| dense-anon alla conversione (stesso run) | memcpy=900 odirect=764 ranges_fallback=586 |
| expert-mmap dropped | 9313 MiB |
| memcpy mediano report dense2 (riferimento) | ≈815 MiB |

Artefatti: `results/adopt_dense2/diag2/`.

---

## Verdetto (tabella mandato)

| soglia | lettura |
|---|---|
| ≥ ~1400 MiB | reclaim DOPO warm-up → riordino recupera |
| ≤ ~900 MiB | reclaim DURANTE warm-up → riordino non recupererebbe |
| in mezzo | decide coordinatore |

**Misura: 899 MiB ≤ ~900** e allineata al memcpy di conversione (900 MiB nello stesso run; ≈815 mediano dense2).

**Verdetto: residuo CHIUSO definitivamente.**  
Il reclaim della metà non-residente avviene **durante** (o entro la fine di) il capture warm-up, non tra warm-up e conversione. Un riordino drop-esperti / conversione dense **non** recupererebbe le pagine già assenti a fine warm-up. Si passa oltre: nessun mandato di riordino da questo esperimento.

---

## Stato pin post-mandato

| binario | sha256 | note |
|---|---|---|
| CAMPAIGN | `cab20432…` | = DENSE2, read-only |
| DENSE2 | `cab20432…` | copia nominata |
| PREFAULT | `5c95cb5f…` | intatto |
| KVFIX / DIAG2 / KVCTRL | — | rimossi |

Fork sorgente: nessuna modifica permanente (patch DIAG2 ripristinata).  
Non toccati: `../ai-chat`, `PLAN.md`, decode path.

## Blocker

Nessuno.

DONE
