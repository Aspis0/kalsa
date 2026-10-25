# Piano — Attachments locali (PDF/immagini/foto) + Test Android su emulatore

> Progetto: AI Chat (`ai-chat`) · Data: 2026-08-02 · Stato: **V2 — review ostile APPLICATA**
> La review ostile ha prodotto 8 blocker verificati sul codice: tutti incorporati sotto (sezione "Fix da review ostile").

## Fix da review ostile (bloccanti, verificati su codice reale)

1. **GATE compatibilità vision**: `llama.rn` C++ non ha `PROJECTOR_TYPE_QWEN35`
   (solo Qwen2VL/2.5VL/3VL), MA ha `PROJECTOR_TYPE_GEMMA4` confermato
   (clip-impl.h:361-364). → **Vision PRIMARY = Gemma 4 E2B** (mmproj certificato);
   Qwen3.5-4B vision = da VERIFICARE con smoke reale (gate esplicito: se
   `initMultimodal` fallisce o `isMultimodalEnabled` false → errore UI, non
   silenzio). Test vision su emulatore con Qwen3.5-4B+mmproj; fallback Gemma.
2. **Engine identity = (modelPath, mmprojPath)**, non solo modelId: uno short-
   circuit sul solo modelId riuserebbe un engine text-only. `initMultimodal()
   === false` → errore. `disposeEngine` aggiunge `releaseMultimodal()`.
3. **Contratto attachments end-to-end**: tipo unico `LocalAttachment`
   (`{kind:"image"|"pdf", name, uri, pages?}`); ELIMINATO il vecchio gateway
   `{title,text}` (filtrava via gli allegati nuovi); AppShell mappa a
   `RNLlamaMessagePart[]`; tool loop tipizzato con i tipi llama.rn; immagini
   SOLO nel messaggio user corrente (system senza immagini).
4. **Context budget**: n_ctx 4096→8192 (vision), `ctx_shift:false`, history
   ridotta a 8 msg (2000 char) quando ci sono immagini, cap pagine dinamico,
   controllo `result.context_full` → errore UI dedicato.
5. **Formati immagine**: mtmd supporta JPEG/PNG/BMP/GIF/TGA/HDR/PIC/PNM — NON
   HEIC/WebP. → conversione a JPEG via **expo-image-manipulator** per le foto
   dalla galleria (HEIC/WebP inclusi), MIME reale verificato.
6. **Downloader a bundle**: manifest per-file (url con REVISION HF pinnata,
   sizeBytes esatta, resume key separata), progresso AGGREGATO
   (modello+mmproj), retry/abort per fase, `isBundleDownloaded`.
7. **PDF WebView progettato**: trasferimento file = RN legge base64
   (risolve anche `content://`) → Blob in WebView → `URL.createObjectURL` →
   pdf.js da blob; worker = Blob URL (`worker-src blob:` in CSP) + fallback
   fake-worker; bridge chunked con ack/timeout/cleanup; limiti: 5MB, 10 pagine
   (render max 5); pdf.js **v3.11.174** (ultima build UMD, la più testata in
   WebView — v4 richiede module import da blob, non affidabile); licenza
   Apache-2.0 + NOTICE vendored.
8. **Test separati**: smoke text-only (2B) ≠ smoke vision (Qwen4B+mmproj o
   Gemma E2B+mmproj); AVD RAM 4096→6144 (config.ini) per il bundle vision;
   profiling `gpu/reasonNoGPU/devices` + prefill/decode + OOM, non solo
   screenshot.
9. **expo-image-picker @~57.0.7 INSTALLATO davvero** + plugin in app.config.js
   (camera permission); expo-document-picker riaggiunto; test deny camera.
10. **Sanitizer**: persistono SOLO i metadata (kind, name, pageCount) — URI e
   pages NON persistiti (cache invalida dopo sessione); al reload chip
   "non disponibile" o drop.
11. **Timeout/abort ovunque**: ExaMCP con AbortSignal+deadline (il segnale
   della chat arriva al fetch), PdfToImages con timeout per fase.

---

## Parte A — Attachments locali per la vision

### A1. Modello (multimodale)

Fatti verificati:
- **Qwen3.5-4B**: `image-text-to-text` (HF), mmproj disponibile nello stesso repo
  `unsloth/Qwen3.5-4B-GGUF`: `mmproj-F16.gguf` = **672.423.616 byte**
