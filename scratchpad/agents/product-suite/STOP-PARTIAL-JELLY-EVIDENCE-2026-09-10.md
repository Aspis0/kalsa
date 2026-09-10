# STOP-PARTIAL Jelly evidence — 2026-09-10

**Verdict (scoped):** partial preservation after Stop is **PASS** on one Jelly shot.
Stop was tapped after non-empty assistant text existed; the persisted last
assistant has non-empty `text`, `interrupted: true`, `streaming` absent, and the
UI shows `Generazione interrotta.`

No app code was changed. APK under test is still the installed `095466e`
build (SHA-256 `224fb7d117f66bd94af0e8acd22d9b24559f6b3f98e9f059aebb2a25256e346a`).
The stop/finalize path is the same on current `origin/main` `1edf5c6`.

Device: Jelly Star `JELLYS0000053795` only. S23 `192.168.1.152` and Xiaomi
`192.168.1.193` were not contacted. No uninstall, no clear-data, no file
deletion. Luna was out of tokens; this shot was run from the orchestrator.

Evidence dir: `scratchpad/agents/product-suite/STOP-PARTIAL-EVIDENCE-2026-09-10/`

---

## Result

| Check | Observed | Verdict |
|---|---|---|
| Visible text before Stop | SQL grew a **new** assistant (`n_asst` 1→2) to 215 chars, then 285 after tap | **PASS** |
| Persist after settle | last assistant `id=a-8080264`, `len=285`, `interrupted=true`, `streaming` absent | **PASS** |
| UI marker | `text="Generazione interrotta."`; composer `content-desc="Invia"` (Stop gone) | **PASS** |
| Not a completed long answer | prompt asked for 20 paragraphs; persisted text is 285 chars and stable | **PASS** |
| Abort telemetry | `KALSA_MEMORY_EXTRACT extractStopReason:4` at `18:14:43.721`; `KALSA_SESSION save messageCount:5` at `18:14:43.837`. No `KALSA_TELEMETRY` line (same as prior aborted Jelly turns) | **PASS** (abort, not complete) |
| Live re-read after idle | same 285 chars, `interrupted=true`; CPU ~11–15 % | **PASS** |

---

## Sequence (attempt 3 — the valid shot)

Attempts 1–2 are harness misses, not product verdicts (see §Limits).

1. New short chat already resident (LFM `Pronto`, `kalsa.bench.kvtranscript=1`).
2. `kalsa://share` injected:
   `Continua: scrivi venti paragrafi sul mare… Il primo paragrafo deve iniziare con: Il mare è vasto.`
3. Submit `18:11:21` local (`KALSA_SEND`, `KALSA_THINKING budget:1024` because EMA decode was 5.74 tok/s ≥ 5).
4. Waited on **SQLite**, not uiautomator (dump blocks until the UI is idle, i.e. until the turn ends).
5. At `t≈140s` SQL first showed the new assistant as 3 chars `"The"` with `interrupted:true` (crash-safety streaming persist).
6. At `t≈148s` / `22:14:44Z` SQL showed 215 chars; composer coords `426,805` tapped twice.
7. After settle: 285 chars, `interrupted:true`. Idle UI dump: `Generazione interrotta.` + `Invia`.

Canonical files:

- `hist3-before.json` — `n_asst=1`
- `hist3-at-visible.json` — new assistant 215 chars, `interrupted:true`
- `hist3-after-stop.json` / `hist3-after-realstop.json` / `hist3-live.json` — 285 chars, `interrupted:true`
- `logcat3-after.txt` — extractStopReason 4 + session save `messageCount:5`
- `ui3-after-realstop.xml` — marker + Invia
- `verdict3.txt` = `PASS`

---

## What this is not

The preserved partial is **English chain-of-thought**, not the Italian
`Il mare è vasto` answer. LFM emitted reasoning as ordinary tokens (no
`<think>` wrap on this block), so `onDelta` treated it as visible text.
That is inside the current contract: non-empty streamed text + Stop → keep
with `interrupted:true`. It is not a demo of a cleaned Italian answer being
kept, and it is not a think-stripper bug hunt.

`interrupted:true` on the first SQL sighting is the 10 s crash-safety
partial (`buildPersistableMessages` writes streaming bubbles as interrupted).
The proof that Stop kept the message is the **post-idle** state: marker
visible, Stop gone, length frozen at 285, extractStopReason 4.

No `KALSA_TELEMETRY` on aborted turns remains a measurement gap, not a
preservation failure.

---

## Limits

1. **Attempt 1 VOID (harness):** `uiautomator dump` waited for idle, so the
   first “visible text” dump was the *completed* turn. Stop was already gone.
2. **Attempt 2 FAIL (harness):** SQL still pointed at the previous 1925-char
   assistant; Stop was tapped at t=0 during think. Placeholder removed
   (`extractStopReason:4`, no assistant). Same timing case as `095466e`.
3. Screenshots `screen3-*.png` are 0 bytes (`timeout` absent on this host).
   UI XML dumps substitute.
4. One device, one successful shot. Not blanket G2 PASS. Edit-save and
   Regenerate remain unverified / absent.

---

## Hygiene

Jelly only. Battery 100 % → 100 %, 28.0 °C → 35.0 °C. App `pid` 21302
unchanged. Installed APK hash identical to the `095466e` CI artifact.
App tree `/Users/marco/Projects/kalsa` not modified.
