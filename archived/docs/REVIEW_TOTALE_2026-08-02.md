# Review totale personale — Kalsa (2026-08-02)

Review fatta dal **main agent direttamente** (nessun subagent), prima della build APK — su richiesta dell'utente, con focus sulla classe di bug "chiave API non persistente" (es. PubVia).

Scope: tutto `src/` + `App.tsx` + config — persistenza, concorrenza, errori, UI, sicurezza.

## 1. Persistenza tra sessioni (focus principale) — TUTTO PASS

| Chiave | Load | Save | Validazione | Esito |
|---|---|---|---|---|
| `kalsa.locale` | gate `localeReady` in App | set con catch | normalized | ✅ |
| `kalsa.model.id` | al mount, `findIndex >= 0` (valore invalido ignorato) | set con catch | — | ✅ |
| `kalsa.messages.v1` | JSON try/catch + `sanitizeHistoryMessages` (dedup id, cap 100k/100, miniapp normalize, niente stati transitori) | debounce 400ms, esclude streaming | robusta | ✅ |
| `kalsa.memory.facts` / `.enabled` | try/catch, migrazione al load, default OFF | cache aggiornata SOLO dopo write riuscita; mutex+epoch | robusta | ✅ |
| `kalsa.fontScale` | gate all'avvio | set | normalizzata | ✅ |
| `kalsa.tts.enabled` | al mount (`Promise.all`), default true | `stop()` in finally anche se setItem fallisce | "1"/"0" | ✅ |
| `kalsa.search.provider` | get con fallback exa-mcp | set | id validato | ✅ |
| `kalsa.secret.<provider>` | **SecureStore** (unica fonte, mai cache), letta fresca a ogni ricerca | `setSecret` PRIMA di `setActiveProviderId`; key vuota → delete | id provider validato | ✅ |
| `kalsa.download.resume.*` | JSON try/catch | revision-aware (repo+rev) | — | ✅ |

**Nessun bug di persistenza trovato.** Il pattern PubVia (chiave persa) qui non esiste: tutte le chiavi hanno load→validate→save con fallback, e i segreti sono in Keystore.

## 2. Concorrenza — PASS
- Mutex engine FIFO (`withEngineJob`) copre stream+tool loop+extractMemory+translateText; `disposeEngine` attende la coda (max 5s)
- Memoria: epoch su clear/remove/disable → scritture tardive scartate; estrazione registrata PRIMA di `finish()`
- Voce: state machine `idle|starting|recording|stopping`, cap 60s/2MB, cleanup in finally, AppState background → cancel, `voiceRunId` per risultati tardivi
- UI: `sendingRef`/`translationInFlightRef`/`voiceBusyRef` sincroni (non React batching); download in-flight guard; model switch attende extract ≤3s

## 3. Errori — PASS
- Tutti i load con try/catch; parser fail-closed (extract/translate/quiz/miniapp/resume); friendlyNetworkError localizzato per rete/storage; errori engine mostrati nella barra modello localizzati; abort con rimozione placeholder vuoto

## 4. Sicurezza — PASS
- Key solo in SecureStore (Keystore), mai loggate; allowBackup=false; niente cleartext; prompt facts come "untrusted data" + filtro sensibili in memoria (opt-in); audio PCM mai inviato (disclosure privacy aggiunta in Help)

## 5. Osservazioni / rischi residui (NON bug, da decidere)
1. **Hash file non verificato**: download validati solo per size esatta, non SHA-256 — file corrotto della stessa size passa (modelli LLM + whisper). Richiede aggiunta digest alla pipeline (leftover storico).
2. **Draft non persistito**: si perde al kill dell'app (comportamento, non bug — decidere se salvare).
3. **History senza versione**: `kalsa.messages.v1` fissa — quando il formato cambierà servirà migrazione esplicita (oggi la sanitize filtra ma non migra).
4. **whisper.rn**: import dinamico `require("whisper.rn/index")` — da confermare al primo bundle release (Metro exports); permesso mic iOS non distinguibile (granted vs denied) — Android-first ok.
5. **Font XL**: il chrome delle miniapp (createStyles) non scala (token tipografici sì) — accettato.
6. **Notifica**: canale "default" via trigger TIME_INTERVAL 1s — verificare su device che compaia nel canale giusto (emulatore non decisivo).

## Verdetto
Nessun bug critico/alto trovato. L'app è pronta per E2E + build — **build NON eseguita** (fermo richiesto dall'utente dopo questa review).
