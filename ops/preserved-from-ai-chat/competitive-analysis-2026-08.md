# Kalsa vs le migliori app AI — analisi competitiva

Data: 2026-08-16 · Autore: gualt (con assistenza pi) · Stato: NON COMMITTATO (analisi interna)

## 1. Contesto e metodologia

Kalsa è un'app di chat AI **on-device** (llama.rn, modelli GGUF Qwen3.5-4B con
decodifica speculativa), offline-first, senza backend cloud per le conversazioni.
Questo report la confronta con le app cloud leader: **ChatGPT (OpenAI), Claude
(Anthropic), Gemini (Google), Copilot (Microsoft), Perplexity**, più la categoria
delle app **locali** (Private LLM, Apollo AI, Locally AI, Off Grid) e i sistemi
ibridi (Apple Intelligence, Galaxy AI). Fonti elencate in §8.

## 2. Tabella features

| Feature | Kalsa | ChatGPT | Claude | Gemini | Copilot | Perplexity |
|---|---|---|---|---|---|---|
| Modello | On-device 4B (Qwen3.5) | GPT-5.x cloud | Opus 4.8/Sonnet cloud | Gemini 3.x cloud | GPT-class cloud | Cloud multi-modello |
| Chat offline | ✅ completa | ❌ | ❌ | ❌ | ❌ | ❌ |
| Web search | ✅ opt-in (Exa, key locale) | ✅ integrata | ✅ integrata | ✅ integrata | ✅ integrata | ✅ (core del prodotto) |
| Voce | ✅ dettatura on-device (no TTS conversazionale) | ✅ voice mode con interruzione (~232ms latenza) | ✅ | ✅ | ✅ | ❌ |
| Multimodale (immagini in/out) | ❌ | ✅ (DALL·E/Sora, visione) | ✅ (visione) | ✅ (Veo 3, visione) | ✅ | ✅ visione |
| Memoria persistente | ✅ su dispositivo (local) | ✅ cloud (opt-out) | ✅ cloud | ✅ cloud (personalizzazione da chat passate) | ✅ | ⚠️ parziale |
| Progetti/workspace | ⚠️ conversazioni + documenti locali | ✅ Projects | ✅ Projects | ✅ | ✅ | ✅ collections |
| Documenti | ✅ PDF locali + ricerca ibrida BM25+densa | ✅ upload cloud | ✅ upload cloud | ✅ Drive/Gmail | ✅ M365/OneDrive | ✅ file interni (Enterprise) |
| Calendario | ✅ tool locale (eventi sul device) | ⚠️ via plugin | ❌ | ✅ Google Calendar | ✅ M365 | ❌ |
| Note | ✅ locali | ❌ (solo in app) | ⚠️ | ⚠️ Keep | ✅ | ⚠️ |
| Agenti/automazioni | ⚠️ miniapp base | ✅ Agent/Operator | ✅ agent tools | ✅ agenti I/O 2026 | ✅ super app unificata | ✅ |
| Canvas/codice collaborativo | ❌ | ✅ Canvas | ✅ Artifacts | ✅ | ✅ | ❌ |
| Generazione immagini | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Ricerca profonda ("deep research") | ❌ (ricerca locale sui doc) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Traduzione | ✅ on-device | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multi-account profili | ❌ (1 mock locale) | ✅ | ✅ | ✅ | ✅ personale/lavoro separati | ✅ |
| i18n | EN/IT (+ pronto per altre) | ✅ molte lingue | ✅ | ✅ | ✅ | ✅ |
| Share intent (testo/PDF) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Prezzo | Gratis (Pro = UI placeholder) | Free / Plus / Pro $200 | Free / Pro / Max $200 | Free / AI Ultra $250 | Free / Copilot Pro | Free / Pro / Max |

## 3. Tabella sicurezza & privacy

