# moe-calaqwen-fix-session

**Mandato:** `mandates/calaqwen-fix-session.md`  
**Device:** S23 UNPLUGGED · batt ~65%→58% · default A (KEXP + k=6 drop=0.65) · CAMPAIGN `1ca51420…`  
**Artefatti:** `results/calaqwen_s23/fix/`  
**Finestra:** 2026-08-11 ~08:15–09:12 EDT · STATUS **DONE**

---

## PASSO 1 — diagnosi (una riga)

**Cosa era rotto:** (1) JSONL session **senza** `cmd:"generate"`, `id`, `think:false` e trailer `{"cmd":"close"}` (il binario ignora le righe incomplete → 0 turni); (2) anche col formato fixed, `parse_dones` usava **heredoc+stdin** e non leggeva il combo → false 0 DONE.  
**Known-good:** `results/requant1c/run_kv_session_kexp.sh`, `results/adopt_dropcold/conv5/conv5_in.jsonl`.  
**BMOE_DONE esce su stdout** (`BMOE_DONE {json}`), non solo stderr.

### Smoke

| formato | dones | esito |
|---------|-------|--------|
| broken (solo prompt/n_predict/clear_kv) | **0** | reproduce bug |
| fixed (+cmd/id/think/close) | **2** | **PASS** t1 n_past=**71**, t2 n_common=**71**, t2 n_prompt=41 |

---

## PASSO 2 — conv5 TTFT (recuperato)

5 turni, `clear_kv` solo T1, n_predict=256, gold prompts adopt. rc=0.

| turn | n_prompt | n_past | prefill_s | prefill_tps | tok_s | tokens |
|------|----------|--------|-----------|-------------|-------|--------|
| 1 | 96 | **352** | **30.41** | 3.16 | 1.48 | 256 |
| 2 | 87 | **695** | **29.37** | 2.96 | 1.41 | 256 |
| 3 | 782 | 854 | 223.46 | 3.50 | 1.32 | 72 |
| 4 | 92 | **1189** | **30.37** | 3.03 | 1.36 | 243 |
| 5 | 70 | **1350** | **24.70** | 2.83 | 1.38 | 91 |

**Lettura TTFT:** sui turni “normali” (1,2,4,5) prefill resta **~25–30 s** nonostante n_past cresca (KV reuse: T2 n_past=352+256+87).  
T3 ha n_prompt anomalo (782) e prefill lungo — possibile ri-serializzazione history / early EOS; non usare T3 come riga TTFT canonica.  
**Riga scheda:** TTFT multi-turno ≈ **~28 s prefill/turno** (mediana T1/T2/T4/T5), non degradante col contesto.

---

## PASSO 3 — N1 v2 (recuperato)

### Controllo decode

| | tok_s | t_decode1 = 1/tok_s |
|--|-------|---------------------|
| ctrl_decode1 | 1.369 | **0.730 s** |

(Nota: ctrl lento vs scheda ~5 tok/s — device fresco/throttling post-conv5; soglia 0.3·t1 resta **0.219 s/tok**.)

### Tabella k (tutte OK, n_prompt = 14+k esatto)

| k | n_prompt | prefill_s (med 2 rep) | prefill_tps med |
|---|----------|------------------------|-----------------|
| 0 | 14 | **5.13** | 2.73 |
| 8 | 22 | **8.56** | 2.58 |
| 32 | 46 | **14.64** | 3.14 |
| 64 | 78 | **24.00** | 3.25 |
| 128 | 142 | **42.36** | 3.35 |
| 256 | 270 | **76.79** | 3.51 |

12/12 celle **OK** (niente SCARTATA).

### Fit `t_prefill = F + m · n_prompt` (12 punti)

| | |
|--|--|
| **F** | **2.025 s** |
| **m** | **0.2785 s/tok** |
| **R²** | **0.9994** |
| se(m) | 0.00218 |
| IC95(m) | [0.2743, 0.2828] |
| 0.3 · t₁ | 0.219 |
| m ≤ 0.3·t₁? | **NO** (0.279 > 0.219) |

**Verdetto N1 (regole mandato):** **EPITAPH_SPEC** — F fisso c’è (~2 s), ma **m non è ammortizzabile** rispetto a t₁ (anche con t₁ “buono” ~0.18 s da scheda, m≫0.3·t₁). Prefill scala quasi perfettamente col prompt → costo non è solo overhead di sessione.

One-shot `-p` ~128 token: eseguito (artefatto `n1/oneshot.*`); non ribalta il fit session.

**Conseguenza:** **non** dossier riapertura MTP-spec da questi numeri; epitaffio spec **confermato** sul path session/prefill misurato. Decisione gualt se servono altre misure (decode-only t₁ caldo, o protocollo diverso).

---

## PASSO 4 — energia / segno current

| stato | current mediano (µA) | segno |
|-------|----------------------|-------|
| idle UNPLUGGED 30 s (questa run) | **−173 500** | scarica |
| idle scheda (pre/post B1) | −430 000 | scarica |

- **In carica non campionato** questa run (device rimasto UNPLUGGED) — nota a verbale.
- Convenzione draw: `I_draw = max(0, I_idle − I)` (più negativo = più assorbimento).
- Ricalcolo J/token celle scheda con questa convenzione:

| cella | J/tok ricalcolato |
|-------|-------------------|
| sos_short_r1 | 0.023 |
| sos_short_r2 | 0.075 |
| long thermal | 0.147 |
| **mediana** | **0.075** |

vs scheda precedente **0.455** → **Δ −83%** (>15%) → **CORREGGERE la riga scheda**.

**Correzione proposta:** J/token staccato **non affidabile al livello 0.45**; con convenzione draw-vs-idle mediana **~0.08 J/tok** (range 0.02–0.15) — ancora **stima flight grezza**; per prodotto dichiarare **“energia: ordine 0.05–0.15 J/tok (flight 1 s, caveat idle)”** oppure **NON CITARE** un singolo J/tok fino a calibrazione con shunt / campioni in carica.

Aggiornamento in `moe-calaqwen-scheda.md` (riga energia): declassare 0.455 → nota di correzione.

---

## Deliverable checklist

| item | stato |
|------|--------|
| Diagnosi 1 riga | ✅ |
| Smoke broken vs fixed | ✅ |
| Tabella conv5 + n_past | ✅ |
| Tabella N1 + fit + verdetto | ✅ **EPITAPH_SPEC** |
| Energia segno + ricalcolo | ✅ UNPLUGGED only; correzione scheda |
| Artefatti `results/calaqwen_s23/fix/` | ✅ |

**STOP ai gate.** Riapertura MTP-spec: **no** (numeri N1).
