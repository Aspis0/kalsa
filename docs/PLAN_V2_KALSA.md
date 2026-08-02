# PLAN V2 — Kalsa AI Chat (miglioramenti)

Stato fasi: ✅ fatto · 🔄 in corso · ⬜ da fare
Modalità di lavoro: **main agent = orchestrazione** (piano, istruzioni ai coder, verifica, review) — **nessun coding diretto**. Ogni fase: 1 coder subagent → verifica tsc → **review ostile** (1 reviewer) → fix via coder → commit.

Ultimo aggiornamento: 2026-08-02

---

## Fase 1 — Drawer → menu Settings ✅
**Obiettivo:** il menu hamburger (già funzionante in Kalsa) diventa il punto di ingresso dei Settings — **una sola voce: Settings** (Help/Privacy/About diventano sezioni INTERNE della schermata Settings in Fase 4/7).
- `drawerItems` → [Settings ⚙️]; stato `activeScreen: "settings" | null`; tap → chiude drawer + apre SettingsScreen placeholder (Fase 4 la riempie)
- Nuovo `src/screens/SettingsScreen.tsx`: schermata piena con back, tema labTheme (GlassPanel2, typography, useLabTheme) — solo titolo "Settings" per ora
- File: `src/app/AppShell.tsx`, `src/screens/SettingsScreen.tsx`
- Done: tap hamburger → drawer → tap Settings → placeholder renderizzato; back funziona; voci Privacy/Modelli/About rimosse dal drawer

## Fase 2 — i18n EN/IT (master file) ⬜
**Obiettivo:** doppia lingua, **default EN**, switch nei Settings (Fase 4). Modello risponde **sempre nella lingua dei settings** (prompt).
- `src/i18n/en.ts` (**master**, tutte le stringhe UI), `src/i18n/it.ts`, `src/i18n/types.ts` (`Locale = typeof en` — tipo garantisce parità chiavi), `src/i18n/useT.ts` (hook `useT()` + `useLocale()`), persistenza `kalsa.locale` (AsyncStorage, default `"en"`)
- Refactor stringhe hardcoded: `AppShell.tsx`, `AiChatPage.tsx`, `Drawer.tsx`, `QuickActionSheet.tsx`, notifiche (`notifyDownload`), errori downloader (`ModelDownloader` friendly error → `t()`), `miniappActions`
- **LlamaService**: il system prompt non è più una costante — `SYSTEM_PROMPT`/`SYSTEM_PROMPT_WITH_SEARCH` diventano `buildSystemPrompt(locale)` con istruzione lingua esplicita ("Always answer in English" / "Rispondi sempre in italiano"); AppShell passa `locale` a `streamAssistantTurn`
- Done: app interamente EN/IT switchabile senza riavvio; risposte modello nella lingua scelta (verificabile in E2E)

