# Report NOTTE 9/8 — due binari (telefono a batteria + PC a volontà)

**Data:** 2026-08-08/09 · **Stato:** COMPLETE (entrambi i binari chiusi, nessuna adozione)
**Binario campagna:** `bmoe-cli.CAMPAIGN` = `cab20432…` (DENSE2) · **PREFAULT** intatto
**Regole rispettate:** floor batteria 30%, guardrail attivi, flight recorder sempre, nessuna adozione (solo report), `../ai-chat`/`PLAN.md` intatti.

---

## 1. Celle 3-4 (ripresa dopo indagine riavvio #2) — COMPLETE

Report: `reports/moe-misure-staccato-3.md` (commit `8f87eea`).

### Cella 3 — ubatch 512 vs 2048 @ cache 2000 (d1_long, n=256, 2 rep)

| ubatch | prefill tok/s (rep) | mediana | memfree_min | lmkd |
|---|---:|---:|---:|---:|
| 512 | 12.4 / 10.8 | **11.6** | 13–64 MiB | 0 |
| 2048 | 10.3 / 9.3 | **9.8** | 13–64 MiB | 0 |

**Gain 2048 vs 512: −15.5% → regola FAIL** (serviva ≥+10% ∧ lmkd0 ∧ memfree>300).
**winner_ubatch = 512** (buffer ~0.5 vs ~2.0 GiB; 2048 più lento E più pesante).

### Cella 4 — plateau sostenuto (n=512)

- Decode 128–512: **~3.6–4.2 tok/s** (eval med 4.00); blocco 0-64 include prefill (1.73).
- die decode ~68°C (max 81.8°C). **Nessun throttling hard da staccato** in 512 token.
- Guardrail: **0 scatti** (streak die>88 max ~15.5s < 60s hold) — la lezione del reboot rispettata.

Batteria celle: 56%→45% UNPLUGGED. `screen_off_timeout` ripristinato 1800000. bin_sha256 su 5/5 righe.

---

## 2. Binario A — sweep cache-down (quanta cache serve DAVVERO?)

Report: `reports/moe-notte9-a.md` (commit `6be77ed`). Batteria 45% all'avvio (≥42% → si parte).

### C1500 vs baseline C2000 (mediana 4.608 dalla Cella 2)

| run | tok/s | hit | memfree_min | VmHWM |
|---|---:|---:|---:|---:|
| short r1 | 4.157 | 67.4% | 21 | 3379 |
| short r2 | 3.853 | 67.4% | 20 | 3376 |
| f45_1 r1 | 3.774 | 71.1% | 19 | 3380 |
| f45_1 r2 | 3.982 | 71.1% | 48 | 3380 |

**Mediana 3.9175 → Δ −14.99% vs 4.608 (< −10%)**

**Verdetto: `MIN_SANE_2000`** — 2000 è il minimo sano; il taglio di 500 MiB costerebbe ~15% di tok/s. **C1000 SKIPPED** (non-candidato, come da regola). Batteria fine 41%, guardrail 0 scatti.

**Lettura di prodotto**: il sistema a 2000 vive al limite di headroom (memfree_min 19–48 MiB, VmHWM ~3.4 GiB, hit 67–71%). La cache NON è riducibile senza pagare cara la velocità: la risposta alla domanda "quanta ne serve davvero" è **tutta quella che il budget RAM consente (2000)**, e l'headroom vero per l'app va cercato altrove (non nella cache).

---

## 3. Binario B — scorer PPL nel decode-path (PC, zero telefono)

Report: `reports/moe-notte9-b.md` (fork `d408e03`, report `66e2eef`).

### La modifica (fork `d408e03`, +174/−15)

- `perplexity_decode` in session (batch=1, phase-aware, gold-force) + CLI `--ppl-decode <file>`: percorre il testo **nel percorso di decode normale** (streaming esperti, cache, niente sampling), registra `pos,token_id,logprob` del token vero successivo — stesso formato di `--ppl-file`.
- `BMOE_PPL.mode` per distinguere i due percorsi.

### Smoke di coerenza su host (Qwen3.6, k=8, no drop, testo corto)

| mode | n | sum_lp | ppl | max\|Δ\| |
|---|---:|---:|---:|---:|
| prefill ubatch=1 | 56 | −46.53232377 | 2.295463 | — |
| decode | 56 | −46.53232377 | 2.295463 | **0** |

**PASS** — il decode streamato produce logprob identici al prefill (Δ=0 esatto su ubatch=1). La differenza prefill-largo vs decode è attesa (memoria GDN ibrida), non un bug.

### Gate device — PREPARATO, NON ESEGUITO (come da mandato)

`scripts/run_ppl_decode_gate.sh` pronto (target: riprodurre baseline PPL 2.779 su sottoinsieme corpus prima di qualunque sweep drop-cold). Richiede: **rebuild Android + re-pin CAMPAIGN con `d408e03`** — decisione di gualt, non di stanotte. Il pin attuale (`cab20432`) è ancora pre-scorer.

---

## 4. Stato telefono/batteria (flight recorder)

- 00:00 ≈ 56% → celle 3-4 → 45% → sweep C1500 → **41%** UNPLUGGED (mai sotto floor 30%).
- die: max ~81.8°C (Cella 4), mai oltre; nessun guardrail scattato; nessun riavvio.
- Flight log: `results/staccato3/flight.log` + `results/notte9/cache_down/flight.log`.

## 5. Adozioni — NESSUNA (decisioni a gualt)

| leva | stato | decisione di gualt |
|---|---|---|
| ubatch | 512 confermato (2048 rigettato −15.5%) | adozione conferma o no |
| cache | 2000 = minimo sano (C1500 −15%, C3500 rigettato −62/−68%) | 2000 resta prodotto |
| scorer --ppl-decode | pronto (Δ=0 vs prefill), gate device non eseguito | go al gate device: rebuild + re-pin `d408e03` |

## 6. Cosa non dice

- Le misure sono su batteria da staccato (conteggi ok, timing ok in unplugged): la sessione è stata UNPLUGGED per intero, quindi i tempi sono citabili.
- C1000 non misurato (SKIPPED per regola — C1500 già <−10%).
- Il gate device dello scorer resta da eseguire (domani, col cavo).
- Nessuna decisione di prodotto presa in notte: tutto è report per gualt.
