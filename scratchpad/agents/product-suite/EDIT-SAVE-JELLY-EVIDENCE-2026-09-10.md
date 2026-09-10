# EDIT-SAVE Jelly evidence — 2026-09-10

**Verdict (scoped):** user-message Edit → Salva is **PASS** on one Jelly shot.
No typing. The edit modal was opened on a prefilled user bubble and Salva
was tapped with the same text. That is enough: `editMessage` truncates and
re-sends even when the draft is unchanged.

The Explorer claim that a Bluetooth keyboard is required is **REFUTED**.

Device: Jelly Star `JELLYS0000053795` only. Installed APK still `095466e`
(SHA-256 `224fb7d117f66bd94af0e8acd22d9b24559f6b3f98e9f059aebb2a25256e346a`).
No uninstall, no clear-data, no Xiaomi/S23. App tree was not needed for this
shot (current APK already contains `editMessage`).

Evidence dir: `scratchpad/agents/product-suite/EDIT-SAVE-EVIDENCE-2026-09-10/`

---

## Result

| Check | Observed | Verdict |
|---|---|---|
| Reachability | Altro `413,344` → Modifica `240,722` → Salva `389,524` | **PASS** |
| Resend started | `KALSA_SEND` fit immediately after Salva (`22:33:38Z`) | **PASS** |
| `edited:true` | SQL at +39s: user `"Dimmi solo la parola: ciao."` `edited=True` | **PASS** |
| Truncate + new turn | live `n=2`: edited user + assistant `"ciao"` | **PASS** |
| Session save | `KALSA_SESSION op:save messageCount:2 hash:1694250169` at `18:35:10` | **PASS** |
| Completion | `KALSA_TELEMETRY turnId:14 interrupted:false predicted:321` then extract `done` | **PASS** |

Live re-read after idle (pid 21302, ~11 % CPU):

```
role=user edited=True  len=27 'Dimmi solo la parola: ciao.'
role=assistant         len=4  'ciao'
```

The mid-poll snapshot `hist-after-save.json` still had the crash-safety
partial assistant `"The"` / `interrupted:true`. That is the 10 s streaming
persist, not the final turn. `hist-live.json` is the completed state.

---

## Sequence

1. Nuova chat (so the user bubble stays on screen).
2. `kalsa://share` injected `Dimmi solo la parola: ciao.` and Send.
3. Stop during think (`426,805`) so the assistant placeholder was dropped
   and the user row remained (`hist-after-stop.json`: 1 user, `edited` unset).
4. Altro → Modifica → Salva **without changing the draft**.
5. `editMessage` re-appended the same text with `edited:true` and generated.
   First SQL sighting of `edited:true` at 39 s (persist waits on streaming).

Driver: `scratchpad/agents/product-suite/edit-save-oneshot.sh`

---

## Limits

- Text was **not** changed, so this does not prove a *different* string round-trips
  through the React TextInput (the known `adb input text` hole remains). It does
  prove Salva, truncate, resend, `edited` persist, KV save, and a completed new
  assistant.
- Regenera UI is a separate in-tree change on `1edf5c6` and is **not** in this APK.
- One device, one shot. Not blanket G2 PASS.

---

## Hygiene

Jelly only. Battery left at 100 %. App `pid` 21302 unchanged.
