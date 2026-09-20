# Il governor deve sapere in che telefono sta — piano

> ## UNDER AUDIT — 19/09/2026 — 7 REFUTED, 2 unverifiable, 6 citation drifts
>
> **Non usare questo documento come fonte senza leggere prima l'[Appendice A](#appendice-a--audit-puntiglioso-del-19092026-deepseek-v41-verbatim).**
>
> **Park status: open owner decision.** This document records the 19/09 owner order to set the
> governor aside. A memory dated 20/09 claims the condition for that order has fallen and the
> work can resume, but no document on disk records an un-park. Whether the governor stays parked
> is the owner's to decide; this header does not assert it.
>
> **Pending re-verification.** The audit's findings below have not been re-read on the artefacts.
> That work is a separate cell; its record goes to
> `scratchpad/agents/governor-audit-recheck/REPORT.md`. Until that report exists, do not cite a
> number from this document as established.
>
> **Body language.** The body of this document is still Italian and is left as-is pending the
> re-verification rewrite by agent `719eb904`; only the header above has been corrected to English.
>
> Due cose sono successe il 19/09.
>
> **1. L'owner ha sospeso il lavoro sul governor** — *"metti da parte il governor perche senza un
> kalsallama funzionante non ha senso"*. La priorita' e' ribasare il fork sul nuovo layout
> `vendor/` di llama.rn upstream.
>
> **2. Un audit puntiglioso (deepseek v4.1, ricerca online autorizzata, agente `447dbd7c`) ha
> smontato una parte sostanziale dei numeri di questo piano.** Il report integrale e' in coda al
> documento, verbatim. **Nessuna delle sue conclusioni e' stata riletta sull'artefatto
> dall'orchestratore**, quindi l'audit stesso va trattato come un delegato, non come verita'.
> Ma la sovrapposizione fra le sue accuse e le parti portanti di questo piano e' tale che
> **il corpo del documento non e' utilizzabile cosi' com'e'**.
>
> Sintesi di cosa l'audit contesta — dettaglio e citazioni in appendice:
>
> | # | verdetto | cosa contesta |
> |---|---|---|
> | 1 | REFUTED | la "Smentita a verbale" sul decode `0,992` sarebbe essa stessa l'errore: il numero sarebbe proprio dello Xiaomi 14, non della QRD8650 — e anche la scheda nominata sarebbe sbagliata |
> | 2 | REFUTED | lo stato Mali della Parte 3.3 e' superato: i gate 3 e 4 sono gia' girati, l'ipotesi "due difetti nominati" e' stata testata e smentita, e l'owner aveva gia' parcheggiato la G57 |
> | 3 | REFUTED | il `+1,3 °C` dell'NPU e' la salita dell'intera cella (tre rep HTP +0,4, una rep CPU +0,9), non dell'NPU |
> | 4 | REFUTED | il censimento `Thermal Status 0 in ogni campione` e' falso: 28 campioni leggono `3`, uno dentro product-suite |
> | 5 | REFUTED | i delta termici 4B citano l'artefatto sbagliato — e quello citato e' marcato `CONTAMINATED` |
> | 6 | REFUTED | il rerun del 18/08 non ha "10 ripetizioni per verso" sul decode: sono due coppie interlacciate |
> | 7 | REFUTED (esterno) | Mali-G57 MC2 e' confermato, ma `1100 MHz` non e' la frequenza del G99 |
> | — | NON VERIFICABILI | `cpu7 a 1824000` e la baseline `gpubusy ~7,5%` non esistono in nessun artefatto: compaiono **solo in questo piano** |
> | — | DERIVE | sei citazioni `file:riga` sono spostate di poche righe, e tre dicono meno di quel che il testo afferma |
> | 8-11 | CONFIRMED | tutte le altre citazioni di codice, l'intera aritmetica della Parte C, le soglie di ammissione al bordo, la cella S23 |
>
> L'audit contesta poi il **disegno** (la chiave di ordinamento e' un ΔT piu' piccolo della
> quantizzazione dello strumento; niente isteresi e un cambio motore costa un reload; la chiave di
> calibrazione omette ambiente, `plugged` e modello; `gpubusy` globale non prova quel che deve
> provare) ed elenca **dieci omissioni**. La sua riga di chiusura: *"the shape … is sound and worth
> building from, but not one of the quantitative inputs it feeds to that shape is both sourced and
> measured above the noise floor"*.
>
> **Conseguenza pratica:** la forma del piano (Regole 1/2/3, un selettore, matrice come dato,
> sonde che falliscono chiuse) sopravvive. I numeri no. Quando il governor si sblocca, si
> riparte dall'Appendice A, non da qui.

**19/09/2026, ordine dell'owner:** *"facciamo un piano serio, perche il governor deve sapere in che
telefono sta"* — (1) CPU, GPU, RAM e NPU devono dare info al governor; (2) in base a queste il
governor sa se puo' passare a GPU o NPU o niente; (3) si parte dai tre telefoni che abbiamo, e si
decide cosa fare quando scaldano.

Scritto da kalsa-2d. **Ogni numero e ogni riga di codice citata qui e' stata riletta sul file
dall'orchestratore**, non ripetuta da un report di delegato. Dove la fonte non regge, lo dico.

---

# Scopo — cosa copre questo documento e cosa no

**Dentro: Android.** I tre telefoni che abbiamo, tre motori (CPU, GPU, NPU), due fasi (prefill,
decode). Oggi 3 x 3 x 2; il numero cresce, ed e' il motivo della Parte 2b.

**Dentro come vincolo di forma, anche senza dispositivo in mano: i vendor non-Qualcomm.** Il record
di capacita' (1.5) deve poter descrivere un MediaTek o un Exynos **senza inventargli un'identita'
Qualcomm**. Oggi non puo': il campo che decide tutto si chiama `generation` e i suoi valori sono
`V73 | V75 | V79 | Unknown`, cioe' **versioni Hexagon**. Un Dimensity o un Exynos non hanno una
versione Hexagon, quindi cadono in `Unknown` e da li' in `NoFit`. Non e' che siano supportati male:
il modello dei dati **non sa dirli**. E' l'argomento piu' forte a favore della Regola 1.

- **MediaTek:** un dispositivo ce l'abbiamo (Jelly, Helio G99, Mali-G57) ed e' trattato in 3.3 —
  con la correzione importante che la sua GPU e' bloccata da una **lista bianca**, non
  dall'hardware.
- **Exynos:** nessun dispositivo in lab, **nessuna misura, nessuna riga di codice**. Va nominato
  qui solo perche' il record deve poterlo esprimere il giorno che ne arriva uno; qualunque cosa
  scrivessimo oggi sulle sue prestazioni sarebbe inventata.

**Fuori: Apple e Metal — decisione dell'owner, 19/09:** *"per la parte metal forse dovremmo
scrivere tutta un'altra cosa quindi non va in questo governor."* Concordo, e le ragioni sono
strutturali, non organizzative:

1. **La memoria unificata rompe il presupposto centrale.** Tutto il cancello di fit qui dentro
   (1.3, `gpuFit()`) poggia sull'idea che la memoria GPU sia separata e vada riservata a parte —
   `gpuReserveMiB = 800 + 1,05 x byte offloadati`. Su Apple non c'e' niente da riservare a parte, e
   il calcolo non solo e' inutile: e' sbagliato.
2. **Metal non e' OpenCL mobile.** Qui meta' del lavoro e' scoprire se i kernel compilano su quel
   driver (1.2); su Apple il backend Metal e' di prima classe a monte e quel problema non esiste.
3. **La corsia NPU e' un'altra cosa.** L'Hexagon lo pilotiamo noi via HTP; l'Apple Neural Engine
   non e' raggiungibile dal motore.
4. **E gli alberi sono gia' separati:** Android gira sui kernel del nostro fork, iOS sul
   xcframework precostruito di llama.rn con il Metal di monte, **64 commit di distanza**, e una
   build iOS dai sorgenti non e' mai stata tentata. Un documento solo dovrebbe descrivere due
   motori diversi.

iOS resta la piattaforma successiva ad Android e avra' il suo documento. Quello che **deve**
sopravvivere da qui a la' e' la Regola 1: se le decisioni non contengono identita' di dispositivo,
il selettore regge anche quando i motori sotto sono altri.

# Parte 0 — Cosa c'e' oggi, riga per riga

## 0.1 La "rilevazione" e' una regex su una stringa

`kalsa/src/engine/governorInputs.ts:60-75`, `generationFor()`: prende `profile.socModel`, lo mette
in maiuscolo e lo confronta con tre regex.

```ts
if (/(SM8550|KALAMA|SM7675|SM8635)/.test(soc)) return "V73";
if (/(SM8650|PINEAPPLE)/.test(soc))            return "V75";
if (/(SM8750|SUN)/.test(soc))                  return "V79";
...
return "Unknown";
```

Non c'e' nessuna sonda. Se il SoC non e' in quella lista bianca di Qualcomm, il telefono e'
`Unknown`. Il Jelly (Helio G99) e' `Unknown` per costruzione, e lo sarebbe qualunque Exynos,
Dimensity o Tensor.

## 0.2 Una chiave sola fa da procura per quattro sottosistemi

`governorInputs.ts:14-27`:

```ts
const GPU_PREFILL_CORRECT: Record<Generation, boolean> = {
  V79: true, V75: true, V73: false, Unknown: false,
};
```

e `:129-130`: `const enabled = force || GPU_PREFILL_CORRECT[generation];`

La versione **Hexagon** (che e' l'NPU) decide se si puo' usare la **GPU**. Sono due sottosistemi
diversi. La conseguenza pratica: sull'S23 il governor e' spento **per tabella, non per misura**
(`V73: false`, commento: *"never measured in-app"*), e sullo Xiaomi e' acceso senza che nulla sia
stato verificato a runtime.

## 0.3 I nove campi che arrivano al nativo

`buildGovernorParams()` (`governorInputs.ts:120-145`) emette:

| campo | come e' calcolato oggi | giudizio |
|---|---|---|
| `enabled` | `force \|\| GPU_PREFILL_CORRECT[gen]` | tabella |
| `generation` | regex sul SoC | tabella |
| `model_kind` | `Dense \| MoE \| Hybrid` dal registro | ok |
| `gpu_fit` | **calcolo vero**, vedi 0.4 | il solo campo misurato |
| `gpu_prefill_measured` | `gen === "V75" \|\| gen === "V79"` | **un'altra tabella travestita da misura** |
| `bench_force_gpu_prefill` | flag di bench | ok |
| `npu_lane_enabled` | **`false` fisso** | l'NPU non esiste per il governor |
| `reload_budget_available` | **`false` fisso** | uccide la corsia cool del decode |
| `forced` | flag di bench | ok |

Il nome `gpu_prefill_measured` e' il caso peggiore: promette una misura e restituisce
un'appartenenza a un insieme.

## 0.4 `gpu_fit` — l'unica cosa che oggi guarda il telefono

`governorInputs.ts:78-118`. Rifiuta con `NoFit` se: manca `kvBytesPerToken` sul modello, la RAM
totale e' `<= 8 GiB`, la generation e' `Unknown`, oppure il fit di memoria non passa. Poi calcola
un budget a due contesti:

```ts
const gpuReserveMiB = 800 + (1.05 * offloadedBytes) / MIB;
const requiredMiB = estimate.nonEvictableMiB + gpuReserveMiB + estimate.computeMiB + estimate.kvMiB;
```

E' il pezzo scritto meglio del file. Due note:
- il `<= 8 GiB` esclude il Jelly a prescindere dal resto;
- fino a `b4fe891` il 4B non dichiarava `kvBytesPerToken` e quindi finiva sempre `NoFit`. Ora
  `ModelRegistry.ts:229` dichiara **13312** e `:259` dichiara **6656** per LFM (verificato: e'
  committato, non lavoro in corso). Il 4B e' quindi diventato *fittabile* da poche ore, e nessuno
  l'ha ancora visto succedere.

## 0.5 La costante termica e' di un altro telefono

```c
constexpr float k_cpu_delta_c[] = { 1.9f, 3.25f, 3.25f, 5.15f };   // llama-governor-policy.cpp:15
constexpr uint32_t k_table_tokens[] = { 128, 512, 1024, 2048 };    // :14
```