- **Gemma 4 E2B**: `mmproj-F16.gguf` = **985.654.080 byte**
- **llama.rn 0.12.8** supporta multimodal: `context.initMultimodal({ path, use_gpu })`,
  messaggi con `image_url` (file://), media markers automatici, richiede
  `ctx_shift: false` per multimodal

Modifiche:
1. `ModelRegistry.ts`: campo `mmproj?: { file: string; sizeBytes: number }` per
   qwen3.5-4b e gemma-4-e2b (non per qwen3.5-2b: fallback text-only)
2. `ModelDownloader.ts`: refactor in `downloadFile({ url, target, sizeBytes,
   onProgress, signal })` (stesso resume/validazione esatta già collaudata);
   `downloadModel` scarica modello **+ mmproj** se presente (progresso separato
   ma stesso flusso); `isMmprojDownloaded(model)`
3. `LlamaService.ts`:
   - `initEngine(modelPath, modelId, mmprojPath?)`: dopo `initLlama` →
     `initMultimodal({ path: mmprojPath, use_gpu: true })` se presente;
     `ctx_shift: false` nei params quando c'è mmproj
   - `EngineMessage` + campo opzionale `images?: string[]` (URI file)
   - `streamAssistantTurn`: se `images` → contenuto del messaggio come parts
     `[{type:"text"}, {type:"image_url", image_url:{url}}]` (cap 5 immagini)

### A2. UI — attach sheet

- Composer: pulsante **Plus** (ripristinato) → sheet: "Photo from library"
  (expo-image-picker), "Take photo" (camera), "PDF document"
  (expo-document-picker, tipo application/pdf)
- `app.config.js`: plugin `expo-image-picker` (permissioni camera/fotolibreria)
- Chips allegati con rimozione; cap: 5 immagini oppure 1 PDF (≤5 pagine)
- Tipo `onSendStream` attachments (4° param, oggi `{title,text}[]`):
  `Array<{ kind: "image" | "pdf"; name: string; uri: string; pages?: string[] }>`
  (pages = URI delle pagine PDF renderizzate)

### A3. PDF → immagini: pdf.js in WebView (scelta primaria)

Perché **NON react-native-pdf**:
- react-native-pdf 7.0.4 richiede peer `react-native-blob-util` e compila pdfium
  nativo; supporto New Architecture (RN 0.86 = solo nuova) non certificato;
  il capture di view native PDF via view-shot è fragile
**Scelta**: pdf.js (Apache-2.0) vendored in `assets/pdfjs/` (pdf.min.js +
pdf.worker.min.js, ~2MB), renderizzato in una WebView dedicata (pattern già in
uso per il blocco html miniapp):
- Asset letti come stringa (expo-asset → readAsStringAsync) e iniettati
  nell'html; worker via Blob URL; nessuna rete
- Pagina → canvas (max 1024px lato lungo, scale 1.5) → `toDataURL('image/jpeg', 0.8)`
  → `postMessage` → salvata in cacheDir (expo-file-system/legacy)
- Cap: 5 pagine, base64 chunked se > 1MB per postMessage
- Componente `PdfToImages` (src/components/PdfToImages.tsx): input uri →
  output `string[]` (URI pagine) + stato/errore

### A4. Wiring

- `AiChatPage`: stato `attachedItems` (già esistente, oggi morto) popolato dal
  nuovo sheet; chips con X; attachments passati a `onSendStream`
- `AppShell.handleSendStream`: mappa attachments → `images` dell'engine
  (immagini dirette + pagine PDF); il sanitizer conserva già `attachments`
- Flow download: quando si scarica un modello con mmproj → scarica entrambi;
  barra modello mostra progresso combinato; `ensureEngineForModel` verifica
  anche mmproj prima di `initEngine`

---

## Parte B — Test su Android (io, emulatore)

Fatti verificati:
- AVD **Pixel_7a** (x86_64, Android 36, 4GB RAM, 4 core) + **Medium_Phone_API_36.1**
- llama.rn ha **jniLibs x86_64** (oltre arm64) → gira su emulatore
- adb: `$LOCALAPPDATA/Android/Sdk/platform-tools/adb`

Flusso:
1. `npx expo run:android` (prima build lunga: gradle + dipendenze native)
2. Avvio AVD headless: `emulator -avd Pixel_7a -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect`
3. Install + launch; **logcat** (`ReactNativeJS`) + **screencap** a ogni step
4. Test flow:
   - Boot → barra modello → stato corretto
   - Download **Qwen3.5-2B** (1.28GB — RAM emulatore 4GB; 4B resta per device
     reale) → progresso → "Downloaded" → invio → **streaming token**
   - **Websearch ON**: domanda attuale → tool loop → sorgenti citate
   - **Attachments**: `adb push` immagine di test in gallery (+ media scan) →
     attach via tap (coordinate da screenshot) → invio → risposta vision;
     PDF di test (2-3 pagine) → render pagine → invio
5. Esiti in `docs/TEST_ANDROID_2026-08-02.md` (screenshot + log + note)

Note attese: emulatore senza GPU → n_gpu_layers degrada a CPU (ok funzionale);
OpenCL assente; mlock da verificare; 2B ~5-15 tok/s su CPU emulata.

---

## Rischi noti (da attaccare in review ostile)

1. **pdf.js vs react-native-pdf**: correttezza della scelta (dipendenza nativa
   vs ~2MB asset JS; new-arch; offline)
2. **mmproj compatibilità**: llama.rn 0.12.8 + mmproj unsloth (qwen35) —
   formato supportato? `use_gpu: true` su emulatore senza GPU (degrada?)
3. **ctx_shift: false** con n_ctx 4096: pagine vision consumano molti token
   (~1k/pagina) → contesto per il testo ridotto
4. **postMessage base64**: limiti WebView Android su messaggi grandi
5. **Permessi**: Android 13+ photo picker (niente permesso libreria), camera
   serve permesso; plugin expo-image-picker corretto
6. **expo-asset**: serve dipendenza esplicita? (oggi transitiva da expo)
7. **HEIC** (da iPhone) non supportato — accettare jpeg/png/webp e convertire?
8. **Sanitizer**: attachments con pages[] (nuovi campi) — validazione
9. **Test emulatore**: 4GB RAM con 2B (1.28GB) + app + WebView — OOM?
10. **Streaming con vision**: il primo token dopo il processing immagine è
    lento (prefill immagine) — la UI mostra "Thinking"?
