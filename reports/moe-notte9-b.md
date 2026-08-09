# Notte 9/8 — BINARIO B (PC): scorer PPL nel decode-path

Agente: subagent esecuzione PC. **Zero run telefono. Zero touch `../ai-chat`. PLAN.md intatto.**

## Commit fork (BigMoeOnEdge)

| | |
|---|---|
| **hash** | `d408e03b6dc872e3ff01674d6e67212330864bcc` |
| **subject** | `feat(cli): add --ppl-decode teacher-forced logprob on the decode path` |
| **branch** | `main` (ahead origin by 9 after this commit; was 8) |
| **fork status post-commit** | clean |

### Diff sintetico (3 file, +174 / −15)

- `core/include/bmoe/session.h` — API `Session::perplexity_decode(text, csv_path)` + doc: stesso target di `perplexity()`, path = decode batch=1 phase-aware.
- `core/src/engine/session.cpp` — implementazione: tokenizza come `perplexity()`; finestre non-sovrapposte ≤ `n_ctx`; per ogni pos: `set_batch_phase(0)` sul primo token della window, `phase=1` dopo; `llama_batch_get_one` + `llama_decode` a 1 token; log-softmax sul gold next; teacher-force del gold come input successivo. CSV identico: `pos,token_id,logprob`.
- `cli/main.cpp` — flag `--ppl-decode PATH` (mutuamente esclusivo con `--ppl-file`); branch unificato di lettura file + open Session; JSON `BMOE_PPL` guadagna `"mode":"decode"|"prefill"`.

Niente fork del calcolo: è il decode di sempre, più la lettura del logprob del target prima del force.

## Build host

| step | esito |
|---|---|
| `cmake --build build-pc -j 8 --target bmoe-cli` (VsDevCmd x64, Ninja, MSVC 14.44) | **OK** → `build-pc/cli/bmoe-cli.exe` |
| `bash -n BigMoeOnEdge/scripts/build-host.sh` | **OK** |
| `bash -n scripts/run_ppl_decode_gate.sh` | **OK** |
| CLI help mostra `--ppl-decode` | **OK** (`bmoe-cli --version` → 0.19.0) |

Nota: `build-host.sh` assume cmake in PATH (Linux/macOS). Su questo host Windows si riusa `build-pc/` già configurato + CMake/Ninja del VS BuildTools.

## Smoke di coerenza (HOST)

Modello campagna presente: `models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf` (anche LFM2-8B-A1B per prova strutturale). Testo: `results/notte9/ppl_decode_smoke/smoke.txt` (Dante, 211 B). Config: `-t 4 -c 256`, **niente drop-cold**, k modello = 8 su Qwen. Artefatti: `results/notte9/ppl_decode_smoke/`.

### Qwen3.6 — ubatch=1 (confronto equo batch≈1)

| scorer | n_scored | sum_logprob | ppl | s |
|---|---:|---:|---:|---:|
| `--ppl-file` (`--ubatch 1` → batch interno 2) | 56 | −46.53232377 | 2.295463 | 8.3 |
| `--ppl-decode` | 56 | −46.53232377 | 2.295463 | 8.0 |

Per-token (56 righe, token_id allineati):

| metrica | valore |
|---|---|
| max \|Δ logprob\| | **0** |
| mean / median \|Δ\| | **0 / 0** |
| n(\|Δ\| > 1e−4) | **0** |
| **VERDICT** | **PASS** (identità bit-a-bit sui logprob stampati a 8 decimali) |

Esempio prime righe (`qwen_u1_diff_table.csv`):

| pos | token_id | lp_prefill | lp_decode | \|Δ\| |
|---:|---:|---:|---:|---:|
| 0 | 175917 | −6.54199728 | −6.54199728 | 0 |
| 1 | 1538 | −0.30831534 | −0.30831534 | 0 |
| 2 | 219869 | −1.57432447 | −1.57432447 | 0 |

### Qwen3.6 — ubatch default (prefill largo vs decode 1)

| scorer | sum_logprob | ppl |
|---|---:|---:|
| `--ppl-file` (batch 256) | −48.21192065 | 2.365353 |
| `--ppl-decode` (batch 1) | −46.53232377 | 2.295463 |

max \|Δ\| per-token ≈ **1.26**, mean ≈ 0.13. **Non è un bug dello scorer**: Qwen3.6 abilita *fused Gated Delta Net* (hybrid recurrent). Prefill chunked e decode AR non condividono lo stesso aggiornamento di stato ricorrente — atteso, non D1-batch-invariant su pure transformer. Con path allineato (ubatch=1) l'identità torna.

### LFM2-8B-A1B (strutturale)

Entrambi i flag OK (rc=0, CSV 63 righe, `mode` corretto). Hybrid GDN pure: default-ubatch max \|Δ\| ≈ 2.12, ma sum_logprob entro ~0.03. Non usato come gate numerico campagna.

## Script gate device (preparato, NON eseguito)

Path: **`scripts/run_ppl_decode_gate.sh`**

- Pin campagna (`lib_campaign_pin.sh` / `bmoe-cli.CAMPAIGN`) come F5.5-A.
- Config: `--moe-stream --cache-mb 2000 --dense-weights anon --overlap --n-expert-used 8 --ppl-decode`.
- Target PPL default **2.779**, tol assoluta **0.05** (stringibile a cavo).
- Scrive `results/.../ppl_decode_gate.{stdout,stderr,per_token.csv,json}` + `STATUS_PPL_DECODE.txt`.
- `bash -n` OK. **Non lanciato stanotte** (mandato: gate device = domani col cavo).

## Blocker / note per il coordinatore

1. **Nessun blocker codice**: commit + build + smoke PASS a path allineato.
2. Gate device ancora da fare: serve binario Android aggiornato con `d408e03` (o cherry-pick) → non è il CAMPAIGN pin attuale (`cab20432…` DENSE2). Prima del gate: rebuild NDK/`bmoe-cli.CAMPAIGN` e ripin SHA.
3. Per confronti prefill-vs-decode su Qwen3.6 hybrid: usare `--ubatch 1` su `--ppl-file`, o confrontare solo decode-vs-decode al variare di drop/k/cache.
4. Telefono / BINARIO A: **non toccati** da questo agente.

## Stato

| item | stato |
|---|---|
| Fork BigMoeOnEdge | clean @ `d408e03` |
| Host build | OK |
| Smoke coerenza | PASS (ubatch=1) |
| `run_ppl_decode_gate.sh` | pronto, non eseguito |
| Report pezzo B | questo file |
