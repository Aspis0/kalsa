# Report — fix del riuso KV (re-render byte-identico al prefisso in `kv_tokens`)

**Stato:** G-K1 PASS · G-K2 PASS · G-K3 PARZIALE (telefono riavviato a metà run; A/B mostra che la deriva single-turn non è introdotta dal fix)  
**Data:** 2026-08-08  
**Mandato:** `mandates/kv-reuse-fix.md`  
**Diagnosi:** `reports/moe-kv-reuse-diagnosis.md` (caso 2: match 35/71, rottura su `<think>` vuoto)

---

## 1. Commit + diff

| pezzo | hash | messaggio |
|---|---|---|
| fix fork `BigMoeOnEdge` | `2c675a52abecce529b6a595b617717bbf2fdb282` | `fix(session): keep empty-think prefix byte-identical for multi-turn KV reuse` |
| base precedente | `bd0cb35` | bump tri-state `mmap_prefetch` (fix-bloccanti) |

**Diff (22 righe, solo `core/src/engine/session.cpp`):**

1. **History commit (empty-reasoning only)** — se `final_parsed && reasoning_content.empty() && content != gen`, committa `assistant.content = gen` (stream grezzo). Thinking reale resta parsato; `prefilled_answer` / non-chat intatti.
2. **`preserve_thinking=true`** su ogni `common_chat_templates_apply` — il template Qwen3.6 (GGUF) **scarta** `<think>` sugli assistant passati se `loop.index0 <= last_query_index` e `preserve_thinking` non è true. Con `--no-think` lo span vuoto vive nel *generation prompt* (quindi in `kv_tokens`), non in `gen`; senza questo kwarg il re-render diverge a pos 35 anche con history grezza.

**Nota di esecuzione:** il primo binario con solo (1) ha fallito G-K1 (`n_prompt` t2=108 ⇒ `n_common=0`). Solo (1)+(2) ha sbloccato il riuso. Nessun tocco a `n_common` / `seq_rm`.

Binario gate: `bmoe-cli.KVFIX`  
`sha256 ede3ac7cc91af03da3fcee883c22c6b99d246ae0b0a5c9426674a09608b03178`  
CAMPAIGN / PREFAULT **intatti** (`ad058660…`, `5c95cb5f…`).

---

## 2. G-K1 — il numero che decide — **PASS**

Setup: prompt sha256 `a8471e81e2320558b64760b8ab354277330afe79c7456970cab1a962180f5cc9`,  
`-t 4 -c 2048 -n 32 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --session`,  
t1 `clear_kv=true`, t2 `clear_kv=false`. Telefono in carica (conteggi citabili, secondi indicativi).

| turno | clear_kv | n_prompt | n_past | tokens | prefill_s | n_common (= n_past_t1 se match pieno; qui da n_past−n_prompt−n_gen al t2) |
|------:|----------|---------:|-------:|-------:|----------:|----------------------------------:|
| 1 | true | 39 | 71 | 32 | 5.253 | 0 (KV vuota, atteso) |
| 2 | false | **41** | 144 | 32 | **4.230** | **71** |

- Prima del fix (diagnosi): t2 `n_prompt=108`, `prefill_s≈11.95`, `n_common=0`.  
- Dopo il fix: t2 `n_prompt=41` (solo nuovo user + gen-prompt), `prefill_s≈4.2` (ordine del t1), `n_common=71`.  
- Testo t1=t2 (temp 0): *«La memoria KV è una cache…»* (149 char, sha256 `5590b1ee…aa2e`).

**PASS.**

---

## 3. G-K2 — il riuso non cambia il testo — **PASS**

Controllo usa-e-getta `bmoe-cli.KVCTRL` (stesso albero del fix + forza `n_common=0` dopo il calcolo → ri-prefill completo con la stessa history). Sorgente ripristinata dopo il run; binario lasciato solo come artefatto.

