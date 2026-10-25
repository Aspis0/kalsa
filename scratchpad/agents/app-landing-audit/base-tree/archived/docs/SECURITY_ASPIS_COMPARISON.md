# Sicurezza APK — confronto Aspis Launcher → AI Chat

> Data: 2026-08-02 · Fonte: repo `Aspis0/Aspis-Launcher` (SECURITY.md, PRIVACY.md, app/build.gradle.kts, proguard-rules.pro, AndroidManifest.xml, res/xml/{network_security_config,data_extraction_rules}.xml)
> Stato: REPORT SOLO — nessuna implementazione (in attesa di test device)

## Misure Aspis Launcher e trasponibilità

| # | Misura Aspis | Dettaglio | Per AI Chat | Priorità |
|---|---|---|---|---|
| 1 | **dataExtractionRules** (Android 12+) | `allowBackup=false` NON blocca l'Auto Backup Google; regole escludono da cloud-backup/device-transfer: sharedpref, database, file, external | **MANCANTE**: i GGUF (3.5GB) e la chat in `files/` potrebbero finire nei backup → serve config plugin (manifest attr + res/xml/data_extraction_rules.xml) | 🔴 ALTA |
| 2 | **network_security_config** | base-config cleartext=false + eccezioni localhost/127.0.0.1/10.0.2.2 (dev/emulatore) | Parziale: abbiamo usesCleartextTraffic=false ma senza eccezioni localhost (Metro debug) → file xml esplicito | 🟡 MEDIA |
| 3 | **Proguard/R8 release** | isMinifyEnabled=true + proguard-android-optimize + rules custom (Kotlin, Coroutines, Parcelize, Room, SQLCipher JNI, OkHttp, ML Kit, WorkManager, WebView JS bridge) | Noi: minify OFF (ok per test). Se R8: `-keep class com.rnllama.** { *; }` + regole RN/Expo + test release | 🟡 MEDIA (quando store) |
| 4 | **Storage cifrato** | SQLCipher DB + EncryptedSharedPreferences + chiavi Keystore | Noi: zero segreti; chat AsyncStorage in chiaro → cifratura a riposo opzionale (leftover) | 🟢 BASSA |
| 5 | **Firma release** | signingConfigs.release con keystore dedicata | Noi: debug key (ok test, no store) → generare keystore + config | 🟡 MEDIA |
| 6 | **Manifest hardening** | permissions minimali (tools:node=remove), exported espliciti, supportsRtl | Noi: permissions:[] + plugin necessari → ok | ✅ FATTO |
| 7 | **Runtime hardening** | WeightIntegrity.verify() all'avvio, SafeMode, PiiStripper, deep-link validators | Noi: sizeBytes esatta (integrity), sanitizer, niente deep link, query minima | ✅ EQUIVALENTE |
| 8 | **SECURITY.md / PRIVACY.md** | Documenti dedicati nel repo | Da creare (utili anche per store) | 🟡 MEDIA |
| 9 | **Certificate pinning** | OkHttp pinning domini first-party | NON applicabile: solo HF + Exa pubblici | — |
| 10 | **Auth (JWT/PKCE/nonce)** | Worker first-party | NON applicabile: nessun account | — |

## Già implementato in AI Chat
- `allowBackup: false` + `usesCleartextTraffic: false` (app.config.js, commit e5ec90e)
- `permissions: []` · secret scan pulito · unici endpoint HF+Exa HTTPS · validazione download sizeBytes esatta · sanitizer storico · WebView sandbox (no-JS + CSP) · endpoint bio rimossi

## Prossimi passi (dopo test device)
1. Config plugin `dataExtractionRules` (esclude modelli/chat dai backup Android 12+)
2. `network_security_config.xml` con eccezioni localhost
3. Keystore release + firma (APK store-ready)
4. SECURITY.md + PRIVACY.md
5. R8 + proguard (com.rnllama) quando serve minify
6. Cifratura chat a riposo (opzionale)
