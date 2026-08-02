/**
 * Master locale strings (English).
 * `it.ts` must mirror this shape via `typeof en`.
 */
export const en = {
  common: {
    back: "Back",
    cancel: "Cancel",
    ok: "OK",
    download: "Download",
    settings: "Settings",
    help: "Help",
    privacy: "Privacy",
    about: "About",
    close: "Close",
    continue: "Continue",
    next: "Next",
    save: "Save",
    clear: "Clear",
    copy: "Copy",
    send: "Send",
    stop: "Stop",
    tools: "Tools",
    web: "Web",
    source: "Source",
    image: "Image",
    attachment: "Attachment",
  },

  drawer: {
    subtitle: "Local · private",
    toolsSection: "Tools",
  },

  settings: {
    title: "Settings",
    placeholder: "Settings will be added here",
    language: "Language",
    languageEn: "English",
    languageIt: "Italiano",
    languageHint: "The assistant answers in this language.",
  },

  download: {
    title: "Download model",
    confirmBody:
      "Download {name} ({size})? You need a stable connection and free disk space. If it stops, it resumes where it left off.",
    checking: "Checking…",
    missing: "Download {size}",
    downloading: "Downloading… {percent}%",
    loading: "Loading model…",
    failedRetry: "Download failed — tap to retry",
    readyLocal: "Ready · local",
    downloaded: "Downloaded",
    incomplete: "Download incomplete — tap to retry.",
    readyNotice: "{name} is ready.",
    notifyReady: "{name} downloaded and ready.",
    notifyFailed: "Download failed: {error}",
    stalled: "Download stalled — check your connection. Retry: it will resume where it left off.",
    failed: "Download failed",
    incompleteBytes: "Download incomplete ({got} != {expected} bytes)",
  },

  chat: {
    placeholder: "Ask a question…",
    greetingMorning: "Good morning",
    greetingAfternoon: "Good afternoon",
    greetingEvening: "Good evening",
    welcomePrompt: "What do you want to investigate today?",
    thinking: "Thinking…",
    thinkingStatus: "Thinking",
    searching: "Searching the web…",
    today: "Today · {time}",
    yesterday: "Yesterday",
    exportTitle: "Kalsa — conversation export",
    exportYou: "**You**",
    exportAi: "**AI**",
    backendNotWired: "Backend not wired.",
    queryLimit: "You've reached your query limit for today.",
    serviceUnreachable: "Couldn't reach the AI service. Please try again.",
    modelNotDownloaded: "Model not downloaded yet. Tap the model bar to download {name}.",
    openAction: "Open {label}",
    openOutputPicker: "Open output picker",
    selectedRun: "Selected run: {label}",
    copy: "Copy",
    photoLibrary: "Photo from library",
    takePhoto: "Take photo",
    pdfDocument: "PDF document",
    interactive: "Interactive",
    miniappTap: "Interactive miniapp · tap to open",
    openTool: "Open tool",
    suggestion1: "Explain a concept clearly",
    suggestion1Sub: "Chat · local model",
    suggestion2: "Search the web: latest news on [topic]",
    suggestion2Sub: "Websearch · local model",
    suggestion3: "Build a comparison table",
    suggestion3Sub: "Miniapp · interactive table",
    suggestion4: "Summarize this text",
    suggestion4Sub: "Chat · long input",
    toolChat: "Chat",
    toolWebsearch: "Websearch",
    toolMiniapp: "Miniapp",
    toolTools: "Tools",
    a11yMenu: "Menu",
    a11yExport: "Export chat",
    a11yNewChat: "New chat",
    a11yClearRun: "Clear selected run",
    a11yLongPress: "Long press to copy or share",
    a11yAttach: "Add attachment",
    a11yStop: "Stop generation",
    a11ySend: "Send",
    a11yToolComingSoon: "{label} context (coming soon)",
  },

  notify: {
    channelName: "Kalsa",
  },

  miniapp: {
    reportHint: "Report: export the mini-app as JSON and ask the chat to generate the report.",
    exportCsvTitle: "Export mini-app CSV",
    exportJsonTitle: "Export mini-app JSON",
    csvExported: "Mini-app CSV exported",
    jsonExported: "Mini-app JSON exported",
    exportFailed: "Could not export the mini-app result.",
    plateMapsUnsupported: "Plate maps are not part of the general mini-app format.",
    noExportableRows: "message\nNo exportable rows in this mini-app.\n",
    exportNativeOnly: "Export is currently available on native platforms only.",
    exportedAs: "Mini-app exported as {format}.",
    couldNotExport: "Could not export mini-app.",
    legacyLabActions: "Legacy lab actions are not part of the general mini-app format.",
    preparingAction: "Preparing action…",
    runAction: "Run action",
    confirmAction:
      "This action may use AI to generate a result from your current calculator values.",
    exportDialogTitle: "Export mini-app {format}",
    renameNode: "Rename node",
    edgeLabel: "Edge label",
    addedSample: "Added Sample {n}.",
    noEditablePlate: "No editable plate or table was available.",
    autoFilledReplicates: "Auto-filled {n} replicate assignment(s).",
    replicatesComplete: "Replicates already look complete.",
    plateCleared: "Plate assignments cleared.",
  },

  /** UI chrome / fallback labels inside the miniapp renderer (not model content). */
  renderer: {
    blockedRenderPath: "Blocked render path",
    nestedDepthCapped: "Nested content is capped at {depth} levels.",
    noSummaryYet: "No summary yet.",
    summary: "Summary",
    inputs: "Inputs",
    input: "Input",
    noResult: "No result.",
    formula: "Formula",
    calculationUnavailable: "Calculation step unavailable",
    warning: "Warning",
    actions: "Actions",
    statistics: "Statistics",
    values: "Values",
    mean: "Mean",
    sampleSd: "Sample SD",
    outlier: "Outlier",
    needThreeValues: "Need at least 3 values",
    flagged: "flagged",
    notSignificant: "not significant",
    massFromDensity: "Mass from density",
    volumeMl: "Volume (mL)",
    densityGml: "Density (g/mL)",
    mass: "Mass",
    unsupportedUnit: "Unsupported unit",
    chart: "Chart",
    table: "Table",
    noRowsYet: "No rows yet.",
    showingUpTo: "Showing up to {rows} rows and {cols} columns.",
    interactiveMiniapp: "Interactive miniapp",
    interactiveMiniappA11y: "Interactive miniapp: {title}",
    run: "Run",
    source: "Source",
    noEvidenceNotes: "No evidence notes available.",
    noContentInBlock: "No content in this block.",
    emptyHtmlBlock: "Empty html block",
    unsupportedBlock: "Unsupported miniapp block: {type}",
    evidencePanel: "Evidence panel",
    pathwayEditor: "Pathway editor",
    noNodeSelected: "No node selected",
    noEdgeSelected: "No edge selected",
    nodeKind: "Node kind",
    location: "Location",
    target: "Target",
    edgeKind: "Edge kind",
    addNode: "Add node",
    addEdge: "Add edge",
    deleteSelected: "Delete selected",
    noNodesAvailable: "No nodes available.",
    pathwayHint: "Tap a node or edge to select it. Node changes then affect local actions.",
    nodePrefix: "Node: {label}",
    edgePrefix: "Edge: {label}",
  },

  errors: {
    connectionLost:
      "Connection lost — check your network and retry. The download will resume where it left off.",
    networkUnreachable: "Network unreachable — check your connection.",
    storageFailed: "Storage error — check free disk space and app permissions.",
    engineInitFailed: "Could not load the model.",
    modelNotLoaded: "Model not loaded. Download and load a model first.",
    contextFull:
      "Context full: this conversation is too long for the model. Retry with shorter messages.",
    visionInitFailed: "Vision unavailable: multimodal init failed for this model.",
    visionNotSupported: "Vision unavailable: this model does not support images.",
    pdfTooLarge: "PDF too large (max 5 MB).",
    pdfTimeout: "PDF page rendering timed out.",
    searchCancelled: "Search cancelled",
    noResults: "No results.",
    noResultsFound: "No results found.",
    emptySearchQuery: "Empty search query.",
    unknownTool: "Unknown tool: {name}",
    toolError: "Tool error: {message}",
    source: "Source",
  },

  quickActions: {
    title: "Quick actions",
    newChat: "New chat",
    newChatSub: "Start a conversation",
    webSearch: "Web search",
    webSearchSub: "Ask the web for an answer",
    newMiniapp: "New miniapp",
    newMiniappSub: "Generate an interactive block",
    openLast: "Open last item",
    openLastSub: "Jump back to your most recent",
  },

  wizard: {
    back: "Back",
    next: "Next",
    save: "Save",
  },

  /**
   * System prompt for the on-device model (no tools).
   * Language rules: (a) natural-language answer AND miniapp textual values use the settings
   * language; (b) web_search source titles may stay in their original language; (c) do not
   * translate URLs, JSON keys, type names, or the tool name web_search.
   */
  systemPrompt:
    "You are Kalsa, a private assistant running fully on this device (no cloud, no account). " +
    "Language rules: " +
    "(a) Write all natural-language answer text AND all miniapp textual values " +
    "(titles, labels, cell text, summaries, body copy) in English. " +
    "(b) When citing web_search results, source titles may stay in their original language. " +
    "(c) Never translate URLs, JSON keys, block type names, or the tool name web_search. " +
    "Answer concisely and helpfully. " +
    "You can also generate interactive mini-apps: JSON blocks with types like table, chart, calculator, " +
    "metric, tabs, expandable and html.",

  /** System prompt when web_search tool is available. */
  systemPromptWithSearch:
    "You are Kalsa, a private assistant running fully on this device (no cloud, no account). " +
    "Language rules: " +
    "(a) Write all natural-language answer text AND all miniapp textual values " +
    "(titles, labels, cell text, summaries, body copy) in English. " +
    "(b) When citing web_search results, source titles may stay in their original language. " +
    "(c) Never translate URLs, JSON keys, block type names, or the tool name web_search. " +
    "Answer concisely and helpfully. " +
    "You have a web_search tool: use it ALWAYS when the user asks about current information, " +
    "recent news, prices, events, or anything time-sensitive, or when they explicitly mention " +
    "searching the web (e.g. 'search online', 'websearch', 'look it up'). " +
    "Never answer time-sensitive questions from memory alone. " +
    "Cite the sources you used by referencing their titles. " +
    "You can also generate interactive mini-apps: JSON blocks with types like table, chart, calculator, " +
    "metric, tabs, expandable and html.",
};
