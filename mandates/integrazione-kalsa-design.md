# MANDATO — DESIGN integrazione del MoE premium in Kalsa (FASE 0: solo lettura)

Il default di campagna è adottato (KEXP + k=6 + drop 0.65 → 5.86 tok/s, PPL
1.852). Inizia il capitolo prodotto: portare il motore streaming dentro l'app.
Questo mandato produce il **design document**, non codice.

**REGOLA DURA: `../ai-chat` (l'app Kalsa) si LEGGE, non si tocca.** Nessun file
dell'app viene modificato in questo mandato — la scrittura arriverà con un
mandato separato esplicitamente autorizzato da gualt. Anche BigMoeOnEdge non si
modifica qui (e ricorda: quel repo è PUBBLICO con le sue regole AGENTS.md —
qualunque futura modifica lì segue quelle regole, commit author Helldez only).

## Cosa studiare (lettura)

1. **Lato app** (`../ai-chat`): come l'app usa llama.rn oggi — inizializzazione,
   gestione modelli (download/storage), sessioni/KV, config per-modello,
   patch-package esistenti (ricorda: le jniLibs precompilate — serve
   `rnllamaBuildFromSource=true` per build native custom), minSdk 35.
2. **Lato motore** (`moe-experiments/BigMoeOnEdge`): la superficie di
   `core/` (RunConfig, session, runtime) — cosa servirebbe esporre a un
   binding nativo; cosa è CLI-only.

## Il design document deve rispondere a

1. **Architettura del binding** — 3 opzioni con pro/contro e raccomandazione:
   (a) estendere il modulo nativo llama.rn (patch locale) per ospitare il path
   bmoe; (b) modulo nativo separato (`react-native-bmoe`) che linka il core;
   (c) altro se emerge dallo studio. Criteri: superficie di manutenzione,
   convivenza coi modelli classici llama.rn (il tier gratuito RESTA llama.rn),
   compatibilità con gli aggiornamenti upstream.
2. **Distribuzione del modello**: 12.5 GB da consegnare all'utente premium —
   canale (HF? CDN?), download resumabile con sha, storage Android (scoped),
   UX di attesa. E il piano B per aggiornamenti modello.
3. **Config di prodotto**: come i parametri di campagna (t=4, cache 2000, dense
   anon, overlap, io-threads 4, ubatch 512, k=6, drop 0.65, prefault tri-stato,
   preserve_thinking per il riuso KV) diventano config dell'app — hard-coded
   dove misurato, esposto dove serve (es. cache scalata sulla RAM del device).
4. **Convivenza di memoria**: l'app + il motore nello STESSO processo con ~4 GB
   usabili — le lezioni RescueParty (memfree, thermal) diventano policy in-app:
   quando rifiutare di caricare, quando degradare, come monitorare. I guardrail
   di harness vanno ripensati come guardrail di prodotto.
5. **Termica e batteria UX**: sostenuto ~69 °C die e ~1 J/token — policy di
   throttling volontario? avvisi? limiti di sessione?
6. **Sessioni/KV**: il riuso incrementale (−94% prefill) nell'UX chat reale;
   il vincolo "niente rollback parziale su ibrido" → edit/regenerate =
   ri-prefill: come lo gestisce la UI senza sorprese.
7. **Naming**: "KEXP" è un nome di laboratorio (gualt: "orribile") — proporre
   2-3 nomi di prodotto per il modello premium (file, UI, marketing).
8. **Piano di implementazione a fasi** con stime: quale fase è il primo
   mandato di scrittura, cosa si può testare su device di lab prima di toccare
   l'app vera, quali gate (il visual-capture harness di Kalsa esiste già).
9. **Rischi top-5** con mitigazioni.

## Deliverable

`reports/kalsa-integration-design.md` nel repo moe-experiments (NON nell'app).
Commit del solo report. **STOP al design — il GO all'implementazione e
l'autorizzazione a scrivere nell'app sono di gualt.**