| Aspetto | Kalsa | ChatGPT | Claude | Gemini | Apple Int. (confronto locale) |
|---|---|---|---|---|---|
| Dove girano le chat | **100% dispositivo** | Cloud OpenAI | Cloud Anthropic | Cloud Google | Device + Private Cloud Compute |
| Account obbligatorio | **No** (opzionale, mock locale) | Sì | Sì | Sì (Google) | No (system-level) |
| Retention conversazioni | Nessuna (dati locali) | Fino a 30gg post-delete (abusivi anche con cronologia off) | 30gg consumer; ZDR solo Enterprise; **5 anni de-identificati se autorizzi training** | Indefinita per account Google | Nessuna |
| Training sui tuoi dati | Impossibile (mai inviati) | Free/Plus: sì salvo opt-out; Pro/Team: escluso | Consumer: opt-in; Commercial: no di default | Sì salvo controlli smart features | No |
| Cifratura | Storage locale (SecureStore per chiavi) | TLS in transito, at-rest; niente E2E | TLS, at-rest; niente E2E | TLS, at-rest; niente E2E | E2E dichiarata su PCC |
| Telemetria | **Opt-in, default OFF**, sanitizer + Worker dedicato | Baseline (analytics/abuso) | Baseline | Baseline | Minimal |
| Dati di terze parti | Solo Exa quando attivi web (key locale, mai nel client dati sensibili) | Plugin/aziende terze | — | Estensioni Google (Gmail/Drive/…) | — |
| GDPR/compliance | Dati mai escono dal device (by design) | DPA su Team/Enterprise, BAA su enterprise | DPA/ZDR enterprise | Workspace admin controls | — |
| Minori età/abuso | N/A (locale) | Filtri + review umana selezionata | Filtri | Filtri | — |
| Apertura | App chiusa, ma modello open (Qwen) e runtime open (llama.cpp) | Closed | Closed | Closed | Closed |

## 4. Approfondimento per categoria

### 4.1 Capability (dove le cloud sono avanti)
Le app cloud sono **2-3 ordini di grandezza sopra** in capacità bruta: modelli
con centinaia di miliardi di parametri, multimodale completo (immagini, video,
audio), agenti che navigano il web, deep research, canvas/artifacts, generazione
immagini/video. Kalsa con un 4B on-device non compete su ragionamento, cultura
generale o scrittura creativa. La latenza locale (15-20s per 100 parole su
telefono, contro <1s cloud) è un limite fisico documentato anche dalle altre app
locali (Atomic Chat 2026).

### 4.2 Privacy (dove Kalsa è unica)
Kalsa è più vicina a **Private LLM / Apollo AI / Off Grid** che a ChatGPT:
- Nessun account, nessun login, nessun cloud: i dati **non possono** essere
  usati per training, venduti o sequestrati lato server — non è un opt-out, è
  un'assenza strutturale.
- Anche le cloud "privacy-positive" hanno limiti reali: ChatGPT Free/Plus
  allenano sui tuoi prompt salvo opt-out; Claude trattiene 30gg e **fino a 5
  anni de-identificati** se autorizzi; Gemini si aggancia a tutto il tuo
  account Google; nessuna offre E2E sulle chat (solo Apple con Private Cloud
  Compute la dichiara).
- Il positioning di Kalsa ("everything stays on this phone", rifiuto
  automatico di salvare password/carte/ID/indirizzi) è onesto e verificabile:
  è un vantaggio competitivo reale, non marketing.
- Telemetria opt-in default OFF con sanitizer è allineata alle best practice
  (meglio della baseline di telemetria delle cloud).

### 4.3 Monetizzazione
Le cloud hanno **funnel di prezzo aggressivi**: free tier limitato, poi
$20-30/mese (Plus/Pro), fino a **$200-300/mese** per i tier massimi (ChatGPT
Pro, Claude Max, SuperGrok Heavy, Google AI Ultra, Perplexity Max). Kalsa è
gratis con Pro placeholder: il piano Pro UI-only che abbiamo appena costruito
dovrà, prima o poi, decidere cosa vendere (più modelli? velocità? funzioni
cloud opzionali?) — le app di successo vendono **benefici misurabili**, non
"supporto allo sviluppo".

### 4.4 UX
Le app premiate (e le cloud) convergono su: onboarding guidato, voice
conversazionale, memory visibile e controllabile, progetti, ricerca ibrida nei
propri documenti, condivisione. Kalsa ha già: drawer glass, documenti con
ricerca ibrida BM25+densa, note, calendario, share intent, i18n — una base
solida. Manca: voice conversazionale (ora solo dettatura), canvas/artifacts,
multimodale in input (foto), onboarding per spiegare il modello privacy.

