import type { en } from "./en";

/**
 * Italian locale — must match `en` keys exactly (`typeof en`).
 */
export const it: typeof en = {
  common: {
    back: "Indietro",
    cancel: "Annulla",
    ok: "OK",
    download: "Scarica",
    settings: "Impostazioni",
    help: "Aiuto",
    privacy: "Privacy",
    about: "Informazioni",
    close: "Chiudi",
    continue: "Continua",
    next: "Avanti",
    save: "Salva",
    clear: "Cancella",
    copy: "Copia",
    send: "Invia",
    stop: "Stop",
    tools: "Strumenti",
    web: "Web",
    source: "Fonte",
    image: "Immagine",
    attachment: "Allegato",
  },

  drawer: {
    subtitle: "Locale · privato",
    toolsSection: "Strumenti",
  },

  settings: {
    title: "Impostazioni",
    placeholder: "Le impostazioni verranno aggiunte qui",
    language: "Lingua",
    languageEn: "English",
    languageIt: "Italiano",
    languageHint: "L'assistente risponde in questa lingua.",
    webSearch: "Ricerca web",
    webSearchHint:
      "Scegli un provider di ricerca. Exa MCP è gratuito e non richiede chiave; gli altri provider richiedono una chiave API salvata sul dispositivo.",
    provider: "Provider",
    providerExaMcp: "Exa MCP (gratis)",
    providerExa: "Exa API",
    providerBrave: "Brave Search",
    providerTavily: "Tavily",
    apiKey: "API key",
    apiKeyPlaceholder: "Incolla la tua API key",
    apiKeyHint:
      "La chiave viene salvata in modo sicuro su questo dispositivo. Viene inviata solo al provider selezionato.",
    keyNotNeeded: "Nessuna API key richiesta per questo provider.",
    showKey: "Mostra",
    hideKey: "Nascondi",
    saved: "Salvato",
    saving: "Salvataggio…",
    saveFailed: "Impossibile salvare: {message}",
    unsavedChanges: "Modifiche non salvate",
    unsavedTitle: "Modifiche non salvate",
    unsavedBody: "Hai modifiche non salvate. Vuoi scartarle?",
    discard: "Scarta",
    models: "Modelli",
    modelsHint:
      "Scegli il modello sul dispositivo. Il download parte solo se lo chiedi; i download interrotti riprendono da dove erano.",
    modelActive: "Attivo",
    modelSelect: "Seleziona",
    modelDownload: "Scarica",
    modelDownloading: "Scaricamento… {percent}%",
    modelLoading: "Caricamento…",
    modelChecking: "Verifica…",
    modelReady: "Pronto",
    modelMissing: "Non scaricato",
    modelError: "Errore — riprova",
    modelDownloadedBadge: "Scaricato ✓",
    modelNotDownloadedBadge: "Non scaricato",
    switchWhileStreamingTitle: "Risposta in corso",
    switchWhileStreamingBody:
      "Cambiare modello interromperà la generazione. Continuare?",
    privacy: "Privacy",
    privacyBody:
      "Kalsa gira interamente su questo dispositivo. Le chat restano locali. Le uniche chiamate di rete sono il download dei modelli da Hugging Face e la ricerca web tramite il provider che scegli. Le chiavi API sono salvate nell'archivio sicuro del dispositivo. Nessun account e nessuna sincronizzazione cloud.",
    about: "Informazioni",
    aboutAppName: "Kalsa AI Chat",
    aboutVersion: "Versione {version}",
    aboutBody:
      "Assistente privato sul dispositivo. Chat, ricerca web e mini-app interattive — senza account.",
    help: "Aiuto",
    helpSubtitle: "Come funziona Kalsa",
  },

  help: {
    title: "Aiuto",
    intro:
      "Kalsa è un assistente privato sul dispositivo. La chat gira interamente sul telefono — nessun account, nessun cloud per il modello.",
    howItWorks: {
      title: "Come funziona",
      body:
        "La chat è 100% locale. Non serve un account. I modelli girano su questo dispositivo con llama.rn. La conversazione resta sul telefono, a meno che non la esporti tu.",
    },
    models: {
      title: "Scaricare i modelli",
      body:
        "Apri Impostazioni → Modelli. Scegli un modello (Qwen 4B è il default consigliato; usa il 2B su device con poca RAM). Il download chiede conferma, mostra il progresso e invia una notifica a fine download. Serve spazio su disco (~3 GB per il modello più i componenti vision se presenti). I download interrotti riprendono da dove erano.",
    },
    websearch: {
      title: "Ricerca web",
      body:
        "La chat può cercare online quando servono info fresche, notizie o prezzi. Il provider predefinito è Exa MCP gratuito. In Impostazioni → Ricerca web puoi aggiungere le chiavi API di Exa, Brave o Tavily; le chiavi restano nel keystore sicuro del dispositivo. Se il provider scelto fallisce, Kalsa ripiega automaticamente sul provider gratuito.",
    },
    privacy: {
      title: "Privacy",
      body:
        "Tutto gira sul dispositivo. Le uniche chiamate di rete sono il download dei modelli (Hugging Face) e la ricerca web (il provider scelto). Nessun account, nessuna telemetria. Le chiavi API restano nel keystore del dispositivo. La cronologia resta sul telefono.",
    },
    miniapps: {
      title: "Mini-app",
      body:
        "La chat può generare mini-app interattive — tabelle, grafici, calcolatrici, quiz a risposta multipla e altro. Esempio: \"fammi un quiz su X\". Tocca la card della mini-app in chat per aprirla a schermo intero.",
    },
    limits: {
      title: "Limiti",
      body:
        "È un modello piccolo sul dispositivo: le risposte restano brevi di proposito. Senza rete la ricerca web non funziona (la chat locale sì). La velocità dipende dal telefono. Su device con poca RAM usa il modello 2B.",
    },
    faq: {
      title: "FAQ",
      shortAnswers: {
        q: "Perché la risposta è corta?",
        a: "Il modello on-device tiene le risposte brevi. Chiedi più dettagli se ti serve una risposta più lunga.",
      },
      offline: {
        q: "Posso usare Kalsa senza rete?",
        a: "Sì per la chat locale (dopo aver scaricato il modello). No per la ricerca web — serve una connessione.",
      },
      chatStorage: {
        q: "Dove sono salvate le mie chat?",
        a: "Solo su questo dispositivo. Non c'è sincronizzazione cloud.",
      },
      language: {
        q: "Come cambio lingua?",
        a: "Apri Impostazioni → Lingua. Il modello risponde nella lingua scelta.",
      },
    },
  },

  download: {
    title: "Scarica modello",
    confirmBody:
      "Scarica {name} ({size})? Serve una connessione stabile e spazio su disco. Se si interrompe, riprende da dove era.",
    checking: "Verifica…",
    missing: "Scarica {size}",
    downloading: "Scaricamento… {percent}%",
    loading: "Caricamento modello…",
    failedRetry: "Download non riuscito — tocca per riprovare",
    readyLocal: "Pronto · locale",
    downloaded: "Scaricato",
    incomplete: "Download incompleto — tocca per riprovare.",
    readyNotice: "{name} pronto.",
    notifyReady: "{name} scaricato e pronto.",
    notifyFailed: "Download non riuscito: {error}",
    stalled:
      "Download bloccato — controlla la connessione. Riprova: riprenderà da dove era.",
    failed: "Download non riuscito",
    incompleteBytes: "Download incompleto ({got} != {expected} byte)",
  },

  chat: {
    placeholder: "Fai una domanda…",
    greetingMorning: "Buongiorno",
    greetingAfternoon: "Buon pomeriggio",
    greetingEvening: "Buonasera",
    welcomePrompt: "Cosa vuoi approfondire oggi?",
    thinking: "Sto pensando…",
    thinkingStatus: "Sto pensando",
    searching: "Cerco sul web…",
    today: "Oggi · {time}",
    yesterday: "Ieri",
    exportTitle: "Kalsa — esportazione conversazione",
    exportYou: "**Tu**",
    exportAi: "**AI**",
    backendNotWired: "Backend non collegato.",
    queryLimit: "Hai raggiunto il limite di query di oggi.",
    serviceUnreachable: "Impossibile raggiungere il servizio AI. Riprova.",
    modelNotDownloaded:
      "Modello non ancora scaricato. Apri Impostazioni → Modelli per scaricare {name}.",
    openAction: "Apri {label}",
    openOutputPicker: "Apri selettore output",
    selectedRun: "Esecuzione selezionata: {label}",
    copy: "Copia",
    photoLibrary: "Foto dalla libreria",
    takePhoto: "Scatta foto",
    pdfDocument: "Documento PDF",
    interactive: "Interattivo",
    miniappTap: "Mini-app interattiva · tocca per aprire",
    openTool: "Apri strumento",
    suggestion1: "Spiega un concetto in modo chiaro",
    suggestion1Sub: "Chat · modello locale",
    suggestion2: "Cerca sul web: ultime notizie su [argomento]",
    suggestion2Sub: "Websearch · modello locale",
    suggestion3: "Crea una tabella di confronto",
    suggestion3Sub: "Mini-app · tabella interattiva",
    suggestion4: "Riassumi questo testo",
    suggestion4Sub: "Chat · testo lungo",
    toolChat: "Chat",
    toolWebsearch: "Websearch",
    toolMiniapp: "Mini-app",
    toolTools: "Strumenti",
    a11yMenu: "Menu",
    a11yExport: "Esporta chat",
    a11yNewChat: "Nuova chat",
    a11yClearRun: "Cancella esecuzione selezionata",
    a11yLongPress: "Tieni premuto per copiare o condividere",
    a11yAttach: "Aggiungi allegato",
    a11yStop: "Interrompi generazione",
    a11ySend: "Invia",
    a11yToolComingSoon: "Contesto {label} (in arrivo)",
  },

  notify: {
    channelName: "Kalsa",
  },

  miniapp: {
    reportHint:
      "Report: esporta la mini-app come JSON e chiedi alla chat di generare il report.",
    exportCsvTitle: "Esporta mini-app CSV",
    exportJsonTitle: "Esporta mini-app JSON",
    csvExported: "Mini-app CSV esportata",
    jsonExported: "Mini-app JSON esportata",
    exportFailed: "Impossibile esportare il risultato della mini-app.",
    plateMapsUnsupported: "Le plate map non fanno parte del formato mini-app generale.",
    noExportableRows: "message\nNessuna riga esportabile in questa mini-app.\n",
    exportNativeOnly: "L'esportazione è disponibile solo sulle piattaforme native.",
    exportedAs: "Mini-app esportata come {format}.",
    couldNotExport: "Impossibile esportare la mini-app.",
    legacyLabActions: "Le azioni lab legacy non fanno parte del formato mini-app generale.",
    preparingAction: "Preparazione azione…",
    runAction: "Esegui azione",
    confirmAction:
      "Questa azione può usare l'AI per generare un risultato dai valori attuali del calcolatore.",
    exportDialogTitle: "Esporta mini-app {format}",
    renameNode: "Rinomina nodo",
    edgeLabel: "Etichetta arco",
    addedSample: "Aggiunto Sample {n}.",
    noEditablePlate: "Nessuna piastra o tabella modificabile disponibile.",
    autoFilledReplicates: "Compilati automaticamente {n} assegnamento/i di replica.",
    replicatesComplete: "Le repliche sembrano già complete.",
    plateCleared: "Assegnazioni piastra cancellate.",
  },

  renderer: {
    blockedRenderPath: "Percorso di rendering bloccato",
    nestedDepthCapped: "Il contenuto annidato è limitato a {depth} livelli.",
    noSummaryYet: "Nessun riepilogo ancora.",
    summary: "Riepilogo",
    inputs: "Input",
    input: "Input",
    noResult: "Nessun risultato.",
    formula: "Formula",
    calculationUnavailable: "Passo di calcolo non disponibile",
    warning: "Avviso",
    actions: "Azioni",
    statistics: "Statistiche",
    values: "Valori",
    mean: "Media",
    sampleSd: "DS campione",
    outlier: "Outlier",
    needThreeValues: "Servono almeno 3 valori",
    flagged: "segnalato",
    notSignificant: "non significativo",
    massFromDensity: "Massa da densità",
    volumeMl: "Volume (mL)",
    densityGml: "Densità (g/mL)",
    mass: "Massa",
    unsupportedUnit: "Unità non supportata",
    chart: "Grafico",
    table: "Tabella",
    noRowsYet: "Nessuna riga ancora.",
    showingUpTo: "Mostro fino a {rows} righe e {cols} colonne.",
    interactiveMiniapp: "Mini-app interattiva",
    interactiveMiniappA11y: "Mini-app interattiva: {title}",
    run: "Esegui",
    source: "Fonte",
    noEvidenceNotes: "Nessuna nota di evidenza disponibile.",
    noContentInBlock: "Nessun contenuto in questo blocco.",
    emptyHtmlBlock: "Blocco html vuoto",
    unsupportedBlock: "Blocco mini-app non supportato: {type}",
    evidencePanel: "Pannello evidenze",
    pathwayEditor: "Editor pathway",
    noNodeSelected: "Nessun nodo selezionato",
    noEdgeSelected: "Nessun arco selezionato",
    nodeKind: "Tipo nodo",
    location: "Posizione",
    target: "Destinazione",
    edgeKind: "Tipo arco",
    addNode: "Aggiungi nodo",
    addEdge: "Aggiungi arco",
    deleteSelected: "Elimina selezione",
    noNodesAvailable: "Nessun nodo disponibile.",
    pathwayHint: "Tocca un nodo o un arco per selezionarlo. Le modifiche ai nodi influenzano le azioni locali.",
    nodePrefix: "Nodo: {label}",
    edgePrefix: "Arco: {label}",
    tabs: "Schede",
    tabN: "Scheda {n}",
    details: "Dettagli",
    noDetailsYet: "Nessun dettaglio ancora.",
    calculator: "Calcolatrice",
    result: "Risultato",
    formulaUnsupported: "Formula non supportata",
  },

  quiz: {
    check: "Verifica",
    correct: "✅ Corretto",
    wrong: "❌ Sbagliato",
    retry: "Riprova",
    correctAnswer: "Risposta corretta: {answer}",
    explanation: "Spiegazione",
    questionFallback: "Domanda",
    notGradable: "Risposta non disponibile",
  },

  errors: {
    connectionLost:
      "Connessione persa — controlla la rete e riprova. Il download riprenderà da dove era.",
    networkUnreachable: "Rete non raggiungibile — controlla la connessione.",
    storageFailed: "Errore di archiviazione — controlla lo spazio libero e i permessi dell'app.",
    engineInitFailed: "Impossibile caricare il modello.",
    modelNotLoaded: "Modello non caricato. Scarica e carica prima un modello.",
    contextFull:
      "Contesto pieno: la conversazione è troppo lunga per questo modello. Riprova con messaggi più brevi.",
    visionInitFailed: "Vision non disponibile: initMultimodal non riuscito per questo modello.",
    visionNotSupported: "Vision non disponibile: il modello non supporta le immagini.",
    pdfTooLarge: "PDF troppo grande (max 5 MB).",
    pdfTimeout: "Timeout nel rendering della pagina PDF.",
    searchCancelled: "Ricerca annullata",
    noResults: "Nessun risultato.",
    noResultsFound: "Nessun risultato trovato.",
    emptySearchQuery: "Query di ricerca vuota.",
    unknownTool: "Tool sconosciuto: {name}",
    toolError: "Errore tool: {message}",
    source: "Fonte",
    searchKeyMissing: "API key mancante per {provider}. Aggiungila in Impostazioni.",
    searchKeyInvalid: "API key non valida per {provider}. Controlla Impostazioni.",
    searchRateLimited: "Limite di richieste raggiunto per {provider}. Riprova più tardi.",
    searchFailed: "Ricerca non riuscita ({provider}): {message}",
    searchFallbackUsed:
      "Il provider di ricerca principale non ha funzionato; usato Exa MCP gratuito.",
    searchFallbackUsedNamed:
      "{provider} non disponibile; usato Exa MCP gratuito.",
    searchBothFailed: "{primary}; fallback Exa MCP: {fallback}",
    searchDeadline: "Ricerca scaduta per timeout. Riprova.",
    searchInvalidResponse: "Risposta non valida da {provider}",
    searchStorageUnavailable: "Impossibile leggere le impostazioni di ricerca: {message}",
    invalidSecretProvider: "Impossibile salvare una chiave per il provider \"{id}\".",
    secureStoreFailed: "Impossibile accedere all'archivio sicuro: {message}",
    sourceVia: "via {provider}",
  },

  quickActions: {
    title: "Azioni rapide",
    newChat: "Nuova chat",
    newChatSub: "Inizia una conversazione",
    webSearch: "Ricerca web",
    webSearchSub: "Chiedi al web una risposta",
    newMiniapp: "Nuova mini-app",
    newMiniappSub: "Genera un blocco interattivo",
    openLast: "Apri ultimo elemento",
    openLastSub: "Torna all'elemento più recente",
  },

  wizard: {
    back: "Indietro",
    next: "Avanti",
    save: "Salva",
  },

  systemPrompt:
    "Sei Kalsa, un assistente AI privato che gira interamente su questo dispositivo. Nessun cloud, nessun account, nessun tracciamento. " +
    "Regole di lingua: " +
    "(a) Scrivi tutto il testo naturale della risposta E tutti i valori testuali delle mini-app " +
    "(titoli, etichette, testo celle, riepiloghi, corpo) in italiano. " +
    "(b) Quando citi risultati di web_search, i titoli delle fonti possono restare nella lingua originale. " +
    "(c) Non tradurre URL, chiavi JSON, nomi dei tipi di blocco, né il nome del tool web_search. " +
    "Onestà: Non inventare mai fatti, date, nomi, numeri, citazioni, fonti o riferimenti. " +
    "Se non sai o non sei sicuro, dillo esplicitamente: 'Non sono sicuro' — non indovinare. " +
    "Se una domanda è ambigua, chiedi chiarimenti invece di assumere. " +
    "Distingui chiaramente tra ciò che sai e ciò che inferisci. " +
    "Puoi anche generare mini-app interattive: blocchi JSON con tipi come table, chart, calculator, " +
    "metric, tabs, expandable, html e quiz (domande a scelta multipla con 4 opzioni, answerIndex obbligatorio come intero zero-based 0-3, e explanation opzionale). " +
    "Per i blocchi quiz non rivelare mai answerIndex nel testo — l'app valuta la risposta in privato. " +
    "Formule calculator: solo numeri, identificatori di campi, + - * / e parentesi. " +
    "Emetti una miniapp come oggetto JSON con schema miniapp_v1, kind, title e blocks (opzionalmente in un fence ```json). " +
    "Rispondi in modo conciso. Usa paragrafi brevi e elenchi puntati quando servono. Scrivi nella lingua richiesta sopra. " +
    "Sei un modello piccolo sul dispositivo: tieni le risposte brevi (sotto le 200 parole, salvo richiesta esplicita di più). " +
    "Se un compito è troppo lungo o complesso, suddividilo o suggerisci come procedere. " +
    "Se ti chiedono contenuti dannosi (violenza, atti illegali, odio, dati personali di terzi), rifiuta in breve e offri un'alternativa sicura.",

  systemPromptWithSearch:
    "Sei Kalsa, un assistente AI privato che gira interamente su questo dispositivo. Nessun cloud, nessun account, nessun tracciamento. " +
    "Regole di lingua: " +
    "(a) Scrivi tutto il testo naturale della risposta E tutti i valori testuali delle mini-app " +
    "(titoli, etichette, testo celle, riepiloghi, corpo) in italiano. " +
    "(b) Quando citi risultati di web_search, i titoli delle fonti possono restare nella lingua originale. " +
    "(c) Non tradurre URL, chiavi JSON, nomi dei tipi di blocco, né il nome del tool web_search. " +
    "Onestà: Non inventare mai fatti, date, nomi, numeri, citazioni, fonti o riferimenti. " +
    "Se non sai o non sei sicuro, dillo esplicitamente: 'Non sono sicuro' — non indovinare. " +
    "Se una domanda è ambigua, chiedi chiarimenti invece di assumere. " +
    "Distingui chiaramente tra ciò che sai e ciò che inferisci. " +
    "Hai uno strumento web_search: usalo SEMPRE quando l'utente chiede informazioni aggiornate, " +
    "notizie recenti, prezzi, eventi o qualsiasi cosa time-sensitive, oppure quando menziona esplicitamente " +
    "la ricerca sul web (es. 'cerca online', 'websearch', 'cercami'). " +
    "Non rispondere mai a domande time-sensitive solo dalla memoria. " +
    "Se ti chiedono qualcosa che può essere cambiato (prezzi, notizie, eventi, persone), usa web_search — ma riporta solo ciò che dicono davvero i risultati. " +
    "Dopo web_search, basa la risposta sui risultati; se i risultati non contengono la risposta, dillo. " +
    "Cita le fonti usate facendo riferimento ai titoli. " +
    "Puoi anche generare mini-app interattive: blocchi JSON con tipi come table, chart, calculator, " +
    "metric, tabs, expandable, html e quiz (domande a scelta multipla con 4 opzioni, answerIndex obbligatorio come intero zero-based 0-3, e explanation opzionale). " +
    "Per i blocchi quiz non rivelare mai answerIndex nel testo — l'app valuta la risposta in privato. " +
    "Formule calculator: solo numeri, identificatori di campi, + - * / e parentesi. " +
    "Emetti una miniapp come oggetto JSON con schema miniapp_v1, kind, title e blocks (opzionalmente in un fence ```json). " +
    "Rispondi in modo conciso. Usa paragrafi brevi e elenchi puntati quando servono. Scrivi nella lingua richiesta sopra. " +
    "Sei un modello piccolo sul dispositivo: tieni le risposte brevi (sotto le 200 parole, salvo richiesta esplicita di più). " +
    "Se un compito è troppo lungo o complesso, suddividilo o suggerisci come procedere. " +
    "Se ti chiedono contenuti dannosi (violenza, atti illegali, odio, dati personali di terzi), rifiuta in breve e offri un'alternativa sicura.",
};
