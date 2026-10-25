# Test Android su emulatore — AI Chat (2026-08-02)

Ambiente: AVD Pixel_7a (x86_64, Android 36, RAM 6GB, 4 core, headless) · host 32GB RAM
Build: `npx expo run:android` + gradle assembleDebug · APK 89MB · install + UI via adb

## ✅ Verifiche PASSATE

| Test | Esito | Evidenza |
|---|---|---|
| Build APK + install | ✅ | app-debug.apk 89MB, install ok |
| Boot app (font/tema/UI Aspis) | ✅ | Header, barra modello, chat, suggerimenti generici |
| Download bundle GGUF+mmproj | ✅ | Qwen3.5-4B 2.740.937.888 byte + mmproj 672.423.616 byte — validazione dimensione ESATTA passata (file `===` size) |
| Progress download | ✅ | Barra "Downloading… %" (throttled) |
| Init modello (lazy) | ✅ | "Loading model…" → "Ready · local" |
| **initMultimodal (vision)** | ✅ | Log: "Multimodal context initialized successfully with mmproj" + "Context shifting disabled" — il GATE vision passa |
| Streaming per token | ✅ | Risposta Qwen3.5-4B completa arrivata in UI (Hello! I'm Qwen3.5...) |
| Persistenza conversazione | ✅ | La risposta è sopravvissuta a force-stop (AsyncStorage) |
| Selezione modello persistita | ✅ | Switch 4B→Gemma→2B + ripristino al riavvio (con tap espliciti) |
| **Tool loop websearch** | ✅ (parziale) | Il modello CHIAMA web_search → Exa risponde → **sorgenti in UI** ("OPENAI LAUNCHES GPT-5", "INTRODUCING GPT-5") |
| Attach sheet UI | ✅ | Plus → Photo library / Take photo / PDF document |

## 🐛 BUG TROVATI E FIXATI (tutti in commit)

1. **`<think></think>` visibili in UI** — Qwen3.5 emette il blocco vuoto anche con enable_thinking:false; il binding non lo filtra per qwen35 → fix `cleanDelta` (strip tag/blocchi) in LlamaService
2. **"Encountered two children with the same key u-1/a-2"** — `nextMsgId` ripartiva da 0 a ogni avvio → collisione con gli id della history persistita → fix: seed univoco per sessione (Date.now()) + **dedup id nel sanitizer** (ripara anche la history già corrotta)
3. **`json.exception.type_error.302: type must be string, but is null` nel round 2** — il binding restituisce `tool_call.id: null` (non undefined) → il re-parse fallisce → fix: **normalizzazione id** dei tool_calls (come nell'esempio ufficiale di llama.rn) — commit applicato, verifica del round 2 su device reale
4. **Header mangiava metà schermo** (nome modello gigante, 3 livelli di header) → fix: riga unica compatta [AI Chat + modello·stato inline] + badge Web + Ask AI; progress bar sottile solo in download
5. **Toggle Web ON/OFF rimosso** — websearch SEMPRE attivo: è il modello che decide (system prompt rafforzato: info attuali/notizie/menzione di ricerca → usa il tool; mai rispondere su notizie dalla memoria)
6. **LMK uccide l'app con 4B su emulatore 6GB** (low memory killer, RAM 3.3GB+ — atteso, documentato; su device reali 8GB+ ok; fallback 2B)

## ⚠️ Da verificare su device reale (emulatore CPU troppo lento)

- Round 2 completo del tool loop (risposta finale dopo le sorgenti) — fix 302 applicato
- **Vision con immagini**: mmproj caricato ✓, attach sheet ✓, immagine in gallery ✓ — il turno vision col 4B su emulatore = OOM/lento → test su device
- Velocità reale: su emulatore ~2-4 tok/s (CPU), 8+ min per il 4B; device reale con NPU/GPU attesa 5-15 tok/s
- mlock su Android: non verificato (nessun errore, ma niente log dedicato)
- Android CLI per l'estensione pi-android-cli: non trovato nel PATH (servirà riavvio di pi o path esplicito)

## Comandi utili (test manuale)

```bash
export ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
ADB="$ANDROID_HOME/platform-tools/adb"
# avvio emulatore headless
"$ANDROID_HOME/emulator/emulator" -avd Pixel_7a -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect
# build + install
cd android && ./gradlew :app:assembleDebug && cd ..
"$ADB" install -r android/app/build/outputs/apk/debug/app-debug.apk
# UI test
"$ADB" shell am start -n com.aichat.app/.MainActivity
"$ADB" exec-out screencap -p > shot.png
"$ADB" shell uiautomator dump && "$ADB" shell cat /sdcard/window_dump.xml
"$ADB" shell input tap X Y        # da bounds del dump
"$ADB" shell input text "Hello%sWorld"
"$ADB" logcat -d | grep -iE "ReactNativeJS|RNLlama|lowmemorykiller"
```
