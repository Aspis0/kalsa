# Design — Integrazione del motore MoE premium (BigMoeOnEdge) in Kalsa

Mandato: `mandates/integrazione-kalsa-design.md` · FASE 0 (solo design, nessuna scrittura in `../ai-chat`)
Data: 2026-08-10 · Stato: DESIGN — il GO all'implementazione è di gualt

## 0. Riepilogo esecutivo

Il default di campagna è adottato (KEXP + k=6 + drop 0.65 → **5.86 tok/s**, PPL 1.852, cache 2000 MiB, riuso KV −94% prefill). Questo documento progetta come portare il motore streaming dentro l'app Kalsa come **tier premium**, lasciando il tier gratuito su llama.rn.

**Raccomandazione chiave**: modulo nativo separato **`react-native-bmoe`** con uno shim `extern "C"` sopra `bmoe_core` (opzione b), condiviso con la barriera `runNativeOp` esistente dell'app. L'APK demo Android di BigMoeOnEdge (ProcessBuilder su `libbmoe-cli.so`) resta il fallback di laboratorio. Modello distribuito via HF con resume + sha256; policy termica/memoria costruita sulle lezioni RescueParty.

## 1. Architettura del binding — 3 opzioni

Fatti verificati che vincolano la scelta:
- `core/` è **C++ puro senza C ABI** (`core/include/bmoe/{config,session,runtime,metrics}.h`); `Session::generate` è **serializzato** (non concorrente per sessione), `cancel()` è thread-safe, `set_cache_budget_mb` esiste per la pressione di memoria.
- L'app ha già: source-build nativo di default (patch-package + `rnllamaBuildFromSource`), la barriera `runNativeOp` (FIFO su TUTTE le op llama.rn), `llamaContextGate` (co-residenza >6GB+2B), stato hung con policy.
- BigMoeOnEdge è **pubblico** (AGENTS.md: niente env in `core/`, commit Helldez-only, gates prima del merge); llama.cpp è submodule con ports-and-adapters (hook fork `ggml_cpu_set_expert_ready_hook` solo per `--overlap`).