## Fase 3 — Websearch agnostico + API key sicure ⬜
**Obiettivo:** switch provider (Exa MCP gratis / Exa API / Brave / Tavily) con API key salvate **bene** (expo-secure-store = Keystore Android, mai AsyncStorage).
- `npx expo install expo-secure-store` (57.0.1, verificato online ✓ — Android: SharedPreferences cifrate con Keystore)
- `src/search/providers/exaMcp.ts` (esistente, gratis — refactor), `src/search/providers/exaApi.ts` (API diretta `api.exa.ai/search` con key), `src/search/providers/brave.ts`, `src/search/providers/tavily.ts` (fetch diretto, niente nuove deps — verificare online i formati esatti durante l'implementazione)
- `src/search/registry.ts`: `SearchProvider` + `PROVIDERS` + `getActiveProvider()` (default `exa-mcp` senza key) + fallback automatico su Exa MCP gratis con avviso se il provider attivo fallisce (429/key errata)
- `src/search/secretStore.ts`: wrapper SecureStore con try/catch, `setSecret(provider, key)` / `getSecret(provider)` / `deleteSecret` — **unica fonte di verità** (nessuna cache AsyncStorage delle key), chiavi `kalsa.secret.<provider>`
- `webSearchTool.ts`: esegue via `getActiveProvider()` (non più `exaSearch` hardcoded)
- Settings (Fase 4) salva `kalsa.search.provider` (AsyncStorage, non è un segreto) + key via SecureStore
- Done: cambio provider da Settings senza rebuild; key sopravvive a kill/restart/reinstall (verificato in E2E)

## Fase 4 — Schermata Settings ⬜
**Obiettivo:** schermata unica con sezioni; aperta dal drawer (Fase 1).
- Sezioni: **Lingua** (radio EN/IT, default EN) · **Websearch** (dropdown provider + campo key con maschera/occhio + "Testa connessione") · **Modelli** (selezione + spazio occupato + scarica/elimina con conferma) · **Help** (link alla Fase 7) · **Privacy** · **About**
- **Modelli**: spostare la selezione dai chip in alto in AiChatPage → sezione Modelli (i chip vengono rimossi; l'header mantiene il nome del modello attivo come indicatore)
- Persistenza: `kalsa.locale`, `kalsa.search.provider` (AsyncStorage) + key in SecureStore (Fase 3)
- Pattern schermata: state-based (come `activeMiniapp`), back dal drawer
- Done: tutte le sezioni funzionanti; selezione modello da Settings aggiorna l'engine all'avvio del turno

## Fase 5 — Mini app: audit + quiz ⬜
**Obiettivo:** miniapp verificate e utili per una chat AI.
- **Audit** blocchi esistenti (html, table, chart, calculator, metric, tabs, expandable): verifica render + sicurezza (WebView sandbox no-JS + CSP per html) — errori trovati → fix via coder
- **Nuovo blocco `quiz`**: il modello genera `{type:"quiz", question, options[4], answerIndex, explanation}`; UI interattiva (tap opzione → feedback ✅/❌ + spiegazione); aggiunto al prompt miniapp in `buildSystemPrompt`
- Done: quiz funzionante end-to-end (chiedere "fammi un quiz su X" → risposta interattiva), audit documentato in `docs/`

## Fase 6 — Prompt Kalsa (onestà + identità) ⬜
**Obiettivo:** prompt migliore: identità Kalsa, **niente invenzioni**, chiedere se non sicura.
- `buildSystemPrompt(locale)`: "You are Kalsa, a private on-device assistant…" + regole: se non sai → dillo esplicitamente ("non sono sicuro", "potrei sbagliarmi"); non inventare fatti, date, nomi, fonti, numeri; se la richiesta è ambigua → chiedi chiarimento; lingua forzata; uso web_search per info fresche; miniapp quando utile
- Nota: la forzatura su Qwen 4B è **best-effort** — valutazione in E2E con frasi-esca (domande inventate) e, se del caso, aggiunta di una regola tool-loop
- File: `src/engine/LlamaService.ts` (con i18n, Fase 2)
- Done: domande-esca ("chi ha vinto X nel 2030?") → risposta cauta o websearch; identità Kalsa

## Fase 7 — Help screen ⬜
**Obiettivo:** guida in-app EN/IT.
- Contenuto: come scaricare i modelli (conferma, notifiche), come funziona il websearch (provider, key), privacy (tutto on-device, uniche chiamate: HF/Exa/provider), FAQ, limiti (locale, RAM, niente cloud)
- Accesso: drawer → Help; testo nei file i18n (Fase 2)
- Done: help completo e leggibile in entrambe le lingue

## Fase 8 — E2E emulatore + APK finale ⬜
**Obiettivo:** test completo su AVD (Pixel_7a) + report + APK Kalsa v2 consegnato.
- Test: download modello, streaming, tool loop (provider attivo), **lingua (switch EN→IT → risposte in italiano)**, settings (key persistono dopo kill/restart), quiz miniapp, drawer/settings navigazione, onestà prompt
- Report: `docs/TEST_KALSA_V2_<data>.md` (screenshot + bug con fix)
- **Build APK**: workaround documentato del bundle stale — 1) `npx expo export:embed --platform android --dev false --bundle-output <tmp>/kalsa.bundle --assets-dest <tmp>/assets` 2) `./gradlew :app:assembleRelease` 3) python zipfile sostituzione `assets/index.android.bundle` 4) `apksigner sign` (debug keystore) 5) verifica grep fix nel bundle + sha256
- Consegna: path APK + istruzioni (disinstallare la vecchia — package `com.kalsa.app`)

---

## Ordine di esecuzione
Fase 1 → 2 (i18n base per Settings) → 3 (provider + secure-store) → 4 (Settings UI che usa 2+3) → 5 (mini app) → 6 (prompt, usa 2) → 7 (help, usa 2) → 8 (E2E + APK)

## Leftover (fuori scope, tracciati)
- `dataExtractionRules` (gap critico sicurezza Android) — prima dello store
- keystore release + R8/proguard — prima dello store
- `network_security_config` localhost da rimuovere
- Bug pipeline gradle: bundle JS stale (task non invalida sui sorgenti) — investigare `bundleCommand/entry` in build.gradle Expo
- Resume download force-kill (il task ricreato riparte da capo se kill durante il resume)
- Q3 MTP non validato, Gemma MTP (injection), benchmark KV, profili RAM automatici, retry HF, 429 Exa MCP

## Regole operative
- Ogni fase: coder subagent → `npx tsc --noEmit` 0 errori → commit → **review ostile** (1 reviewer) → fix via coder → commit
- Nessun coding da parte del main agent
- Verificare online API/versioni prima di implementare (Brave/Tavily/Exa API, expo-secure-store)
- i18n: MAI stringhe hardcoded nuove — solo `t()` dai master file
