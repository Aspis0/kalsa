# PIANO OPERATIVO V1 — "Beyond Memory Capacity": MoE 35B da flash su Galaxy S23 8GB

> **Brief operativo per Grok.** Data: 2026-08-03 · Progetto: Kalsa (ricerca "banda per token")
> Orchestratore: Claude (main loop) · Esecutore codice/analisi: **Grok** · Mani sul telefono: **gualt**
> **Repo di lavoro: `Kalsa/moe-experiments/`** (repo git dedicato, totalmente staccato dall'app)
> Device primario: **Samsung Galaxy S23 128GB VERGINE dedicato** (8GB RAM, Snapdragon 8 Gen 2, **UFS 3.1**, OneUI)
> Stato: piano iniziale, sostituisce integralmente il draft precedente (che era basato su Qwen3-30B-A3B)
>
> Tutti i fatti marcati [V] sono stati **verificati online il 2026-08-03** (URL in §13). Tutte le cifre
> marcate [S] sono **stime da confermare** in F0/F2. Grok NON deve fidarsi di nulla che non sia [V]:
> la prima cosa che fa è la checklist di ri-verifica in §7-F0.

---

## Aggiornamenti ri-verifica — 2026-08-03

Ri-verifica online F0.1 (GitHub API + HF tree API + `common/arg.cpp` master). Report: `reports/moe-f0.1.md`.

- **Voce 5 download list (§4) — quant minima MTP 35B: stima ~2–3GB [S] → realtà 11.37GB.**
  - `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` non espone un draft MTP piccolo: i `.gguf` modello sono full+MTP; il più piccolo è `Qwen3.6-35B-A3B-UD-IQ1_M.gguf` = **11 366 414 624 byte** (~11.37GB decimali). Source: `https://huggingface.co/api/models/unsloth/Qwen3.6-35B-A3B-MTP-GGUF/tree/main`.
  - `ggml-org/Qwen3.6-35B-A3B-MTP-GGUF` ha solo `Qwen3.6-35B-A3B-MTP-Q8_0.gguf` = **37 801 096 544 byte** (+ BF16 e mmproj). Source: `https://huggingface.co/api/models/ggml-org/Qwen3.6-35B-A3B-MTP-GGUF/tree/main`.
  - **Implicazione:** il budget disco core 1+2+3+5 non è ~22.6GB ma ~**~30.7GB** (2.74+5.04+11.52+11.37) se si tiene un GGUF MTP full accanto al target; oppure F6 deve riusare/sostituire il file target con la variante MTP (stesso footprint ~11–22GB). Rivedere §4 spazio e sequenza download prima di F1/F6.
- **BigMoeOnEdge stelle: ~196 → 197** (cosmetico). Ultimo commit `b0c4e5b` 2026-08-02. Source: `https://api.github.com/repos/Helldez/BigMoeOnEdge`.
- **Parametro `k` dei bench BigMoeOnEdge chiarito:** è `--n-expert-used` (README: active experts / turbo top-k; best lossy 5.8 tok/s a k=6, best lossless ancora **5.0** a k=8 / cache 3000 MiB). Non cambia la strategia F4; chiude il TODO semantico di §3.2 p.9.
- **Flag mainline `--load-mode`:** modi attuali = `none | mmap | mlock | mmap+mlock | dio` (default `mmap`). Non esiste un modo `on-demand` / `map` con quel nome. Source: `https://raw.githubusercontent.com/ggml-org/llama.cpp/master/common/arg.cpp` (b10244 era il latest release al momento del check).
- **Invariati (confermati):** PR #26003 OPEN non mergiata; PR #24156 OPEN; PR #22673 MERGED 2026-05-16; GGUF size §3/§4 (GB decimali) match byte-esatti HF; llama.rn **0.12.8** (GitHub + npm); famiglia `--spec-draft-*` + `--spec-type` + `-ctk/-ctv` + `--no-warmup` presenti; fork flag `--moe-stream/--cache-mb/--dense-weights/--drop-cold-experts` presenti nel README.

### Aggiornamenti gguf-dump — 2026-08-03

F0.6 completata: download + analisi `GGUFReader` su `models/Qwen3.6-35B-A3B-UD-IQ2_M.gguf`. Report: `reports/moe-f0.6.md`, dump grezzo: `results/gguf_ud-iq2m_dump.txt`.

- **Size file [V]:** **11 522 702 304** byte — match byte-esatto HF (nessun re-download necessario se già presente).
- **Metadata [V]:** `general.architecture=qwen35moe`; `block_count=40`; `expert_count=256`; `expert_used_count=8` (solo routed; shared a parte); `embedding_length=2048`; `expert_feed_forward_length=512`; `expert_shared_feed_forward_length=512`; `full_attention_interval=4`; `attention.head_count_kv=2`; `attention.key/value_length=256`.
- **Per-esperto per-layer [V] (routed, somma gate+up+down):**
  - **37/40 layer:** **942 080 B = 0.942 MB** (gate IQ2_XXS 270 336 + up IQ2_XXS 270 336 + down IQ3_XXS 401 408).
  - **3/40 layer (34, 38, 39):** **1 097 728 B = 1.098 MB** (down alzato a IQ4_XS 557 056).
  - Mediana = 942 080 B; media = 953 754 B.
- **Traffico naive / token [V]:** 8 routed × 40 layer × 942 080 = **301 465 600 B ≈ 301.5 MB/token (mediana)**; pesato reale (37 L × 942 080 + 3 L × 1 097 728) × 8 = **305 201 152 B ≈ 305.2 MB/token** (0% hit; shared residente escluso).
- **Sanity params [V]:** 3·2048·512 = **3 145 728** params/esperto/layer; 256×40×3.15M = **32.21B** esperti + resto ≈ 35.9B; bpw esperti effettivo ≈ **2.40**.
- **Layout [V]:** non fused (gate/up/down separati); i 3 `*_exps` di un layer **non** sono contigui tra loro (in mezzo: shexp + router `ffn_gate_inp`); ordinati per layer 0→39; 1 esperto = slice contigua dentro ogni tensore (dim 256 outermost). Overhead metadata: **10 990 048 B (0.095%)**.
- **§4 budget core aggiornato [V]:** voci 1+2+3+5 = 2.74+5.04+11.52+11.37 = **≈30.67 GB** (non 22.6). Alternativa F6: swap del file target con variante MTP (stesso footprint ~11–12 GB), senza tenere base+MTP insieme.
- **§5 stime [S] sostituite:** ~1.0–1.3 MB/esperto → **0.942 MB** (mediana, 0.954 media); ~350 MB/token → **305.2 MB/token (pesato reale)**. Vedi §5 riscritto sotto.

---

## 0. TL;DR — le decisioni già prese e cosa cambia rispetto al piano precedente

Il piano precedente (quello ricevuto da un altro assistente, basato solo sul titolo del documento)
era ragionevole nell'impianto ma sbagliato o superato in punti chiave. Correzioni verificate:

1. **Modello target: Qwen3.6-35B-A3B, non Qwen3-30B-A3B.** [V] Esiste (rilascio 2026-04-15,
   Apache-2.0), è la stessa classe architetturale del Qwen3.5 che Kalsa già usa
   (`model_type: qwen3_5_moe`), ha **MTP nativo nel config** (`mtp_num_hidden_layers: 1`),
   256 esperti routed + 1 shared (9 attivi/token, ~3B), 40 layer ibridi Gated DeltaNet 3:1,
   contesto 262K. llama.cpp lo supporta da febbraio 2026 (PR #19435) e l'MTP da maggio 2026
   (PR #22673, testato proprio su questo modello).
2. **Nessuna quantizzazione del 35B sta in 8GB di RAM.** [V] Il GGUF più piccolo (unsloth
   UD-IQ1_M) è 10.05GB. Quindi lo streaming da flash **non è un'opzione: è obbligatorio**.
   Questo è esattamente il punto della ricerca — se il progetto funziona, funziona davvero
   "beyond memory capacity".
3. **mmap "nudo" di llama.cpp mainline NON è lazy.** [V] Il loader di default fa
   `MAP_POPULATE` + `posix_madvise(WILLNEED)` sull'INTERO file: con un modello > RAM il
   risultato è thrashing catastrofico, non paging intelligente. Dato reale: gpt-oss-120b via
   mmap nudo su un telefono 12GB = **0.09 tok/s**. L'esperimento "cold vs warm page cache" del
   vecchio piano va quindi reinterpretato: serve a MISURARE il muro, non a scavalcarlo.
4. **Esiste già una base di codice per lo streaming: BigMoeOnEdge.** [V] Fork llama.cpp
   (github.com/Helldez/BigMoeOnEdge, creato 2026-07-10, ~196 stelle, attivo) con flag custom
   `--moe-stream`, `--cache-mb`, `--dense-weights`, `--drop-cold-experts`. Numeri riportati su
   telefono 12GB/UFS 4.x: **Qwen3.6-35B-A3B ≈ 5.0 tok/s**, Qwen3-30B-A3B 5.2, Gemma-4-26B-A4B
   5.0, gpt-oss-120b 2.2. Non partiamo da zero: partiamo da audit + build + bench di questo fork.
5. **`--mlock` è inutilizzabile senza root** (RLIMIT_MEMLOCK), i **thermal zone sono bloccati
   da SELinux** per le app Termux, e **perfetto/simpleperf non sono realistici senza root**. [V]
   La telemetria si fa con `/proc/PID/stat` (majflt), `/proc/PID/io`, `/proc/meminfo`,
   `termux-battery-status` (temperatura batteria come proxy termico).
6. **La GPU non è una via per i MoE su questo telefono.** [V] Vulkan è rotto su Adreno 740
   (issue #6713), OpenCL è verificato solo su 8 Gen 3/Elite e comunque il backend OpenCL non
   gestisce i tensori MoE (restano su CPU). Baseline = CPU-only, ed è una semplificazione, non
   un limite.
7. **Il gap di ricerca è reale e documentato.** [V] Nessun sistema pubblicato combina
   MoE ~35B/256 esperti + smartphone 8GB + flash UFS + cache DRAM predittiva con eviction.
   Una survey 2026 dichiara: *"The architecture that makes MoE truly practical on mobile
   (sub-10W, sub-8GB) doesn't exist yet."* I più vicini: FlashMoE (desktop), SpecPrefetch
   (telefono ma modello minuscolo), PowerInfer-2 (niente codice Android pubblico).
8. **Il modello di controllo denso è Qwen3.5-4B** (già nel catalogo Kalsa, GGUF verificati),
   non Qwen3-4B. E aggiungiamo un controllo nuovo e importante: **LFM2-8B-A1B**, un MoE che
   STA in RAM (Q4_K_M = 5.04GB) — separa il costo "essere MoE" dal costo "streaming da flash".

**La frase chiave del progetto resta valida:** non stiamo cercando di far entrare il modello in
RAM; stiamo cercando di far arrivare gli esperti giusti al momento giusto, abbastanza
velocemente da non fermare il token successivo.

---

## 1. Contesto: cos'è Kalsa e perché questo progetto

**Kalsa** è un'app di chat AI **100% on-device** (React Native/Expo, Android-first) costruita su
`llama.rn` (binding llama.cpp): niente backend, niente account, privacy by design. Oggi in app
girano **Qwen3.5-4B** (default, ibrido DeltaNet, speculative decoding MTP/NextN attivo sui turni
testo) e **Gemma 4 E2B**, con websearch via Exa MCP (senza API key), memoria locale, traduzione,
voce. Repo: `C:/Users/gualt/Desktop/Kalsa/ai-chat`. Documenti rilevanti già nel repo:

- `docs/ROADMAP_BIGGER_MODELS.md` — la genesi di questo piano: identifica il vincolo
  banda-per-token e i candidati (Qwen3.6-35B-A3B, Gemma 4 26B-A4B, SmallThinker, DraftExpert).
- `PLAN.md` (root Kalsa) e `docs/PLAN_V2/V3/V4*` — storia del prodotto.

Il progetto ha **due binari**, con priorità diverse:

| Binario | Obiettivo | Orizzonte |
|---|---|---|
| **A — Prodotto** | qualcosa di *buono* che giri bene su telefoni 6-8GB (mercato di massa) | settimane |
| **B — Ricerca** | un MoE di classe 35B utilizzabile su un telefono 8GB, via streaming esperti + cache predittiva | mesi |

Il binario A ha già un candidato pronto emerso dalla ricerca: **LFM2-8B-A1B** (MoE 8.3B/1.5B
attivi, Q4_K_M 5.04GB, architettura `lfm2moe` supportata da llama.cpp b6709+, esplicitamente
ottimizzato on-device). È un quick win per il catalogo Kalsa via llama.rn e NON dipende dal
binario B. Questo piano è dedicato al **binario B**, ma la F2 produce anche i numeri per A.

Perché il Galaxy S23 128GB: è il banco di prova *difficile* (8GB RAM, UFS 3.1 — il taglio 128GB
usa UFS 3.1, non 4.0 [V]; OneUI aggressiva; thermal throttling). Se il sistema funziona qui, è
robusto; se funzionasse solo su un 16GB/UFS4, non avremmo risolto il problema, avremmo solo
comprato hardware migliore.

---

## 2. Ruoli e modalità operativa per Grok

### 2.1 Chi fa cosa

- **Grok (tu)**: scrivi TUTTI gli script (bash Termux, Python analisi, C++ patch), fai gli audit
  di codice, prepari i comandi esatti da incollare in Termux, analizzi i log/CSV che gualt ti
  riporta, scrivi i report di fase. Non hai accesso diretto al telefono.
- **gualt**: esegue sul telefono i blocchi di comandi che prepari (copia/incolla in Termux),
  ti incolla output e file di log, fa le azioni fisiche (riavvio, app pesanti, raffreddamento).
- **RunPod** (autorizzato, senza chiedere conferma, MA spegnere i pod a fine uso): SOLO per
  (a) build farm / cross-compile / CI, (b) training del predictor in F7-F8, (c) esperimenti di
  correttezza su emulatore. **MAI per numeri di performance**: i tok/s contano solo dal
  telefono fisico.

### 2.2 Regole operative (vincolanti)

1. **Verifica online prima di agire.** Ogni volta che tocchi un repo/flag/quant citato qui,
   ricontrolla che esista ancora e che la sintassi non sia cambiata (llama.cpp rinomina i flag
   di frequente — è già successo con `--spec-draft-*`). La checklist minima è in F0.
2. **Una variabile alla volta.** Ogni run cambia UN parametro rispetto al run precedente.
   Niente "ho cambiato quant, thread e contesto insieme".
3. **Ogni run → una riga nel CSV** (`~/experiments/results/runs.csv` SUL TELEFONO, schema in
   §8.3; la copia canonica vive su PC, flusso dati definito in F0.2) + log grezzo salvato.
   Un numero senza riga CSV non esiste.
4. **Run ripetuti**: ogni configurazione va misurata **3 volte** (mediana). Cold = dopo riavvio
   telefono + `echo 3 > /proc/sys/vm/drop_caches` NON disponibile senza root → cold reale =
   riavvio. Warm = run immediatamente successivo.
5. **Ogni fase → report** in `reports/moe-f<N>.md` (in questo repo, versionato): cosa fatto,
   numeri, deviazioni dal piano, verdetto sul gate. Chiudi con DONE o BLOCKED(motivo).
6. **Il tuo project root è QUESTO repo** (`Kalsa/moe-experiments/`, git dedicato). Qui
   committi liberamente e spesso (script, report, CSV, patch — MAI i GGUF: sono in
   .gitignore). Il repo dell'app (`Kalsa/ai-chat/`) è FUORI PERIMETRO: sola lettura per i
   documenti citati in §1, vietata qualunque modifica. Sul telefono il buffer di lavoro è
   `~/experiments/`.
7. **Codice di terzi = non fidato.** BigMoeOnEdge va auditato (F0.4) PRIMA di buildarlo ed
   eseguirlo. È un fork poco conosciuto: cerca backdoor, telemetria nascosta, curl/exec
   sospetti nel diff vs upstream.
8. **Onestà brutale nei report**: se un numero smentisce l'ipotesi, il numero vince. Il
   progresso si misura coi criteri di §10, non con l'entusiasmo.

---

### 2.3 Modalità solo-Grok (goal pi) con S23 collegato al PC

Questa modalità è quella preferita da gualt per risparmiare token: Grok esegue il piano in
autonomia come goal, con il telefono raggiungibile dal PC. Sostituisce il copia/incolla manuale
di §2.1 per tutto ciò che è remotizzabile.

**Setup controllo remoto (una tantum, lo fa gualt guidato da Grok):**

1. Opzioni sviluppatore + Debug USB attivi; `adb devices` vede l'S23.
2. In Termux: `pkg install openssh termux-api`, impostare password con `passwd`, avviare `sshd`
   (porta 8022). Utente = output di `whoami`.
3. Accesso da PC via USB: `adb forward tcp:8022 tcp:8022` → `ssh -p 8022 <utente>@localhost`.
4. **Termux:Boot** (da F-Droid) + script in `~/.termux/boot/` che lancia `sshd` +
   `termux-wake-lock` → l'accesso sopravvive ai riavvii (indispensabile: i run cold richiedono
   riavvio, che Grok fa con `adb reboot`). Nota: dopo il reboot Termux:Boot parte solo se il
   telefono è stato sbloccato almeno una volta → sul device di test (S23 VERGINE dedicato,
   nessun dato personale) NON impostare alcun blocco schermo: così `adb reboot` + ripartenza
   di sshd sono completamente autonomi, senza intervento umano.

   **[2026-08-05 — incidente e fix definitivo]** Dopo un riavvio sshd NON è ripartito. Causa
   reale: `com.termux.boot` risultava `stopped=true notLaunched=true` — installata ma **mai
   aperta**, e Android non consegna `BOOT_COMPLETED` a un pacchetto in stato *stopped*
   (`FLAG_EXCLUDE_STOPPED_PACKAGES`). Non era un problema di permessi: `RECEIVE_BOOT_COMPLETED`
   era già `granted=true`. Fix applicato e verificato con un riavvio reale:
   - `adb shell monkey -p com.termux.boot 1` (una sola volta nella vita del device) → l'app
     esce da *stopped*; da lì in poi Termux:Boot riceve `BOOT_COMPLETED` a ogni riavvio;
   - `adb shell cmd deviceidle whitelist +com.termux +com.termux.boot` (esenzione doze).

   **Regole per lo script di boot** (imparate dal `boot.log` del riavvio di verifica):
   - `sshd` va lanciato **per primo e incondizionatamente**. Tutto il resto è best-effort e
     va dopo, con `timeout`: se lo script si blocca prima di sshd il telefono resta
     irraggiungibile finché qualcuno non lo tocca a mano.
   - **Mai** sondare la rete con `ip addr show wlan0`: è negato agli uid app untrusted, non
     dà errore, semplicemente non ritorna nulla — nella v1 dello script ha bruciato 90 s di
     attesa **ritardando sshd di 90 s**. Per l'IP si usa `termux-wifi-connectioninfo`.
   - `/proc/uptime` è negato da SELinux su questo device (`/proc/meminfo` invece è leggibile).
   - Marker `~/.boot_ready` (timestamp) scritto subito dopo sshd + log in `~/boot.log`.

   **Limite accertato (testato, non aggirabile senza root):** il riavvio **non** può essere
   innescato da Termux — `svc power reboot` → *"Neither user 10344 nor current process has
   android.permission.REBOOT"*; `/system/bin/reboot` → *Permission denied*; `am start -a
   android.intent.action.REBOOT` → *SecurityException*. E `setprop persist.adb.tcp.port`
   (che renderebbe adb-over-TCP persistente) è bloccato da SELinux anche da uid shell. Il
   toggle "Debug wireless" di Android si spegne **by design** a ogni riavvio.

5b. **App helper per il Debug wireless** — `tools/adb-boot-helper/` (sorgente + `build.ps1`,
   niente Gradle: due classi e un manifest, si compila con javac/d8/aapt2/apksigner dell'SDK).
   Il toggle "Debug wireless" non è riaccendibile da shell (`settings` vuole
   INTERACT_ACROSS_USERS, `content` vuole ACCESS_CONTENT_PROVIDERS_EXTERNALLY), ma **un'app
   installata che detiene `WRITE_SECURE_SETTINGS` sì**, tramite la normale API Settings — e
   quel permesso, concesso una volta con `pm grant`, sopravvive ai riavvii. L'app scrive
   `adb_wifi_enabled=1` a `BOOT_COMPLETED`.
   Installazione (una volta sola, richiede adb attivo in quel momento):
   ```
   adb install -r tools/adb-boot-helper/moe-adb-boot.apk
   adb shell pm grant com.moe.adbboot android.permission.WRITE_SECURE_SETTINGS
   adb shell monkey -p com.moe.adbboot 1          # esce da "stopped", v. sopra
   adb shell cmd deviceidle whitelist +com.moe.adbboot
   ```
   Scelte di design imposte dall'audit ostile (2026-08-05) — non regredire:
   - il receiver è `exported="false"` e **non** espone azioni custom: con un receiver
     esportato qualsiasi app installata, senza alcun permesso, poteva riaccendere il debug
     wireless in silenzio. I broadcast di sistema arrivano lo stesso a un receiver non
     esportato, e `BOOT_COMPLETED` è protetto (nessuna app può falsificarlo);
   - i retry girano in un **JobScheduler job**, non in un `Thread` lanciato da `onReceive`:
     appena `onReceive` ritorna il processo non ha più componenti attivi e diventa un empty
     process, primo candidato di LMKD durante il boot storm — verrebbe ucciso con SIGKILL,
     senza eccezione né log. Serve perché al `BOOT_COMPLETED` il Wi-Fi spesso non è ancora
     associato e adbd rifiuta di aprire il listener TLS;
   - l'uscita richiede **3 successi consecutivi**, non uno: adbd può ripulire il flag se
     parte dopo la prima scrittura.
   Diagnostica: `adb logcat -s MoeAdbBoot`.

   Conseguenza operativa che resta valida comunque: **ssh è il canale di controllo, adb è un
   comfort.** Ogni script deve funzionare via ssh; se l'helper fallisce su un firmware
   futuro, il lavoro non si ferma.
5. **REGOLA CRITICA — carica**: USB collegato = telefono in carica = misure invalide (§8.2).
   Quindi: setup, build e push di file grossi via USB; **i run di misura SEMPRE con cavo
   staccato**, controllo via Wi-Fi (wireless debugging / `adb tcpip 5555` + ssh sull'IP Wi-Fi).
   Prima di ogni blocco di misura Grok verifica `termux-battery-status` → `"plugged":
   "UNPLUGGED"`; se risulta in carica, il run non parte e non entra nel CSV.

**Cosa Grok può fare da solo con questo setup:** tutto F0-F6 — riavvii (`adb reboot`), run e
telemetria via ssh, pressure test (apertura camera/browser via `adb shell am start` / `monkey`),
download modelli, sweep completi, CSV e report.

**Cosa resta comunque a gualt (azioni fisiche):** staccare/attaccare il cavo, assicurare
condizioni termiche sensate (telefono su superficie fresca, non in tasca), intervenire se il
telefono si pianta. (Con lock schermo assente, lo sblocco post-riavvio non serve.)

**Regole di autonomia aggiuntive (si sommano a §2.2):**

9. **Checkpoint obbligatori con STOP**: fine F0.4 (audit fork), gate F4, e prima di iniziare
   F7. Lì Grok scrive il report, si ferma e aspetta l'ok di gualt. Mai proseguire oltre un
   gate senza report scritto.
10. Mai inventare o estrapolare numeri mancanti: run fallito = riga CSV con FAIL nelle note,
    non una stima.
11. Comando adb/ssh che fallisce 3 volte di fila → BLOCKED nel report, non retry infinito.
12. Perimetro file sul telefono: solo home Termux (`~/`, `~/models`, `~/experiments`). Vietati:
    factory reset, modifiche a impostazioni di sistema oltre a quelle elencate in F1, flash,
    qualunque cosa fuori perimetro.
13. F7-F8 (patch C++ su ggml/fork + design predictor) NON vanno tentate in solo-mode senza
    checkpoint: è il territorio a più alto rischio di lavoro sbagliato che sembra giusto.

## 3. Stato dell'arte verificato (2026-08-03)

### 3.1 Il modello target e le alternative

**Qwen/Qwen3.6-35B-A3B** [V]:

| Proprietà | Valore |
|---|---|
| Parametri totali | 35.95B (safetensors: 35,951,822,704) |
| Architettura | `Qwen3_5MoeForConditionalGeneration`, `model_type: qwen3_5_moe` (stessa classe di Qwen3.5) |
| Layer | 40, pattern 10×(3 Gated DeltaNet → 1 Gated Attention) |
| Attention piena | solo 10 layer su 40; 16Q/2KV head, head_dim 256 |
| Esperti | 256 routed, `num_experts_per_tok=8`, +1 shared → 9 attivi/token ≈ 3B parametri |
| `moe_intermediate_size` | 512 (esperti PICCOLI e numerosi — ottimo per caching a grana fine) |
| Contesto | 262,144 nativo |
| MTP | nativo, `mtp_num_hidden_layers: 1` |
| Licenza / rilascio | Apache-2.0 / 2026-04-15 |
| Varianti | checkpoint unico con `enable_thinking` nel template (niente -Instruct/-Thinking separati) |
| Multimodale | sì (vision encoder incluso; su llama.cpp il supporto iniziale era "no vision") |

**GGUF** [V] — repo `unsloth/Qwen3.6-35B-A3B-GGUF` (naming Unsloth Dynamic "UD-", mixed-bit;
niente IQ3_XS/Q2_K "puri"); MTP: `unsloth/Qwen3.6-35B-A3B-MTP-GGUF` e `ggml-org/Qwen3.6-35B-A3B-MTP-GGUF`:

| Quant | GB | Note per S23 8GB |
|---|---:|---|
| UD-IQ1_M | 10.05 | solo stress test, qualità attesa bassa |
| UD-IQ2_XXS | 10.76 | — |
| **UD-IQ2_M** | **11.52** | **quant primaria del progetto** |
| **UD-Q2_K_XL** | **12.29** | alternativa K-quant (K > IQ sugli expert tensors, v. sotto) |
| UD-IQ3_XXS | 13.21 | upgrade qualità se lo streaming regge |
| UD-Q3_K_S / M | 15.36 / 16.60 | probabilmente troppo per UFS 3.1, misurare solo se F4 va molto bene |
| UD-Q4_K_M | 22.13 | è la taglia usata da BigMoeOnEdge sul telefono 12GB — fuori portata S23 [S] |

Nota qualità quant [V]: nella discussione ik_llama.cpp #359 i K-quant risultano migliori degli
IQ **sui tensori degli esperti MoE** a parità di bit; le UD di Unsloth sono mixed-bit calibrate.
Quindi il confronto UD-IQ2_M vs UD-Q2_K_XL (F4) non è pedanteria: è una decisione di progetto.

**Famiglia Qwen** [V]: esistono anche `Qwen3.5-35B-A3B` e `Qwen3.5-122B-A10B` (MoE) oltre alla
linea densa 0.8/2/4/9/27B. **Decisione: si usa Qwen3.6-35B-A3B** — stessa classe architetturale
del 3.5 ma più recente (aprile 2026), MTP integrato, ed è il modello su cui llama.cpp ha
testato l'MTP e su cui BigMoeOnEdge riporta i numeri. Il vecchio Qwen3-30B-A3B è escluso
(scelta di gualt, confermata: architettura precedente, niente DeltaNet → KV cache più pesante).

**Alternative nel piano** (tutte [V] salvo dove indicato):

| Modello | Tot/attivi | GGUF | Ruolo nel piano |
|---|---|---|---|
| **Qwen3.5-4B** | 4B densa (ibrida, 8 full-attn su 32) | Q4_K_M 2.74GB; MTP 2.83GB | controllo denso (già in Kalsa) |
| **LFM2-8B-A1B** (Liquid) | 8.3B/1.5B | Q4_K_M **5.04GB** | controllo "MoE che sta in RAM" + candidato prodotto |
| **Gemma-4-26B-A4B** | 26B/4B (fonti secondarie) | UD-IQ2_XXS 9.92GB, UD-IQ3_XXS 11.42GB; MTP presente | secondo MoE grande (cross-check in F4, opzionale) |
| GPT-OSS-20B | ~21B/3.6B | ~11.4-12.1GB a TUTTE le quant (esperti MXFP4) | riserva; taglia fissa, poco regolabile |
| SmallThinker-21B-A3B | 21B/3B | Q3_K 10.42GB | scartato come motore: i "20+ tok/s @8GB" sono sul framework PowerInfer, che NON ha codice Android pubblico [V] |
| Moonlight-16B-A3B / ERNIE-4.5-21B-A3B / Ring-mini-2.0 | vari | esistono | fuori piano V1 (issue note / meno rilevanti) |

### 3.2 Il runtime: cosa offre DAVVERO llama.cpp oggi

Fatti [V] che vincolano il design:

1. **mmap default = eager**: `MAP_POPULATE` + `posix_madvise(WILLNEED)` sull'intero file
   (`src/llama-mmap.cpp`); con `--numa` si passa a `MADV_RANDOM`. Nessun lazy loading
   per-esperto in mainline.
2. **PR #26003 `--lazy-experts`: APERTA, non mergiata** (creata 2026-07-22). PR #24156
   `--reclaim-mmap-source` correlata. → Da monitorare settimanalmente: se merge, diventa la
   via mainline e riduce la dipendenza dal fork.
3. **`--cpu-moe` / `--n-cpu-moe` / `-ot`** (PR #15077, #11397): assegnano tensori a buffer
   NOMINATI → su una build CPU-only pura sono di fatto inerti. Servono solo con backend GPU
   attivo. Non sono lo strumento per questo progetto.
4. **MTP/NextN mergiato** (PR #22673, maggio 2026): `--spec-type draft-mtp`, famiglia flag
   `--spec-draft-*` (`--spec-draft-n-max`, `--spec-draft-type-k/v`, `--spec-draft-cpu-moe`…).
   Testato su Qwen3.6-35B-A3B: acceptance ~75%, speedup >2x MA su GPU (DGX Spark). Zero dati
   CPU/ARM pubblicati. Un test indipendente su RTX3090 riporta **nessuno speedup netto** con
   speculative su A3B MoE (Ampere). Sul telefono l'economia è diversa (domina l'I/O esperti,
   non il compute) → l'ipotesi H4 va misurata, esito genuinamente aperto.
5. **llama.rn 0.12.8** espone `n_cpu_moe` e tutto lo speculative/MTP (text-only), ma NON
   `-ot`. L'integrazione prodotto di qualunque cosa esca da questo piano passa da lì, dopo.
6. **ik_llama.cpp** builda su Termux [V] (`-fmoe`, `-rtr`) ma con regressioni documentate su
   Qwen3 MoE (issue #1699: PP 2x più lento di mainline in un caso). Solo benchmark mirato, non base.
7. **Bug Android noti**: DirectIO/scoped storage (#18804) → **tenere i GGUF nella home
   Termux**, mai su `/storage/...`. Phantom process killer (termux-app #2366, ancora vivo su
   Android 15) → workaround adb in F1. `--mlock` non praticabile senza root.
8. **Fork sperimentali di expert-caching su llama.cpp**: issue #20757 (two-tier cache) chiusa
   senza merge; kisasexypantera94 `moe-expert-residency` (LFU su **Metal**, 97-99% hit su
   Qwen3-30B-A3B — conferma indiretta di H1/H2!); Lidenburg (3-tier disk); koren1712
   `expert-streaming-win` (meno byte ma end-to-end più lento — monito: ridurre i byte non
   basta, conta la pipeline). Nessuno è CPU-ARM.
9. **BigMoeOnEdge** (Helldez): la base pratica. Flag: `--moe-stream` (streaming esperti
   on-demand), `--cache-mb N` (budget cache esperti), `--dense-weights` (pesi densi residenti),
   `--drop-cold-experts` (+ un parametro `k` che compare nei bench, semantica da chiarire in
   F0.4). Numeri dichiarati (telefono 12GB RAM / UFS 4.x): 35B-A3B 5.0 tok/s (file UD-Q4_K_M ~22GB!),
   30B-A3B 5.2, Gemma-4-26B 5.0, gpt-oss-120b 2.2; baseline mmap nudo 0.09. Non validato
   indipendentemente: la validazione siamo noi (F4).
10. **Termux**: esiste `pkg install llama-cpp` ufficiale (arm64, auto-update) — utile per lo
    smoke test, ma i run di misura usano **build da sorgente** (controllo versione/flag;
    dotprod/i8mm auto-rilevati, il Cortex-X3/A7xx dell'8 Gen 2 li ha entrambi; i8mm ≈ +20%).
11. **Hardware S23 128GB** [V]: UFS 3.1 confermata sul taglio 128GB; AndroBench reale:
    seq read ~1686 MB/s, seq write ~552 MB/s. **Random read 4K: nessun dato pubblico → lo
    misuriamo noi con fio (F2.1), ed è IL numero che governa tutto il progetto.**

### 3.3 La letteratura: cosa è già dimostrato (numeri da citare, non da riscoprire)

**Località degli esperti (H1 è già provata in letteratura, va solo confermata on-device):**

- Mixtral paper (arXiv:2401.04088): P(stesso esperto del token precedente) ≈ **30%** vs 12.5%
  random, più alta nei layer profondi.
- "Local Routing Consistency of MoE Models" (arXiv:2505.16056): hit-rate **LRU** per finestra:
  m=4 → **81.2%**, m=16 → **90.4%**, m=64 → **93.1%**, m=256 → **97.5%**; cache ottimale ≈
  **2× gli esperti attivi**; Qwen3 tra i modelli con routing più "locale" (SRP 54.14).
- Analisi caching Mixtral (arXiv:2511.05814): LRU precision 29.1%/recall 58.2%; speculative
  expert loading precision=recall=**84.6%**.
- Blog Doubleword su **Qwen3.5-35B-A3B** (256 esperti, 40 layer — stessa famiglia del target):
  co-attivazioni sfruttabili, −21.3% caricamenti unici (oracle).

**Sistemi di riferimento (cosa copiare, cosa evitare):**

| Sistema | Idea chiave | Numeri | Codice |
|---|---|---|---|
| PowerInfer-2 | neuron cluster, hot/cold, pipeline I/O-compute su phone | 11.68 tok/s su 47B sparso | NON Android-pubblico [V] |
| LLM in a Flash (Apple) | windowing + row-column bundling per letture flash sequenziali | 4x CPU / 20x GPU vs naive | no |
| Mixtral-offloading | LRU + speculative loading (router layer i → layer i+1) | — | sì |
| MoE-Infinity | tracing sequence-level, cache activation-aware | −4x/−20x latenza | sì |
| Pre-gated MoE | il router del layer corrente predice il layer successivo | — | no |
| AdapMoE | gating adattivo + prefetch | −25% caricamenti, 1.35x | sì |
| **HOBBIT** | **mixed-precision sui cache miss** (esperto mancante caricato a bit più bassi) | fino a 9.93x vs SOTA offload; +8k righe su llama.cpp | no (peccato) |
| ProMoE | prefetch proattivo con predictor | 2.20x prefill / 2.07x decode | sì |
| ExpertFlow | predictor transformer del routing path | hit 91.96% (+61% vs LRU), acc 95% | no |
| **Fate / Cross-Layer Gate** | input del gate dei layer adiacenti | prefetch acc **97.15%** (soglia 75° pct), 4.5x/4.1x | no |
| PreScope | predictor LLaPor layer-group-aware | top-4 acc 94-99% | no |
| **SpecPrefetch** (arXiv:2607.24787) | adapter low-rank 6.48M par. che predice la massa di routing; **girato su Snapdragon 8 Elite** | Recall@8 85.6-89.4% (Qwen3-VL-30B-A3B); +20% su storage lento | "upon acceptance" |
| FlashMoE (arXiv:2601.17063) | SSD offload + cache ML recency+frequency | hit +51% vs LRU/LFU, 2.6x — ma DESKTOP | — |
| **DraftExpert** (arXiv:2607.24434) | draft expert residenti distillati per layer, self-speculative + prefetch del target | **1.45x**, acceptance 84-87%, prefetch hit 86-88% (DeepSeek-V2-Lite, Moonlight-16B-A3B; scenari CPU→GPU e Flash→NPU) | no |
| EVICT (arXiv:2605.00342) | speculative decoding expert-aware (albero di draft che minimizza l'unione di esperti) | −32.5% esperti attivati vs EAGLE-3 | — |
| **kimi-k3-in-c** (FareedKhan-dev, 2026) | C99 puro, `pread` **O_DIRECT** (bypassa il page cache), LRU + batch prefetch; anche il trunk denso (109GB bf16) è streamato via ring buffer; budget RAM "a manopola" con output byte-identico a ogni preset | Kimi K3 **2.78T** (896 esperti/layer, 16 attivi) in 8.24GB RSS — ma **~32 s/token** su dual EPYC 7763 + NVMe 5-6 GB/s | sì (Linux x86-64 only: O_DIRECT, no ARM/Android) |

Nota su kimi-k3-in-c (aggiunta 2026-08-05): è la dimostrazione più estrema del principio di
questo progetto (checkpoint/RAM ≈ 190:1 contro il nostro ≈ 1.6:1), ma il caso "8GB" è lento
(~0.03 tok/s) proprio perché lì **anche il trunk denso viene ri-letto da disco a ogni token**;
nel nostro setup trunk+shared expert stanno in RAM e si streamano solo i routed → regime
molto più favorevole, la finestra 5-8 tok/s resta plausibile. Takeaway tecnico per F8: la
loro scelta `O_DIRECT`+`pread` batte l'I/O bufferizzato e **non inquina il page cache** —
rilevante per noi visti i majflt storm di F2; da valutare se il read path di BigMoeOnEdge
possa usare O_DIRECT su f2fs/FBE Android (esperimento, non prerequisito). NON è un runtime
candidato per S23.

**Gap che questo progetto copre** (dai report, riformulati come obiettivi):

- G1: nessuno ha fatto MoE 256-esperti/~35B da flash **UFS** su telefono **8GB** con cache
  predittiva end-to-end (FlashMoE=desktop, SpecPrefetch=modello piccolo).
- G2: gli hit-rate in letteratura sono quasi tutti **simulazioni offline**; noi misuriamo con
  budget RAM reale, eviction reale, lmkd reale.
- G3: **expert packing su flash per letture sequenziali single-device è un'area quasi vuota**
  (il più vicino è il bundling di Apple, a grana di neurone) → contributo originale possibile.
- G4: nessuno integra speculative expert-aware + cache multi-tier + quantizzazione mista
  per-esperto in un'unica pipeline mobile.
- G5: i sistemi migliori (HOBBIT, ExpertFlow, Fate, PreScope) sono **senza codice** → una
  implementazione open riproducibile ha valore di per sé.

---

## 4. Decisione modelli (finale, eseguibile)

Download list per il telefono (home Termux, `~/models/`), in ordine di priorità:

| # | File | GB | Obbligatorio? |
|---|---|---:|---|
| 1 | Qwen3.5-4B Q4_K_M (`unsloth/Qwen3.5-4B-GGUF`) | 2.74 | sì — controllo denso (possibile riuso del file già scaricato dall'app Kalsa se estraibile; altrimenti riscaricare) |
| 2 | LFM2-8B-A1B Q4_K_M (`LiquidAI/LFM2-8B-A1B-GGUF`) | 5.04 | sì — controllo MoE-in-RAM |
| 3 | **Qwen3.6-35B-A3B UD-IQ2_M** (`unsloth/Qwen3.6-35B-A3B-GGUF`) | 11.52 | sì — target primario |
| 4 | Qwen3.6-35B-A3B UD-Q2_K_XL | 12.29 | sì, ma si scarica SOLO al momento di F4.4 (servono 12.3GB liberi allora; cancellabile dopo il confronto) |
| 5 | Qwen3.6-35B-A3B-MTP GGUF (repo unsloth; quant minima = UD-IQ1_M full+MTP) | **11.37 [V]** (ex ~2–3 [S]; F0.1) | sì — serve per F6; **non** è un draft leggero |
| 6 | Qwen3.6-35B-A3B UD-IQ3_XXS | 13.21 | solo se gate F4 = PASS |
| 7 | Gemma-4-26B-A4B UD-IQ2_XXS (`unsloth/gemma-4-26B-A4B-it-GGUF`) | 9.92 | opzionale (cross-check) |

Spazio (matematica esplicita, edit 2026-08-03): core residente iniziale = voci 1+2+3+5 =
2.74+5.04+11.52+11.37 ≈ **30.7 GB [V]** (non più 22.6 [S]). Alternativa per non sforare:
tenere solo 1+2+3 (~19.3 GB) e in F6 **sostituire** il file target con la variante MTP
(stesso ordine di grandezza, niente base+MTP affiancati).
Requisito d'ingresso: **≥40GB liberi** — copre il core, il margine di lavoro e la voce 4 al
momento di F4.4 (che va cancellata dopo il confronto se lo spazio è sotto i 15GB liberi).
Le voci 6-7 (≈23GB in più) SOLO se al momento restano ≥15GB liberi dopo il download previsto.
Se lo spazio non basta: si rinuncia prima alla 7, poi alla 6; il confronto K vs IQ di F4.4 si
fa comunque, al limite in modalità "una quant grande alla volta" (scarica 4 → misura →
cancella 3 o 4, mai tenerle entrambe senza margine).

Verifica d'integrità: dimensione esatta in byte da HF API (pattern già usato nell'app Kalsa) —
niente hash streaming disponibile per file da 11GB+, la size esatta + load riuscito è il check.

---

## 5. La fisica del problema (aggiornata coi numeri veri)

Numeri F0.6 misurati su `Qwen3.6-35B-A3B-UD-IQ2_M.gguf` (2026-08-03, source:
`results/gguf_ud-iq2m_dump.txt`). I [S] restanti sono solo I/O UFS e budget RAM device.

- Parametri per esperto per layer [V]: 3 matrici × hidden 2048 × moe_ff 512 =
  **3 145 728 params/esperto/layer**. Quant mista Unsloth UD-IQ2_M:
  gate/up = IQ2_XXS, down = IQ3_XXS (37 layer) o IQ4_XS (layer 34/38/39).
  → **942 080 B = 0.942 MB per esperto** (37/40 layer) [V];
  1 097 728 B = 1.098 MB (3/40 layer) [V]; media 0.954 MB.
  (Sanity: 256×40×3.15M ≈ 32.21B esperti + attention/shared/embed ≈ 3.7B ≈ 35.9B ✓;
  bpw esperti effettivo ≈ 2.40 [V].)
- Traffico naive per token (0% hit) [V]: 8 routed × 40 layer × 942 080 B =
  **301 465 600 B ≈ 301.5 MB/token (mediana)**, pesato reale (3 L con down IQ4_XS) **305 201 152 B ≈ 305.2 MB/token** [V] (shared shexp residente, escluso).
  **[MISURATO F2.1, 2026-08-04 — placeholder sostituito]** Random read UFS 3.1 (qd1, mediane
  fio): 1M = **413 MiB/s**, 256k = 214, 64k = 83, 4k = 21. Per letture a grana esperto
  (0.942 MB [V]) banda effettiva stimata **~370-410 MiB/s** → naive ≈ 305 MB ÷ ~400 MB/s ≈
  **~0.75-0.85 s/token di solo I/O ≈ 1.2-1.3 tok/s**: il muro, misurato. (Mai usare la
  colonna 4K in questa formula. Nota: qd>1/io_uring inaffidabile su Termux — il parallelismo
  reale lo danno gli `--io-threads` del fork, da misurare in F4.)
- Con hit-rate 90% (plausibile da letteratura con cache ≈ 2× working set): ~30.1 MB/token →
  **~0.08 s di I/O** → **5-8 tok/s combinando compute** [S]. Il progetto vive o muore qui.
- Budget RAM S23 [S]: 8GB fisici − OS/OneUI ≈ 3-3.5GB → **~4.5GB usabili in Termux** senza
  farsi uccidere da lmkd. Allocazione target: pesi densi+shared residenti ~1.5-2GB + KV+buffer
  ~0.5GB + **cache esperti 1500-2500MB** (`--cache-mb`).
- KV cache: `full_attention_interval=4` → 10 layer full-attn su 40 [V]; 2 KV head × head_dim 256
  → a q8_0 ≈ **10KB/token** [S] → 4k contesto ≈ 40MB: trascurabile. L'ibrido DeltaNet/SSM è un
  regalo per questo progetto (in un MoE classico il KV competerebbe con la cache esperti).
- Cache "utile" in numeri di esperti: 2000MB / 0.942MB ≈ **~2120 slot su 10 240 totali
  (256×40) ≈ 21%** [V] — la letteratura (2505.16056) dice che con questa copertura l'hit-rate
  LRU su finestre medie supera l'85-90%: coerente con l'ipotesi H2.

Formula guida (da riportare in ogni report di fase):

```
t_token ≈ t_compute(3B attivi, CPU 8g2) + n_miss × t_load_esperto(UFS 3.1, random ~0.942 MB)
hit-rate → n_miss = 320 esperti-layer/token × (1 − h)
traffico_flash/token ≈ n_miss × 0.942 MB
```

---

## 6. Ipotesi scientifiche (riformulate con attese quantitative)

| ID | Ipotesi | Attesa quantitativa (da letteratura) | Dove si testa |
|---|---|---|---|
| H1 | Località temporale degli esperti su Qwen3.6-35B-A3B in task chat/coding reali | hit-rate LRU ≥80% con cache ≈2× working set (2505.16056: 81-97%) | F7 (trace), conferma indiretta in F4 |
| H2 | Una cache esperti in DRAM con budget ~2GB riduce il traffico flash ≥5× vs naive | da **305.2 MB/token [V]** a ≤50 MB/token [S] | F4 (BigMoeOnEdge), F8 |
| H3 | Il prefetch predittivo batte LRU/LFU puro | +5-15 punti di hit-rate (ExpertFlow: +61% vs LRU è su GPU serving, non ci aspettiamo tanto) | F7 simulatore → F8 runtime |
| H4 | MTP/speculative riduce i caricamenti per token utile (meno passi target) | DraftExpert: 1.45x; EVICT: −32.5% esperti attivati. Ma RTX3090: 0 speedup → esito aperto su CPU+flash | F6 |
| H5 | Il degrado sotto memory pressure è governabile con cache applicativa esplicita (vs page cache) | BigMoeOnEdge vs mmap nudo: 5.0 vs 0.09 tok/s (già quasi-provata altrove) | F5 |
| H6 | (originale, G3) Riordinare gli esperti sul GGUF per co-attivazione converte random read in read semi-sequenziali → +banda effettiva | UFS 3.1: seq 1686 MB/s vs random 4K ~10-20× più lenta [S] | F8+ (estensione) |

---

## 7. Roadmap: fasi F0-F8 (+ estensioni F9)

> Ogni fase ha: obiettivo, task, gate d'uscita. Le fasi F0 è su PC (Grok da solo); F1-F6 sono
> PC+telefono (Grok prepara, gualt esegue); F7-F8 tornano pesantemente su PC/RunPod.

### F0 — Preflight su PC (Grok, ~1-2 giorni, nessun telefono richiesto)

- **F0.1 Ri-verifica online** (obbligatoria, il mondo cambia in fretta):
  - stato PR llama.cpp **#26003** (`--lazy-experts`) e #24156 — se nel frattempo MERGIATE, il
    piano F4 cambia: prima si prova mainline lazy, poi il fork;
  - repo `Helldez/BigMoeOnEdge`: ultimo commit, issue aperte, licenza, README aggiornato;
  - esistenza/nome esatto dei file GGUF della download list §4 (HF tree API, size in byte);
  - versione corrente llama.cpp e nomi flag (`--spec-*`, `--load-mode`, `-ctk/-ctv`);
  - llama.rn ultima versione (per il binario prodotto, non blocca).
- **F0.2 Struttura di lavoro e flusso dati canonico**: GIÀ CREATA — è questo repo
  (`scripts/` bash per Termux · `analysis/` Python: parsing log → CSV → grafici · `traces/` ·
  `results/` · `reports/`). **Flusso dati (unica definizione valida, richiamata da
  §2.2.3/5/6)**: sul telefono l'harness scrive `~/experiments/results/runs.csv` + log grezzi
  (buffer di lavoro); a fine di OGNI sessione di misura Grok fa pull (scp via ssh §2.3, o
  `adb pull`) verso `results/` di questo repo — che è l'archivio canonico — e committa;
  l'analisi legge SOLO la copia PC. Mai editare a mano la copia telefono.
- **F0.3 Harness telemetria** (bash, POSIX-compatibile con Termux): script `run_bench.sh` che
  wrappa un run llama.cpp e cattura: cmdline, timestamp, `/proc/meminfo` prima/dopo,
  `/proc/<pid>/stat` (minflt campo 10, majflt campo 12) prima/dopo, `/proc/<pid>/io`
  (read_bytes) prima/dopo, `termux-battery-status` (temperatura) prima/dopo, output completo
  llama.cpp (i suoi timing: prompt eval tok/s, eval tok/s, ttft) → append riga a `runs.csv`.
  NB: thermal zones e simpleperf NON disponibili senza root — non perderci tempo.
- **F0.4 Audit BigMoeOnEdge** (ostile): diff completo vs llama.cpp upstream di pari data.
  Cerca: (a) codice malevolo/rete/exec, (b) correttezza dello streaming (race, use-after-free,
  cache coherency), (c) semantica ESATTA di `--moe-stream`, `--cache-mb`, `--dense-weights`,
  `--drop-cold-experts` e del parametro `k` dei bench, (d) policy di eviction usata (LRU? LFU?
  altro?), (e) punti di aggancio per la nostra strumentazione (log attivazioni esperti, hit/miss
  counter), (f) **build system**: CMake/script che scaricano roba dalla rete a build-time
  (FetchContent, curl nei target custom) = red flag da ispezionare uno per uno.
  **Regole di contenimento (ricalibrate: il device di test è un S23 VERGINE dedicato, senza
  dati personali)**: si builda SOLO da sorgente a commit PINNATO e auditato — mai
  binari/release precompilati del fork (costa zero e garantisce riproducibilità). La passata
  di sicurezza si limita ai punti (a) e (f) — rete/exec e fetch a build-time; il valore
  PRIMARIO dell'audit è ingegneristico: capire streaming/cache/eviction per decidere la
  strategia F8. Prima esecuzione direttamente sul telefono: OK (RunPod resta solo come
  fallback se la build Termux fallisce). Termux senza permesso storage (v. F1) come default
  di least-privilege. Blocco WAN nei run di misura: opzionale, non richiesto.
  Report dedicato: è la lettura più importante di tutto il progetto — da qui esce la
  strategia F8 (patchare il fork vs riscrivere su mainline+#26003).
- **F0.5 Piano build**: due percorsi pronti: (a) build on-device in Termux (clang/cmake, flags
  auto dotprod/i8mm), (b) cross-compile NDK su RunPod se la build on-device è troppo lenta o
  fallisce. Scrivi entrambi gli script; il default è (a).
- **F0.6 Download su PC + gguf-dump del target** (autonomo, niente telefono): Grok scarica
  UD-IQ2_M (voce 3 di §4) **direttamente su PC** (huggingface-cli; serve ~12GB liberi su PC)
  e ci fa girare gguf-dump: dimensioni esatte per-tensore → dimensione reale media di un
  esperto a UD-IQ2_M, layout dei tensori esperti nel file (contigui per layer? interleaved?),
  overhead metadata. Aggiorna le stime [S] di §5. Il file NON si riscarica sul telefono: in F1
  viene pushato via USB (`adb push` verso la home Termux, poi spostato con `mv` da shell ssh —
  NB: `adb push` diretto nella home Termux non è permesso dai permessi Android; push in
  `/sdcard/Download/` e poi `cp` da Termux, che può leggere /sdcard SOLO se in quel momento ha
  il permesso storage → farlo PRIMA di revocare il permesso per la campagna, oppure usare
  `scp` via ssh §2.3 che non ha questo problema. Preferenza: **scp**.)
- **Gate F0**: audit BigMoeOnEdge = nessun red flag di sicurezza; harness pronto; download list
  confermata. Altrimenti: BLOCKED con alternative (es. fork malevolo → si parte da mainline + PR #26003 applicata a mano).

### F1 — Setup telefono (gualt esegue, Grok prepara tutto; ~1 giorno)

Checklist device (una tantum):
- [ ] ≥40GB liberi; batteria >50%; telefono aggiornato
- [ ] **Device di test dedicato e VERGINE** (confermato): nessun dato personale a bordo →
      niente backup necessario. NESSUN blocco schermo (autonomia dei riavvii, §2.3).
      Possibilmente senza account Google (meno servizi in background = più RAM libera e
      misure più pulite; Termux/F-Droid non lo richiedono)
- [ ] **Termux SENZA permesso storage**: niente `termux-setup-storage` — su questo device non
      serve (i file arrivano via scp nella home) ed evita anche il bug scoped-storage #18804:
      least privilege gratis
- [ ] **RAM Plus OFF** (Impostazioni → Assistenza dispositivo → Memoria → RAM Plus) — usa la
      UFS come swap: veleno puro per questo progetto
- [ ] Termux da **F-Droid o GitHub releases** (mai Play Store)
- [ ] Ottimizzazione batteria disattivata per Termux (Device Care → escludi)
- [ ] `termux-wake-lock` attivo in ogni sessione; `pkg install termux-api` per battery-status
- [ ] **Workaround phantom process killer via adb** (richiede PC, una tantum):
      `adb shell "settings put global settings_enable_monitor_phantom_procs false"`
      (e su Android 14+: `adb shell device_config put activity_manager max_phantom_processes 2147483647`)
      — senza questo, OneUI può uccidere i processi a metà run e i numeri diventano spazzatura
- [ ] Modelli SEMPRE in `~/models/` (home Termux) — MAI in `/sdcard` o `/storage/...` (bug #18804)
- [ ] Numeri di performance MAI sotto carica attiva (throttling diverso) e MAI con telefono caldo:
      regola: temperatura batteria ≤32°C a inizio run (da `termux-battery-status`)

Poi: `pkg update && pkg install git cmake clang make python curl fio jq openssh termux-api`,
build llama.cpp mainline pinnata (tag scelto in F0.1), smoke test con `pkg install llama-cpp`
in parallelo per un primo output entro minuti. Modelli: voci 1-2 e 5 di §4 via
`huggingface_hub[cli]` sul telefono (poi `rm -rf ~/.cache/huggingface`); la voce 3 arriva
**via scp dal PC** (già scaricata e dumpata in F0.6 — non riscaricarla). Prompt di benchmark
fissi in `~/experiments/prompts/` (short/medium/code — riusare i testi del piano precedente,
vanno bene).

**Gate F1**: llama.cpp buildato gira; Qwen3.5-4B genera testo; harness `run_bench.sh` produce
righe CSV valide con majflt/read_bytes/temperatura.

### F2 — Baseline e caratterizzazione (telefono; ~1-2 giorni)

- **F2.1 fio su UFS 3.1** — IL numero fondante del progetto:
  random read 4k/16k/64k/256k/1M, iodepth 1 e 4, su file da 2GB nella home Termux (3 run,
  mediana). Output: curva banda-vs-blocksize → dice la granularità di lettura ottimale per lo
  streaming di esperti da ~1MB e quanto costa il random vs i 1686 MB/s sequenziali.
- **F2.2 Baseline densa**: Qwen3.5-4B Q4_K_M — config di partenza dichiarata: t=5, ctx=1024,
  KV q8_0. Sweep **greedy, una dimensione alla volta tenendo il best-so-far, in quest'ordine**:
  thread {4,5,6} → ctx {512,1024,4096} → KV {f16, q8_0}. Fissa la configurazione di
  riferimento del telefono e i suoi tok/s.
- **F2.3 Baseline MoE-in-RAM**: LFM2-8B-A1B Q4_K_M, stessa griglia. Confronto con F2.2 →
  quanto costa l'orchestrazione MoE quando l'I/O non c'entra. (Questi numeri sono anche il
  materiale del binario prodotto A.)
- **F2.4 Termica**: run continuo 10 minuti col 4B, log tok/s per blocco da 30s + temperatura →
  curva di throttling del telefono (serve per interpretare TUTTI i run successivi).

**Gate F2**: fio completato (numeri random read in mano); 4B ≥ ~8-10 tok/s stabili [S];
LFM2 misurato. Se il 4B va male, si sistema il setup PRIMA di toccare il 35B.

### F3 — Il muro: mmap naive col 35B (telefono; ~1 giorno)

Scopo: MISURARE il disastro atteso, non evitarlo. È la baseline "B" della tabella §9 e il
numero che dà senso a tutto quello che viene dopo.

- Qwen3.6-35B-A3B UD-IQ2_M su llama.cpp **mainline**, mmap default: run cold (post-riavio),
  `-n 32 -c 512`. Attesi: minuti di caricamento (MAP_POPULATE su 11.5GB con 4.5GB di RAM),
  poi 0.1-1.5 tok/s [S] con majflt altissimi. Registrare TUTTO (majflt/token è la metrica).
- Variante `--numa` (→ MADV_RANDOM) e variante `--no-warmup` se disponibile: cambia qualcosa?
- Run warm immediato: la page cache (≈4GB utili vs 11.5GB di file) può tenere ~35% del
  modello → miglioramento atteso modesto. Quantificarlo.
- 3 run per variante. Se il processo viene ucciso da lmkd → annotare, è un dato (non un fallimento).

**Gate F3**: numeri naive registrati (anche "OOM-kill sistematico" è un risultato valido).
Non c'è FAIL possibile in F3: è pura misura.

### F4 — Streaming: BigMoeOnEdge (telefono; ~3-5 giorni) — **cuore del piano**

- **F4.1 Build** in Termux (script F0.5). **[Aggiornato post-F0.4]** BigMoeOnEdge NON è un
  fork di llama.cpp: è un monorepo con engine proprio (~5.4 kLOC streaming) + llama.cpp come
  submodule con UNA patch di 28 righe (hook expert-ready per `--overlap`). Il binario di
  misura è **`bmoe-cli`**, non `llama-cli`. Build SOLO da sorgente ai pin auditati (monorepo
  `b0c4e5b`, submodule `5236140e5`); mai APK/release. Se la build Termux fallisce → NDK su RunPod.
- **F4.2 Riproduzione**: UD-IQ2_M, `bmoe-cli --moe-stream --cache-mb 2000 --dense-weights anon
  --overlap --io-threads 4`, `-n 64 -c 512`, 3 run.
  Domanda unica: **quanti tok/s su S23/UFS3.1 con 8GB?** (il riferimento è 5.0 su 12GB/UFS4
  con un file di 22GB — noi abbiamo metà RAM e storage più lento ma un file di metà taglia).
- **F4.3 Sweep parametri** — config base = quella di F4.2 (thread = migliore di F2.2, ctx 512).
  Vincolo dal fork: `--cache-mb` ha un **floor di 1500** (1-1499 rifiutati senza
  `--force-cache`). Sweep **greedy, una variabile alla volta tenendo il best-so-far, in
  quest'ordine**: `--cache-mb` {1500, 2000, auto} → `--overlap` on/off → `--io-threads`
  {2, 4, 8} → `--prefetch` {0, 1, 2} → thread {4,5,6} → ctx {512, 2048}. Per ogni run: tok/s,
  ttft, **`cache_hit_pct` (nativo nel fork: summary/CSV)**, MiB/token letti (nativo),
  majflt/token, read_bytes/token, RAM peak, temp.
- **F4.3b Knob LOSSY — separati, MAI nella baseline scientifica** [da F0.4]:
  `--n-expert-used` {6, 4} (è il "k" dei bench del fork = override del top-k del routing:
  deterministico ma cambia il modello) e `--drop-cold-experts` {0.75} (salta esperti routed
  su cache-miss sotto soglia: lossy e NON riproducibile per design). Ciascuno si misura vs la
  config best-so-far di F4.3 E si accompagna al check qualità di F4.5. I numeri "headline"
  del progetto restano quelli SENZA knob lossy; le varianti lossy vanno in tabella dichiarate
  come tali.
- **F4.4 K-quant vs IQ**: ripetere la config migliore con UD-Q2_K_XL (12.29GB). Decidere la
  quant di progetto su (tok/s, qualità percepita su 3 prompt fissi).
- **F4.5 Qualità**: con la config migliore, 5 prompt qualitativi (chat IT, reasoning semplice,
  coding breve, summarization, tool-call finto stile Kalsa) → giudizio a 3 livelli vs Qwen3.5-4B
  e vs LFM2. Se UD-IQ2_M produce spazzatura, provare UD-IQ3_XXS (se spazio) e rivalutare.
- **F4.6 (opzionale)** Gemma-4-26B-A4B UD-IQ2_XXS con la stessa config → il fenomeno
  generalizza oltre Qwen?

**Gate F4** (il gate del progetto). Definizione: x = eval tok/s mediana warm della config
migliore; "naive di riferimento" = la migliore mediana warm tra le righe B e B2 di F3 (§9):
- x ≥ 3 tok/s → PASS pieno, si va a F5-F8 con priorità alta.
- 1.5 ≤ x < 3 tok/s **e x ≥ 3× il naive di riferimento** → PASS condizionato: si va avanti,
  ma F8 (predictor) diventa la leva necessaria.
- x < 1.5 tok/s (oppure x < 3× il naive) dopo lo sweep → STOP del binario B su S23: si
  documenta, si ripiega su (a) target UFS 4.0 device (S23 256GB+/S24) come richiesta hardware
  minima, e (b) binario A (LFM2) come prodotto. Decisione a gualt con i numeri davanti.

### F5 — Stabilità: memory pressure, termica, lunga durata (telefono; ~2 giorni)

- Pressure test in TRE varianti SEPARATE (una variabile alla volta, coerente con §2.2.2).
  Protocollo per ciascuna: run warm di riferimento → disturbo → ritorno → stesso prompt ×2
  (misura SOTTO effetto del disturbo) → chiusura di tutte le app di disturbo → stesso prompt
  ×2 (misura del RECUPERO — è questa che il gate valuta):
  a) solo pressione RAM: browser con 10 tab pesanti;
  b) solo termica: fotocamera 30s in registrazione 4K;
  c) combinata (browser + fotocamera), SOLO dopo a) e b), per l'effetto congiunto.
  Domande: la cache applicativa del fork sopravvive meglio della page cache (H5)? lmkd uccide
  il processo? Il recupero avviene senza riavvio?
- Run lungo: 5 minuti di generazione continua → curva tok/s vs tempo vs temperatura.
  Per il confronto termico, eseguire nella STESSA sessione anche un run denso 4B di 5 minuti
  come riferimento a pari durata (la curva F2.4 da 10 min è carico diverso: usarla solo come
  contesto, non come confronto diretto).
- Robustezza: 10 avvii consecutivi, tasso di successo; comportamento con batteria <30%.

**Gate F5**: sotto disturbo degrado <50%; **recupero ≥90% del tok/s pre-disturbo dopo la
chiusura delle app, senza riavvio** (misurato dal protocollo sopra); nessun OOM sistematico
con la config di progetto. Altrimenti: ridurre `--cache-mb` e riprovare (tradeoff da tabellare).

### F6 — MTP / speculative decoding (telefono; ~2 giorni, dipende da F4 PASS)

- Verificare che la build del fork (o mainline, se nel frattempo #26003 è mergiata e F4 è
  stata rifatta lì) supporti `--spec-type draft-mtp` col GGUF MTP di §4 (voce 5).
- A/B rigoroso, stessa config F4 migliore: MTP off vs on (`--spec-draft-n-max` {2,3,4}).
  Metriche: tok/s netti, acceptance rate (dal log), **majflt/token e read_bytes/token** —
  H4 dice che il guadagno vero è nei caricamenti per token utile, non solo nel compute.
- Attenzione al conflitto RAM: il draft MTP occupa memoria → potrebbe rubare spazio alla
  cache esperti. Se serve, ridurre `--cache-mb` di pari passo e misurare il netto.
- Esito atteso: genuinamente incerto (GPU: +2x dichiarato da llama.cpp, 0x su RTX3090 indie).
  Qualunque esito è un risultato pubblicabile.

**Gate F6** (soglia dura): MTP "conviene" se eval tok/s netti ≥ **+10%** vs stessa config
senza MTP, con majflt/token **invariato o ridotto**; qualunque altro esito = "non conviene"
(si documenta e si toglie dalla config finale).

### F7 — Ricerca: trace, simulatore, predictor (PC/RunPod + telefono per i trace; ~2-4 settimane)

- **F7.1 Trace di attivazione**: **NESSUNA patch necessaria** [esito F0.4] — il fork ha già
  `--route-trace` (RouterHook → righe: step, layer, slot, expert, weight, residency, dropped;
  sink CSV). Raccogliere ≥50k token di trace su telefono con task realistici Kalsa (chat
  IT/EN, coding, summarization, tool-calling) + prompt lunghi. Se per il predictor
  cross-layer (F7.3c) servono anche le top-16 router prob, aggiungere un sink alternativo
  sulla stessa callback (patch piccola, fuori dal critical path).
- **F7.2 Simulatore offline** (Python, su PC): replay dei trace contro modelli di cache
  parametrici: LRU, LFU, frequency+decay, costo-aware (score = P(riuso) × costo_reload / size),
  con budget cache variabile 500MB-3GB. Output: curve hit-rate vs budget per policy.
  Calibrazione: il simulatore deve riprodurre l'hit-rate osservato in F4 col fork **entro ±2
  punti** (metà del margine di vittoria del Gate F7 — se non ci si arriva, il simulatore non è
  affidabile: BLOCKED finché lo scarto non è spiegato).
- **F7.3 Predittori** (in ordine di complessità, fermarsi appena il guadagno satura):
  a) frequenza recente + decay (baseline già nel vecchio piano);
  b) matrice di co-occorrenza/transizione esperto→esperto (Markov, per layer);
  c) cross-layer: router del layer i → prefetch layer i+1 entro lo stesso token (Fate-style,
     acc attesa ~80-97%);
  d) adapter low-rank stile SpecPrefetch (6.5M parametri, training su RunPod coi trace) —
     SOLO se (c) non basta.
  Metrica: hit-rate simulato vs LRU a parità di budget + costo compute del predictor.
  **Nota [da F0.4]**: il fork ha già un prefetch predittivo sperimentale (`--predict-prefetch`,
  gate-early, + `--route-ahead`): vanno misurati come baseline aggiuntive — il nostro
  predictor deve battere anche loro, non solo LRU.
- **F7.4 Analisi H6 (packing)**: dai trace, matrice di co-attivazione → clustering degli
  esperti → stima di quanto un riordino su disco convertirebbe i miss in letture sequenziali
  (usando le curve fio F2.1). Solo analisi, niente implementazione qui.

**Gate F7**: una policy batte LRU di ≥5 punti di hit-rate a parità di budget nel simulatore
(H3) — margine ≥2× la tolleranza di calibrazione di F7.2 — con costo del predictor
trascurabile (definizione: **<5% del tempo per token stimato** nella config di progetto).
Altrimenti: si documenta che LRU/LFU è già vicino all'ottimo su questo carico (risultato
negativo ma utile, coerente con 2505.16056) e F8 si riduce a hardening del fork.

### F8 — Runtime predittivo + eval finale (PC + telefono; ~2-4 settimane)

- Implementare nel runtime la policy vincente di F7 — **decisione presa al checkpoint F0.4:
  si estende BigMoeOnEdge** (predictor come nuovo caller di `IExpertSource::prefetch/retain`
  + aggancio nel RouterHook, senza toccare ggml; eviction cost-aware al posto della LRU in
  `ExpertStreamSource`). Piano B (mainline + PR #26003) resta attivabile SOLO se F4 mostra
  immaturità runtime (crash, silent-wrong, thrashing non governabile). Contatori hit/miss:
  già esposti dal fork, estendere non sostituire.
- Rieseguire l'intera griglia F4 (stessa metodologia, stessi prompt) con la config finale.
- **Eval finale "paper-grade"**: tabella §9 completa, confronto A/B/C/D/E, 3 seed, tutte le
  metriche §8. Se i numeri reggono (§10 livello buono+), questo è il materiale per un
  write-up pubblico (blog tecnico o short paper — i gap G1-G5 sono la motivazione).

### F9 — Estensioni (solo dopo F8, in ordine di valore atteso)

1. **Quantizzazione mista per-esperto** (HOBBIT-style, G4): esperti hot a 3-4 bit residenti,
   cold a 2 bit su flash; oppure "miss serviti a bassa precisione". Richiede tooling di
   ri-quantizzazione GGUF per-tensore (fattibile con llama-quantize custom).
   **1b. Expert pruning trace-driven** (variante degenere della 1: cold → 0 bit). Filone
   LOSSY, mai nella baseline. Razionale [2026-08-04]: nello streaming il pruning NON riduce il
   traffico di decode (8 attivi restano 8) e muove poco l'hit-rate; beneficio reale solo su
   prefill/TTFT (unione esperti più piccola) e copertura cache marginale. Se si fa: decisione
   dai NOSTRI route-trace F7.1 (carico Kalsa IT/EN), NON con pruned generici da HF calibrati
   su benchmark inglesi; check qualità F4.5 obbligatorio, con attenzione all'italiano.
   Da valutare anche il trade "pool −25% ma quant +1 tier": file uguale ma traffico/token
   +~30% — ambiguo, solo misura può dirlo.
2. **Expert packing su flash** (H6/G3): riscrittura del GGUF con esperti riordinati per
   co-attivazione. Contributo potenzialmente originale, nessun paper lo fa su single-device.
3. **DraftExpert-style** (G4): training per distillazione dei draft expert su RunPod
   (paper senza codice: implementazione da zero, costosa — solo se F6 mostra che lo
   speculative paga su questo hardware).
4. **Binario prodotto**: portare il risultato in Kalsa via llama.rn richiede che i flag di
   streaming arrivino nel binding (PR upstream a llama.rn o fork nostro). Prima però il
   catalogo Kalsa può già prendere LFM2-8B-A1B coi numeri di F2.3.
5. **Multi-device**: S24/S25 (UFS 4.0), Pixel — la matrice fascia×strategia del vecchio piano
   resta valida come formato.

---

## 8. Telemetria, harness e formati (per F0.3)

### 8.1 Cosa si misura, da dove

| Metrica | Fonte | Note |
|---|---|---|
| prompt tok/s, eval tok/s, ttft | output llama.cpp (`llama_perf`/timings) | parsare, non ricopiare a mano |
| majflt, minflt | `/proc/<pid>/stat` campi 12/10 | delta pre/post run; majflt = letture da flash |
| read_bytes | `/proc/<pid>/io` | leggibile per processi propri (stesso UID) |
| RAM processo/sistema | `/proc/<pid>/status` (VmRSS), `/proc/meminfo` | prima/durante(peak)/dopo |
| temperatura | `termux-battery-status` (JSON, campo temperature) | thermal zones = SELinux-blocked, non provarci |
| hit/miss cache esperti | contatori del fork (verificare in F0.4; se assenti → patch) | metrica primaria da F4 in poi |
| stabilità | exit code, dmesg non disponibile → log lmkd indiretto (processo sparito) | annotare kill |

### 8.2 Regole di misura

- 3 run per configurazione, si riporta la mediana; run scartato se temperatura iniziale >32°C.
- Cold = post-riavvio telefono. Warm = run successivo senza riavvio. Pressure = protocollo F5.
- **[2026-08-05] Cold SENZA riavvio — meccanismo primario**: il riavvio on-demand non è
  ottenibile in autonomia (v. §2.3: nessun permesso REBOOT da Termux, adb wireless non
  sopravvive al riavvio). Il cold operativo si ottiene con `~/bin/cold_model.sh MODEL.gguf`,
  che chiama `posix_fadvise(DONTNEED)` sul file del modello (`~/bin/fadv`, sorgente
  `scripts/fadv.c`): evieta **esattamente** le pagine del file sotto test, verifica con
  `mincore` che le residenti siano 0 e **esce non-zero se non lo sono** (un run "cold" non
  può quindi essere riportato per sbaglio come tale). Verificato 2026-08-05: 153856 pagine
  residenti → 0. Rispetto al riavvio è più chirurgico ma non azzera frammentazione/lmkd/
  termica: per questo **ogni riga CSV deve registrare `MemAvailable` a inizio run** come
  covariata (`/proc/meminfo` è leggibile da Termux). Il riavvio vero resta il gold standard
  e si usa quando gualt è presente; in quel caso la nota del run dice `cold=reboot`.
- Cold+warm si misurano ENTRAMBE solo per le configurazioni promosse (la migliore di ogni
  fase → righe B, B2, C2, C3, D, E di §9); gli sweep intermedi (F2.2, F4.3) si misurano solo
  warm. In §9 le celle non misurate si riempiono con "—", mai lasciate vuote.
- Prompt fissi (short/medium/code), `--temp 0` nei run di misura (determinismo), `-n` fisso
  per confronti (64 per il 35B, 128 per i piccoli).
- **[2026-08-04, lezione F2.2] Cooldown tra run**: ≥3 min di idle E temperatura batteria
  ≤30.0°C prima di OGNI rep. La batteria è un proxy LENTO del SoC: run back-to-back
  si auto-throttlano anche con batteria a 30-31°C (misurato: stessa config 8.9 tok/s da
  fresco vs 5.9 back-to-back).
- **[2026-08-04] Sentinella anti-drift**: alla fine di ogni stage di sweep si RIPETE la
  config vincente; se devia >15% dalla sua mediana, lo stage è invalido (ordine/termica)
  e si rifà col cooldown. Nessun "best-so-far" è valido senza sentinella.
- **[2026-08-04, sera] Floor batteria**: nessun rep di misura parte con batteria <40%
  (sotto quota, Android/SoC attivano risparmi che falsano i numeri). Il runner si mette in
  attesa e segnala CHARGE_NEEDED nel log. La ricarica avviene SOLO tra una fase e l'altra
  (mai durante le misure — regola UNPLUGGED invariata); in particolare: **ricaricare a ≥80%
  tra la fine di F2 e l'inizio di F3** (F3 è la fase più energivora della campagna).
- **[2026-08-04] majflt/token si legge INSIEME a tok/s**: run con majflt alto (>50k) =
  page-cache evicted, regime memoria — si annota come tale e NON entra nella mediana di
  baseline (misurato: tok/s correla inversamente con majflt a parità di config). Le mediane
  di baseline si calcolano sui run a majflt basso; il regime alto è un dato di pressione,
  non di prestazione.

### 8.3 Schema `runs.csv`

```
run_id,date,phase,model,quant,file_gb,runtime(mainline|bigmoe|ik|custom),runtime_commit,
flags,threads,n_ctx,kv_type,n_gen,run_type(cold|warm|pressure),
prompt_id,prompt_tok_s,eval_tok_s,ttft_ms,majflt_delta,minflt_delta,read_bytes_delta,
vmrss_peak_mb,memfree_min_mb,batt_temp_start,batt_temp_end,expert_hit_rate,notes
```

### 8.4 Template report di fase (`reports/moe-f<N>.md`, in questo repo)

```
# F<N> — <titolo> — <data>
## Cosa è stato fatto (vs piano)
## Numeri chiave (tabella, riferimenti a run_id)
## Deviazioni / sorprese / bug
## Verdetto gate: PASS | PASS-CONDIZIONATO | FAIL | BLOCKED(<motivo>)
## Prossima azione proposta
DONE
```

---

## 9. Tabella comparativa finale (da riempire progressivamente)

**Unità, per non ripetere l'errore di F3**: `MiB flash/tok` = `read_bytes_delta / 1024² /
n_gen`. In F3 questa colonna era stata riempita dividendo per 1024 → valori **1024× troppo
alti**, con il rischio di far sembrare mille volte migliore qualunque riduzione di traffico
misurata in F4 contro questa baseline. Ricontrollare a mano ogni colonna derivata prima di
usarla in un confronto.

| ID | Configurazione | tok/s cold | tok/s warm | hit-rate | majflt/tok | MiB flash/tok | RAM peak | Note |
|---|---|---:|---:|---:|---:|---:|---:|---|
| A | Qwen3.5-4B Q4_K_M (denso, in RAM) | — | **8.90** | n/a | basso | ~0 | — | controllo, F2.2c t4/c1024/f16; sostenuto 10 min **4.68** (F2.4) |
| A2 | LFM2-8B-A1B Q4_K_M (MoE, in RAM) | — | — | n/a | ~2e6/rep | — | — | **nessun baseline valido**: thrash su 8GB anche a Q4_0, sentinella FAIL×2 (F2.3c/bis) |
| B | 35B UD-IQ2_M, mainline mmap naive | 0.10 | 0.10 | n/a | ~3.6e5 | ~9.7e3 (9.5 GiB) | ~4.4–4.8 GB | **il muro** (F3); cold=fadv; no OOM/lmkd |
| B2 | come B + --numa/MADV_RANDOM | 0.10 | 0.10 | n/a | ~3.6e5 | ~9.7e3 (9.4 GiB) | ~4.7–4.8 GB | F3; indistinguibile da B **alla risoluzione dello strumento** (±0.05 tok/s) |
| B2alt | come B + --no-warmup | 0.10 | — | n/a | ~3.5e5 | ~9.4e3 (9.2 GiB) | ~4.7 GB | F3, **esplorativa** (1 rep cold, nessun warm): non riga promossa |
| C | 35B UD-IQ2_M, BigMoeOnEdge default | | | | | | | F4.2 |
| C2 | C + sweep migliore (cache-mb/k/…) | | | | | | | F4.3 |
| C3 | 35B UD-Q2_K_XL, config C2 | | | | | | | F4.4 K vs IQ |
| D | C2 + MTP | | | | | | | F6 |
| E | C2 + predictor F8 | | | | | | | F8 |
| (opz) | Gemma-4-26B UD-IQ2_XXS, config C2 | | | | | | | F4.6 |

---

## 10. Criteri di successo (ricalibrati sui dati 2026)

**Minimo (il progetto "ha senso"):**
- il 35B genera ≥64 token senza crash sistematici su S23; F3 e F4 misurate;
- streaming (F4) ≥ **1.5 tok/s** sostenuti e ≥3× il naive di riferimento di F3 (stessa
  definizione e stesse soglie del Gate F4 — nessun criterio aggiuntivo).

**Buono (il progetto "è promettente"):**
- ≥ **3 tok/s** sostenuti 5 minuti; hit-rate ≥80%; traffico flash ridotto ≥5× vs naive;
- degrado sotto pressure <50% con recupero automatico; qualità F4.5 ≥ "utilizzabile".

**Ottimo (il progetto "è forte" — parità col telefono 12GB/UFS4 di BigMoeOnEdge):**
- ≥ **5 tok/s**; hit-rate ≥90%; predictor F8 ≥ +5 punti vs LRU; ttft accettabile (<15s cold);
- risultato riproducibile in 10/10 avvii → materiale per write-up pubblico (G1-G5).

---

## 11. Rischi e mitigazioni (aggiornati)

| Rischio | Prob. | Mitigazione |
|---|---|---|
| OOM/lmkd kill col 35B | alta | cache-mb prudente (partire 2000→scendere), ctx 512, KV q8_0, RAM Plus off, niente app in background; annotare ogni kill |
| Random read UFS 3.1 troppo lento (F2.1 <150MB/s [S]) | media | granularità di lettura più grossa (batch di esperti), prefetch più aggressivo, valutare packing (F9.2) prima del previsto; peggio: dichiarare UFS 4.0 requisito minimo |
| BigMoeOnEdge immaturo/buggato/abbandonato | media | audit F0.4; piano B = mainline + PR #26003 applicata a mano; piano C = patch nostra su mainline (F8 anticipata) |
| Fork di terzi = rischio sicurezza | bassa (device vergine dedicato, zero dati personali) | audit F0.4 + build solo da sorgente a commit pinnato (mai binari); Termux senza permesso storage (least privilege); blocco WAN opzionale |
| gualt è single point of failure (azioni fisiche per settimane) | media | modalità solo-Grok §2.3 minimizza le azioni manuali; checkpoint asincroni (nessuna fase richiede presenza continua); le azioni fisiche residue sono elencate in §2.3 e schedulabili a blocchi |
| Phantom process killer / OneUI uccide i run | alta senza fix | workaround adb in F1 (OBBLIGATORIO prima di ogni misura) |
| Thermal throttling falsa i confronti | alta | regola ≤32°C start, run brevi, curva F2.4 come riferimento, mai sotto carica |
| Qualità inaccettabile a ~2.5 bpw | media | F4.4/F4.5: UD vs K-quant, upgrade a IQ3_XXS; se anche IQ3 è insufficiente → il valore si sposta sul metodo (comunque pubblicabile) e sul binario A |
| MTP non paga su CPU+flash (H4 falsa) | media | è un esperimento, non una dipendenza: nessuna fase a valle richiede F6 PASS |
| llama.cpp cambia flag/architettura sotto i piedi | certa nel tempo | versioni PINNATE per tutta la campagna; upgrade solo tra fasi, mai dentro una fase |
| Spazio disco insufficiente (128GB) | media | priorità download §4; una quant grande alla volta; pulizia cache HF immediata |
| Numeri da emulatore spacciati per reali | — | VIETATO: emulatore/RunPod solo per build e correttezza, mai nel CSV |

---

## 12. Decision tree sintetico

```
F2: 4B ok? ──no──> sistemare setup (thread/build/termica), NON toccare il 35B
   └─sì─> F3 (misura il muro) ─> F4 (BigMoeOnEdge)
F4: ≥3 tok/s? ──sì──> F5 → F6 → F7 → F8 → (F9, write-up)
   ├─ 1.5-3 ──> F5 → F7/F8 (il predictor è la leva per salire) → F6 dopo
   └─ <1.5 ──> STOP S23: report onesto; target → UFS4-device; prodotto → binario A (LFM2)
F6: MTP paga? ──sì──> resta nella config finale ──no──> documentare e togliere
F7: policy > LRU+5pt? ──sì──> F8 full ──no──> F8 = hardening + write-up del risultato negativo
```

---

## Registro checkpoint

- **2026-08-06 — Sweep thread: la letteratura sbaglia bersaglio nel NOSTRO caso. Correggere l'asse.**
  Misure: `t=4` → 0.81/0.82/0.83, sentinella 0.80 (drift 2.4%, stage valido), **mediana 0.82**.
  `t=5` → **0.69, 0.65, 0.86**: mediana 0.69, ma **dispersione del 32%** (0.65-0.86) contro il
  4% di `t=4`. **CORREZIONE (scritta dopo la terza rep, la voce iniziale si fermava alle prime
  due e concludeva "calo del 16-21%": era una conclusione su due punti, ritirata).** Il dato
  vero non è "t=5 è peggio", è **"t=5 è instabile"**: la terza rep è il valore più alto di
  tutto lo sweep. Con questa varianza la mediana non è confrontabile con quella di `t=4` e
  la sentinella quasi certamente fallirà il controllo di drift §8.2 (>15%) → **stage da
  rifare prima di qualunque conclusione**.
  La varianza però **non smentisce** l'ipotesi sotto, la sostiene: sotto sovrascrizione il
  piazzamento dei thread da parte dello scheduler cambia da run a run, e l'esito oscilla
  invece di degradare in modo pulito. Ma è un'ipotesi, non un risultato.

  **Sentinella `t=5` = 0.87 contro mediana 0.69: drift 26% → STAGE INVALIDO (§8.2).**
  E la sequenza non è casuale, è **monotòna crescente**: 0.69 → 0.65 → 0.86 → 0.87. Non
  sembra rumore, sembra **deriva sistematica dentro il braccio**: qualcosa migliora col
  passare dei run (page cache che trattiene più modello fra un run e l'altro? affinità dei
  thread che si assesta? DVFS?). La temperatura sale (29.1 → 30.4) mentre le prestazioni
  salgono, quindi **non** è throttling termico.

  **Conseguenza metodologica seria, più importante del singolo braccio.** Se esiste una
  deriva crescente nel tempo, allora **i bracci misurati dopo sembrano migliori di quelli
  misurati prima**, e l'intero sweep è confuso dall'ordine: `t=4` è stato misurato per
  primo, `t=5` per secondo. La sentinella §8.2 controlla la deriva **dentro** uno stage, non
  **fra** stage: è un buco del protocollo che finora non era emerso perché nessuno sweep
  aveva mostrato una deriva così netta.
  **Controllo da fare subito, prima di qualunque altro braccio: ri-misurare `t=4` adesso.**
  Se ora dà ~0.86-0.87, la differenza fra i bracci era **tutta deriva** e lo sweep thread non
  ha ancora prodotto nessuna informazione. Se ridà ~0.82, allora `t=5` è davvero diverso (e
  instabile). È il run più informativo disponibile in questo momento.
  **Regola nuova da adottare negli sweep successivi**: alternare o randomizzare l'ordine dei
  bracci, oppure chiudere ogni sweep con una **ri-misura del primo braccio** come controllo
  d'ordine, non solo con la sentinella del vincitore.
  **Perché**: la regola "thread = numero di core grandi" viene da benchmark di **puro
  calcolo**. Noi giriamo anche `--io-threads 4` che streamano gli esperti in parallelo, quindi
  la domanda reale di core è **compute + I/O**. `t=4` + `io=4` = 8 = esattamente i core del
  chip. `t=5` + `io=4` = **9 thread su 8 core** → sovrascrizione e stragglers sulla barriera,
  cioè lo stesso meccanismo per cui la letteratura sconsiglia gli efficiency core, solo che
  ce lo procuriamo da soli. Proseguire con `t=6` e `t=8` a `io=4` fisso significa misurare
  10 e 12 thread su 8 core: **ore di telefono per confermare la sovrascrizione**, non per
  capire il calcolo.
  **Asse corretto: tenere la somma a 8 e variare la ripartizione** — `t=4/io=4` (già fatto,
  0.82), `t=5/io=3`, `t=6/io=2`. Abbiamo un motivo forte per spostare core dall'I/O al
  calcolo: **l'I/O non è il ramo critico** (0.764 s contro 0.913 s, e sotto overlap), quindi
  può permettersi di rallentare finché non torna a essere il ramo lento. Il punto di pareggio
  atteso è dove I/O ≈ compute: è quello il massimo, e si trova per misura.
  **Nota**: è una configurazione che nessuno degli studi letti ha esplorato, perché nessuno
  di loro **streama pesi mentre calcola**. Non è una taratura, è una caratteristica del
  nostro regime.

- **2026-08-06 — Due lacune che la campagna si porta dietro dall'inizio (Claude).**

  **1. Non abbiamo MAI misurato l'energia.** Per giorni abbiamo inseguito i tok/s e trattato
  la batteria solo come vincolo operativo (floor 40%, mai in carica), mai come metrica. Per
  un'app su telefono i **joule per token** contano quanto i token al secondo: un modello due
  volte più veloce che consuma il triplo non è un progresso. E si misura quasi gratis —
  `termux-battery-status` dà `voltage` e `current`, quindi la potenza istantanea, e il numero
  di token generati lo abbiamo già.
  **Da fare in harness**: colonna `j_per_token` = (V × I medi durante il run × durata) /
  n_gen, più `power_w_mean`. Campionare la corrente insieme al resto della telemetria, non
  solo a inizio/fine (la corrente varia molto fra prefill e decode). Ordine di grandezza dai
  dati esistenti, da confermare: 35B in streaming ≈ 6 J/token, 4B denso ≈ 1.5 J/token — cioè
  il 4B non è solo ~8× più veloce, è anche ~4× più efficiente per token. Se il numero regge,
  è un argomento di prodotto, non solo tecnico.
  Nota di principio: sui telefoni conviene **"correre e poi dormire"** — finire sui core
  grandi e tornare in idle consuma meno che spalmare il lavoro su tutti i core. È un secondo
  motivo, indipendente dalla velocità, per non usare gli efficiency core.

  **2. Il binario denso (Qwen3.5-4B) eredita 3 scoperte su 4, e la GPU gli si applica MEGLIO.**
  Il 4B è il candidato prodotto a breve per Kalsa, e finora l'abbiamo lasciato fermo ai
  numeri di F2. Cosa trasferisce:
  - **Quantizzazione**: gira a **Q4_K_M**, cioè su un K-quant che su ARM **non ha kernel
    dedicati** e cade sul percorso generico. Q4_0 è l'unico formato con KleidiAI + repack
    online. Taglia quasi identica (4.5 vs 4.8 bpw). **A/B Q4_0 vs Q4_K_M con misura di
    velocità E di qualità** — su un 4B la perdita per bit si sente più che su un 35B, quindi
    la qualità non è opzionale.
  - **Thread**: F2 aveva scelto `-t 4`; l'evidenza big.LITTLE dice numero di core grandi = 5.
  - **i8mm**: stesso controllo del 35B.
  - **GPU: qui il 4B è avvantaggiato**, non svantaggiato. Tutto il blocco sul 35B è
    `MUL_MAT_ID` ("partial", e inesistente per IQ2). **Un modello denso non usa quell'op**:
    gli serve solo la matmul densa, che OpenCL dà come **"full"**, in Q4_0 — lo stesso
    formato verso cui lo sposteremmo comunque per la CPU. È esattamente il caso che gira già
    in giro (denso + Q4_0 + backend GPU). Restano i due dubbi veri: il backend carica su
    Adreno 740, e quanto dura prima del throttling.
  - **Non trasferisce**: tutto lo streaming/cache/expert-packing — il 4B sta in RAM.

  **Metrica di prodotto, da non dimenticare**: il numero del 4B **non è 8.90 tok/s** (burst a
  telefono fresco) ma **4.68** (sostenuto 10 min, F2.4). Ogni ottimizzazione va riportata sul
  sostenuto: è quello che l'utente sente dal secondo messaggio in poi.

- **2026-08-06 — GPU/NPU: la porta è stretta ma non è murata. Verifica dello stato reale.**
  La domanda «perché non usiamo tutto il telefono?» è stata rifatta ora che il muro è il
  calcolo (prima non aveva senso: per un muro di I/O la GPU non serve). §3.2 diceva
  "OpenCL non supporta i tensori MoE" e "Vulkan rotto su Adreno 740": **la prima è ormai
  FALSA, la seconda è imprecisa.** Fonte principale: talk Qualcomm a IWOCL 2026 (Wang et
  al.) + `docs/backend/OPENCL.md`.
  - **OpenCL**: `MUL_MAT_ID` **è mergiato** nel backend pubblico. Ma Qualcomm stessa lo
    classifica **"MoE (mul_mat_id): partial — routing works, per-expert tuning ongoing"**,
    contro "full" di CUDA/Metal/Vulkan. Quant supportati: Q4_0/1, Q5_0/1, Q8_0, Q4_K, Q5_K,
    Q6_K, MXFP4, IQ4_NL — **nessun IQ a 2 bit**, e i kernel `MUL_MAT_ID` esistono solo per
    **Q4_0, Q4_1, Q4_K, MXFP4**. Con UD-IQ2_M il MoE su GPU **non è eseguibile**, punto.
  - **Adreno 740 non è nella lista verificata** (750, 810, 830, 840, X1-85, X2-90). Le slide
    Qualcomm parlano genericamente di "7xx e 8xx": discrepanza da risolvere **empiricamente**
    (test da 30 minuti: compila con `-DGGML_OPENCL=ON` e vedi se carica).
  - **Il dato che ridimensiona tutto**: i numeri spettacolari di Qualcomm (5×, 600+ tok/s in
    prefill su gpt-oss-20B MXFP4) sono su **Snapdragon X2 Elite — un chip da laptop** — con
    **kernel ILA in assembly interni, non pubblici**. E **il nostro modello, Qwen3.5/3.6-A3B,
    è nella loro lista dei supportati ma marcato "Internal ILA path; flagship demo"**. Cioè:
    gira benissimo nel loro laboratorio, su codice chiuso, su hardware che non è un telefono.
    Sul percorso pubblico non esiste **nessun numero** per la nostra combinazione. È G5 in
    forma pura: i sistemi migliori esistono e non sono pubblicati.
  - **Vulkan**: `MUL_MAT_ID` c'è (shader generici), ma i driver Adreno crashano in modo
    ricorrente e trasversale alle generazioni — sul 740 c'è un `createComputePipeline:
    ErrorUnknown` proprio sulla pipeline `matmul_q4_k` (issue #6713, stale). Qualcomm
    stessa dà a Vulkan priorità inferiore rispetto a OpenCL. **Non è la strada.**
  - **Hexagon NPU**: backend sperimentale in mainline; 8 Gen 2 = Hexagon **v73**, "elencato
    ma non verificato" (verificati v75/v79/v81). Esempio MoE esistente solo su **OLMoE-1B-7B**,
    giocattolo. Resta aperta la questione **firma del codice DSP** su un S23 Samsung con
    Knox: non verificato. GenieX (SDK Qualcomm 2026) **esclude esplicitamente 8 Gen 2**.
    **Parcheggiare.**
  - **Fisica**: 8 Gen 2 ha ~67 GB/s di banda **condivisa** fra CPU e GPU. La GPU non alza
    il tetto di banda: aiuta solo se il limite è ALU/dequant sui byte già letti — che è
    plausibilmente il nostro caso, ma va dimostrato.
  - **Termica, avvertimento serio per il prodotto**: su S24 Ultra è documentato un **floor
    di frequenza GPU imposto dall'OS che TERMINA l'inferenza** sotto carico sostenuto (gli
    autori hanno dovuto spegnere lo schermo e ridurre il contesto). Niente di equivalente
    riportato per la CPU. Per un'app di chat un guadagno che si spegne da solo non è un
    guadagno.

  **L'unico bersaglio realistico, e converge con l'analisi CPU**: mettere sulla GPU **solo il
  tronco denso** (attention + shared expert) via **OpenCL**, tenendo gli esperti routed sulla
  CPU con `-ngl` + `--n-cpu-moe`/`-ot`. È l'unico pezzo che la tabella Qualcomm dà come
  **"full"** (GEMM/GEMV densa), non tocca il percorso MoE "partial", non richiede i kernel
  ILA chiusi. E i pesi densi sono **residenti**: si caricano una volta, non si streamano —
  quindi il costo di portarli in memoria GPU si paga una volta sola. **Stessa conclusione a
  cui porta l'analisi della quantizzazione**: densi in Q4_0 = kernel ARM veloci sulla CPU
  *e* formato pienamente supportato da OpenCL. La quantizzazione mista per residenza è ora
  giustificata da tre direzioni indipendenti.
  Prerequisiti prima di investirci: (1) il backend OpenCL carica davvero su Adreno 740?
  (2) quanto costa portare i densi in memoria GPU senza zero-copy — AHardwareBuffer non è
  integrato in ggml, andrebbe scritto.

  **Da valutare, unico software pubblico con focus MoE-on-edge**: `mllm`
  (UbiquitousLearning, base di EdgeMoE) — ARM CPU + OpenCL + QNN, ma scala provata
  8x2B, lontanissima dai nostri 35B. **PowerInfer-2 confermato NON pubblico** (issue #207
  senza risposta): resta paper.

- **2026-08-06 — F4.2: IL COLLO DI BOTTIGLIA SI È SPOSTATO. Riorientamento del piano (Claude).**
  Primi numeri BigMoeOnEdge (35B UD-IQ2_M, `--moe-stream --cache-mb 2000 --dense-weights anon
  --overlap --io-threads 4`): **0.93-0.97 tok/s**, ttft ~86 s. Dal log del runtime:
  ```
  read 84.73 MiB/token, decode 1.070 s/token
     (compute 0.913 + cache mgmt 0.050 + flash I/O 0.764 s/token, 111 MiB/s)
  cache: 56.9% hit, resident 1999.7 MiB, 8843 evictions, 4848 re-reads (75.8/token)
  ```
  - **H2 non solo confermata, stravinta**: 9.5 GiB/token (F3) → **84.7 MiB/token**, cioè
    **115×**; majflt 11.4M → 33k (340×). Lo streaming degli esperti funziona.
  - **MA con `--overlap` il percorso critico è il CALCOLO**: compute 0.913 s vs I/O 0.764 s.
    **Se l'I/O andasse a zero saremmo a 1.1 tok/s.** Tutto il ramo I/O del piano — H3
    (predictor), H6/G3 (packing), F7 (trace+simulatore), cache più grande — **non è
    sbagliato, è diventato prematuro**: ottimizza un ramo già coperto dall'overlap.
  - **L'anomalia da spiegare**: il 4B denso Q4_K_M fa 0.112 s/token con ~4B parametri
    attivi; qui ~3B attivi costano 0.913 s. **8× peggio per parametro attivo.** Un MoE
    dovrebbe costare MENO di un denso di pari attivi.

  **Ricerca 2026-08-06 — cause e leve (fonti in §13):**
  1. **IQ2 su ARM è il percorso peggiore possibile** [CONFERMATO]. Gli IQ memorizzano indici
     in un codebook: il loop interno fa lookup + ricostruzione invece di mappare diretto su
     NEON dotprod. In mainline llama.cpp **solo Q4_0 e IQ4_NL hanno kernel ARM veloci**;
     KleidiAI accelera **solo Q4_0/Q8_0**; il repack online copre Q4_0; l'ottimizzazione
     i8mm di Arm ha toccato Q6_K/Q4_K su Neoverse, **niente a 2 bit**. Stima 2-5× — grossa,
     ma **non spiega tutto l'8×**.
  2. **Thread**: su big.LITTLE il numero ottimo è **il numero di core grandi**; aggiungere
     gli efficiency core **peggiora** (straggler sulla barriera), e in decode il degrado è
     più marcato. 8 Gen 2 = 1 prime + 4 perf + 3 eff → **`-t 5`**, non 4 (ereditato da F2,
     regime diverso) né 8.
  3. **i8mm su Android**: regressione nota di detection in alcune versioni llama.cpp
     (`lscpu` lo vede, llama.cpp no → fallback scalare). **Da verificare sul nostro build.**
  4. **Esperti minuscoli** (`moe_intermediate_size` 512, 9 attivi × 3 matmul × 40 layer):
     overhead di dispatch/barriera pagato ~1080 volte per token invece di ~120. Meccanismo
     plausibile ma **non quantificato in letteratura per questa forma**. Attenzione: il
     grouped GEMM **non riduce i FLOP a batch=1** — con un token solo non c'è nulla da
     raggruppare; il guadagno sarebbe solo di overhead. Ridimensiona l'idea "fondere gli
     esperti".
  5. **MTP/speculative: aspettative da abbassare.** Tutti i numeri di llama.cpp (PR #22673,
     1.7-1.85×) sono **GPU**. Nessun benchmark CPU-only per MoE. E su **Qwen3.6-35B-A3B
     specificamente** lo speculative è risultato **in perdita netta su RTX3090 in 19
     configurazioni su 19**. Il meccanismo (ammortizzare letture memory-bound su N token)
     è più debole in regime compute-bound. **H4 va declassata**, non promossa.
  6. **Lead nuovo con codice**: i **Trellis quant di ik_llama.cpp** (IQ2_KT/IQ3_KT/IQ4_KT)
     sostituiscono il lookup su codebook con aritmetica a trellis, con supporto NEON —
     nati esattamente contro il problema del punto 1. ik_llama.cpp dichiara 4.6-7× sui
     kernel ARM vs mainline. Nessun confronto controllato Trellis vs IQ2_M a 2 bit: da
     misurare noi.

  **Scala degli esperimenti (dal più economico), da eseguire in F4.3:**
  | # | Cosa | Costo | Atteso |
  |---|---|---|---|
  | 1 | sweep `-t` {4,5,6,8} sulla config attuale | minuti | 1.1-1.3× |
  | 2 | verificare che il build usi davvero i8mm/dotprod | minuti | 0 o molto |
  | 3 | profilare quanto degli 0.913 s è dispatch/barriera vs dot-product | ore | diagnosi |
  | 4 | **UD-Q2_K_XL vs UD-IQ2_M** (era F4.4, ora prioritaria) | ore | ? — nota: anche i K-quant su ARM non hanno kernel dedicati, il salto vero è verso Q4_0 |
  | 5 | **Quant mista per residenza (idea nuova)**: tensori RESIDENTI (trunk denso, attention, shared expert) in **Q4_0** = kernel ARM veloci, costo solo RAM e **zero traffico flash**; esperti ROUTED restano a 2 bit perché sono quelli che si streamano. Oggi paghiamo il kernel lento anche su ciò che non viene mai streamato. | 1-2 giorni (requant per-tensore) | potenzialmente il più grande |
  | 6 | Trellis quant ik_llama.cpp | giorni (altro runtime) | ignoto, alto |

  Ordine deciso: 1-2-3 subito (misura, nessun codice), poi 4, poi 5. MTP (F6) **rinviata**
  finché il calcolo non scende: oggi non è la leva giusta.

  **Conferma sperimentale del riorientamento (8 righe `F4.3`, sweep `--cache-mb`).** Grok
  aveva lanciato lo sweep della cache — il vecchio F4.3, deciso quando credevamo che il muro
  fosse il flash. Esito: `--cache-mb 1500` → 0.90-0.95, `auto` → 0.93-0.96, contro `2000` →
  0.93-0.97 di F4.2. **Tutto entro il rumore: la dimensione della cache non sposta niente.**
  È esattamente ciò che prevede l'analisi — con `--overlap`, ridurre l'I/O agisce su un ramo
  che non è il percorso critico. Risultato negativo valido: **il ramo I/O è chiuso**, non ci
  si torna finché il calcolo non scende sotto l'I/O. Le 8 righe restano in archivio come
  prova, non come sweep da estendere.
  Da guardare: l'harness segnala `ttft_lt_load` su queste righe (ttft ~86 s < load_s ~157 s).
  Con lo streaming il "load" può completarsi in background dopo il primo token, quindi non è
  necessariamente un bug — ma il check va interpretato, non lasciato acceso a vuoto.

  **Lezione operativa (2026-08-06, canale caduto durante F4).** sshd è morto **senza
  riavvio** (uptime 7 h): Android ha ucciso la sessione Termux durante i run del 35B
  (~4.7 GB RSS + 2 GB di cache esperti = pressione di memoria, lmkd). Recuperato via adb in
  un minuto senza intervento umano (`am start` di Termux + `input text 'sshd'`), quindi
  **non è un'azione umana obbligata** come sembrava. Mitigazioni per F4.3+: lanciare
  l'harness sotto `nohup`/`setsid` così sopravvive alla morte della sessione ssh, riarmare
  `termux-wake-lock` all'inizio di ogni blocco, e ricordare che il CSV è scritto in modo
  incrementale — un canale caduto non perde i run già chiusi.

- **2026-08-06 notte — ANOMALIA APERTA sul binario: da risolvere PRIMA di F4 (Claude).**
  Cercando di capire perché `ttft_ms` resta vuoto ho trovato un problema più grosso, e
  **non l'ho risolto**: quello che segue è un referto, non una diagnosi chiusa.
  - **Fatto 1 — riproducibile.** `build-safe/bin/llama-cli` (pin 67d5978) **aborta in
    `load_tensors`** (`SIGABRT`, `src/llama.cpp:62: fatal error`, top frame
    `llama_load_mode_from_str`) su **tutti e tre i modelli** (4B, LFM2, 35B) quando
    `--load-mode` non è passato. Con **`--load-mode mmap` esplicito carica e genera**
    (`[ Prompt: 2.5 t/s | Generation: 2.2 t/s ]` sul 4B). Testato ~8 volte, deterministico
    in entrambe le direzioni. Non è memoria (4.2 GB `MemAvailable`), non è `TMPDIR`, non è
    un file corrotto (crashano tutti e tre), non è il binario cambiato (mtime 2026-08-03
    23:57, cioè **precedente** ai run F2 riusciti), non sono variabili d'ambiente
    (nessuna `LLAMA_*`/`GGML_*` né in shell interattiva né di login).
  - **Fatto 2 — non spiegato, ed è questo il punto.** La riga di comando dell'harness
    (`run_bench.sh:1033-1046`) è **identica** a quella che fallisce — stessi flag, stesso
    ordine, stesso `< /dev/null` — e alle 22:00-00:22 ha caricato e generato senza
    problemi 9 volte di fila, exit 0. Alle 01:00 la stessa riga aborta.
    **Un ambiente che cambia comportamento in silenzio invalida qualunque confronto**: se
    F4 gira in queste condizioni non sapremo se un delta viene da BigMoeOnEdge o dal
    binario. Va chiuso prima, non "aggirato".
  - **Fatto 3.** Con `--load-mode mmap` il processo carica, genera, e poi **non esce**:
    resta appeso oltre `--single-turn`/`--no-conversation` fino al timeout (rc=124), e in
    un run manuale ha mostrato il banner della REPL interattiva (`> `, `/exit`, `/regen`).
    Sotto l'harness invece usciva con rc=0. Se in F4 ricapita, un run resta appeso 45
    minuti e finisce come `BLOCKED/timeout` invece che come dato.
  - **F3 NON è invalidata**: quei run hanno caricato, generato, chiuso con rc=0 e prodotto
    numeri coerenti fra loro sullo stesso percorso mmap.
  - **Test decisivo che non ho potuto fare**: lanciare `run_bench.sh` così com'è. Il gate
    batteria lo blocca perché il telefono è in carica (corretto che lo faccia) — quindi va
    rifatto **a telefono scollegato**. È il primo passo prima di qualsiasi cosa in F4:
    se l'harness passa e la mano fallisce, la differenza è nell'ambiente di invocazione e
    va trovata lì; se fallisce anche l'harness, si ricostruisce il binario.
  - **Solo dopo**, se confermato: passare `--load-mode mmap` esplicito in
    `build_run_cmdline` (e registrarlo nella colonna flags, perché diventa parte della
    configurazione misurata), più un guard che fallisca subito se nel log compare il
    banner della REPL.
  - **Scoperta collaterale che vale una riga in F4**: questa build espone
    **`--load-mode dio` (DirectIO)**. Visti i **9.5 GiB riletti per token** di F3, causati
    dalla page cache continuamente sfrattata, bypassarla del tutto è esattamente
    l'esperimento suggerito da kimi-k3-in-c (§3.3) — ed è già disponibile, senza scrivere
    codice. Da provare in F4 accanto a `mmap`, non da rimandare a F8.
  - Difetto minore dell'harness: il gate batteria scatta **prima** di `--print-cmd`, che
    non esegue nulla; stampare la cmdline a telefono collegato è impossibile.
  - **Aggiornamento 2026-08-06 mattina — altre 5 ipotesi cadute, e 2 fatti nuovi.**
    Cadute: pseudo-terminale (crasha anche con `ssh -tt`), riavvio pulito, flag
    `-ctk/-ctv`, secondo binario (`build/`), stato del telefono (scollegato, 100%, 26°C).
    **Fatto nuovo 1 — il workaround regge sul modello che conta**: 35B + flag esatti di
    F3 + `--load-mode mmap` → nessun abort, e i numeri **coincidono con F3**
    (`[ Prompt: 1.8 t/s | Generation: 0.1 t/s ]`). È una **conferma indipendente del muro
    di F3**, ottenuta con un percorso diverso: 0.10 tok/s non era un artefatto dell'harness.
    **Fatto nuovo 2 — `--perf` NON produce il blocco perf nemmeno così**: `ttft_ms` resta
    vuoto. La spiegazione di Grok regge, ma la conseguenza cambia strategia: **smettere di
    inseguire `llama_perf_context_print`**. L'harness legge già lo stream di output del
    processo, quindi il TTFT va misurato **fuori dal binario**, prendendo il wall-clock
    del primo token emesso sullo stream. Più robusto e indipendente dal runtime — utile
    anche per `bmoe-cli` in F4, che ha un formato di output diverso.
    Confermato anche il blocco post-generazione: il 35B genera e poi **non esce**
    (rc=124 al timeout). Sotto l'harness usciva con rc=0 — differenza ancora non spiegata.
  - **Aggiornamento 2026-08-06 ~06:30 — ANOMALIA CHIUSA (mitigata; Grok, solo agente).**
    Report: `reports/moe-f3-binary-anomaly.md`. Commit harness `c9768f4`.
    **Test A:** rebuild `build-safe2` pin 67d5978 (GGML_NATIVE=OFF, stessa ISA) → PREFLIGHT OK.
    4B **senza** `--load-mode`: rc=0, genera, Exiting. **Anche il vecchio build-safe** (stesso
    mtime 2026-08-03) **ora** carica senza flag. Pin e file su disco **non** sono la causa
    permanente; trigger transiente non più riprodotto (boot 05:17 + MemAvailable ~5.1 GiB).
    **Test B:** non rilanciato `start_f3 numa` (CSV già completo). Diagnostica equivalente
    via `run_bench` 4B + env start_f3 → rc=0, flags=`--load-mode mmap`, ttft_wall, spinner
    collassato. Preflight 4B 30s rc=0.
    **Harness (a prescindere):** sempre `--load-mode mmap` in cmdline+CSV; preflight 4B in
    `start_f3` (exit 10); anti-REPL hang → exit 9; batteria dopo `--print-cmd`; stream
    filter CR/spinner; `ttft_ms` wall-clock primo token stream (non `--perf`).
    Test: `test_run_bench` 54 PASS, `test_f3` 47 PASS.
    **Binary F4 raccomandato: `build-safe2`.** F3 non invalidata. Root-cause non
    deterministica → mitigazione obbligatoria, non «ignorare e sperare».

- **2026-08-06 — Gate F3 ACCETTATO (Claude): PASS, con 4 correzioni. Il muro è misurato.**
  Numeri: **0.10 tok/s** su tutte e tre le varianti (default, `--numa distribute`,
  `--no-warmup`), **~11.4M majflt** e **~9.5 GiB letti da flash per token** — l'intero
  modello riletto ~28 volte ogni 32 token. **Warm ≈ cold**: con 7 GB di RAM la page cache
  non trattiene il working set. Zero OOM, zero lmkd, sentinella a drift 0. Il piano
  stimava 1.2–1.3 tok/s: la realtà è **12× peggio**, il che rafforza la tesi del progetto
  invece di indebolirla — nessuna manopola di mmap salva il naive.
  Correzioni applicate a `reports/moe-f3.md` (sezione "Correzioni post-audit") e a §9:
  (1) la colonna MiB/tok era **1024× troppo alta** (KiB spacciati per MiB) — pericoloso
  perché F4 misura la riduzione di traffico contro questa baseline; (2) **"0.10" ha
  risoluzione ±0.05** (viene dalla riga compatta a 1 cifra significativa, non dal blocco
  perf): quindi "numa non dà guadagno" NON è dimostrato, è solo non misurabile con questo
  strumento; (3) `--no-warmup` è esplorativa, non riga promossa (1 rep, nessun warm);
  (4) `read_bytes_delta=0` va letto come "non misurato", non come zero.
  **Prerequisito per F4** oltre a batteria ≥80% e ≤30°C: far stampare il blocco perf vero
  (`llama_perf_context_print`) — senza `ttft_ms` e con 1 cifra significativa, F4 non
  potrebbe distinguere un 3 tok/s da un 5 tok/s in modo difendibile.

- **2026-08-05 notte — Canale di controllo riparato (Claude). LEGGERE PRIMA DI RIPARTIRE.**
  Dopo un riavvio il telefono era irraggiungibile (sshd giù, adb wireless spento). Causa,
  fix e limiti accertati sono in **§2.3**; qui la parte che cambia il lavoro di Grok:
  1. **sshd ora riparte da solo a ogni riavvio** (verificato con un riavvio reale: sshd su
     ~80 s dopo il boot, marker `~/.boot_ready`, log `~/boot.log`). Non serve più toccare il
     telefono per riavere il canale.
  2. **adb NON è più un canale affidabile**: il toggle "Debug wireless" muore a ogni riavvio
     e non è riattivabile da software (testato: `svc power reboot`, `/system/bin/reboot`,
     `am ... REBOOT`, `setprop persist.adb.tcp.port` — tutti negati). **Ogni script deve
     funzionare interamente via ssh.** Se un passo richiede `adb`, va segnalato a gualt come
     azione umana, non assunto come disponibile.
  3. **Cold senza riavvio**: sul telefono ci sono ora `~/bin/fadv` (sorgente
     `scripts/fadv.c`) e `~/bin/cold_model.sh`. Verificato: 153856 pagine residenti → 0,
     con exit non-zero se il file resta residente. **Compito di Grok**: cablare
     `cold_model.sh "$MODEL"` dentro `run_f3.sh`/`start_f3.sh` al posto dell'assunzione
     "il run cold parte dopo un riavvio umano", e aggiungere `MemAvailable` (da
     `/proc/meminfo`, leggibile) come colonna/covariata di ogni riga CSV. Finché non è
     cablato, le righe cold di F3 vanno marcate `cold=fadv` o `cold=reboot` nelle note —
     mai lasciate ambigue.

- **2026-08-05 — Addendum F3 (Claude, durante la fase — 2 punti critici per l'harness):**
  (1) **Timeout harness**: i timeout calibrati sul 4B (load in secondi) NON valgono per il
  35B naive — il solo caricamento può durare 10-30+ minuti in thrashing. Timeout per-run in
  F3 ≥ 45 min, altrimenti l'harness ammazza run validi e registra spazzatura. Un run ucciso
  DA NOI non è un dato: solo lmkd/OOM di Android lo è.
  (2) **ttft_ms VA POPOLATO da questa fase in poi** (in F2 la colonna è rimasta vuota): in
  F3 il tempo-al-primo-token È una metrica primaria del muro, non un nice-to-have. Se il
  parser non lo estrae dai timing di llama-cli, va sistemato PRIMA dei run, e in ogni caso
  registrare anche il wall-clock load-time (da log runner) come colonna note.
  (3) Promemoria §8.2: le righe B/B2 sono "promosse" → per ciascuna variante servono il
  cold (post-riavvio) E il warm immediato senza riavvio, in coppia.

- **2026-08-05 sera — Gate F2 ACCETTATO (Claude): PASS-CONDIZIONATO → via libera a F3.**
  Numeri chiave: 4B denso 8.90 tok/s burst / **4.68 sostenuti su 10 min** (il sostenuto vale
  ~metà del burst su questo device: metro per giudicare F4); fio fatto; LFM2 = risultato
  negativo valido (nessuna quant gira senza thrashing su 8GB → niente baseline MoE-in-RAM,
  controllo = 4B denso; per il prodotto se ne riparla con lo streaming F4+). F3 è MISURA,
  non ottimizzazione: lmkd kill e tok/s ridicoli sono dati validi, non fallimenti. Batteria
  93% ✓. Promemoria: cold = riavvio; MAI caricatore durante la fase.

- **2026-08-05 mattina — Nota di revisione F2.3c (Claude).** F2.2c chiusa pulita: 4B =
  **8.90 tok/s** (t4/c1024/f16) → soglia F2 di fatto raggiunta. F2.3c invece è "done with
  warning": sentinella kv FALLITA due volte (drift 0.95), majflt milionari e ~10GB riletti
  per 128 token anche col protocollo conforme → **LFM2 Q4_K_M (5.04GB) è memory-bound su
  questo device: il 5.30 tok/s NON è un baseline affidabile**. Azioni per Grok al resume:
  (1) F2.3c-bis con **LFM2 Q4_0 (4.73GB)** — stessa griglia ridotta (threads best + ctx best,
  3 rep + sentinella) — prima di dichiarare il numero prodotto; (2) F2.4 termica; (3) report
  gate F2. Telefono in ricarica ≥80% (regola §8.2) prima di F3.

- **2026-08-03 — Checkpoint F0.4: PASS confermato (verdetto Claude).** Spot-check
  indipendente sul clone locale (pin submodule `5236140e5` identico al report,
  `LLAMA_CURL OFF FORCE`, LRU/route-trace/`bmoe-cli` presenti nel tree): il report
  `reports/moe-f0.4.md` riflette il codice reale. Adottata la raccomandazione F8 = estendere
  BigMoeOnEdge. Emendamenti applicati al piano: F4.1-F4.3b (bmoe-cli, floor cache 1500,
  overlap/io-threads/prefetch nella griglia, knob lossy separati), F7.1 (route-trace già
  presente, zero patch), F7.3 (baseline aggiuntive `--predict-prefetch`/`--route-ahead`),
  F8 (base runtime decisa). **Autorizzato procedere con F0.5-F0.6 e, a telefono pronto, F1+.**

- **2026-08-04 — Nota di revisione F2.2 (Claude, non un gate).** Analisi di `runs.csv`:
  la preoccupazione "4B < 8-10 tok/s" del report F2 è quasi certamente un **artefatto di
  protocollo**, non un problema del device. Evidenza: stessa config (t4, c512) → 5.9 tok/s
  back-to-back vs **8.9/8.7 tok/s** da telefono riposato (run `…-083319`/`…-083413`); i run
  lenti hanno majflt_delta 200-450k (page-cache eviction) vs 11k del run veloce; degrado
  progressivo dentro ogni stage (c4096: 8.5→5.5→4.9 con batteria 31.7→32.6°C).
  **Azioni per Grok**: (1) applicare le tre nuove regole di §8.2 (cooldown ≥3min + ≤30.0°C,
  sentinella anti-drift, majflt come covariata); (2) **rifare lo stage threads** col nuovo
  protocollo prima di fidarsi di "t4 best" (fu misurato tutto in regime caldo); (3) completare
  ctx/kv con cooldown; (4) la diagnostica profonda pre-F3 proposta nel report F2 NON serve:
  il device raggiunge già la fascia attesa da fresco; (5) nit harness: colonne `ttft_ms` e
  `flags` del CSV sono vuote — riempirle. Gate F2 resta da chiudere con F2.2 completa +
  F2.3 (LFM2) + F2.4 (termica).

---

## 13. Fonti (verificate 2026-08-03)

**Modelli**
- Qwen3.6-35B-A3B: https://huggingface.co/Qwen/Qwen3.6-35B-A3B
- GGUF: https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF · MTP: https://huggingface.co/unsloth/Qwen3.6-35B-A3B-MTP-GGUF · https://huggingface.co/ggml-org/Qwen3.6-35B-A3B-MTP-GGUF
- Qwen3.5-4B: https://huggingface.co/Qwen/Qwen3.5-4B · GGUF unsloth (base + MTP)
- LFM2-8B-A1B: https://huggingface.co/LiquidAI/LFM2-8B-A1B-GGUF
- Gemma-4-26B-A4B: https://huggingface.co/unsloth/gemma-4-26B-A4B-it-GGUF
- SmallThinker: https://github.com/SJTU-IPADS/SmallThinker (no motore Android pubblico: https://github.com/SJTU-IPADS/PowerInfer/issues/207)

**Runtime**
- BigMoeOnEdge: https://github.com/Helldez/BigMoeOnEdge
- llama.cpp mmap: https://github.com/ggml-org/llama.cpp/blob/master/src/llama-mmap.cpp
- PR #26003 --lazy-experts (OPEN): https://github.com/ggml-org/llama.cpp/pull/26003 · PR #24156 --reclaim-mmap-source
- PR #19435 Qwen3.5 dense+MoE: https://github.com/ggml-org/llama.cpp/pull/19435
- PR #22673 MTP: https://github.com/ggml-org/llama.cpp/pull/22673 · issue Metal #23011
- PR #15077 --cpu-moe · PR #11397 --override-tensor · PR #19493 speculative checkpointing
- Test speculative RTX3090: https://github.com/thc1006/qwen3.6-speculative-decoding-rtx3090
- Bug DirectIO scoped storage: https://github.com/ggml-org/llama.cpp/issues/18804
- Vulkan Adreno 740: https://github.com/ggml-org/llama.cpp/issues/6713 · OpenCL docs: docs/backend/OPENCL.md
- Expert-cache forks/issue: https://github.com/ggml-org/llama.cpp/issues/20757
- llama.rn: https://github.com/mybigday/llama.rn (0.12.8)
- ik_llama.cpp: https://github.com/ikawrakow/ik_llama.cpp (Termux PR #336; regressione MoE #1699; quant MoE discussion #359)
- Termux llama-cpp package: https://github.com/termux/termux-packages/blob/master/packages/llama-cpp/build.sh
- Phantom process killer: https://github.com/termux/termux-app/issues/2366 · https://dontkillmyapp.com/samsung
- S23 128GB UFS 3.1: https://www.gsmarena.com/128gb_samsung_galaxy_s23_to_use_the_old_ufs_31_storage-news-57375.php · AndroBench: https://www.digit.in/reviews/mobile-phones/samsung-galaxy-s23-review-258863.html

**Letteratura**
- Mixtral: arXiv:2401.04088 · Local Routing Consistency: arXiv:2505.16056 · Caching analysis: arXiv:2511.05814
- PowerInfer-2: arXiv:2406.06282 · LLM in a Flash: arXiv:2312.11514 · EdgeMoE: arXiv:2308.14352
- Mixtral-offloading: arXiv:2312.17238 (github.com/dvmazur/mixtral-offloading) · MoE-Infinity: arXiv:2401.14361
- Pre-gated MoE: arXiv:2308.12066 · SwapMoE: arXiv:2308.15030 · AdapMoE: arXiv:2408.10284
- HOBBIT: arXiv:2411.01433 · ProMoE: arXiv:2410.22134 · ExpertFlow: arXiv:2410.17954
- Fate/Cross-Layer Gate: arXiv:2502.12224 · PreScope: arXiv:2509.23638 · FlashMoE: arXiv:2601.17063
- SpecPrefetch: arXiv:2607.24787 · DraftExpert: arXiv:2607.24434 · EVICT: arXiv:2605.00342
- MoESD: arXiv:2505.19645 · SliceMoE: arXiv:2512.12990 · Klotski: arXiv:2502.06888
- Survey on-device 2026 ("the architecture … doesn't exist yet"): https://v-chandra.github.io/on-device-llms/
- Co-attivazioni Qwen3.5-35B-A3B: https://blog.doubleword.ai/moe-expert-coactivations

---

*Fine del piano V1. Grok: parti da F0.1 (ri-verifica online) e F0.4 (audit BigMoeOnEdge) — tutto
il resto dipende da quei due report.*