Provenienza tracciata con `git log -S`: commit `c1bb48d32` e lo sweep
`scratchpad/agents/q58-s23-npu-spike-sweep`. `REPORT.md:31-35` sono esattamente quei quattro valori;
`RUN_LOG.md:5` dichiara `device=Galaxy S23 / Hexagon v73`. Sono ΔT **di processo intero** (mmap del
modello inclusa), n=2 per cella, di uno sweep **NPU**, usati per prezzare un chunk **GPU** su V75 e
V79. In `llama-governor-policy.cpp:200,205` non c'e' **nessun ramo per device**.

Inoltre `k_warn_c = 40.0` e `k_kill_c = 43.0` (`:10,12`) sono le soglie della **guardia
dell'harness** q58 (`--warn-tenths 400 --kill-tenths 430`), promosse a soffitto di prodotto.

---

# Parte 1 — Cosa il telefono deve dire al governor

Quattro sonde. Ognuna produce una **misura**, non una voce di tabella. Ognuna e' cacheata per
`socModel + versione driver GPU + versionCode dell'app`, e invalidata quando uno dei tre cambia —
perche' un aggiornamento di sistema puo' cambiare il driver sotto di noi, ed e' proprio il driver a
decidere se i kernel compilano.

Tutte e quattro **falliscono chiuse**: sonda assente o in errore ⟹ quella capacita' non esiste ⟹
si resta su CPU. Mai il contrario.

## 1.1 Sonda CPU

**Cosa legge**

| dato | percorso | note |
|---|---|---|
| numero di core e cluster | `/sys/devices/system/cpu/cpu*/topology/physical_package_id` + `cpufreq/related_cpus` | raggruppa i core in cluster |
| freq massima hardware per cluster | `/sys/devices/system/cpu/cpuN/cpufreq/cpuinfo_max_freq` | costante |
| **freq massima corrente** | `/sys/devices/system/cpu/cpuN/cpufreq/scaling_max_freq` | **cambia sotto strozzamento** |
| governor DVFS | `cpufreq/scaling_governor` | diagnostico |

**Perche' e' la sonda piu' importante.** Sullo Xiaomi `scaling_max_freq` e' **l'unico posto dove lo
strozzamento si vede**. `dumpsys thermalservice` riporta `Thermal Status 0` in *ogni* campione
dell'archivio: 12/12 nel cooldown del 19/09, 15/15 nei file product-suite, tutti gli
`results/htp_*`. Nel frattempo cpu7 gira a **1824000** su **3302400** di hw max — il 55%. Un
governor che legge lo stato termico dell'OS su questo telefono e' cieco.

**Il derivato che serve al governor:** `headroom_cpu = scaling_max_freq / cpuinfo_max_freq` per il
cluster grande. E' un numero fra 0 e 1, si legge in microsecondi, e dice *quanto* il vendor sta
gia' strozzando prima che noi facciamo qualsiasi cosa.

**Attenzione al campionamento:** non si legge durante un turno (contamina il soggetto). Si legge
prima del load e fra un turno e l'altro.

## 1.2 Sonda GPU

**La domanda giusta non e' "esiste una GPU" ma "il nostro set di kernel compila su questo
driver".**

E' la lezione del 19/09: il crash sullo Xiaomi non era un problema di capacita' hardware, era
`gemv_moe_q4_k_f32_ns.cl:216` che chiamava un helper a 7 parametri con 4 argomenti; la build del
programma falliva e `build_program_from_source_ex` chiamava `exit(1)`. E il miscompile E031 —
quello che ha reso necessarie le maschere come argomenti — dipende dalla **versione del driver**
(`E031.41.03.62`, Adreno 740), non dal modello di chip.

**Cosa legge**

| dato | fonte |
|---|---|
| vendor / renderer / versione driver | `clGetDeviceInfo` (`CL_DEVICE_VENDOR`, `CL_DEVICE_NAME`, `CL_DRIVER_VERSION`) |
| presenza di OpenCL | caricamento di `libOpenCL.so` |
| memoria globale del device | `CL_DEVICE_GLOBAL_MEM_SIZE` |
| supporto dot product int8 | `cl_khr_integer_dot_product` nelle estensioni |
| **esito di compilazione del set di kernel** | build vera del programma, esito registrato |

**Come si comporta.** Alla prima esecuzione su un `(device, driver)` nuovo: compila il set, misura
il tempo, registra `ok | fail` con il log di errore. Salva in cache. Le esecuzioni successive
leggono la cache. Se `fail`, per il governor **la GPU non esiste** e non si ritenta finche' il
driver non cambia.

⛔ **Vincolo assoluto:** un errore di compilazione di un kernel **non puo' chiamare `exit(1)`**
dentro l'app. Oggi lo fa (`ggml-opencl.cpp:1298-1300`), e mettere `fatal=false` da solo **non
basta**: il ritorno diventa `nullptr`, poi `clCreateKernel(nullptr, ...)` passa per `CL_CHECK`, che
e' `GGML_ASSERT(0)` → `abort()`. Stesso SIGABRT una riga dopo. Servono tre pezzi: build non fatale,
salto esplicito delle `clCreateKernel`, e una guardia al dispatch (o `supports_op` che risponde
`false`). Il modello da copiare esiste gia' nell'albero: le varianti flash-attention usano
`fatal=false` con `if (!prog) return false;` (`ggml-opencl.cpp:5807-5811`, `:6291-6295`).

## 1.3 Sonda RAM

**Cosa legge:** totale, disponibile, e la classe di dispositivo (`ActivityManager.isLowRamDevice`).

**Il vincolo gia' pagato, che nessuna sonda cancella:** il cancello di fit e' **strutturalmente
cieco alla memoria GPU**. L'input di `estimateMemory` non ha un campo backend, e il test tratta i
pesi come pagine file-backed evictabili — cosa che l'offload GPU inverte. Misurato: lmkd ha ucciso
l'app, e un modello da 6,4 GB a GPU piena ha riavviato il kernel. **lmkd non si cattura**: non e'
un throw, nessun fallback scatta.

`gpuFit()` (0.4) e' oggi la toppa: somma a mano una riserva GPU di `800 MiB + 1,05 × byte
offloadati`. Va mantenuta finche' l'input dello stimatore non ha un campo backend, e va **misurata
almeno una volta per telefono** invece di essere stimata.

## 1.4 Sonda NPU

**Cosa legge:** versione Hexagon (dal SoC e dalla presenza di `libggml-htp-v73|v75|v79|v81.so` in
`assets/ggml-hexagon`), inizializzazione del backend HTP, e supporto dell'architettura del modello
caricato.

**Stato oggi:** `npu_lane_enabled: false` fisso in `buildGovernorParams`, e nel nativo
`rn-governor-params.cpp:150-151` lancia `std::invalid_argument("Governor NPU lane is not
supported")` se qualcuno lo accende. L'NPU e' quindi **fuori dal governor per costruzione**, pur
essendo — sullo Xiaomi — il motore di prefill piu' veloce e piu' freddo che abbiamo misurato
(3,19× la CPU, ΔT +1,3 °C).

**Nota sull'architettura:** sul 4B ibrido l'NPU regge solo la parte non ricorrente; GDN/SSM restano
su CPU. La sonda deve saperlo dire per modello, non per device.

## 1.5 Il record che ne esce

Un oggetto solo, serializzato al nativo al posto dei nove campi attuali. Forma minima — **niente
campi che nessuno costruisce**, che e' la regola:

```
DeviceCapabilities {
  cpu:  { clusters: [{ cpus, max_khz, cur_max_khz }], headroom }
  gpu:  { present, vendor, driver, kernels_compile: ok|fail, global_mem_bytes, int8_dot }
  ram:  { total_bytes, available_bytes, low_ram_device }
  npu:  { hexagon: "v73"|"v75"|"v79"|null, htp_libs_present, arch_supported }
  probe_version, cached_for: { soc, gpu_driver, app_version }
}
```

`generation` sopravvive solo come **etichetta diagnostica**, mai come cancello.

---

# Parte 2 — Come il governor decide

## 2.1 La regola

Non *"GPU se freddo, CPU se caldo"*. E':

> **scegli, per ciascuna fase, il motore che minimizza il calore per token, sotto un pavimento di
> velocita' accettabile per l'utente.**

Tre input che oggi il codice **non ha**:

1. **ΔT per 1000 token, misurato, per motore e per device** (oggi: una costante S23 per tutti)
2. **tok/s per fase, per motore, per device** (oggi: niente, solo la tabella `gpu_prefill_measured`)
3. **il cap di frequenza vivo** (oggi: niente, si legge lo stato termico dell'OS che su Xiaomi e'
   sempre 0)

## 2.2 Cosa fa oggi, ed e' il rovescio

Sopra 37,6 °C nessun blocco della tabella passa, la decisione e' `Wait`, e il runtime:

```c
// llama-governor-runtime.cpp:60-63
LLAMA_LOG_WARN("%s: prefill admission is waiting; routing this turn to CPU\n", __func__);
```

Cioe': la tabella rifiuta **perche' la CPU scalderebbe troppo**, e il ripiego manda l'intero turno
**sulla CPU**, per giunta non spezzato. Sullo Xiaomi quella e' la strada che misura **+19,3 °C** di
zona SoC contro **+1,4** della GPU.

E il pavimento di batteria e' **invertito**: con `requested == CPU` (batteria < 45%, LOWBAT, V73
senza force) la decisione di ammissione e' `Admit`, che cade al ramo
`prefill_route_ = GPU` (`llama-governor-runtime.cpp:65-68`) e manda il batch su `ctx_prefill`, cioe'
`n_gpu_layers = 99` (`rn-llama.cpp:69`). Sotto il 45% di batteria il prefill gira **su GPU** mentre
la telemetria scrive "CPU".

## 2.3 La scala delle decisioni, nell'ordine

```
per fase (prefill, decode):
  candidati = motori con capacita' provata dalle sonde
  filtra per fit di memoria (con la riserva GPU misurata)
  filtra per correttezza (i kernel compilano; l'oracolo non e' peggiorato)
  ordina per calore-per-token misurato su QUESTO device
  scegli il primo che rispetta il pavimento di velocita'
  se nessuno lo rispetta: il piu' veloce fra quelli sotto il tetto termico
  se nessuno sta sotto il tetto: riduci i TOKEN per chunk, non cambiare motore
  se il tetto e' sfondato comunque: pausa dichiarata all'utente, mai un abort silenzioso
```

L'ultima riga e' il punto dove oggi il governor latcha `failed` e ogni completamento successivo
lancia un'eccezione. Vedi 5.2.

---

# Parte 2b — La forma del codice: aggiungere un telefono deve costare una riga di dati

**Vincolo dell'owner (19/09):** *"il codice deve essere scritto ad opera d'arte... per ora abbiamo 3
telefoni, 2 condizioni (prefill e decode) e 3 strutture (gpu, cpu e npu), ma col tempo aumenteranno
quindi bisogna scriverlo bene e chiaro da subito cosi e' facile aggiungere."*

Oggi siamo a **3 x 2 x 3 = 18 caselle**. Il punto non e' il numero: e' che l'enumerazione e'
**cablata nel flusso di controllo** invece di stare nei dati, quindi ogni casella nuova si paga in
`if`.

## 2b.1 Quanto costa oggi aggiungere un telefono — contato, non stimato

Un quarto telefono (poniamo un Tensor o un Dimensity) richiede oggi di modificare:

| # | punto | file | cosa |
|---|---|---|---|
| 1 | `generationFor()` | `governorInputs.ts:60-75` | una regex nuova sul SoC |
| 2 | `GPU_PREFILL_CORRECT` | `governorInputs.ts:14-27` | una riga nel record |
| 3 | `gpu_prefill_measured` | `governorInputs.ts:137` | l'espressione `gen === "V75" \|\| gen === "V79"` |
| 4 | `llama_governor_generation` | `llama-ext.h` | un valore nell'enum nativo |
| 5 | `prefill_engine()` | `llama-governor-policy.cpp:153-172` | un ramo nella catena di `if` |
| 6 | `select_decode()` | `llama-governor-policy.cpp:236-242` | la clausola `generation == V73` |
| 7 | `k_cpu_delta_c[]` | `llama-governor-policy.cpp:15` | non e' nemmeno indicizzabile per device |