## 5. Sintesi: dove Kalsa vince / perde

**Vince (unico nel suo genere per il segmento):**
- Privacy strutturale: chat 100% on-device, zero account, zero cloud — nessuna
  delle big può fare questa affermazione
- Offline totale (aereo, clinica, laboratorio senza rete)
- Zero costi (gratis per sempre, senza telemetria forzata)
- Tool locale su dati sensibili: calendario/documenti/note mai escono dal device

**Perde:**
- Qualità del ragionamento (4B vs modelli di frontiera)
- Multimodalità (niente immagini in/out, niente video)
- Voice conversazionale (dettatura sì, dialogo no)
- Agenti/deep research/workspace collaborativi
- Ecosistema (plugin, integrazioni, cross-device sync)

**Segmento giusto:** Kalsa non compete con ChatGPT sul mercato generale — compete
come **alternativa privacy-first, gratuita e offline** per utenti che trattano
dati sensibili (medici, ricercatori, avvocati, studenti) o lavorano senza rete.
È lo stesso spazio di Apple Intelligence/Private LLM, ma con tool locali in più.

## 6. Raccomandazioni (roadmap suggerita)

1. **Voice conversazionale on-device** (ASR già presente → TTS + turn-taking):
   è la feature che le app premiate hanno tutte e Kalsa no.
2. **Multimodale in input**: visione locale (llama.rn supporta modelli vision) —
   fotografare documenti/lavagnette è il caso d'uso killer per lab.
3. **Modelli più grandi a scelta** (7B/8B Q4) per chi ha 8+GB RAM, con avviso
   RAM/velocità (pattern già in Settings).
4. **Piano Pro reale**: definire 1-2 benefici misurabili (es. modelli premium
   on-device, embedding illimitati, export PDF/riassunti) — con prezzo locale
   e "cancel anytime" come da best practice paywall.
5. **Onboarding privacy-first** (3 schermate: "i tuoi dati restano qui",
   web search opt-in, telemetria opt-in): è ciò che converte gli utenti
   sensibili alla privacy.
6. **Sync opzionale cifrato** (solo se l'utente lo attiva) per competere con
   il cross-device delle cloud senza rompere il posizionamento.
7. **Deep research locale**: pipeline "documenti → domanda → piano → lettura →
   citazioni" sui PDF già in libreria (manca la parte multi-step, non i
   mattoni).

## 7. Verdetto

Kalsa è **l'unica app del confronto che può dire "le tue conversazioni non
esistono da nessuna parte tranne il tuo telefono"** senza asterischi. Le cloud
vincono su tutto il resto delle capability. La strategia corretta non è
inseguire le feature delle big, ma **raddoppiare sulla privacy strutturale +
tool locali** (voce, visione, ricerca documenti) che le big non possono offrire
senza contraddire il proprio modello di business.

## 8. Fonti

- ChatGPT features: aifans.fan/blog/chatgpt-complete-guide-2026/ · help.openai.com (Capabilities Overview) · releasebot.io/updates/openai/chatgpt (ago 2026)
- ChatGPT privacy: openai.com/policies/row-privacy-policy/ · openai.com/enterprise-privacy/ · terms.law Privacy Audit (48/100) · sonomos.ai free-vs-paid-privacy-2026
- Claude: anthropic.com/news/updates-to-our-consumer-terms · privacy.claude.com (retention, 5 anni de-identificati) · platform.claude.com (ZDR) · jlellis.net (30gg + ZDR)
- Gemini: blog.google/products/gemini/temporary-chats-privacy-controls/ · support.google.com/gemini (Privacy Hub) · itechguides.com (ago 2026)
- Copilot: thinkcomputers.org (super app unificata) · learn.microsoft.com (privacy M365)
- Perplexity: perplexity.ai/hub/legal/privacy-notice (incognito) · help center (Pro)
- On-device: privatellm.app · atomic.chat/blog (latenze locali 15-20s) · dev.to alichherawalla (Apple PCC vs Off Grid) · reddit r/LocalLLaMA (app locali 2026)
- Prezzi: artificialanalysis.ai/agents/chatbots (tier $200-300) · sentisight.ai (AI Ultra $250) · aipricecompare.org
