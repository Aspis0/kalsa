// Tradotto dal copy inglese approvato.

export const CHROME = {
    "home": "Home",
    "room": "Stanza",
    "chat": "Chat",
    "settings": "Impostazioni",
      "mail": "Mail",
    "navigation": "Pagine",
    // The settings surfaces' names, keyed as the shell looks them up.
    pages: {
    "help": "Aiuto",
      "models": "La tua AI",
      "devices": "Telefoni",
      "settings": "Impostazioni",
    } as Record<string, string>,
    "showConversations": "Mostra le chat"
  };

export const SETTINGS = {
    "title": "Impostazioni",
    "look": "Aspetto",
    "lookLight": "Chiaro",
    "lookDark": "Scuro",
    "lookAuto": "Automatico",
    "webSearch": "Lascia che Kalsa cerchi sul web",
    "webSearchHint": "Su internet vanno solo le parole cercate. Le tue chat restano su questo computer.",
    "webSearchMore": "Cosa esce da questo computer?",
    "webSearchNote": "Quando una domanda richiede informazioni aggiornate, Kalsa può cercare sul web e aprire pagine. Ogni ricerca invia le parole scelte da Kalsa, e l'indirizzo di ogni pagina che apre, a un servizio di ricerca su internet. I risultati restano nella conversazione. Con l'opzione spenta non si effettuano ricerche né richieste di pagine, e Kalsa risponde con ciò che già sa.",
    "lede": "I tuoi messaggi e le risposte restano su questo computer.",
    "language": "Lingua",
    "languageSystem": "Come il sistema",
    "ai": "AI",
    "usingAi": (name: string) => `In uso: ${name}`,
    "mail": "Mail",
    "mailHint": "Leggi la tua casella nella chat e rispondi.",
    "mailOpen": "Configura la mail",
    "browser": "Browser",
    "browserOpen": "Apri il browser",
    "aiDetails": "Cambia o vedi i dettagli"
  };