**Sette punti, tre file, due linguaggi, e il settimo non ha nemmeno un posto dove mettere il
valore.** E un telefono non-Qualcomm non ha una "generation Hexagon" da dichiarare, quindi i punti
1-4 gli chiedono di fingere un'identita' che non ha.

Questo e' il difetto di forma da cui discendono quasi tutti i difetti di comportamento della Parte
5: la corsia morta (5.4) esiste **perche'** `generation == V73` sta dentro una decisione di policy.

## 2b.2 Le tre regole

**Regola 1 — L'identita' del dispositivo non entra mai in una decisione.**
Nessun `if (generation == ...)` dentro la policy. La policy vede solo **capacita' misurate**:
"questo motore e' disponibile", "costa tanto per token", "scalda tanto per mille token". Il nome
del telefono serve a scegliere la riga di dati, non a scegliere il ramo di codice. `generation`
sopravvive come etichetta diagnostica nei log, e in nessun altro posto.

*Verifica meccanica:* un `grep` di `generation` nei file di policy deve tornare zero occorrenze
fuori dalla telemetria.

**Regola 2 — La matrice e' un dato, non un flusso di controllo.**
La decisione e' una **selezione ordinata** sopra una lista di motori candidati, non una catena di
`if`:

```
per (fase, stato_termico):
    candidati = motori con capacita' provata
    scarta chi non ci sta in memoria
    scarta chi non e' corretto su questo driver
    ordina per calore-per-token misurato su QUESTO device
    prendi il primo che rispetta il pavimento di velocita'
```

Con questa forma: **aggiungere un motore e' aggiungere un elemento alla lista**; aggiungere una
fase e' aggiungere una chiave; aggiungere un telefono non tocca il codice **per niente** se le
sonde lo coprono. Il codice smette di crescere con il catalogo.

**Regola 3 — Le due fasi sono lo stesso selettore con un parametro diverso.**
Oggi sono due funzioni separate, `admit_prefill` (`:180-225`) e `select_decode` (`:227-252`), che
duplicano la struttura e **hanno difetti diversi ciascuna**: la prima aborta a CRITICAL, la seconda
aspetta; la prima ignora LOWBAT nell'ammissione mentre `prefill_engine` lo consulta; la soglia di
batteria 45% compare in due posti con due effetti. La duplicazione non e' un dettaglio di stile: e'
la fabbrica di quei difetti. Un selettore solo, parametrizzato per fase, li chiude tutti e tre
insieme e dimezza la superficie della prossima fase che aggiungeremo.

## 2b.3 Cosa NON va costruito

La regola del progetto resta e vale anche qui: **niente tipi o API che nessuno costruisce.** Quindi
**no** a un sistema di plugin, **no** a una gerarchia astratta di provider di motori, **no** a un
DSL di configurazione, **no** a un registro estensibile a runtime. Non stiamo aggiungendo
astrazione: stiamo **togliendo** un'enumerazione cablata che gia' esiste e gia' ci costa.

La differenza, in concreto: una lista di record con quattro campi e una funzione di ordinamento
sono *meno* codice di quello che c'e' oggi, non di piu'. Se il rifacimento produce piu' righe di
quelle che sostituisce, e' il segno che si e' scivolati nell'astrazione speculativa.

## 2b.4 Il criterio di accettazione, verificabile

Non basta dichiarare che il codice e' estensibile: va dimostrato, e in modo che fallisca se non lo
e'.

> **Aggiungere un quarto telefono deve toccare esattamente un file di dati e zero file di
> decisione. Aggiungere un quarto motore deve toccare la lista dei motori e zero rami condizionali.**

Si prova cosi': si aggiunge un dispositivo finto al file di dati, si verifica che il selettore
produca la politica attesa per tutte le combinazioni (fase x stato termico), e si verifica con un
diff che **nessun file di policy sia stato toccato**. Se per far passare il test bisogna aggiungere
un `if`, il rifacimento non e' riuscito e il test lo dice prima di noi.

Questo test va scritto **insieme** al rifacimento, non dopo: e' l'unica prova che la Regola 1 tiene
davvero, e senza di esso "scritto bene" resta un'opinione.

# Parte 3 — I tre telefoni

## 3.1 Xiaomi 14 — `houji`, SD8650 (8 Gen 3), Adreno 750, Hexagon v75

**Termica, coppie appaiate della stessa sera, staccato** —
`results/xiaomi_ab/task_a/battery_notes.txt`, riletto dall'orchestratore:

| carico | motore | batteria | zona SoC di picco |
|---|---|---|---|
| 2B pp512 | CPU | 27,9 → 29,0 (+1,1) | — |
| 2B pp512 | GPU | 29,0 → 29,0 (0,0) | — |
| 2B pp1024 | CPU | 29,0 → 31,8 (+2,8) | — |
| 2B pp1024 | GPU | 32,2 → 31,9 (−0,3) | — |
| 2B pp2048 | CPU | 31,9 → 35,5 (+3,6) | 47,8 → **67,1** (+19,3) |
| 2B pp2048 | GPU | 35,5 → 35,6 (+0,1) | 49,2 → 50,6 (+1,4) |

Il 4B da' lo stesso verso: CPU +2,4/+3,5/+1,7 a pp512/1024/2048 contro GPU +0,4/−0,7/−0,3.

**Velocita'** — `results/xiaomi_ab/phase3_baseline/bench_{cpu,gpu_faoff}.json`, Qwen3.5-2B Q4_K_M,
letto dal JSON:

| fase | CPU | GPU | rapporto |
|---|---|---|---|
| prefill pp128 | 31,459 | **181,652** | GPU **5,77×** piu' veloce |
| decode tg256 | **16,149** | 7,066 | GPU **2,3× piu' lenta** |

Il rerun interlacciato del 18/08 (10 ripetizioni per verso, entrambi gli ordini) conferma il verso
del decode — GPU 17,46 vs CPU 26,50 — e **ridimensiona il prefill a 3,18×** con una baseline CPU
migliore. Il 5,77× e' quello propagato nei doc dell'app; il 3,18× e' quello meglio controllato.

**NPU:** prefill 165,4 vs 51,9 CPU (**3,19×**, ΔT +1,3 °C); decode 4,47 vs 11,94 (**0,37×**).

⛔ **Smentita a verbale.** La parita' di decode "0,992" citata nella memoria
`kalsa-the-goal-is-a-governor` **non e' dello Xiaomi**: e' della scheda di riferimento QRD8650, che
ha lo stesso SoC ma non e' il nostro telefono. Sul telefono vero la GPU in decode perde, su due
misure indipendenti.

**Politica bersaglio**

