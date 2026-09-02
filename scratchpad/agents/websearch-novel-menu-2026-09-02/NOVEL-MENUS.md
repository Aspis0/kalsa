# A1-novel — ricerca su pattern di menù/navigation mobile

**Data ricerca:** 2026-09-02  
**Target:** app chat React Native/Expo, Android+iOS, uso a una mano.  
**Contesto considerato:** drawer laterale sinistro con conversazioni/ricerca, Settings/Account/Documents/Notes e selector persona; il radial bottom-center a 5–8 voci è già considerato esistente e non viene proposto come novità.

## Sintesi esecutiva

Non è possibile dimostrare in senso assoluto che “nessuno abbia mai fatto” una certa interazione. È però possibile delimitare la novità rispetto a ciò che è documentato in HCI, nei sistemi operativi e nei prodotti mainstream.

Il risultato più netto della ricerca è:

- **Non è nuovo:** pie/radial menu, marking menu, gesto C-Swipe, floating orb, edge panel, menu contestuale da long-press, menù adattivo per frequenza, overlay assistant, UI diegetica, gooey/spring menu.
- **È plausibile come frontiera:** una superficie d’azione *stabile nella geometria ma dinamica nel significato*, con ranking predetto localmente dal contesto della conversazione; gesto continuo di hold-drag; fallback visivo sempre presente; azioni espresse come “intento + risultato” e non come categorie fisse.
- **Non trovato:** un prodotto mainstream o un paper che implementi esattamente un **main menu di chat mobile che si riordina/morfizza in tempo reale usando un LLM on-device da 1–4B**. Esistono invece i mattoni separati: App Intents predittivi, next-action prediction, GUI agents, action recommendation e menu adattivi.
- La combinazione più difendibile per A1-novel è quindi **LLM-predicted action field + menu a geometria costante + preview “perché questa azione” + undo/lock dell’utente**, con eventuale canale secondario edge/back/pressure solo come esperimento opzionale. Non chiamarla “mai vista” senza uno studio comparativo.

## Metodo e copertura

Sono state eseguite 14 tornate di ricerca, con oltre 50 query variate, su Google/ACM/archivi universitari/documentazione Apple-Google-Expo/GitHub. I filoni sono stati: HCI accademica, menu adattivi e loro contro-evidenza, OS/product 2023–2026, game UI, LLM-native UI, input alternativi e implementazioni tecniche.

Query rappresentative:

`FlowMenu`, `Hotbox Grossman`, `fisheye menus`, `pressure-based menu`, `speed-dependent pointing`, `control menus`, `gravity well menu`, `cursor-agnostic menu`, `adaptive menus Findlater McGrenere`, `predictive radial menu`, `LLM next action prediction UI`, `Dynamic Island Live Activities`, `visionOS ornaments`, `Liquid Glass`, `Android predictive back`, `Gemini overlay`, `Nothing Glyph`, `Samsung Edge Panel`, `diegetic UI Dead Space`, `companion orb UI`, `M3 Gesture Menu`, `EdgeMark`, `BackSwipe`, `CountMarks`, `React Native gooey menu`, `Expo physics radial menu`.

**Esiti negativi rilevanti:** per le query esatte `"working menus" CHI UIST menu interaction` e `"cursor-agnostic menu" HCI` non è emerso un pattern di menu accademico pertinente e verificabile nel periodo richiesto. Sono emersi risultati omonimi o non pertinenti; perciò: **non trovato** come tecnica specifica. Il concetto utile più vicino è l’azione contestuale/target-aware e il menu che segue il punto di interazione, già coperto da Hotbox, fisheye, FlowMenu e dai moderni GUI agents.

## 1. Inventario di ciò che esiste già

### 1.1 Radial, pie e marking menus — esclusi dalla pretesa di novità