| Opzione | Pro | Contro |
|---|---|---|
| **(a) estendere llama.rn** (patch locale per ospitare il path bmoe) | Riusa pipeline JSI/lifecycle esistenti; una sola libreria nativa | Accoppia due motori nel binding: gli update upstream di llama.rn si scontrano col path bmoe; il tier gratuito paga la complessità premium; superficie di manutenzione alta |
| **(b) modulo nativo separato `react-native-bmoe`** + shim `extern "C"` su bmoe_core | Isolamento pulito: JNI proprio, versioning indipendente, llama.rn intatto (update upstream puliti); la barriera si estende (stesso `runNativeOp`) | Serve shim C + build NDK dedicata; due librerie native (il tier gratuito non lo carica mai — zero impatto) |
| **(c) subprocess** (ProcessBuilder → `libbmoe-cli.so`, pattern dell'APK demo esistente) | Zero JNI, isolamento da crash, già dimostrato in `examples/android` | Streaming token via IPC, kill/recovery, sessioni KV handoff scomodo, doppio accounting RSS (mmap condiviso ma gestione più fragile), ~69°C comunque sul device; meno adatto a chat interattiva 5.86 tok/s |

**Raccomandazione: (b).** Un modulo `react-native-bmoe` con:
- shim `extern "C"` minimo: `bmoe_open(SessionConfig)`, `bmoe_generate(req, token_cb, userdata)`, `bmoe_cancel`, `bmoe_set_cache_budget_mb`, `bmoe_close` (+ `bmoe_metrics`) — avvolge le classi `Session`/`RunConfig`.
- JNI/N-API che esegue TUTTE le chiamate native dentro la barriera `runNativeOp` dell'app (estesa: oggi serializza llama.rn, domani anche bmoe — invariante "mai due op native sovrapposte" invariato).
- Build NDK: riusa il pattern di `scripts/build-android.ps1` (armv8.2-a+dotprod+fp16, API 29+, ma l'app è minSdk 35 → allineare a 35).
- Il tier premium **non è mai co-residente** col tier gratuito (12.5GB + modello chat non convivono): caricare premium → unload free e viceversa, serializzato dal gate.

## 2. Distribuzione del modello (12.49 GB)

- **Canale: HuggingFace** (l'app già scarica da HF con resume + validazione `sizeBytes` esatta — `ModelDownloader.ts`). Repo HF **privato/gated** con `Qwen3.6-35B-A3B-KEXP.gguf` (12.49 GB) + `revision` versionata.
- **Integrità**: aggiungere `sha256` nel catalogo per il modello premium (l'attuale validazione è sizeBytes; per 12.5GB serve l'hash) — verificato a fine download prima del "Ready".
- **Storage**: `documentDirectory/models/kexp/` (scoped, `allowBackup:false`, `usesCleartextTraffic:false` già attivi). Gate disco esistente (`diskRequirementBytes` ×1.1) applicato: servono ≥ ~13.7 GB liberi + headroom.
- **UX di attesa**: progress con resume reale (pattern esistente), stima tempo su Wi-Fi (~12.5GB = ore), stato "scarica in background" (keep-awake + stall timeout già presenti), avviso spazio.
- **Piano B aggiornamenti**: `revision` HF versionata + changelog; se in futuro si sharda (per-esperti), delta-only; oggi = re-download completo documentato (raro).

## 3. Config di prodotto (parametri di campagna → config app)

| Parametro | Valore campagna | In app |
|---|---|---|
| `n_threads` | 4 | **hard-coded** (misurato) nel blocco bmoe del catalogo |
| `n_ctx` | 4096 | **hard-coded** (misurato); niente upgrade high-RAM (il modello è calibrato a 4096) |
| `n_ubatch` | 512 | hard-coded |
| `n_expert_used` (k) | 6 | hard-coded |
| `drop_cold_frac` | 0.65 | hard-coded |
| `dense_weights` | anon (anonimo) | hard-coded |
| `cache_mb` | 2000 | **esposto e scalato sulla RAM** del device: high → 2000, mid → 1500, low → off (e `set_cache_budget_mb` in risposta alla pressione di memoria) |
| `io_threads` | 4 | hard-coded |
| `overlap` | sì (hook fork) | **feature-flag**: richiede il fork-hook compilato; default ON nei build bmoe, documentato |
| prefault tri-state | -1 (off) | hard-coded nel loader |
| `preserve_thinking` | true | hard-coded (path chat) |
| sampling | greedy | come oggi, esposto in bench |

Forma: un blocco `bmoe: RunConfigShape` nel `ModelRegistry` (nuovo `ModelInfo` premium), i sovraccarichi via `applyEngineOverride`/`benchConfig` come oggi. Niente env in `core/` → tutta la config passa dal RunConfig (regola AGENTS.md rispettata).

## 4. Convivenza di memoria (~4 GB usabili) — lezioni RescueParty come policy

Fatti: die **88–93 °C** + MemFree ≪100 MiB sostenuti → reboot `rescueparty`; guardrail lab: PAUSE_THERMAL 88 °C/60 s (resume <80), ABORT_MEM MemFree<100 MiB/10 s.

Policy in-app (nuovo `BmoeRuntimePolicy`):
1. **Pre-load gate**: carica KEXP solo se MemAvailable ≥ nonEvictable(stima) + FIT_HEADROOM 512 MiB + margine lavorativo (pattern `memoryEstimate.ts`); rifiuto con messaggio esplicito (riuso `modelGateVerdict` esteso).
2. **Monitor attivo**: poll MemAvailable (`/proc/meminfo` già letto da `getAvailableMemoryBytes`) a ~1 Hz durante la generazione:
   - MemAvailable < soglia warn → riduci `cache_mb` via `set_cache_budget_mb` (degradazione graduale, no crash);
   - MemAvailable < soglia abort (≈ ABORT_MEM) → `bmoe_cancel` + messaggio "memoria insufficiente, risposta interrotta", stato recuperabile.
3. **Termica**: nuovo `ThermalMonitor` — Android Thermal API (`PowerManager.getCurrentThermalStatus`) con fallback sysfs; soglie: warn 75 °C, PAUSE 85 °C/60 s (pausa volontaria con countdown), HARD 88 °C (stop sessione). Il flag `maxDecodeSeconds` di `deviceTuning` diventa reale.
4. **Co-residenza**: premium e free mai insieme (vedi §1); l'embedder resta disponibile solo su >6GB (co-res policy esistente estesa: con KEXP caricato l'embedder NON co-reside mai — 12.5GB + 120MB è comunque troppo su 8GB).

## 5. Termica e batteria UX (~69 °C die, ~1 J/token)

- **Throttling volontario**: limite di sessione (es. N token per sessione con cooldown, configurato), badge termico nell'header chat (stati: ok / caldo / pausa con countdown / stop), avvisi preventivi prima della soglia RescueParty.
- **Batteria**: gate batteria ≥ soglia per il tier premium (lezione dalle regole del lab: niente eroismi sotto il 42% — adattato a prodotto: avviso + sconsigliato sotto 30%, blocco sotto 15%).
- **Sostenibilità**: a ~1 J/token e ~69 °C die, documentare l'attesa: sessioni lunghe scalano a un modello più piccolo (degradazione automatica al tier free) o pausa termica.

## 6. Sessioni/KV nella UX reale

- **Riuso KV (−94% prefill)**: multi-turn = `clear_kv:false` → prefisso comune mantenuto, `llama_memory_seq_rm` sulla coda, prefill solo del suffisso (T5: 165→9.3 s). L'app salva la sessione a fine turno/AppState come oggi (`sessionPersistence`), con `SessionMeta` esteso ai knob bmoe.
- **Vincolo ibrido (niente rollback parziale)**: edit/regenerate = **ri-prefill completo**. UX: quando si modifica un messaggio o si rigenera con KEXP, la UI avvisa ("la modifica riavvierà la risposta — ~10 s di prefill") invece di fingere un rollback incrementale; metrica mostrata (tempo di prefill atteso).
- **`clear_kv:true`** = nuova chat (KV drop + riscaldamento cache esperti); **ricarica dopo restart** = load modello (12.5GB, ~tensione di I/O) + restore KV: UX "caricamento modello premium…" con progress.
- **Cancel**: `bmoe_cancel` thread-safe → abort turno senza corrompere la sessione (stessa semantica dell'attuale `handleStop`).

## 7. Naming (KEXP è un nome di laboratorio — "orribile")

Proposta per il modello premium (il tier eredita il nome):
1. **Cala** — la Cala è il porto antico di Palermo (Kalsa è un quartiere di Palermo): il modello che "fa arrivare la memoria come la marea nel porto". Coerente con l'identità geografica del prodotto.
2. **Marea** — la marea: la cache predittiva che porta dentro e fuori gli esperti; italiano, corto, evocativo del tema "Beyond Memory Capacity".
3. **Corrente** — la corrente (stream): il motore streaming; doppio senso italiano (corrente elettrica/acqua), semplice.

Consigliato: **Cala** (con "Cala Pro" come tier). File/UI/marketing: `CALA.gguf` → `Kalsa · Cala` → "Kalsa con Cala".

## 8. Piano di implementazione a fasi

| Fase | Contenuto | Dove si testa | Stima |
|---|---|---|---|
| **1** | Shim `extern "C"` su bmoe_core + modulo `react-native-bmoe` (JNI, open/generate/cancel/set_cache_budget, metrics) + harness di binding | Lab (bmoe-cli + shim su device di lab; niente app vera) | 2–4 sett |
| **2** | Catalogo premium (blocco bmoe + sha256), download 12.5GB con resume, switch free↔premium, barriera estesa | Device di lab + app in dev | 3–5 sett |
| **3** | `ThermalMonitor` + `BmoeRuntimePolicy` (mem/termica/batteria), UX badge/pause/sessioni | Device di lab (G99/8G2) + emulatore | 2–3 sett |
| **4** | Naming (Cala), paywall/onboarding, visual-capture harness esteso per bmoe, telemetria | CI screens + device | 1–2 sett |

**Primo mandato di scrittura**: Fase 1 (shim + modulo, in un repo dedicato o sotto moe-experiments con le regole AGENTS.md — commit Helldez-only). **Gate**: ogni fase con review ostile; la Fase 2 tocca l'app vera → autorizzazione esplicita di gualt. Il visual-capture harness di Kalsa esiste (`ci-screens.sh`, no-inference) — per bmoe serve un'estensione con inferenza reale su device di lab.

## 9. Rischi top-5

1. **OOM/RescueParty con 12.5GB su device 8GB** → gate pre-load + monitor MemAvailable + `set_cache_budget_mb` degradante + unload free; mai co-residente.
2. **Termica sostenuta (~69 °C, soglia 88 °C)** → ThermalMonitor (Android Thermal API), pausa volontaria, limiti di sessione, avvisi.
3. **Core C++ senza C ABI** → shim `extern "C"` sottile; regola AGENTS.md (gates prima del merge) mantiene la superficie stabile; harness di binding in CI.
4. **Drift upstream llama.cpp** (submodule + hook fork per `overlap`) → pin revisione, CI gates, `--overlap` come feature-flag.
5. **KV reuse vs vincolo ibrido no-rollback** → UX esplicita su edit/regenerate (ri-prefill con stima tempo); metrica nel report di sessione.

## 10. Deliverable e confini

- Questo report (unico deliverable di FASE 0). Nessun file dell'app modificato. BigMoeOnEdge non modificato. Commit del solo report in moe-experiments.
- GO all'implementazione, autorizzazione a scrivere nell'app, scelta del nome: **gualt**.