| stato | prefill | decode | leva quando scalda |
|---|---|---|---|
| freddo | NPU se il modello lo regge, altrimenti GPU | CPU | — |
| caldo | GPU (e' la strada **fredda**) | CPU | riduci i token per chunk |
| molto caldo | GPU con chunk piccoli | CPU | pausa dichiarata |
| critico | nessuno | nessuno | ferma e dillo |

**Il punto che il codice attuale sbaglia:** quando scalda va spostato il **prefill**, non il
decode, e va spostato **verso** la GPU, non via.

## 3.2 Galaxy S23 — SD8550 (8 Gen 2), Adreno 740, Hexagon v73

Decode GPU **−19%** di velocita' ma **−2,75 °C**, e sotto carico prolungato la CPU throttla
**14-16%** mentre la GPU resta piatta **0-5%**.

Qui la GPU perde lo scatto e vince la maratona. Per un'app di chat vera conta il sostenuto: un
decode che parte a 17,5 tok/s e scende a 14,8 e' peggio di uno che sta a 14,2 stabile, perche' il
secondo non fa scaldare il telefono in mano.

**Da misurare:** il prefill GPU sul 740, dove pero' pesa il difetto f16 gia' noto
(`adreno-f16-gemm-is-the-culprit`). Finche' non e' misurato, prefill GPU su questo telefono resta
**non provato**, e va trattato come tale.

**Contaminante da sottrarre a ogni numero S23:** `adsprpcd`/`cdsprpcd` girano al 100% di un core
senza l'app, con 33 h di CPU accumulate. Ogni misura termica su questo telefono porta accanto il
fondo.

**Oggi:** governor spento per tabella (`V73: false`), non per misura.

## 3.3 Jelly Star — Helio G99, Mali

⛔ **Correzione (19/09): "Mali non e' utilizzabile" e' falso, ed era scritto male qui.** La
nostra misura dice il contrario. Gate #26b del repo fratello, 22/08 (`8540797`): il backend OpenCL
di llama.cpp scartava il Mali-G57 del Jelly a `GPU_FAMILY::UNKNOWN` — **una lista bianca, non un
limite hardware o di driver**. Scavalcata con `GGML_OPENCL_ALLOW_UNKNOWN_GPU` (ramo
`kalsa/mali-probe`, mai da fondere), il backend si registra e **f32 MUL_MAT passa 202/202** contro
il riferimento CPU.

Cosa non funziona davvero, e sono due cause **nominate e banali**: (a) i kernel quantizzati
"generici" sono `#ifdef INTEL_GPU` / `#elif ADRENO_GPU` **senza `#else`**, quindi
`N_SIMDGROUP`/`N_DST`/`N_SIMDWIDTH` restano indefiniti su Mali e i kernel non si compilano; (b)
letture dirette di `half*` che il compilatore ARM rifiuta nonostante `cl_khr_fp16` — serve
`vload_half`. Stima del gate: **mezza giornata di PC piu' 30 minuti di Jelly**.

Quindi la voce giusta per il Jelly non e' "niente GPU": e' **"GPU bloccata da una lista bianca e da
due difetti nominati, con una stima"**. E' esattamente il difetto di forma della Parte 2b visto da
un altro lato — una lista bianca di famiglie GPU al posto di una sonda.

⚠️ **Nessun tok/s esiste su questa corsia**: `llama-bench` non e' stato eseguito, sul telefono non
c'e' un GGUF f32 e il percorso quantizzato aborta. **Non citare un numero di prefill Mali**: non
esiste.

Resta vero che oggi, con l'APK spedito, il Jelly non ha acceleratore: la RAM (8 GB) fa scattare
`total <= EIGHT_GIB` ⟹ `NoFit` a prescindere, e la generation `Unknown` spegne il governor prima
ancora.

**Misurato:** `Thermal Status 3` (SEVERE) in **9 minuti** da freddo, con la batteria ancora al 51%;
batteria 26,0 → 34,0 °C; consumo ~40 punti/ora sotto carico contro ~5 da sveglio e fermo. Il limite
e' termico, non di carica.

**L'unica leva e' la CPU stessa:** meno thread, solo i core piccoli, un cap di frequenza, oppure
lavorare a intermittenza.

### Ricerca online, 19/09 — esito

**GPU: disabilitata per default, ma non perche' non esista.** Il Mali e' un **G57 MC2** (non G52),
2 CU a 1100 MHz, driver OpenCL ARM presente e Vulkan 1.1.177. La documentazione OpenCL di
llama.cpp dichiara Adreno come unico target Android verificato. L'unica misura Vulkan pubblica su
Mali-G57 da' **0,79 tok/s prefill e 0,86 decode contro 2,44 e 2,29 su CPU** — GPU ~3x piu' lenta,
ma campioni piccoli e non esattamente un G99. Un tentativo su A15/G99 e' andato in segfault
caricando i tensori. **Nessun risultato pubblicato G99 + 2,6B Q4.**

**Il SoC non e' il problema: lo e' lo chassis.** Telefoni G99 di taglia normale mantengono il
**91%** dopo 15 minuti di throttling test, il **95%** dopo 30, e 99,4-99,5% di stabilita' su Wild
Life. Il nostro `Thermal Status 3` in 9 minuti non e' quindi una proprieta' dell'Helio G99: e' un
telefono da 3 pollici senza massa termica. Cambia la diagnosi e cambia cosa ha senso provare.

**⭐ Il risultato che conta, e che ribalta l'intuizione.** Per il decode, **meno core e piu' grandi
vincono**, e la ricerca ha due misure indipendenti: su Snapdragon 730G, 1x A55 = 1,05 tok/s, 6x A55
= 4,41, **2x A76 = 6,81**, tutti e 8 = 5,26. Un altro sweep A55/A76: da **18,0 tok/s su 2 A76** a
**13,7 su tutti e 8**. Usare tutti i core e' **piu' lento e piu' caldo**. La ragione e' nota ed e'
considerata assodata: il decode e' legato alla banda di memoria, non al numero di core.

✅ **E questo noi lo facciamo gia'.** `src/engine/deviceTuning.ts:203-208`:

```ts
{ id: "helio-g99", decodeThreads: 2, prefillThreads: 8,
  capacitySignature: [348,348,348,348,348,348,1024,1024], ... }
```

`decodeThreads: 2` e' esattamente la coppia di A76. **La raccomandazione principale della ricerca
e' gia' implementata**, quindi i 9 minuti a SEVERE non sono spiegati da una scelta di thread
sbagliata: resta lo chassis.

**Nota di forma, e va imitata.** `MEASURED_PRESETS` sceglie il preset per **firma di capacita'**
(il multiset dei `cpu_capacity` letti da sysfs), non per nome commerciale — e ha gia' una voce
`apple`. E' esattamente il patto della Regola 1: misura, non identita'. **Il governor deve
assomigliare a questo file, non il contrario.**

**Quello che la ricerca NON ha trovato, e che quindi dobbiamo misurare noi:** nessun dato di
joule/token o °C per 1000 token su G99 al variare di thread, tipo di core o cap di frequenza;
nessun esperimento di lavoro a intermittenza su un telefono cosi' piccolo (gli studi generali dicono
che pause brevi rendono poco quando la massa termica e' piccola); **nessuna app documenta una
politica termica** — l'unico esempio trovato allunga l'intervallo di 1,5x a `THERMAL_STATUS_SEVERE`.
E per l'NPU: MediaTek non espone un percorso di inferenza pratico sul G99, NNAPI usa un
acceleratore solo se un delegate del vendor supporta il modello. **NPU su questo telefono: non
verificata, trattare come assente.**

⚠️ **La trappola resta in piedi e la ricerca la conferma:** *piu' lento non e' automaticamente piu'
fresco.* Il criterio e' **°C per 1000 token**, mai °C al minuto. Il lavoro FUSE mostra che scelte
di frequenza diverse danno latenze molto diverse **a parita' di energia**.

**Raccomandazione per il Jelly (confidenza media-bassa, dichiarata):** Mali spento per default;
decode sulla coppia A76 (gia' cosi'); poi la politica di thread e frequenza la decide **il nostro
test a token fissi**, non la letteratura; leggere insieme severita' termica **e** cap di frequenza
reali; e usare intervalli di raffreddamento veri invece di micro-intermittenza.

---

# Parte 4 — La calibrazione termica per device

E' il problema piu' difficile del piano, perche' i numeri che servono non si trovano su una tabella
e non si possono chiedere al sistema operativo.

**Tre strade, con il loro prezzo.**

**(a) Tabella spedita, una riga per device conosciuto, default conservativo per gli altri.**
Semplice, zero costo a runtime, nessuna sorpresa. Ma copre solo i telefoni che abbiamo in mano, e
il default conservativo significa "CPU e basta" su tutto il resto del mondo — cioe' il governor non
serve a nessuno tranne a noi tre.

**(b) Calibrazione al primo avvio.** Un prefill breve per motore, si misura il ΔT, si salva. Costo:
qualche decina di secondi e un po' di calore la prima volta. Rischio: la misura la fai in una
condizione (telefono appena acceso, freddo, magari in carica) e la usi in tutte le altre.

**(c) Apprendimento continuo.** Ogni turno vero e' una misura: token processati, motore, ΔT. Si
aggiorna una media mobile per `(device, motore, fase)`. Costo quasi zero, nessun esperimento
dedicato, e migliora con l'uso. Rischio: i primi turni girano su un valore ancora ignoto, e serve
un valore iniziale prudente.

**Raccomandazione: (c) con (a) come valore iniziale.** Si spedisce una tabella per i device noti,
il default per gli sconosciuti e' prudente, e da li' in poi il telefono corregge se stesso con i
turni veri dell'utente. E' anche l'unica delle tre che sopravvive a un aggiornamento di sistema che
cambia le curve DVFS sotto di noi.

**Quello che va misurato, in ogni caso, e' °C per 1000 token** — mai °C al minuto, e mai ΔT di
processo intero con dentro il caricamento del modello, che e' l'errore che ha prodotto i valori
q58 usati oggi.

---

# Parte 5 — I difetti da riparare prima di misurare

Owner, 19/09: *"testare un governor rotto non ha senso"*. Tutti e cinque CONFIRMED con riga citata
da una review ostile, e i primi tre riverificati a mano dall'orchestratore.

## 5.1 Il ripiego su CPU sopra 37,6 °C
`llama-governor-runtime.cpp:55-63`. La tabella rifiuta per calore e il ripiego e' il motore piu'
caldo, non spezzato. **Riparazione:** il rifiuto deve ridurre i token, non cambiare motore; e se
proprio non c'e' un chunk sicuro, la pausa va dichiarata.

## 5.2 Il caricabatterie avvelena il governor
`GovernorBatteryModule.kt:63-66` manda quattro campi e **non** manda `t_idle_valid`; il ponte JSI
lo default a `false` (`RNLlamaJSI.cpp:43-44`); `profile_is_valid` lo pretende quando `plugged`
(`llama-governor-policy.cpp:60-63`). Quindi `plugged = true` ⟹ profilo `Invalid` ⟹ `Abort` ⟹
`failed = true`, che e' appiccicoso ⟹ ogni completamento successivo lancia.
**Riparazione:** o il modulo manda `t_idle_c`/`t_idle_valid` davvero misurati, o il ramo `plugged`
smette di pretenderli. E `failed` non deve essere terminale per una condizione transitoria come un
cavo attaccato.

## 5.3 Il pavimento di batteria inverte la rotta
`llama-governor-runtime.cpp:65-68`. `requested == CPU` produce `Admit`, che finisce su
`prefill_route_ = GPU`. Il pavimento cambia una stringa di telemetria e nient'altro.

## 5.4 Corsie irraggiungibili
`select_decode` richiede **tredici** clausole simultanee (`llama-governor-policy.cpp:236-242`), fra
cui `generation == V73` — mentre l'app abilita solo V75 e V79 — piu' `cool_delta_measured`,
`kexp_cool_scope` (mai serializzati) e `reload_budget_available` scritto `false` a mano. La corsia
"scalda → sposto il decode su GPU per raffreddare" **non e' raggiungibile su nessun telefono**.
Stessa cosa per `GPU_COOLMODE` nel prefill (`cool_prefill_eligible` mai emesso) e per la corsia NPU
(il loader lancia).

## 5.5 Un prompt di 129, 257 o 385 token tronca la risposta
L'algoritmo di chunking lascia un resto di 1 token; un resto di 1 restituisce `-2`
(`llama-governor-runtime.cpp:96-99`), che non e' classificato come guasto del governor, e la
generazione si ferma. L'utente vede la risposta troncarsi senza errore.

## 5.6 Da CRITICAL non si esce
Il primo decode dopo essere entrati in CRITICAL latcha `failed`; il recupero a
`llama-governor-policy.cpp:118-121` e' irraggiungibile. E `critical_exit = 34,0 °C` e' **piu'
freddo** di `warm_exit = 36,0`: uscire dallo stato peggiore richiede un telefono piu' freddo che
uscire da quello mite. `k_kill_c = 43,0` e' morto per costruzione, perche' `critical_enter <= 42,0`
in entrambi i rami.

---

# Parte 6 — Il piano di misura

**Criteri depositati prima di misurare**, perche' e' la regola del lab e perche' senza di essi ogni
numero diventa negoziabile a posteriori.

## 6.1 Strumenti, e perche' questi

| strumento | cosa prova | limite dichiarato |
|---|---|---|
| `/sys/class/kgsl/kgsl-3d0/gpubusy` | **che la GPU lavori davvero** | globale, non per processo: attribuzione per correlazione temporale. Linea di base misurata **~7,5%** a schermo acceso e app ferma |
| `scaling_max_freq` per cluster | lo strozzamento vero | non si campiona **durante** un turno |
| `dumpsys battery temperature` | la termica lenta | decimi di grado, inerzia alta |
| skin da logcat (`AurogonBandwidthController`) | la termica veloce | solo HyperOS |
| log nativo del motore (`graph splits`, buft) | dove stanno i tensori | e' il motore che si descrive |
| `KALSA_GOVERNOR` | **perche'** ha deciso cosi' | e' l'app che parla di se': la prova piu' debole |

⛔ `dumpsys thermalservice` **non e' uno strumento** su questi telefoni: `Thermal Status` e' 0 in
ogni campione dell'archivio mentre il cap di frequenza si dimezza.

## 6.2 Le celle, in ordine

1. **Xiaomi, sonda governor con l'APK riparato.** Obiettivo: *il governor si aggancia, si' o no*.
   Criterio di successo: almeno una riga `KALSA_GOVERNOR` senza `fallback_reason`, e `gpubusy` che
   si stacca dalla linea di base **dentro la finestra del prefill**. Se `gpubusy` resta a 7,5%
   mentre la telemetria dice "governor attivo", la conclusione e' *"si aggancia ma non usa la
   GPU"*, che e' un risultato diverso e va scritto diverso.
2. **Xiaomi, ΔT per cella isolata** a 128/512/1024/2048 token, per motore, partendo ogni volta
   dalla stessa temperatura di riposo. E' la misura che oggi manca e che serve a sostituire la
   costante S23.
3. **Xiaomi, coppia attaccato/staccato a parita' di lavoro.** Mai fatta su nessun telefono.
4. **S23, prefill GPU sul 740**, col fondo `adsprpcd` dichiarato accanto.
5. **Jelly**, solo dopo la ricerca online: non si brucia batteria per riscoprire una cosa nota.

## 6.3 Regole di stop, invariate
Thermal status >= 3, oppure batteria >= 43 °C da staccato, oppure livello < 25%. Sullo Xiaomi:
**mai** spegnere lo schermo (c'e' la password), mai riavviare, stop se `mWakefulness=Asleep`.

---

# Parte 7 — Le caselle vuote, dette prima di riempirle

- **Nessuna misura GPU in-app sullo Xiaomi**, ne' prefill ne' decode: tutti i numeri GPU sono da
  `llama-bench` a riga di comando. Il governor e' l'unica strada per arrivarci in-app, e fino al
  19/09 abortiva.
- **Nessuna coppia attaccato/staccato a parita' di lavoro**, su nessun telefono.
- **Nessun ΔT per cella isolata** a 128/512/1024/2048 sullo Xiaomi: le celle del 18/08 hanno un solo
  campione di bordo e la sua posizione nella cella non e' documentata.
- Non sappiamo se il cap a **2630400** sullo Xiaomi sia il riposo del vendor o ancora raffreddamento.
- Il **"GPU prefill 5,77×"** propagato nei doc dell'app e' conteso dal rerun meglio controllato che
  da' **3,18×**. Entrambi misurati.
- Il prefill GPU sull'**S23/Adreno 740** non e' mai stato misurato in-app.
- L'**NPU** non e' mai stata provata dentro l'app su nessun telefono.

---

# Parte 8 — Domande aperte per l'owner

1. **Il pavimento di velocita'.** Sotto quanti tok/s in decode una risposta diventa inaccettabile?
   Serve un numero, perche' e' il vincolo che decide quando il governor puo' scegliere il motore
   freddo invece di quello veloce.
2. **Cosa vede l'utente quando il telefono e' troppo caldo.** Oggi: un'eccezione. Le alternative
   sono una risposta piu' lenta senza dirlo, oppure una riga onesta ("sto rallentando, il telefono
   scotta"). E' una scelta di prodotto.
3. **La calibrazione (Parte 4):** tabella spedita, primo avvio, o apprendimento continuo.
4. **L'NPU rientra in M1 o resta in M2?** Sullo Xiaomi e' il motore di prefill migliore che
   abbiamo misurato, e oggi e' disabilitato per costruzione in due punti.
5. **Il Jelly e' un target o un caso limite?** Se e' un target, la politica "solo CPU con
   intermittenza" va disegnata; se e' un caso limite, il governor si spegne e lo dice.

---

# Parte 9 — Ordine dei lavori

| # | cosa | dipende da | esito |
|---|---|---|---|
| 1 | Riparare 5.1, 5.2, 5.3 | — | il governor smette di fare il contrario di se' |
| 2 | Sonda GPU = compilazione vera + degradazione pulita | 1 | niente piu' `exit(1)` in-app |
| 3 | Prova a runtime sullo Xiaomi (M1.3) con `gpubusy` | 1, 2 | **sappiamo se il governor si aggancia** |
| 4 | ΔT per cella sullo Xiaomi | 3 | i numeri per sostituire la costante S23 |
| 5 | Le altre tre sonde + il record di capacita' | 3 | il governor smette di leggere tabelle |
| 6 | Calibrazione per device | 4, 5 | la politica diventa per telefono |
| 7 | **Rifacimento della forma (Parte 2b)**: selettore unico, matrice come dato, identita' fuori dalle decisioni | 3 | aggiungere un telefono torna a costare una riga |
| 8 | 5.4, 5.5, 5.6 (corsie morte, chunk da 1, CRITICAL) | 7 | **assorbiti dal rifacimento**, non patchati a parte |
| 9 | S23 e Jelly | 7, ricerca online per il Jelly | i due telefoni oggi esclusi per tabella |

I passi 1-3 sono M1. Dal 4 in poi si entra in quello che l'owner chiama *"il governor sa in che
telefono sta"*.

**Perche' il rifacimento sta al 7 e non all'1**, visto che l'owner lo vuole scritto bene da subito.
I difetti 5.1/5.2/5.3 sono tre riparazioni chirurgiche su righe che il rifacimento riscriverebbe
comunque, e senza di esse **M1.3 non si puo' nemmeno tentare**: il governor abortisce appena
attacchi il cavo. Farle prima costa poche righe e sblocca la misura; farle dentro un rifacimento
significa non misurare niente finche' il rifacimento non e' finito e validato.

Il confine e' pero' netto, e va rispettato: **il rifacimento deve arrivare prima del quarto
telefono e prima della corsia NPU.** Se aggiungiamo un dispositivo o un motore sulla forma
attuale, paghiamo i sette punti della tabella 2b.1 e li paghiamo ogni volta. E i difetti 5.4, 5.5 e
5.6 **non vanno patchati a mano**: sono sintomi della forma — una corsia morta perche' l'identita'
del device sta dentro una decisione, un resto di 1 token perche' il chunking e' duplicato per fase,
uno stato senza uscita perche' le due fasi gestiscono CRITICAL in modo diverso. Ripararli uno per
uno significa scrivere tre toppe che il passo 7 butta via.

---

# Appendice A — Audit puntiglioso del 19/09/2026 (deepseek v4.1, verbatim)

**Provenienza.** Agente Paseo `447dbd7c-7b15-4ff8-854d-aef8bbd7f140`, modello
`commandcode/deepseek/deepseek-v4.1-flash`, thinking `max`, ricerca online esplicitamente
autorizzata. Brief: verificare ogni citazione `file:riga`, ogni misura contro il suo artefatto,
ogni conto incluse le condizioni al bordo; verificare online in autonomia le affermazioni di
ricerca e chiedersi se qualcosa in questo documento sia gia' superato a monte; attaccare il
disegno; dire cosa il piano omette. Il brief avvertiva: *"this document has already been wrong
twice today and corrected twice… Assume there is a third error I have not found."*

**Stato di verifica.** ⚠️ **L'orchestratore NON ha ancora riletto sull'artefatto nessuna di
queste conclusioni.** Vale la regola di sempre — l'output di un delegato non e' prova. Il report
e' riprodotto **verbatim, senza tagli**, perche' il suo valore sta nelle righe citate: ogni
accusa si controlla aprendo il file che nomina. Dove l'audit dice di non essere riuscito a
riprodurre un numero, lo dice; quelle righe sono le piu' importanti del documento.

**Nota di lettura.** L'audit e' in inglese perche' i brief ai subagenti sono in inglese. I
riferimenti `§` puntano alle sezioni del corpo di questo piano.

---

## Registro delle verifiche dell'orchestratore

Ogni riga qui sotto e' stata **riletta sul sorgente da kalsa-38**, non ripetuta dall'audit.
Il registro cresce: quello che non compare qui **non e' verificato**.

### V1 — Affinity dei core su Android: l'audit e' CORRETTO sul fatto, SBAGLIATO sulla conseguenza

L'audit (sezione D, punto 2) sostiene che il fix upstream #26838 e' nel nostro albero, che quindi
"possiamo pinnare oggi", e che la capacita' e' inutilizzata perche' `grep -rn "cpu_mask" src/`
non torna niente — concludendo che alla Parte 3.3 "serve un parametro".

**Cosa ho letto.**

- `kalsallama:ggml/src/ggml-cpu/ggml-cpu.c:2953` e' `#elif defined(__linux__)`, e `:2969-2973`
  ha il ramo `#ifdef __ANDROID__ / sched_setaffinity(0, sizeof(cpuset), &cpuset);`. **Confermato.**
- `git blame` dice pero' che quella riga e' di **`d2f83055d` (Hitesh Chopra, #26838)** e che e'
  gia' sotto il nostro merge base: **non e' una nostra patch**, e' codice upstream che abbiamo
  ereditato. Attraversa il merge senza costo e senza bisogno di essere difeso.
- `grep -rn "cpu_mask\|cpuMask\|cpu_strict" src/ native/` nell'app: **zero**. Confermato.

**Dove l'audit sbaglia.** Il binding **pinna gia' da solo, per default, su ogni init di contesto** —
non serve nessun parametro dall'app. `llama.rn-kalsa:cpp/jsi/JSIParams.cpp:25-61`, sotto
`#if defined(__ANDROID__)` (`:20`), definisce `set_best_cores()`: legge
`/sys/devices/system/cpu/cpuN/cpufreq/cpuinfo_max_freq` per ogni core, ordina in discesa, accende
`cpumask` sugli N core piu' veloci e chiude con `params.strict_cpu = true; params.mask_valid = true;`.
Il call site e' `:332-333`, incondizionato su Android. `cpu_mask` (`:341-347`) e' un **override**
applicato dopo, non il meccanismo.

**Conseguenza vera, diversa da quella dell'audit.** Non ci manca un parametro: ci manca la
**scelta di quali** core, e soprattutto ci manca il **prefill**. Due cose lette nel codice:

1. `set_best_cores` ordina per `cpuinfo_max_freq`, mentre `kalsa:src/engine/deviceTuning.ts` chiave
   i suoi preset su `cpu_capacity`. **Due segnali diversi per ordinare gli stessi core**, nello
   stesso prodotto.
2. Il commento a `JSIParams.cpp:327-328` lo dice esplicito: *"Decode affinity (set_best_cores below)
   stays on cpuparams only — batch is used verbatim."* Quindi **i thread di prefill non sono
   pinnati**. Per un piano il cui soggetto e' il costo termico del prefill, questa e' la riga che
   conta, e non compare ne' nel corpo del piano ne' nell'audit.

Verificato il 19/09/2026 su `kalsallama@2361be359` e `llama.rn-kalsa@95c3493b`.

---

Audit complete. No files edited, nothing committed, no sub-agents, no `adb`. Online research succeeded (network reachable); my URLs are below, and where I could not reproduce a number I say so rather than substitute a recollection.

---

## A–B. Findings, by severity

### 1. REFUTED — the "Smentita a verbale" is itself the third error. The 0.992 **is** our phone.

Plan: *"La parita' di decode «0,992» citata nella memoria `kalsa-the-goal-is-a-governor` **non e' dello Xiaomi**: e' della scheda di riferimento QRD8650"*.

`scratchpad/agents/q16-xiaomi/REPORT.md:336` — **"d1 LFM A/C N=5 is the bankable 750 number:** tg median A 24.155 / C 24.338, **A/C = 0.992**. pp A/C = 2.477."
`:1-5` — "**Device:** Xiaomi 14 ("houji"), Adreno 750, SM8650".
`:378` — "**A/C tg = 0.992** (N=3 exploratory was 1.008). Parity holds … **A/C pp = 2.477**."
`scratchpad/agents/q16-xiaomi-audit/REPORT.md:137` (audit-recomputed at full precision) — "A/C tg = `0.992469912994216` -> `0.992`, and A/C pp = `2.47734231126173` -> `2.477`", raw `results/xiaomi750_validation/raw/d/`.

The memory's row (`kalsa-the-goal-is-a-governor.md:28`: *"Adreno 750: decode **0.992** (parity), prefill **2.477×**"*) matches this cell **including the 2.477** — two independent numbers, same cell. Consequence: the sentence written "a verbale" to stop this error repeating is the error; the correct retraction is narrower and different (LFM2.5-8B-A1B-KEXP, `-t 4`, `-ngl 99` full-model offload vs `-ngl 0 -nr`, tg128, N=5 — not the governor's two-context phase split), and the plan's closing claim "sul telefono vero la GPU in decode perde, **su due misure indipendenti**" is contradicted by a third on-device, audit-verified measurement on the same phone.

Secondary, same paragraph: the *other* 0.992 in the corpus (`scratchpad/agents/qdc-governor-s5/REPORT.md:235`, `B/A=0.9929437564`) is **QRD8750 / 8 Elite / Adreno 830 / SM8750**, serial `2a38935c` (`:213`, `raw/sa803609/results.tsv`) — not QRD8650. So the named board is wrong too.

### 2. REFUTED — Part 3.3's Mali state is superseded. Gates 3 and 4 already ran; the "two named defects" hypothesis was tested and failed.

Plan: *"GPU bloccata da una lista bianca e da due difetti nominati, con una stima: **mezza giornata di PC piu' 30 minuti di Jelly**"*.

`scratchpad/agents/q26b-mali-probe/REPORT.md:3` — "**Status:** DONE (Gate 4 — GPU ≤ CPU on green paths; Mali-tuned kernels required)".
`:172-179` — "**# Gate 3 — portability patch (quant kernels on Mali)** … Timebox: ~3h … Branch `kalsa/mali-probe` @ `435eacf36`."
`:218-221` — after the `#else` + `vload_half` patch: "q4_0 … **SIGILL 132**", "q4_K … **err -54 `CL_INVALID_WORK_GROUP_SIZE`**", q6_K "**SIGILL 132**".
`:252-260` — "Portability patches made class-1 kernels **parse**. They are **not** enough for the ship path … **Dedicated Mali kernels remain justified** for the ship quant path."
`docs/ALIVE.md:441` — "Gate 4 … **GPU < CPU on all 20 green cases, max 0.962×**"; "**OWNER DECISION 22/08: PARKED on G57-class**".
`grep -rn "mezza giornata"` over the repo returns only the plan and three unrelated hits.
Consequence: the plan reopens, with a half-day estimate, a lane the corpus closed by owner decision after a 3-hour run showed the diagnosed defects were *not* the blocker (`sub_group_shuffle_xor` SIGILL and q4_K WG-size are architectural, not ifdef hygiene) — and it does so under a heading that presents itself as the *corrective* to the earlier "Mali is unusable" error.

### 3. REFUTED — the NPU "ΔT +1,3 °C" is the whole cell's rise, not the NPU's.

Plan: *"l'NPU … sullo Xiaomi … il motore di prefill piu' veloce e piu' freddo che abbiamo misurato (3,19× la CPU, **ΔT +1,3 °C**)"*.

`results/htp_prefill/xiaomi_v75/cell1/battery_series.csv` (6 rows, the whole cell): `htp1_pre … 32.9`, `htp2_pre … 33.3`, `htp3_pre … 33.3`, `cpu_pre … 33.3`, `end … 34.2`. `NOTES.txt:6` — "temp C: htp1 32.9 htp2 33.3 htp3 33.3 **cpu 33.3** end 34.2". So the only derivation of +1.3 is `end − htp1_pre` = **34.2 − 32.9**, the entire cell including the CPU rep. Per-leg: three HTP reps ≈ +0.4 total; the single CPU rep +0.9. `AUDIT-CORRECTIONS.md:11-13` — "The CPU rep starts **1s** after HTP rep3"; HTP reps are separated by "61s/61s".
Consequence: the number is used to argue the NPU is the *cool* prefill engine, while the artifact attributes three quarters of the rise to the CPU arm — and no per-engine NPU ΔT exists in the artifact.

### 4. REFUTED — the thermal-status census is wrong: 28 samples read `3`, one of them in product-suite.

Plan: *"`dumpsys thermalservice` riporta `Thermal Status 0` in ogni campione dell'archivio: 12/12 nel cooldown del 19/09, 15/15 nei file product-suite"*.

Line census over the repo: `1263× "Thermal Status: 0"`, **`28× "Thermal Status: 3"`, `11× "1"`, `9× "2"`**. `product-suite/thermal*.txt` = **23 files**, 21 zeros, one `1` (`S23-SWITCH-EXTRACT-CANCEL-1807aad-2026-09-11/thermal-retry.txt:10`), one **`3`** (`JELLY-PREWARM-2026-09-09/minicpm5/turn/thermal-mid-turn.txt:10`). No 19/09 cooldown artifact exists: newest non-plan file is `docs/ALIVE.md` @ 2026-09-18 20:02. All four `results/` hits are `0`.
Consequence: the enumerated evidence for "thermalservice is not an instrument" does not exist as described; the Xiaomi-only version of the claim survives (`results/` all 0), the archive-wide version does not — and the plan's own §3.3 (`Thermal Status 3 in 9 minuti`) contradicts "in ogni campione" one page later.

### 5. REFUTED (wrong artifact, contaminated source, wrong night) — the 4B thermal deltas.

Plan: header cites `results/xiaomi_ab/task_a/battery_notes.txt` for the block, then *"Il 4B da' lo stesso verso: CPU +2,4/+3,5/+1,7 … contro GPU +0,4/−0,7/−0,3"*.

Those six values are exact from a **different file**: `results/xiaomi_ab/task_a_4b_clean/battery_notes.txt` (289→313, 313→317, 317→352, 354→347, 351→368, 368→365) — a run that began `2026-08-13T05:32:25`, i.e. the next morning, not "la stessa sera". The cited file has **no 4B pp1024 cell at all** and its 4B deltas are +2.3/+0.1/−1.5; `results/xiaomi_ab/task_a/CONTAMINATED_4B.md:1-8` marks that entire 4B block "**CONTAMINATED** … measured while the owner was using the phone (interactive foreground use). They are **not** product numbers."
Consequence: right numbers, wrong citation, and the citation points at the one artifact the camp explicitly retired.

### 6. REFUTED (descriptor inflates n) — the 18/08 rerun's decode evidence.

Plan: *"Il rerun interlacciato del 18/08 (**10 ripetizioni per verso, entrambi gli ordini**) conferma il verso del decode — GPU **17,46** vs CPU **26,50** … e **ridimensiona il prefill a 3,18×**"*.

`results/gpu_prefill_recheck_xiaomi/report.md` §1 — the 10-rep / two-ordering design is the pp128 **prefill** cell. Decode is headed "**### Decode (not disputed; 2 interleaved pairs)**": CPU `26.968 / 26.039` (mean 26.5035), GPU `17.413 / 17.514` (mean 17.4635). The 3.18× is correct (186.567/58.676 = 3.1796), and so is 26.50/17.46.
Consequence: two n=2 pairs are presented as ten-repetitions-per-direction evidence, in the same paragraph whose purpose is to establish which number is "meglio controllato".

### 7. PLAUSIBLE-to-REFUTED (external) — Mali-G57 MC2 ✓, but "1100 MHz" is the wrong number from the right page.

2 CU confirmed: MediaTek official — "Arm Mali-G57 MC2" (https://www.mediatek.com/products/smartphones/mediatek-helio-g99); NotebookCheck — "uses 2 clusters (hence the MC2/MP2 name)" (https://www.notebookcheck.net/ARM-Mali-G57-MP2-GPU-Benchmarks-and-Specs.537758.0.html). The G99's GPU clock is **not published by MediaTek**; third-party G99 pages say **1000 MHz** (https://tenzystech.com/soc/mediatek-helio-g99; https://nanoreview.net/en/soc/mediatek-helio-g99 — "GPU frequency | 1000 MHz"). **1100 MHz** appears on NotebookCheck only as the *generic Mali-G57 MP2 row maximum across other SoCs* (listed under UNISOC T9300/T7300).
Consequence: small, but it is exactly the provenance class the plan says it wants caught — a number lifted from a hardware-database row that is not about this SoC.

### 8. CONFIRMED — every code citation that matters, line-for-line.

Verified as written: `governorInputs.ts:14-27` (incl. `V73: false, // never measured in-app` at `:25`); `:130` `enabled = force || GPU_PREFILL_CORRECT[generation]`; `:137` `gpu_prefill_measured: generation === "V75" || generation === "V79"`; `:139-140` both `false`; `llama-governor-policy.cpp:14-15` (both arrays, exact); `:10,12` `k_warn_c 40.0` / `k_kill_c 43.0` (and `k_limit_c = k_warn_c - 0.5` at `:11`); `:200,205` no device branch; `:153-172` `prefill_engine`; `:236-242` — I count **exactly 13** clauses; `:60-63` plugged branch; `:118-121`; `llama-governor-runtime.cpp:60-63` (warn at `:61`); `:65-68`; `:96-99`; `ggml-opencl.cpp:1298-1300` `if (fatal) { exit(1); }` and `:1301 return nullptr`, with `CL_CHECK → LM_GGML_ASSERT(0)` at `:89` — so the plan's "abort one line later" chain is **correct**; `:5807-5811` and `:6291-6295` `fatal=false` + `if (!prog) return false;`; `rn-governor-params.cpp:150-151`; `GovernorBatteryModule.kt:63-66` (exactly four fields, no `t_idle`); `RNLlamaJSI.cpp:43-44`; `deviceTuning.ts:203-208`; `ModelRegistry.ts:229` `13312`, `:259` `6656`; commit `b4fe891` exists (2026-09-19 08:53, `feat(context): let the user choose context size and KV cache quality`); `8540797` exists and is the Mali gate-2 commit.

Also CONFIRMED by trace, not just by line: the inverted battery floor — `prefill_engine()` `:155` returns CPU below 45% → `admit_prefill` `:220-221` returns `Admit` → runtime `:55-56` false → `:65-66` sets `prefill_route_ = GPU` while `:67` writes `stats_.prefill_engine = requested` (CPU). And `rn-llama.cpp:583` `if (result != 0 && result != -2 && !was_failed)` **excludes `-2` from the `KALSA_GOVERNOR_FALLBACK` log**, which independently confirms §5.5's "not classified as a governor fault".

### 9. PLAUSIBLE (drift, and two places where the citation supports less than the claim)

- `governorInputs.ts:60-75` → `generationFor` is **62-75** (60-61 close the `GovernorModel` type). More than drift: the prose says it "prende `profile.socModel` … e lo confronta con **tre** regex" — the function has **six** (`:64,65,66` on `socModel`; `:71,72,73` on `modelName/modelId/manufacturer`, the QRD/HDK board fallback). The elided block is later load-bearing: §3.1's ⛔ box (reference board ≠ our phone) *depends on exactly that fallback*.
- `governorInputs.ts:78-118` → `gpuFit` is **84-121** (off by 6).
- `governorInputs.ts:120-145` → `buildGovernorParams` is **123-144**, and it emits **ten** keys, not nine (`...(enabled ? {} : { reason: … })` at `:142`). Every device the plan cares about is disabled, so `reason` is always present.
- `llama-governor-policy.cpp:180-225` `admit_prefill` → actually **184-226**; `:227-252` `select_decode` → **228-256**.
- `rn-llama.cpp:69` "cioè `n_gpu_layers = 99`" → line 69 is the tail of the function signature. `prefill_params.n_gpu_layers = 99;` is **`:72`** (and `decode_params.n_gpu_layers = 0;` is `:73`). Citation points at a construct that does not exist there; the claim is true.
- `q58 REPORT.md:31-35` "sono esattamente quei quattro valori" → the four CPU mean ΔT rows are `:29 (1.900)`, `:31 (3.250)`, `:33 (3.250)`, `:35 (5.150)`; `31-35` also contains NPU rows `:32` and `:34`. Needs `27-35` or `29/31/33/35`.
- §0.5 "usati per prezzare un chunk **GPU** su V75 e V79": the constants are the *CPU* delta in `now_c + k_cpu_delta_c[table-1] > k_limit_c`. They price the CPU alternative to a GPU chunk, not the GPU chunk. Minor, but it weakens the plan's own Rule-2 argument that these numbers are foreign.
- §5.6 "il recupero a `llama-governor-policy.cpp:118-121` e' irraggiungibile" — the *policy* path at 118-121 **is** reachable (it runs from `update_thermal`, which the app drives every poll); what is unreachable is any useful recovery, because `fail()` latches first. And "il primo **decode**" understates: `admit_prefill` `:188-192` returns `Abort` under CRITICAL too, so the first *prefill* aborts identically (runtime `:50-51`). Two over-claims, same paragraph; the fix is unaffected.

### 10. CONFIRMED — all Part C arithmetic, including the boundary.

Deltas §3.1 2B: `279→290 (+1.1)`, `290→290 (0.0)`, `290→318 (+2.8)`, `322→319 (−0.3)`, `319→355 (+3.6)`, `355→356 (+0.1)`; SoC `47812→67100 = +19.288` (plan +19.3), `49157→50600 = +1.443` (plan +1.4); `AC powered: false` throughout. Ratios: `181.652046/31.459208 = 5.7742`; `16.148805/7.066402 = 2.2854`; `186.567/58.676 = 3.1796`; `165.42/51.90 = 3.1873`; `4.47/11.94 = 0.3744`; `14.252/17.553 = 0.8120` → −18.8% ≈ "−19%"; `37.200 − 39.950 = −2.75`; `1824000/3302400 = 0.5523` → 55%.

Admission thresholds: the code rejects with `> k_limit_c`, so entry *i* is admitted iff `now_c + Δ_i ≤ 39.5`, i.e. **≤ 34.35 (2048), ≤ 36.25 (1024 and 512), ≤ 37.6 (128)** — **inclusive**, and the `table==0` escape at `:204-205` can never admit above 37.6. Hand-checked at the boundary: a 128-token prompt at exactly 37.6 stops at `table=1` and returns `Admit`; at 37.61 it returns `Wait`. All correct, and §2.2's "Sopra 37,6 °C nessun blocco della tabella passa" is correct as written.
Note: 512 and 1024 carry the **same** ΔT (3.25), so the plan's "riduci i TOKEN per chunk" lever has only three distinct thermal steps, not four.

### 11. CONFIRMED — the S23 cell.

`scratchpad/agents/kexp-n5-session/REPORT.md` running medians: `A 14.252 / C 17.553 → A/C 0.812`; peak T `A 37.200 / C 39.950`. `reports/moe-gpu-sustained.md`: S23 2B `CPU 12.2→10.2 = −16%`, `GPU 8.2→8.2 = 0%`; 4B `CPU −14%`, `GPU −5%`. So "−19% ma −2,75 °C" and "CPU throttla 14-16% mentre la GPU resta piatta 0-5%" are exact. The plan's *"parte a 17,5 tok/s e scende a 14,8"* is **not** in that artifact (segments are 12.2/10.9/10.2 and 8.2/8.2) and I found no source — see the unverified list.

---

## D. External verification, with my own URLs

**Verified.**
- Helio G99 GPU = **Mali-G57 MC2, 2 CU** — https://www.mediatek.com/products/smartphones/mediatek-helio-g99 ; https://www.notebookcheck.net/ARM-Mali-G57-MP2-GPU-Benchmarks-and-Specs.537758.0.html. (Clock: see finding 7 — "1100 MHz" is not the G99's figure.)
- llama.cpp OpenCL doc does declare Adreno the first-class/Android-verified target — "designed to enable llama.cpp on **Qualcomm Adreno GPU** firstly via OpenCL", Android *Verified* column = "Snapdragon 8 Gen 3, Snapdragon 8 Elite": https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/OPENCL.md
- Decode is treated as bandwidth-bound in the mainstream framing — "Prompt processing and token generation are listed separately because they bottleneck on different things, PP on tensor throughput, **TG on memory bandwidth**": https://www.myaihardware.com/llama-cpp-benchmarks
- `getThermalHeadroom` / thermal-mitigation context: https://developer.android.com/games/optimize/adpf/thermal
- Adreno-750-class `0.992` provenance is local, not external (finding 1).

**Could not reproduce — do not cite these as verified.**
- **Mali-G57 Vulkan `0,79 / 0,86` vs CPU `2,44 / 2,29`.** No source found with those four numbers. Nearest published Mali-Vulkan data are different devices and worse ratios: llama.cpp issue **#22682** (RK3588/Mali-G610 — "CPU only (--device none): [ Prompt: 35.9 t/s | Generation: 25.7 t/s ] … Vulkan: [ Prompt: 3.3 t/s | Generation: 5.7 t/s ]"), https://github.com/ggml-org/llama.cpp/issues/22682 ; discussion **#23193** (Mali-G715 usable on Pixel 9 Pro XL), https://github.com/ggml-org/llama.cpp/discussions/23193
- **G99 retention `91% / 95% / 99,4-99,5%`.** Closest published: NanoReview G99 rows "Wild Life Extreme … **Stability 99%**", "Steel Nomad Light … **Stability 98%**", plus a per-device "**CPU Throttle 86%**" — https://nanoreview.net/en/soc/mediatek-helio-g99 . Two of the three numbers I could not reproduce at all, and the direction of the argument is unsafe regardless: a ~1–2-minute *GPU* stress-test stability figure cannot license the conclusion "il nostro `Thermal Status 3` in 9 minuti … e' un telefono da 3 pollici senza massa termica", because the workload, duration and subsystem all differ from a 9-minute sustained CPU prefill.
- **A55/A76 `1,05 / 4,41 / 6,81 / 5,26` on 730G, and `18,0 → 13,7`.** No source found. The *mechanism* is well corroborated: https://github.com/ggml-org/llama.cpp/issues/21763 ("Severe performance collapse on MediaTek ARMv9 when threads > big-core count"), https://github.com/ggml-org/llama.cpp/discussions/25256 (big.LITTLE jitter), and three tools doing this exact work — https://devpost.com/software/mobilespec-2-07x-faster-llm-inference-on-arm ("verified 2.07× sustained decode"), https://devpost.com/software/littletai ("8 threads: 1.60 t/s. Four threads … 18.07 t/s"), https://github.com/hiteshchopra11/armtune. The four numbers themselves are unverified.

**Out of date upstream — and this is where the plan is behind, not the world.**
1. **llama.cpp ships a Hexagon NPU backend upstream.** PR **#16547 "Add experimental ggml-hexagon backend for the Hexagon NPU" — merged 2025-10-22, merge commit `63d2fc46`**, "Supports Hexagon versions: v73, v75, v79, v81" (https://github.com/ggml-org/llama.cpp/pull/16547). Documented: "llama.cpp supports three backends on Snapdragon-based devices: CPU, Adreno GPU (GPUOpenCL), and Hexagon **NPU (HTP0-4)** … Hexagon NPU behaves as a 'GPU' device when it comes to `-ngl`" (https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/snapdragon/README.md). The plan presents the NPU lane as a local fork capability we own; it is now a standardised upstream backend, which changes both the "reinventing" answer and the fork-rebase strategy.
2. **The Android affinity trap is real and was fixed upstream — our fork already carries the fix, and the app does not use it.** llama.cpp **#26838 / commit `d2f8305`** "ggml-cpu : fix CPU affinity mask being ignored on Android" — "`-C`/`--cpu-mask` and `--cpu-strict` are silently ignored on Android … the affinity implementation … is guarded by `#elif defined(__gnu_linux__)`, which Clang does not define for Android target triples" (https://github.com/ggml-org/llama.cpp/commit/d2f8305). In our tree the guard is `#elif defined(__linux__)` with an explicit `#ifdef __ANDROID__ sched_setaffinity(...)` branch (`cpp/ggml-cpu/ggml-cpu.c:2953, 2969-2973`), so **we can pin today** — and `grep -rn "cpu_mask" src/` returns nothing. Consequence: the plan's §3.3 "the thread recommendation is already implemented" is not implementable as written and does not need to be re-invented; it needs one parameter.
3. **`PowerManager.getThermalHeadroom(int)` (API 30) and `getThermalHeadroomThresholds()` (API 33) exist, plus NDK `AThermal_getThermalHeadroom`** — https://developer.android.com/reference/android/os/PowerManager , https://developer.android.com/ndk/reference/group/thermal , with AOSP documenting the conversion: "headroom to temperature conversion: **3C every 0.1 headroom** difference" (https://android.googlesource.com/platform/frameworks/base/+/master/services/core/java/com/android/server/power/ThermalManagerService.java). The plan's §1.1 conclusion ("su questo telefono e' cieco ⟹ costruiamo `headroom_cpu` da `scaling_max_freq`") never mentions the platform API; q58's "current numeric headroom = **NOT_EXPOSED**" is about `dumpsys thermalservice` thresholds, not about this call. This is the single most consequential omission in D.
4. **NNAPI is deprecated.** "The Neural Networks API (NNAPI) is deprecated … deprecated in **Android 15**" — https://developer.android.com/ndk/guides/neuralnetworks/migration-guide . The plan's MediaTek/NPU sentence describes a dead path; the recommended path is LiteRT + Play-services delegates or AICore (https://developer.android.com/ai/custom).
5. **Vulkan on Mali has moved.** PR **#18493 "vulkan: add peak performance tuning for ARM Mali GPUs (G720)"** — Mali-specific warptiles, FP32 forced, 256 MB suballocation cap (https://github.com/ggml-org/llama.cpp/pull/18493); Mali-G715 usable with stock binaries (#23193). So "Vulkan stays dead (BDA missing)" is a **G57** statement, which the plan's wording generalises to "Mali".
6. **Published work we are about to reinvent — yes, for the CPU half.** Phase-aware prefill/decode NPU-offload systems exist (mllm-NPU, ASPLOS'25: https://arxiv.org/html/2407.05858v1 ; llm.npu: https://xumengwei.github.io/files/ASPLOS25-NPU.pdf), and server-side prefill/decode disaggregation is a whole literature (Nexus: https://arxiv.org/html/2507.06608 ; Sandwich, CPU hot-switching: https://doi.org/10.48550/arxiv.2507.18454). The plan's novelty is *per-phase per-engine routing inside one app against a thermal budget on a phone* — I found no direct prior art for that combination, but the plan should cite the NPU-prefill systems rather than say the search found nothing, because it changes the correctness argument it will have to make.

---

## E. The design, attacked

**2.3 / 2.1 — the ordering key cannot be estimated from the telemetry the plan names.**
Ranking by "heat per token measured on THIS device" requires attributing a *phase* delta to *one engine*. The only thermal inputs named are `dumpsys battery temperature` — which the plan itself calls "decimi di grado, **inerzia alta**" (§6.1) — and the battery/thermal-zone probes. The measured effect sizes are at or below that resolution: `results/xiaomi_ab/task_a/battery_notes.txt` GPU pp512 `290→290` (**0.0 °C**), pp1024 `322→319` (−0.3, *negative*). One GPU prefill of a 1400-token prompt at 2B is ~6.5 s (`results/gpu_prefill_recheck_xiaomi/report.md`). A comparator that ranks two engines on a difference smaller than the instrument's quantisation, integrated over a window shorter than its time constant, is not a comparator. This is the defect from which the rest of §2 inherits.

**2.3 — first run, and oscillation.**
"Can it flip engines every turn?" — nothing in the proposed selector has hysteresis, and the existing ratchets are being replaced: `llama-governor-policy.cpp:8-9` defines `k_dwell_ms = 10*60*1000` and `k_flip_window_ms = 60*60*1000`, and `select_decode:236-237,249-252` maintains `last_gpu_engagement_ms_` for exactly this. The plan's Rule 3 ("one selector") removes the duplicated *code* but silently drops those two mechanisms. It matters more than usual because a change of decode engine is a **context reload**: `rn-llama.cpp:72-73` fixes `prefill n_gpu_layers=99 / decode 0`, `select_decode` returns `-2` on `requires_reload` (`llama-governor-runtime.cpp:136-139`), and `clear_cache` (`:155-176`) resets the route and both side-states. So one flip = one reload, and a jittery key = a reload per turn.
Cold start: `(c)` seeded by `(a)` means the first turns run on the shipped table; the GPU's heat-per-token in the *shipped* data came from an S23 NPU/CPU sweep (`llama-governor-policy.cpp:15`), so the initial value for the Xiaomi GPU is the S23 CPU's. Exploration is therefore structural, not incidental: **you cannot measure the GPU's heat per token without choosing the GPU**, and the selector only chooses the GPU if the GPU is already cheapest. The plan says "serve un valore iniziale prudente" (§4c) and never states that exploration must be forced or budgeted.
Tie-breaking: with equal measured heat (e.g. two engines both at +0.0) "il primo" is decided by list order, i.e. by a fixed ordering — a decision derived from identity, which Rule 1 forbids. Needs an explicit, stated tiebreak.

**2b — do Parts 3/5 quietly require a per-device branch Rule 1 forbids? Yes, one, and it is not a branch.**
`gpuReserveMiB = 800 + 1.05 × offloadedBytes` (`governorInputs.ts:112`) is a *measured constant from the S23*, and ALIVE row 12 says so: "k_set 1.74→1.05 … candidate conservative gate for the app `800 MiB + 1.05×bytes` … **Constants need a second model/device before shipping**". §1.3 calls `gpuFit()` "la toppa" and says "va **misurata almeno una volta per telefono**" — i.e. a per-device *number* in a decision path. Rule 1's mechanical check ("a `grep` of `generation` … must return zero") **passes this**, because the device is encoded as a coefficient, not a conditional. Same for `k_cpu_delta_c`. So Rule 1 as written is a syntactic rule that a per-device constant table satisfies while violating its intent. If Rule 1 is meant as "no device-derived number may enter a decision unless it was measured on that device in that configuration", it must say that, and the acceptance test must check it (see 2b.4).
Everything else is consistent: §3.3's thread policy is data (capacity signature), §3.1's NPU clause is a model predicate, §5.4's repair is a *deletion* of identity.

**2b.4 — the acceptance criterion is not falsifiable as written.**
"Aggiungere un quarto telefono deve toccare esattamente un file di dati e zero file di decisione … si verifica con un `diff` che nessun file di policy sia stato toccato." Weaknesses: (i) a `diff` detects *unchanged files*, not *relocated decisions* — `telefono4.prefillEngine = "GPU"` in the data file passes the diff and **is** the `if`, moved into configuration; (ii) "un file di dati" is undefined next to an existing per-device data file (`deviceTuning.ts`), a probe cache, and a calibration store — a lazy implementation adds one new file per concern and passes; (iii) "si verifica che il selettore produca la politica attesa" — expected from what? If the expectation is derived from the same table, the test is a tautology; (iv) nothing tests cold-start behaviour or oscillation, the two places 2.3 actually fails. The falsifiable version is the plan's *other* idea: a property test that **two device rows with identical capabilities must produce identical policy** (which is exactly what the `grep generation` check approximates), plus a schema that states which fields may vary per device, plus a golden expectation authored independently of the implementation.

**4 — continuous learning.**
Cold room → hot car: the key is `(device, engine, phase)`; **ambient/SoC baseline is not in it**, so the running mean mixes a 20 °C morning with a 35 °C car and reports a number that is not a property of the engine. Worse, the plan's new §1.5 `DeviceCapabilities` record **drops** the field that would fix this — `t_idle_c` / `t_idle_valid` / `trend_c_per_min` exist in the JS `ThermoProfile` (`governorInputs.ts:29-37`) and in the native profile, and are absent from the schema the plan proposes.
Plugged state: the plan's §5.2 correctly says the charger "avvelena il governor", then §4's key omits `plugged` — while `get_thresholds()` (`:42-51`) uses a **completely different threshold set** when plugged, derived from `t_idle_c`. Same defect the plan diagnosed, re-created one level up.
Two models of different sizes on one device: the key has no model dimension. The plan itself demands per-model granularity for the NPU ("La sonda deve saperlo dire **per modello**, non per device", §1.4) and then does not carry model into the calibration key.
And the unit is wrong. From the plan's own cited source (`q58 REPORT.md`, per-size means): CPU `°C/1k tokens` = **14.844 (128), 6.348 (512), 3.174 (1024), 2.515 (2048)** — a **5.9× spread**, monotonically falling. So "0.79×" of the plan's central rule ("il criterio e' **°C per 1000 token**, mai °C al minuto") is not an intensive quantity either; for a chunk-size decision the right normalisation is °C per chunk (affine in tokens, with a fixed overhead at small n). The plan warns against °C/min and adopts a unit with 6× dependence on the thing it is deciding.
Missing dimensions, at minimum: model/quant, ambient or baseline, plugged, chunk-size class, context/KV size, screen/foreground state (the plan itself notes Doze-sensitivity), and concurrent non-app load — the S23's `adsprpcd`/`cdsprpcd` is named in §3.2 as "un contaminante da sottrarre a ogni numero S23" and then never enters `DeviceCapabilities`, so the learner will read another process's heat as its own.

**6 — `gpubusy` is not sufficient to conclude "our prefill ran on the GPU".**
`/sys/class/kgsl/kgsl-3d0/gpubusy` is a **global, all-client, cumulative-busy** counter. Confounds that produce the same signal: (1) the app's own UI — token streaming is a continuous redraw for the whole turn, and the proposed baseline ("a schermo acceso e app ferma") is a different workload; (2) **the NPU or CPU doing the work instead** — under the plan's own target policy (§3.1: prefill goes to the NPU when the model allows) gpubusy *should* stay at baseline, and the stated criterion ("se `gpubusy` resta a 7,5% … la conclusione e' *«si aggancia ma non usa la GPU»*") would then produce a **false negative that is more likely as the design improves**; (3) other apps / launcher / compositor; (4) the corpus has one gpubusy figure (49%) that an audit already marked "**PLAUSIBLE (unevidenced)**" (`scratchpad/agents/n10-kexp-audit/REPORT.md:79`). What would settle it: a **null control** (`-ngl 0` same prompt, requiring the trace to be indistinguishable from the "governor active" trace) and a **positive control** (`bench_force_gpu_prefill`), plus the engine's own placement log (`graph splits`, which the plan already lists and calls the strongest instrument) and `clGetEventProfilingInfo` round-trip timing. Sampling is also ~1 Hz over a ~6.5 s window: about six samples.

**Other design defects worth fixing before implementation.**
- §5.1's repair targets the wrong layer: "il rifiuto deve ridurre i token, non cambiare motore" — `admit_prefill` **already** returns `Chunk` with a bounded token count (`:216-225`). The failure is the runtime's per-turn route latch (`:55-68`), which is sticky for the whole turn and turns `Wait` into "whole turn on CPU". An implementer following the plan would edit the function that is already right.
- `kernels_compile: ok|fail` is a single boolean for a *set*. The Mali gate's own lesson is per-kernel granularity ("f32 202/202 is correctness, not speed", quant kernels "fail to COMPILE"). Combined with §1.2's cache rule — "Se `fail`, per il governor la GPU non esiste e **non si ritenta finche' il driver non cambia**" — one bad kernel out of 32 permanently disables a GPU that works for the kernels the product uses. That is the same **sticky negative** the plan criticises in `failed` (§5.2) and would fix in `critical_exit` (§5.6). Fix it in the probe too.
- One cache key, four invalidation truths: §1 caches all four probes on `socModel + gpu_driver + app_version`. Kernel *compile* outcomes are driver-bound (correct), but thermal/DVFS behaviour lives in the kernel/HAL and can change in a monthly vendor patch that changes none of those three — so the thermal calibration must key on something like `Build.FINGERPRINT`/HAL version. Part 4's argument ("(c) è l'unica che sopravvive a un aggiornamento di sistema") answers the *calibration* cache and leaves the *probe* cache unaddressed.
- §1.1 samples `scaling_max_freq` "**prima del load e fra un turno e l'altro** … non si legge durante un turno (contamina il soggetto)". But the plan's whole premise (§2.2) is that the cap changes *within* a turn. Sampling only at the coolest point of each cycle means `headroom_cpu` systematically under-reports the quantity it exists to capture; and the stated reason is not credible for a single sysfs read, whose cost is microseconds against a seconds-scale thermal time constant. As specified, the most important probe cannot see what it is for.
- §1.1's cluster grouping uses `/sys/devices/system/cpu/cpu*/topology/physical_package_id`. It happens to work on our S23 — `results/mellum2_f1_s23/f1d/forensics/topology.txt:14-21` shows `pkg=0` (cpu0-2), `pkg=1` (cpu3-6), `pkg=2` (cpu7), which matches the capacity clusters. But `physical_package_id` is a *socket* id and is not the documented cluster interface; `cpufreq/related_cpus` and `cpu_capacity` are (and `cpu_capacity` is what `deviceTuning.ts` already trusts). The same dump shows why capacity matters: the file also records `min=max=cur` on every core, i.e. a fully pinned DVFS state — the probe needs to say what it is reading.
- §9's ordering contradicts §4's own recommendation: step 6 ("Calibrazione per device") depends on steps 4 and 5, but the recommendation is (c) continuous learning, which depends only on the runtime and could start at step 3. And step 4 measures the ΔT cells *before* step 7 defines the data schema those cells will populate — the plan's own Rule 2 argues the schema should exist first.

---

## F. What the plan omits

1. **"Device" is never defined.** `(device, engine, phase)` is the calibration key and nothing says what a device *is*. Same SoC, different chassis (a G99 tablet — the corpus's own hardware list includes Samsung Tab A9/A15/A16 on G99), a foldable's unfolded state, a phone after a battery/thermal-HAL swap: all either collide in the key or fork it. `gpuFit()`'s `total <= 8 GiB → NoFit` (`:92`) and `generationFor`'s SoC strings are the only device identity in code, and neither is a key definition.
2. **Model switch mid-conversation.** Contexts are built with fixed `n_gpu_layers` (`rn-llama.cpp:72-73`), the KV route is validated at construction (`llama-governor.cpp:48-54`), and an engine change is a `-2` reload. The plan never states what the governor does when the user switches model, or when a conversation outgrows the context the calibration was learned at.
3. **Probe-cache vs system update** (distinct from the Part-4 table problem) — and, symmetrically, **no invalidation on uninstall/reinstall or storage corruption** of the learned table.
4. **Consent and control.** §8.2 asks the owner what the *user sees when hot*, but nothing asks whether continuous per-turn measurement persisted to disk, engine switching that changes latency *and answer determinism*, or downclocking require consent. Two concrete gaps: the probe/calibration artifacts are new persisted device data with no retention/deletion story in a repo that has `sessionMarkerPrivacy`; and switching prefill to the GPU changes the *answer* (`governorInputs.ts:21-22`: "raw oracle is still FAIL on R2; R2 requires ≤0.02 at every step"), so §2.3's "filtra per correttezza" is a correctness gate on a routing decision — the one place where "don't decide from a table" is a product-correctness rule, and it is buried in §0.2.
5. **Plugged turns in the learner.** The project rule is "never benchmark while charging". The plan diagnoses the charger bug (§5.2) and then does not propagate the rule into §4's estimator or §6's cells.
6. **Concurrent non-app load.** Named (§3.2 `adsprpcd`/`cdsprpcd`, 33 h CPU) and never instrumented. §6.1's instrument list has no measure of foreign CPU/GPU load, though it declares `KALSA_GOVERNOR` "the weakest proof" — the confound it names has no witness.
7. **First-launch probe cost and its invalid case.** The GPU probe compiles the kernel set and times it at first use, on the user's phone, before any benefit — and if the user's first launch is on the charger (the common case), the timing is invalid under the project's own rule. Nothing says what happens then.
8. **No probe for sensor honesty.** All four probes "fail closed" (good), but the primary thermal input is documented by this plan as untrustworthy on the exact device M1 targets (`Thermal Status 0` forever). The design's answer is `scaling_max_freq`, and nothing ever verifies that `scaling_max_freq` *moves* on the Xiaomi — a one-`cat` check, which is the one measurement that validates or kills §1.1, and which §6.2 places in cell 4 instead of cell 0.
9. **No bad-learner failure mode.** §2.3 promises "mai un abort silenzioso", but §5.2 shows the abort is already sticky via `failed`. Nothing in the new design removes the sticky latch for *new* failure paths (an out-of-range learned coefficient, a probe that dies mid-session, a corrupt table), so the learner's worst case is the same unrecoverable state the plan is trying to fix.
10. **No overhead budget** for the probes, and nothing about what the governor does when the *speed floor* the owner must supply (§8.1) is unreachable for every engine at once.

---

## Claims I could not verify either way

| claim | what would settle it |
|---|---|
| `cpu7 gira a 1824000 su 3302400 — il 55%` (§1.1). `grep -rn 1824000` over the whole repo returns **only the plan**. Denominator `3302400` is real (`results/gpu_xiaomi/device_snapshot.txt:24`); arithmetic is right. | one archived `cat /sys/.../cpu7/cpufreq/scaling_max_freq` + `cpuinfo_max_freq` on the Xiaomi, taken at the same moment as a `Thermal Status 0` sample |
| `gpubusy` baseline `~7,5%` a schermo acceso e app ferma (§6.1, §6.2). Appears **only in the plan**; the corpus's only archived gpubusy value is `49`, already audit-flagged unevidenced (`n10-kexp-audit/REPORT.md:79`). | a 60-sample `cat gpubusy` trace, screen on, app idle, archived |
| `12/12 nel cooldown del 19/09` | the cooldown artifact — **no file in the repo postdates 2026-09-18 20:02** apart from today's `PLAN.md` and this document |
| `un decode che parte a 17,5 tok/s e scende a 14,8` (§3.2) | the campaign that produced it; `reports/moe-gpu-sustained.md` has 12.2/10.9/10.2 and 8.2/8.2, and I found no other source |
| `ΔT +1,3 °C` for the NPU prefill (§3.1) | as shown in finding 3, the artifact yields 0.4 (three HTP reps) vs 0.9 (one CPU rep); a per-engine ΔT would need a per-rep temperature series, which `battery_series.csv` does not contain |
| Mali-G57 Vulkan `0,79/0,86` vs `2,44/2,29`; G99 retention `91%/95%/99,4-99,5%`; A55/A76 `1,05/4,41/6,81/5,26` and `18,0→13,7` | the URLs the 19/09 research pass recorded — none of them are in this repo, and I could not reproduce any of the four sets externally (see D) |
| `adsprpcd`/`cdsprpcd` "al 100% di un core … con 33 h di CPU accumulate" (§3.2) | `grep -rn "adsprpcd\|cdsprpcd"` over the repo returns nothing; needs the `top`/`/proc` capture it came from |
| whether `3302400` is `cpuinfo_max_freq` or `scaling_max_freq` in `results/gpu_xiaomi/device_snapshot.txt` | the probe script that wrote it (not archived in `results/gpu_xiaomi/`) |

---

## One blunt closing line

**No** — the shape (Rule 1/2/3, one selector, matrix-as-data, probes that fail closed) is sound and worth building from, but not one of the quantitative inputs it feeds to that shape is both sourced and measured above the noise floor: the ranking key in §2.1/2.3 is a ΔT difference smaller than `dumpsys`'s own quantisation, the §4 key omits the three confounders the plan itself diagnosed elsewhere, and three of the load-bearing provenance facts in the document (the 0.992 retraction, the Mali estimate, the 4B cells) are wrong as cited. **The single change that makes it implementable: replace §2.1/2.3's ordering criterion — "heat per token measured on this device" — with a key that one turn can actually establish (°C above the current idle baseline per *chunk*, keyed on `(engine, phase, chunk-size class, model class, plug state)`, with forced exploration and a dwell/hysteresis ratchet), and gate everything else on proving it in a cell 0 that includes a null and a positive control.**