| Pattern | Cosa fa | Perché non è nuovo su mobile mainstream | Fattibilità RN/Expo |
|---|---|---|---|
| **Pie/radial menu** | Voci disposte alla stessa distanza dal centro; la selezione usa angolo e distanza costante. Il lavoro CHI’88 documenta vantaggi di target size e minor drift rispetto ai linear menu. [Callahan et al., 1988](https://www.cs.umd.edu/~ben/papers/Callahan1988empirical.pdf) | Il radial menu è già il progetto di riferimento dichiarato e compare soprattutto in giochi/controller e assistive UI. [Steam Radial Menus](https://partner.steamgames.com/doc/features/steam_controller/radial_menus?l=english) | Geometria, hit-testing e animazione: `react-native-gesture-handler` + Reanimated. Nessun modulo nativo custom. [Expo gestures](https://docs.expo.dev/tutorial/gestures/) |
| **Marking menu** | La prima volta mostra le voci; l’utente esperto esegue direttamente una traccia direzionale memorizzata. La gerarchia usa zig-zag o sequenze. [Kurtenbach & Buxton](https://www.billbuxton.com/MMExpert.html) | È una tecnica HCI classica; AssistiveTouch consente anche gesti registrati personalizzati. [Apple AssistiveTouch](https://support.apple.com/en-us/111794) | Pan gesture e classificatore geometrico in worklet; occorre anche rendere ogni azione accessibile come elemento nativo. [RN accessibility actions](https://reactnative.dev/docs/accessibility.html) |
| **FlowMenu / control menu** | Un singolo gesto unisce scelta del comando, inserimento di parametri e manipolazione continua; FlowMenu ritorna al centro tra i livelli. [Stanford FlowMenu](https://hci.stanford.edu/research/flowmenu/), [Control Menus](https://biblio.telecom-paristech.fr/cgi-bin/download.cgi?id=2765) | È una variante avanzata del marking/radial, non un nuovo modello di navigazione mobile. Il suo input originario è pen/stylus o mouse, non il pollice su una chat. | La versione visuale è fattibile con Reanimated. Parametri continui e classificazione del path sono JS/worklet; serve attenzione a conflitti con ScrollView. |
| **Hotbox** | Menù “a zone” attivato da un tasto, con più command set sovrapposti, marking zones, menubar e capacità elevata. [Kurtenbach et al., 1999](https://www.research.autodesk.com/publications/the-hotbox-efficient-access-to-a-large-number-of-menu-items/) | È un mega-menu desktop di Maya/Mudbox, non una scoperta mobile; il concetto “le funzioni arrivano al cursore” è già documentato. [Maya Hotbox](https://help.autodesk.com/cloudhelp/2026/ENU/Maya-Customizing/files/GUID-751407E4-7728-463F-9806-954AC3B72279.htm) | Layout a zone + overlay RN. La densità desktop non va trasferita direttamente al thumb. |
| **Fisheye menu** | Una lista lunga resta tutta visibile: la zona vicina al dito/cursore si ingrandisce, il resto si comprime. Gli utenti preferivano il fisheye per browsing ma la gerarchia per task goal-directed. [Bederson, 2000](https://www.cs.kent.edu/~jmaletic/softvis/papers/Bederson00.pdf) | È una soluzione nota al problema delle liste lunghe; non è mainstream mobile, ma non è una nuova famiglia di menu. | Scala/traslazione/font animati con Reanimated. Testare leggibilità, layout instability e VoiceOver/TalkBack. |
| **C-Swipe** | Semicerchio naturale col pollice, “C” a destra e reverse-C a sinistra; può essere swipe-and-release o swipe-and-hold, con overflow e sub-menu. [Descrizione e codice](https://www.smashingmagazine.com/2013/03/c-swipe-navigation-on-android/) | È già una proposta mobile esplicita del 2013 e coincide con molte varianti del radial bottom/edge menu. | Il riconoscimento del path può stare in Gesture Handler/Reanimated. Il testo originale cita soglia e classificazione Android; oggi non serve un modulo nativo custom, ma serve un fallback tappabile. |

### 1.2 Pattern OS/product già occupati

| Pattern | Cosa esiste oggi | Novità relativa | Fattibilità |
|---|---|---|---|
| **Dynamic Island / Live Activity** | Presentazioni minimal, compact, expanded e Lock Screen per attività persistenti; l’utente può espandere/collassare. [Apple HIG Live Activities](https://developer.apple.com/design/human-interface-guidelines/live-activities?changes=_3) | È un canale di stato/attività persistente, non un main menu in-app. “Pillola che si espande” non è una novità sufficiente. | Richiede WidgetKit/ActivityKit e codice nativo iOS; non è portabile ad Android né equivalente a un menu dentro React Native. |
| **Liquid Glass / morphing controls** | Apple documenta materiali reattivi, menu che si espandono da toolbar e controlli che cambiano forma durante l’interazione. [WWDC25](https://developer.apple.com/videos/play/wwdc2025/219/), [Adopting Liquid Glass](https://developer.apple.com/documentation/TechnologyOverviews/adopting-liquid-glass?changes=latest_major%2Clatest_major) | È una lingua visuale e una transizione di superficie, non una logica di navigazione nuova. Un blob liquido o un bottone che si gonfia è quindi già “visto”. | Blur e spring sono fattibili; filtri SVG nativi hanno supporto parziale. `react-native-svg` supporta `FeGaussianBlur` e `FeColorMatrix`, ma non tutti i filtri. [SVG filters](https://github.com/software-mansion/react-native-svg/blob/main/USAGE.md) |
| **visionOS ornaments** | Controlli e informazioni restano ancorati alla finestra, senza coprire il contenuto; possono stare su qualsiasi bordo e rimanere visibili. [Apple Ornaments](https://developer.apple.com/design/human-interface-guidelines/ornaments?changes=l_8) | È un buon precedente per un “companion rail” ancorato al contesto, ma non è disponibile su iOS/iPadOS. | Il modello spaziale va reinterpretato in 2D; l’API ornament è nativa visionOS e non trasferibile in Expo. |
| **Android predictive back** | Lo swipe mostra in anticipo la destinazione prima del commit; Android 15 lo rende una superficie da supportare e Android 16 estende il preview ai tre-button. [Android docs](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture), [Android 16](https://android-developers.googleblog.com/2025/06/android-16-is-here.html) | È un pattern di preview/commit molto rilevante per A1-novel, ma è “back”, non menu. | Serve integrazione React Navigation/AndroidX e test nativo; non reinventare il back come menu senza preservare la semantica di sistema. |
| **Samsung Edge Panel** | Handle spostabile sul bordo per app/funzioni frequenti, con pannelli personalizzabili. [Samsung design reference](https://www.design.samsung.com/global/contents/se9/download/SE9_pdf_en.pdf) | Edge access e handle sono già mainstream OEM; un drawer che nasce dal bordo non è nuovo. | Dentro l’app: Reanimated. Fuori dall’app/OEM-wide: non disponibile a una normale app Expo. |
| **Nothing Glyph** | LED/back display con pattern associati a notifiche e suoni; il telefono può comunicare anche a faccia in giù. [Nothing support](https://support.nothing.tech/hc/en-us/articles/43227904206097-What-is-the-Glyph-Interface) | È un precedente di canale posteriore/ambientale, non di menu touch universale. | Su hardware Nothing si dipende da SDK/OEM; per iPhone/Android generico non è una superficie disponibile. |
| **Gemini overlay** | Assistant richiamabile sopra un’altra app, con comprensione dello schermo, suggerimenti contestuali e drag/drop di output. [Google](https://blog.google/products-and-platforms/platforms/android/android-gemini-google-ai/), [support](https://support.google.com/gemini/answer/14554984?hl=en-GB) | Overlay contestuale e “Ask about this screen” sono già un prodotto mainstream; non basta fare una bolla AI. | Overlay dentro la propria app: RN. Assistente sopra altre app: ruolo/permessi OS e integrazione nativa; non è un normale componente Expo. |
| **App Intents / PredictableIntent** | Apple può ricevere azioni strutturate dell’app, indicizzarle e suggerirle in Siri, Spotlight, Shortcuts, widget e altri contesti; `PredictableIntent` dichiara predizioni di intent. [App Intents](https://developer.apple.com/documentation/appintents), [PredictableIntent](https://developer.apple.com/documentation/appintents/predictableintent?language=o_9) | Dimostra che la predizione di azioni app è già una capability OS, ma fuori dal canvas del main menu. | Richiede App Intents/Swift e probabilmente config plugin/native bridge in RN. Non consente di delegare a iOS il layout dinamico del menu in-app. |

### 1.3 Game UI già esistente

| Pattern | Evidenza | Valutazione |
|---|---|---|
| **Diegetic UI** | In Dead Space map, menu e inventory sono integrati nel mondo/nel RIG del personaggio; la UI non è solo overlay esterno. [GameDeveloper analysis](https://www.gamedeveloper.com/design/diegesis-and-designing-for-immersion) | È una grammatica narrativa forte, già canonica. Per una chat si può usare un oggetto/“companion” coerente col mondo, ma l’idea diegetica in sé non è nuova. |
| **Radial/weapon wheel** | Steam documenta radial menu per armi, spell, hotkey e MMO; il genere console ne fa uso estensivo. [Steam](https://partner.steamgames.com/doc/features/steam_controller/radial_menus?l=english) | Escluso come proposta nuova. |
| **Companion orb** | Prodotti AI desktop usano un orb persistente, trascinabile, espandibile a pannello e dotato di quick actions. [EnConvo Companion Orb](https://docs.enconvo.ai/features/companion-bar) | Un orb come trigger non è nuovo; può diventare interessante solo se è una superficie di stato/preview con semantica predetta, non una semplice FAB animata. |
| **FTL/Hades e “hot-wheel” specifici** | Nella ricerca non è stata trovata una fonte tecnica primaria che documenti un loro pattern di menù come contributo HCI distinto. | **Non trovato** come evidenza comparabile; non usarli come prova di novità o come citazione tecnica senza fonti di design specifiche. |

## 2. Meccaniche di frontiera (5–10), con fonti e fattibilità

Le seguenti sono famiglie che hanno precedenti verificabili, ma che possono essere ricombinate in modo più originale per A1-novel. La “novità” è una valutazione progettuale, non un fatto dimostrato.

### A. Action field predetto dall’LLM, geometria stabile

**Meccanica:** un anchor sempre nello stesso punto raggiungibile dal pollice apre 4–6 slot. La geometria, i gesti e almeno un’azione “More” restano fissi; il modello cambia solo il ranking e il contenuto semantico degli slot in base a conversazione, stato del modello, allegati, ultimo gesto e storico locale. Ogni slot mostra un verbo concreto (“Salva in Note”, “Cita fonte”, “Riformula”, “Apri documento”) invece di una categoria generica.

**Fonti:** `SummAct` tratta la next-action prediction come scelta fra elementi UI e operazioni e migliora i risultati usando una sintesi della traiettoria dell’obiettivo. [CHI 2025](https://doi.org/10.1145/3706598.3713190). Il lavoro NAP 2026 rilascia una pipeline su 360K azioni e 1.800 ore di uso telefonico di 20 utenti. [Learning Next Action Predictors](https://arxiv.org/abs/2603.05923). Apple documenta intent predittivi e donazioni di azioni, ma in system surfaces. [PredictableIntent](https://developer.apple.com/documentation/appintents/predictableintent?language=o_9)

**È già mainstream?** No, non è stata trovata evidenza di un’app chat mainstream che usi un LLM locale per rimappare il proprio main menu. È però già visto il concetto più debole di menu adaptive/frequency-based e di suggerimento di azioni.

**Fattibilità:** alta se il modello classifica/rankizza una lista di azioni predefinite. RN/Reanimated gestiscono UI e animazione; il modello locale produce JSON ristretto o logits su action IDs. Non lasciare al modello la generazione libera di label, route o codice. Native module non necessario per il menu; può servire per il runtime LLM già presente o per telemetry/sensori.

**Giudizio A1-novel:** **alto potenziale, ma la novità è nella combinazione e nella policy di stabilità**, non nel solo “AI suggerisce azioni”.

### B. Preview–commit semantico, non semplice apertura

**Meccanica:** hold sull’anchor e drag; mentre il dito si muove, ogni candidato mostra non solo l’icona ma il risultato previsto (“crea nota da questo passaggio”, “cerca nel PDF”, “continua con persona X”). Release esegue; ritorno all’anchor annulla. La UI si comporta come predictive back, ma applicata a un’azione positiva.

**Fonti:** predictive back usa un’anteprima prima del commit. [Android predictive back](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture). FlowMenu e control menus uniscono selezione e manipolazione nel gesto continuo. [FlowMenu](https://graphics.stanford.edu/papers/FlowMenu/flowmenu.pdf), [Control Menus](https://biblio.telecom-paristech.fr/cgi-bin/download.cgi?id=2765)

**È già mainstream?** Preview di link, context menu e back sono comuni; un’anteprima di *intento generato dal modello* durante un hold-drag in una chat non è stata trovata.

**Fattibilità:** alta per preview locale e release-to-commit; il risultato LLM va calcolato prima o mentre il menu è aperto. Usare cancellazione e timeout per evitare che l’inferenza blocchi il gesto.

### C. M3-style command traces, ma ancorate al contesto chat

**Meccanica:** niente settori radiali. Si tiene premuto un piccolo anchor e si disegna una forma breve su una griglia 2×3 o 3×3; la stessa forma può essere mostrata come tile per i novizi e memorizzata come gesto per gli esperti. Il contenuto dei tile è contestuale, mentre la grammatica della forma resta stabile.

**Fonte:** M3 Gesture Menu usa una griglia, forme gestuali invece di direzioni radiali e spazio costante; lo studio riporta performance esperta circa due volte migliore rispetto ai marking menu tradizionali e passaggio a recall dopo tre sessioni di pratica da dieci minuti. [Google Research / CHI 2018](https://research.google/pubs/m3-gesture-menu-design-and-experimental-analyses-of-marking-menus-for-touchscreen-mobile-interaction/)

**È già mainstream?** No, M3 è ricerca; marking/gesture shortcut sì. Non è però “mai visto” nel senso HCI.

**Fattibilità:** alta con Gesture Handler + Reanimated. Registrare path normalizzato, quantizzare celle e mantenere sempre un tap/scroll/accessibility fallback. Non usare il gesto come unico accesso.

### D. EdgeMark / command strip curvo a una dimensione

**Meccanica:** un bordo laterale o inferiore diventa una striscia 1D: hold, poi scorrimento corto lungo il bordo; la preview “si srotola” nella zona raggiunta e la release seleziona. È un menu per il pollice, non un arco circolare completo.

**Fonte:** EdgeMark è un menu gestuale 1D per smartphone waterfall-edged, progettato per invocazione rapida e discreta a una mano. [NRC / MobileHCI 2021](https://nrc-publications.canada.ca/eng/view/object/?id=c7021cfc-ac81-4bf1-8afd-98231f78d4cf)

**È già mainstream?** Edge panels e swipe edge sì; EdgeMark come menu 1D studiato non è una convenzione mainstream.

**Fattibilità:** alta in-app, con `hitSlop`, safe-area e pan gesture. Il bordo di sistema Android/iOS può rubare il gesto: occorre una zona interna, un’attivazione con hold e supporto per il lato sinistro/destro.

### E. Canale posteriore: grip/BackSwipe/BackTap come “secondo pollice”

**Meccanica:** il pollice resta sul contenuto; indice o dita sul retro inviano un comando breve o una forma. Il menu visibile davanti può rimanere fermo mentre il retro sceglie “mode”, “next action” o confirm.

**Fonti:** BackSwipe usa word-gesture sul retro per comandi e testo a una mano, riportando 92% di accuratezza media sui comandi. [CHI 2021 / PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8887869/). BackXPress usa pressione delle dita sul retro come quasi-mode temporanea. [RWTH CHI 2017](https://hci.rwth-aachen.de/backxpress). BackTap propone quattro punti di tap sul retro per uso eyes-free. [UST 2013](https://www.researchgate.net/publication/262323014_BackTap_Robust_four-point_tapping_on_the_back_of_an_off-the-shelf_smartphone). MagPie porta l’input posteriore in un accessorio MagSafe modulare. [CHI 2025 summary](https://hci.top/en/papers/chi/189569/2025)

**È già mainstream?** No per app generiche; Nothing Glyph e alcuni accessori sono precedenti hardware, ma non una superficie posteriore universale.

**Fattibilità:** bassa con solo Expo e telefono standard. Serve accessorio, rear display/touch, sensori OEM o modulo nativo specifico. Per un MVP si può simulare con un secondo touch target/accessory; non venderlo come cross-platform.

### F. Pressione e livelli force-aware

**Meccanica:** tap leggero = preview, pressione mantenuta = apertura, pressione/drag più forte = cambia livello o “commit forte”. La pressione può controllare un parametro continuo, non solo aprire un menu.

**Fonti:** uno studio MobileHCI ha misurato menu a pressione con FSR: 85% di accuratezza con feedback visivo, 74% eyes-free, fino a 10 livelli distinguibili con feedback adeguato. [Wilson, Stewart & Brewster](https://www.dcs.gla.ac.uk/~stephen/papers/MobileHCI2010_graham.pdf). Apple 3D Touch esponeva force e quick actions, ma il supporto è storico e non universale. [Apple 3D Touch APIs](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/Adopting3DTouchOniPhone/3DTouchAPIs.html). Android espone un campo `pressure` normalizzato, con calibrazione dipendente dal device. [AOSP touch devices](https://source.android.com/docs/core/interaction/input/touch-devices)

**È già mainstream?** Il long-press/haptic feedback sì; la pressione continua cross-device no. La storia di 3D Touch è anche un warning sulla scarsa adozione di una modalità invisibile.

**Fattibilità:** non affidabile come core iOS+Android. Servirebbe un adapter nativo e fallback temporale; Expo Go non è una garanzia per force raw. Usare pressione solo come enhancement sperimentale.

### G. Motion/tilt + menu audio spaziale

**Meccanica:** inclinare o ruotare leggermente il telefono naviga tra candidati; audio/haptics annunciano posizione e confini. Può essere un canale eyes-free o una modalità “phone in mano mentre si cammina”.

**Fonti:** un menu a sfera con accelerometri, tilt e audio 3D ha mostrato selezione eyes-free fattibile con target dinamicamente ridimensionati. [Kajastila, Lokki et al.](https://scispace.com/papers/a-gesture-based-and-eyes-free-control-method-for-mobile-4u4650hz4q). Motion Marking Menus usa gesti di movimento per 19 comandi e utenti con disabilità visiva. [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1071581909000226). L’opposto importante: un test audio-tattile su mobile ha trovato selezione significativamente più lenta. [BCS HCI 2014](https://www.scienceopen.com/hosted-document?doi=10.14236%2Fewic%2FHCI2014.33)

**È già mainstream?** Assistenti vocali e haptics sì; un menu di navigazione basato su tilt+audio no.

**Fattibilità:** `expo-sensors` copre accelerometro/giroscopio; Gesture Handler/Reanimated gestiscono stato visuale. [Expo SDK](https://docs.expo.dev/versions/latest/). Audio 3D, soglie calibrate e background sensing richiedono lavoro nativo/energetico. Deve essere una modalità opzionale.

### H. Menu fisico/liquido con attrazione magnetica e blob

**Meccanica:** i candidati si attraggono verso il dito, si fondono in una membrana e si separano in base a velocità/distanza; il menu è più “campo di particelle” che ring.

**Fonti:** esistono implementazioni web gooey con blur + color matrix. [CodePen](https://codepen.io/nyousefali/pen/wvGKXrR?anon=true&view=pen). Esistono menu radiali con spring, attrazione magnetica e arco position-aware. [Uno Platform](https://platform.uno/discover/radial-menu-with-spring-physics/). In RN/Expo esiste un menu hold-drag tipo Pinterest con Reanimated 4, haptics e zero native code. [react-native-halo-menu](https://github.com/thegruber/react-native-halo-menu)

**È già mainstream?** Gooey FAB e spring menu sono molto già visti nella dev/design community; non sono una novità di interazione. Possono però rendere riconoscibile l’A1-novel.

**Fattibilità:** spring/magnetic layout: alta con Reanimated. Gooey native: media; `react-native-svg` supporta alcuni filtri ma non tutti, e il risultato può costare frame/batteria. Considerare Skia o semplice composizione di cerchi come fallback. [react-native-svg filters](https://github.com/software-mansion/react-native-svg/blob/main/USAGE.md)

## 3. LLM-predicted menus — sezione prioritaria

### 3.1 Cosa è stato trovato davvero

| Evidenza | Cosa dimostra | Cosa **non** dimostra |
|---|---|---|
| **Apple App Intents / PredictableIntent** | Un’app può dichiarare azioni, parametri ed entità; il sistema può usarli per suggerimenti e predizione, anche con donazioni di interazioni. [App Intents](https://developer.apple.com/documentation/appintents), [Apple Intelligence](https://developer.apple.com/documentation/technologyoverviews/apple-intelligence/) | Non è un API per far riordinare a un LLM il menu visuale dentro una schermata React Native. |
| **SummAct, CHI 2025** | La storia di azioni + sintesi dell’obiettivo migliora la previsione della prossima UI action; la predizione è una scelta fra candidati strutturati, non generazione arbitraria di UI. [DOI](https://doi.org/10.1145/3706598.3713190) | È valutato su GUI/web e modelli addestrati; non è un menu di chat mobile pronto all’uso. |
| **Learning Next Action Predictors, 2026** | Esiste una direzione recente verso predittori personali longitudinali su azioni reali di smartphone, con dataset e pipeline privacy-aware. [arXiv](https://arxiv.org/abs/2603.05923) | È ricerca su raccolta/modellazione e non prova di un prodotto mainstream con menu morfizzante. |
| **Context-aware action recommendation chatbot** | Un prototipo ha prima offerto raccomandazioni d’azione proattive e poi le ha integrate in un chatbot; il modello era su server interno, con test dogfood. [ACM CUI 2025](https://doi.org/10.1145/3719160.3736637) | Non è on-device 1–4B e non è una navigazione principale con ranking per gesto. |
| **Dynamic Planning / GUI agents** | Gli LLM possono pianificare e predire azioni su smartphone GUI; il planning dinamico migliora benchmark e riduce fallimenti rispetto a piani lunghi. [EMNLP Findings 2024](https://aclanthology.org/2024.findings-emnlp.70.pdf) | Un agente che aziona una GUI non equivale a un menu che assiste un umano. |
| **Adaptive UI con RL** | Un policy model-based può cercare adattamenti conservativi, evitando cambiamenti costosi o subottimali. [CHI 2021 preprint](https://luis.leiva.name/web/docs/papers/adaptivemenus-chi2021-preprint.pdf) | Non fornisce una soluzione specifica per LLM locale o chat. |
| **Google Assistant/Gemini overlay** | L’assistente usa il contesto visibile per suggerire operazioni e restare sopra l’app. [Google](https://blog.google/products-and-platforms/platforms/android/android-gemini-google-ai/) | È un overlay assistant di sistema, non una superficie d’azione interna che conserva una topologia stabile. |
| **Google patent dynamic shortcuts** | Esiste prior art brevettuale su toolbar dinamiche basate sulla previsione della prossima azione. [Patent](https://patents.google.com/patent/US20210294617A1/en) | Un brevetto non è prova di adozione o di buona usabilità; non va presentato come prodotto diffuso. |

### 3.2 Risposta alla domanda “è plausibile con un LLM locale 1–4B?”

**Sì, per ranking/classificazione di azioni candidate; molto meno per generazione libera di un menu.** La formulazione tecnica giusta è:

```text
context locale → action registry → candidate filter → modello/ranker → top-k actions
                                      ↓
                         policy di stabilità + sicurezza + fallback
                                      ↓
                         shell visuale a geometria costante
```

Un 1–4B on-device può essere adeguato se:

- riceve una rappresentazione corta e strutturata: schermata, modalità chat, ultimo messaggio, presenza di allegato, stato streaming, persona attiva, ultimo comando, feature flags;
- sceglie fra 10–30 `action_id` pre-registrati, invece di inventare route o label;
- produce score/confidenza e motivazione breve oppure solo ranking;
- ha fallback deterministico (frequenza, recency, regole di stato) se la confidenza è bassa o l’inferenza supera una soglia temporale;
- non cambia posizione durante il gesto attivo e non sposta in modo imprevedibile l’azione primaria;
- mantiene “More”, “Search actions” e una lista completa accessibile.

**Non trovato:** benchmark pubblico che dimostri specificamente che un modello 1–4B on-device può predire bene le azioni di una singola app chat e migliorare il tempo d’uso del main menu. Questo va misurato in A1-novel.

### 3.3 Proposta di ricerca per A1-novel (inferenza, non finding)

La proposta più originale e testabile è un **menu semantico a campo stabile**:

1. Anchor sempre raggiungibile dal pollice, con indicatore discreto di “azioni disponibili”.
2. Hold: compaiono 4 azioni candidate, ordinate dal ranker locale.
3. Drag: l’azione sotto il dito mostra il risultato concreto e un preview reversibile.
4. Release: commit; ritorno all’anchor o swipe verso “cancel” annulla.
5. Slot di fallback sempre stabili: `New chat`, `Search`, `More`, `Settings` oppure equivalenti essenziali.
6. Dopo un certo numero di usi, il sistema può offrire una “lock action” per fissare un candidato; l’utente mantiene controllo sulla personalizzazione.
7. Un badge/affordance spiega perché un’azione è comparsa (“dal PDF allegato”, “stavi modificando questo testo”), evitando l’impressione di casualità.

La novità misurabile non è “AI menu” ma il confronto fra:

- static radial;
- adaptive per frequenza/recency;
- LLM ranker senza spiegazione;
- LLM ranker con geometria stabile, spiegazione e lock utente.

Metriche: time-to-action, errori, undo rate, feature awareness, task discovery, fiducia, sorpresa, numero di azioni usate, stabilità della memoria spaziale e costo energetico/inferenza.

## 4. Fallimenti noti e advisory

### Learnability, feature awareness e controllo

- Findlater & McGrenere hanno trovato il menu statico significativamente più veloce di quello adattivo; la maggioranza preferiva l’adaptable, cioè controllato dall’utente. [CHI 2004 PDF](https://www.cs.ubc.ca/labs/edapt/papers/findlater2004.pdf)
- La personalizzazione può migliorare i task core ma ridurre la consapevolezza delle feature non usate e peggiorare i task nuovi. [Beyond performance](https://www.sciencedirect.com/science/article/abs/pii/S1071581909001566)
- Una replica/studio del 2025 segnala ancora assenza di consenso su performance e preferenze dei menu adattivi. [JSS 2025](https://doi.org/10.1016/j.jss.2025.112598)
- Un modello locale non elimina il problema: se il menu cambia posizione o vocabolario troppo spesso, l’utente perde memoria motoria e fiducia. Per A1-novel: topologia stabile, slot fissabili, cronologia e reset esplicito.

### Discoverability e hidden gestures

- Marking menus hanno il percorso novizio→esperto, ma richiedono esercizio e una grammatica coerente. M3 documenta proprio il bisogno di studiare la transizione, non di assumere che avvenga automaticamente. [M3](https://research.google/pubs/m3-gesture-menu-design-and-experimental-analyses-of-marking-menus-for-touchscreen-mobile-interaction/)
- C-Swipe descrive soglie di riconoscimento e nota che l’arco può essere più piccolo del previsto; soglie basse generano attivazioni accidentali, alte rendono il gesto difficile. [C-Swipe](https://www.smashingmagazine.com/2013/03/c-swipe-navigation-on-android/)
- La letteratura recente definisce le hidden interactions mobili difficili da scoprire senza onboarding o esperienza pregressa. [GhostUI, 2026](https://arxiv.org/abs/2601.19258)
- Un affordance persistente, tutorial breve e accesso tappabile alla stessa lista di azioni sono obbligatori. Mai nascondere conversazioni, Settings o sicurezza dietro un gesto soltanto.

### Motion sickness, distrazione e performance

- Apple raccomanda movimento intenzionale, feedback alternativo e supporto a Reduce Motion; motion gratuito può disorientare. [HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion?changes=_2_2)
- Apple specifica che scaling, spinning, parallax, blur e depth simulation possono causare nausea o dizziness e devono avere alternativa. [Reduced Motion criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria)
- Un menu fisico/liquido deve avere modalità cross-fade/static, niente oscillazioni periferiche infinite e niente loop “alive” mentre l’utente legge.
- Il feedback audio-tattile non è automaticamente migliore: in uno studio mobile la condizione audio-tattile era più lenta. [BCS HCI 2014](https://www.scienceopen.com/hosted-document?doi=10.14236%2Fewic%2FHCI2014.33)

### Accessibility e inclusione

- Ogni action visuale deve esistere come accessibilità nativa, con label e `onAccessibilityAction`; RN supporta custom accessibility actions. [React Native](https://reactnative.dev/docs/accessibility.html)
- Le gesture che richiedono mano specifica o traiettoria precisa penalizzano dominanza, tremore, amputazioni e uso situazionale. Apple raccomanda alternative a gesti complessi. [HIG Gestures](https://developer.apple.com/design/human-interface-guidelines/gestures?trk=public_post_comment-text)
- Le azioni devono essere selezionabili con tap, VoiceOver/TalkBack, tastiera/switch access e comando vocale quando possibile.
- Non usare colore, vibrazione o suono come unico canale; fornire testo, stato e conferma.

### Occlusione, one-hand e conflitti con il sistema

- Il dito copre il menu proprio nel momento della selezione; C-Swipe ha già dovuto spostare le icone fuori dal percorso del pollice. [C-Swipe](https://www.smashingmagazine.com/2013/03/c-swipe-navigation-on-android/)
- Back gesture e edge gesture del sistema possono confliggere con drawer e EdgeMark; prevedere zone di attivazione interne e test su entrambi i lati.
- Il menu deve adattarsi a mano destra/sinistra, safe area, Dynamic Island/notch, tastiera, modalità landscape e font grandi.
- Pressure, back-of-device e sensori sono enhancement hardware-dependent: non possono essere il percorso primario cross-platform.

## 5. Implementazione RN/Expo: decisione pratica

Il progetto ha già `react-native-gesture-handler` e Reanimated; la base tecnica è quindi favorevole per un MVP del campo d’azione:

- **Sufficiente con RN/Reanimated:** anchor, hold-drag-release, geometria stabile, classificazione path, spring, magnetic attraction semplice, preview/commit, haptics, accessibility actions, menu adattivo deterministico.
- **Sufficiente con Expo SDK:** accelerometro/giroscopio e API device generiche. [Expo SDK](https://docs.expo.dev/versions/latest/)
- **Possibile ma con cautela:** gooey/blur SVG; i filtri nativi supportati non coincidono con tutto SVG web. [react-native-svg](https://github.com/software-mansion/react-native-svg/blob/main/USAGE.md)
- **Modulo/config nativo necessario:** App Intents/Shortcuts/Live Activities iOS; predictive back Android; force/pressure raw affidabile; hardware back-of-device; system-wide assistant overlay; accesso OEM a Glyph/Edge Panel.
- **Consiglio architetturale:** `ActionRegistry` tipizzato e stabile, ranker sostituibile, `MenuPolicy` con hysteresis/cooldown, renderer indipendente dal modello, e un percorso statico sempre attivo per test A/B e accessibilità.

## 6. Cose da non proporre come “nuove”

1. Un semplice arco/pie/radial bottom-center.
2. Una FAB/orb che si espande in bottoni.
3. Un menu gooey o spring senza nuova semantica.
4. C-Swipe/reverse-C o edge swipe generico.
5. Un menu che riordina le voci per uso recente/frequenza senza controllo utente.
6. Un overlay AI flottante simile a Gemini.
7. Un menu diegetico/holographic in stile Dead Space.
8. Un menu pressure/long-press che replica 3D Touch Quick Actions.
9. Live Activity/Dynamic Island usata come argomento per un main menu in-app.

## Conclusione

La pista con il miglior rapporto tra novità, fattibilità e valore per A1-novel è **LLM-predicted action field con spazio stabile e commit reversibile**. La parte LLM è plausibile se ridotta a ranking di action ID e vincolata da policy; la parte realmente differenziante è impedire che la predizione distrugga learnability e controllo.

La pista più radicale ma non cross-platform è il **secondo canale posteriore/pressure**. La pista più facile da prototipare ma meno nuova è il **menu blob/magnetic**. La decisione consigliata è quindi prototipare prima quattro condizioni static/adaptive/LLM/LLM+explanation, poi aggiungere una sola variante gestuale non radiale (M3 o EdgeMark) e misurare.
