# PLAN V3 — Kalsa AI Chat (Memoria, Traduzione, Font, Voce)

Stato fasi: ✅ fatto · 🔄 in corso · ⬜ da fare
Modalità: main agent = orchestrazione · coder subagent → tsc → **review ostile** (1 reviewer) → fix coder → commit.
Ultimo aggiornamento: 2026-08-02

## Audit tecnico (verificato online 2026-08-02)
- **whisper.rn 0.5.2** (MIT, mybigday/whisper.rn, 799★, pubblicato ~1 mese fa): binding whisper.cpp per RN — initWhisper/transcribe (file WAV/PCM), VAD Silero, **RealtimeTranscriber** (richiede `@fugood/react-native-audio-pcm-stream` + `react-native-fs`; utile perché whisper.cpp NON decodifica m4a/aac, serve PCM 16kHz mono). Expo: richiede prebuild (già in uso). Android: proguard rule `-keep class com.rnwhisper.** { *; }`, ndkVersion ≥ 24. Modelli ggml da `ggerganov/whisper.cpp` (HF): **tiny multilingua ~75 MB** (per IT+EN), base ~145 MB. Issue #301 (build new-arch su 0.5.0) → verificare al build con RN 0.86; fallback se RealtimeTranscriber non compila: registrazione PCM + `transcribeData()`.
- **expo-speech 57.0.1** (ufficiale, MIT): TTS — speak/stop/isSpeakingAsync; su Android usa l'engine TTS di sistema (può essere cloud su alcuni device — nota privacy in Help).
- **Memoria**: pattern standard — estrazione fatti in JSON a fine turno (completion breve non-streaming), store locale (AsyncStorage), iniezione nel system prompt, UI settings per gestione manuale. Tutto on-device.

## Fase 1 — Memoria (locale) 🔄
**Obiettivo:** Kalsa ricorda fatti sull'utente tra sessioni (nome, lingua, preferenze, progetti) — 100% on-device.
- `src/memory/MemoryStore.ts`: fatti `{id, text, createdAt}` in AsyncStorage `kalsa.memory.facts` (cap 40, dedup per testo normalizzato), toggle `kalsa.memory.enabled` (default ON); API: `listFacts()`, `addFact(text)`, `removeFact(id)`, `clearFacts()`, `setEnabled(bool)`, `getEnabled()`
- **Estrazione automatica**: a fine turno (dopo onDone della risposta, mai durante streaming), se enabled: completion breve non-streaming dedicata in LlamaService (`extractMemory(messages, locale)`: prompt i18n dedicato → JSON `{add: string[], remove: string[]}`), parser fail-closed (JSON invalido → ignora), merge in MemoryStore
- **Iniezione**: `buildSystemPrompt(locale, withTools, facts?)` — sezione "User memory (facts the user shared):" con i fatti (max ~10, troncati); AppShell carica i facts all'avvio e li passa a streamAssistantTurn
- **Settings → sezione "Memoria"**: toggle attiva/disattiva, lista fatti (testo + elimina singolo), aggiungi manuale, svuota tutto (con conferma), spiegazione "solo sul dispositivo"
- i18n EN/IT (master file); LLM: il modello piccolo può estrarre fatti imperfetti → solo fatti brevi e dedup; il fallback è la memoria manuale
- Done: "Mi chiamo Marco e lavoro su biotech" → turno dopo: "Ciao Marco..." (verifica E2E); fatti visibili/gestibili in Settings; toggle funziona

## Fase 2 — Traduzione in-app ⬜
**Obiettivo:** traduci un messaggio con il modello locale (IT↔EN e altre, nella lingua dei settings o esplicita).
- Long-press su un messaggio (user o assistant) → action sheet "Traduci" (i18n)
- Completion non-streaming dedicata (`translateText(text, targetLang, locale)` in LlamaService, prompt i18n); risultato mostrato sotto il messaggio in un blocco collassabile "Traduzione (EN)" con bottone copia/chiudi
- Target: lingua dei settings; se la lingua di destinazione = lingua del messaggio → suggerimento: traduci nell'altra lingua
- Non persiste nella history (traduzione volatile, on-demand)
- i18n EN/IT; Done: long-press → traduzione corretta sotto il messaggio

## Fase 3 — Dimensione font ⬜
**Obiettivo:** font S/M/L/XL nei Settings (impostazione in-app, non di sistema).
- `kalsa.fontScale` (AsyncStorage, default "m"); scale: s 0.9 / m 1.0 / l 1.15 / xl 1.3
- Estensione del tema (labTheme): typography tokens scalati tramite context (`useLabTheme` espone già colors/typography — aggiungere fontSizeScale e applicarlo ai token tipografici; moduli piccoli)
- Test layout: chat, header, settings, drawer, quiz, help (scroll ok con font grandi, niente overflow)
- Done: S/L/XL applicati ovunque senza layout rotti

## Fase 4 — Comandi vocali (ASR + TTS) ⬜
**Obiettivo:** dettatura on-device (whisper) + lettura risposte (TTS).
- `npm i whisper.rn @fugood/react-native-audio-pcm-stream react-native-fs expo-speech` → prebuild (nativo!) — verificare build new-arch; se RealtimeTranscriber non compila: fallback PCM + transcribeData
- Modello **ggml-tiny multilingua** (~75 MB) nel ModelRegistry come asset opzionale "whisper-tiny" (download in-app con pipeline esistente, conferma + notifica; `kalsa.voice.model`), proguard rule per whisper.rn
- **ASR**: microfono nel composer (icona 🎤): tap per parlare (registrazione PCM), rilascia → trascrizione → draft nel campo (l'utente conferma prima dell'invio); permesso microfono richiesto esplicitamente; stato UI "In ascolto…"/"Trascrizione…"; RealtimeTranscriber con VAD se fattibile
- **TTS**: long-press messaggio assistant → "Leggi ad alta voce" (expo-speech, lingua settings, stop se in riproduzione); icona stato
- Settings → sezione "Voce": download modello ASR, toggle TTS, lingua voce
- i18n EN/IT; Done: dettatura → testo nel campo; risposta letta ad alta voce

## Fase 5 — E2E emulatore + APK v5 ⬜
- Test: memoria (fatto salvato → turno successivo lo usa; kill/restart persiste; toggle off non estrae), traduzione, font S/L/XL, voce (permesso mic, dettatura, TTS)
- Report docs/TEST_KALSA_V3_<data>.md · APK con workaround bundle (Metro manuale + iniezione + firma) · consegna

## Ordine di esecuzione
Fase 1 → 2 → 3 → 4 → 5 (voce per ultima: dipende da whisper.rn — più rischiosa)

## Leftover (da piano V2, invariati)
dataExtractionRules · keystore release + R8/proguard · network_security_config localhost · bug bundle gradle stale · quiz interattivo da testare con 4B su device · badge scaricato per modelli non attivi · export history

## Regole operative
- coder → `npx tsc --noEmit` 0 errori → commit → review ostile (1) → fix coder → commit
- Verificare online API/versioni prima di implementare (whisper.rn build con RN 0.86, expo-speech, @fugood/react-native-audio-pcm-stream compatibilità)
- i18n: MAI stringhe hardcoded — solo t() dai master file (en.ts master, it.ts `typeof en`)
- La memoria NON deve mai contenere dati sensibili → cap, dedup, filtro lunghezza, cancellabile
