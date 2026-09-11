# G2 Next Items Recon — 2026-09-11

Read-only recon. Next 5 G2 code/device items still OPEN, cheapest first.

Scope: PLAN §16–18 (session contract, cache, stop/edit/regen) + §21–23 (complete chat CPU, memory/embedding/tool scheduling, HyperOS bug, idle/ready).
G1 closed 10/09 with LFM. G2 gate: 23 Sep — complete chat on CPU path.

Already DONE (not re-listed): G1 LFM; stop/edit/regen; Copy; EMA withhold; extract-cancel Nuova chat + HOME on S23; model-switch bounded dispose; session hash unify `2619db0`.
Conversation-switch during extract = HARNESS_MISS, not product FAIL.

---

## 1. Device restore of session hash fix `2619db0`

**Why it exists:** `2619db0` unified the load/save hash paths (`promptEnvToolHashFields`), fixing the `no_file` symptom where Jelly `c906727` saved `ok:true` but load found nothing because load hardcoded `hasTools=true` while save used `toolCallingEnabled`. Code + CI + parent jest 18/18 are done. Device verification on the `2619db0` APK is explicitly not done yet.

**Permalink:** PLAN.md:566 — "Device restore on this APK is not done yet."

**Cost:** Low. Install APK on Jelly, kill process after a save, relaunch, confirm `load ok:true tokens ≠ 0`. Repeat on S23. ~30 min manual.

---

## 2. Token reuse observability in continuation prefill

**Why it exists:** M1 §13 requires "token riutilizzati osservabili." S23 `1807aad` loaded `ok:true tokens 1867` but the following turn evaluated 1890 tokens in 37 s — the continuation re-evaluated from near-scratch. The `promptMs` log exists but no log reports how many cached tokens were actually reused vs re-evaluated. Without this, G2 "recupero corretto e token riutilizzati osservabili" (PLAN §16–18 checkpoint) cannot be declared met.

**Permalink:** PLAN.md:566 — "S23 `1807aad` did load `ok:true` tokens 1867 / prewarm `kv_holds_chat` skip, but the following turn still evaluated 1890 tokens in 37 s — not yet 'token riutilizzati osservabili'."

**Cost:** Low–medium. Add a log line in `LlamaService.ts` continuation path reporting `n_common` (tokens reused from cache) and `n_new` (tokens re-evaluated) after the prefill call. CI + one-device smoke. ~1–2 hours code + test.

---

## 3. Functional suite on three physical devices (tools, documents, voice, 20–30 turns)

**Why it exists:** PLAN §21–23 explicitly requires "Suite funzionale sui tre fisici, tool simulati ripetibili più smoke rete reale, voce/documenti e 20–30 turni" for the G2 gate on 23 Sep. The product-suite evidence so far is scoped单项 (stop, edit, copy, extract-cancel, etc.) on Jelly and S23 only; no Xiaomi device pass; no multi-turn sustained conversation on any device; no voice/document E2E on S23 or Xiaomi.

**Permalink:** PLAN.md:408 — "Suite funzionale sui tre fisici, tool simulati ripetibili più smoke rete reale, voce/documenti e 20–30 turni."

**Cost:** Medium. Requires physical access to all three phones. ~2–4 hours per device for the full suite. The tool-simulated part can be scripted; voice/document parts are manual.

---

## 4. Samsung Remote Test Lab compatibility session

**Why it exists:** PLAN §21–23 requires "Prima sessione Samsung per compatibilità" as part of G2. Samsung RTL provides one additional Galaxy with a different SoC/One UI/Android combination. This is a compatibility check, not a performance claim — it validates that the app installs, launches, and runs basic chat without OEM-specific regressions.

**Permalink:** PLAN.md:408 — "Prima sessione Samsung per compatibilità."

**Cost:** Medium. Pre-book a 60-min RTL session. Prepare APK + model + checklist. Run install → smoke chat → tool call → document open → share intent. ~1 hour active + prep.

---

## 5. HyperOS memory false-refusal reproduction on Xiaomi 14

**Why it exists:** PLAN §21–23 lists "bug memoria HyperOS e idle/ready riproducibili" as a G2 coding item. The historical issue: HyperOS aggressive memory management kills the model process or denies RAM to a model already loaded, causing a false refusal or reload when the user returns. PLAN §11 notes the Xiaomi as "test del falso rifiuto memoria a modello già caricato." This has never been instrumented on the retail unit with the current product build.

**Permalink:** PLAN.md:408 — "bug memoria HyperOS e idle/ready riproducibili."

**Cost:** Medium. Requires Xiaomi 14 physical access. Instrument `availableMb` / memory pressure signals, trigger background→foreground transition, verify model stays resident or re-loads cleanly. ~1–2 hours code instrumentation + device test.

---

## Summary table

| # | Item | Cheapest? | Permalink | Est. cost |
|---|---|---|---|---|
| 1 | Device restore `2619db0` | ✓ | PLAN.md:566 | ~30 min manual |
| 2 | Token reuse observability | | PLAN.md:566 | ~1–2 h code |
| 3 | Functional suite 3 devices | | PLAN.md:408 | ~6–12 h total |
| 4 | Samsung RTL compat | | PLAN.md:408 | ~2 h incl. prep |
| 5 | HyperOS memory bug repro | | PLAN.md:408 | ~2–3 h code+device |

## Items explicitly excluded per instructions

- MiniCPM5 (post-M1 gate)
- GPU/NPU/G3 (evidence-gated, G3 phase 24–29/09)
- Xiaomi 192.168.1.193 (not a code item)
- SEND-PDF owner-manual (owner manual test, not harness)
- Hung-FIFO (no unit-testable timeout path found in product code)
- Conversation-switch during extract (HARNESS_MISS, not product FAIL)

---

*Generated 2026-09-11. Read-only; no edits, no sub-agents.*