| | sha256 |
|---|---|
| `bmoe-cli.KVFIX` | `ede3ac7cc91af03da3fcee883c22c6b99d246ae0b0a5c9426674a09608b03178` |
| `bmoe-cli.KVCTRL` | `4beb23e1bf46d9b2df2aab723b29e926f7d6e68455a91891d2dcdb4ca05e4500` |
| output t2 KVFIX | `5590b1ee79b435a17102a3960dbbabdf075a35516f1d550487a02ed0ac53aa2e` |
| output t2 KVCTRL | `5590b1ee79b435a17102a3960dbbabdf075a35516f1d550487a02ed0ac53aa2e` |

t2: KVFIX `n_prompt=41` / `prefill_s=4.23` vs KVCTRL `n_prompt=112` / `prefill_s=10.68` — percorsi diversi, **testo byte-identico**.  
**PASS.**

---

## 4. G-K3 — non-regressione single-turn — **PARZIALE**

Config gate F5.5-B / G-A: `-t 4 -c 4096 -n 200 --temp 0 --chatml --no-think --moe-stream --cache-mb 2000 --dense-weights anon --overlap --io-threads 4 --ubatch 512 --n-expert-used 8`, prompt sha verificati = `results/f5.5/b/prompt_sha256.txt`.

| prompt | esito vs `*-k8.gen.txt` | note |
|---|---|---|
| short | **PASS** (sha `9a3f4175…` con trailing `\n` come i ref G-A) | KVFIX ≡ CAMPAIGN ≡ ref |
| f45_1_esplicativo | **≠ ref** (new `6c45cb91…` / ref `2424179f…`) | **KVFIX ≡ CAMPAIGN** byte-identici; entrambi `n_prompt=124` in `--session` |
| f45_2_scrittura | **≠ ref** (parziale pre-reboot) | interrotto |
| f45_3… d1_long | non completati | telefono **riavviato** mid-run (uptime 3 min; affinità cpuset 0–2, `nproc=3`) |

**A/B post-reboot (decisivo per “il fix non regredisce”):**

- `short` e `f45_1`: output CAMPAIGN == KVFIX (stesso `n_prompt`, stesso testo).  
- Path `-p` (non-session) su CAMPAIGN: `n_prompt=121` (come meta F5.5-B); path `--session`: `n_prompt=124`. Differenza di **3 token** legata al percorso session/template, **già presente su CAMPAIGN pinnato**, non introdotta da questo commit.  
- Quindi: dove G-K3 fallisce contro i ref F5.5-B, fallisce **anche** il binario di campagna sullo stesso harness session — non è una regressione del riuso KV.

**Verdetto G-K3: PARZIALE.** short ok; residuali pre-esistenti su CAMPAIGN; suite 8/8 non chiusa per reboot. Non adottare finché non si riallinea l’harness (session vs `-p`) o non si rigenerano i ref sullo stesso path.

---

## 5. Bonus — perché `seq_rm` parziale fallisce

Dal log di load (`gk1b.stderr.log`):

- `n_swa = 0`, `is_swa_any = 0` → **non SWA**.  
- Presenti tensori **SSM/Mamba** (`ssm_d_conv=4`, `ssm_d_inner=4096`, `ssm_d_state=128`, `ssm_n_group=16`) su arch `qwen35moe`.

**Verdetto:** memoria **ibrida attention+SSM (ricorrente)**, non KV unificata pura né SWA. `llama_memory_seq_rm` a posizione intermedia può rifiutare perché lo stato ricorrente non è ritagliabile come una coda KV; il fallback azzera tutto. Con il fix, nel caso append-only chat, `n_common = |kv_tokens|` e il tail da rimuovere è vuoto → `seq_rm` non serve più.

---

## 6. Artefatti

**Telefono** `~/experiments/results/kv_reuse_fix/`:  
`gk1b.{done,stdout,stderr}`, `gk2.*`, `bin_sha.txt`, `kvfix_t{1,2}.txt`, `kvctrl_t{1,2}.txt`, `gk1_in.jsonl`, `chat_template.jinja`, `g3/*` (parziale), binari `bmoe-cli.KVFIX` / `.KVCTRL`.

**PC** `results/kv_reuse_fix/` (copia parziale post-run) + questo report.

**Non toccati:** `../ai-chat`, `PLAN.md`, `bmoe-cli.CAMPAIGN`, `bmoe-cli.PREFAULT`.  
**STOP al report.** Niente adozione, niente pin, mai `complete_goal`.
