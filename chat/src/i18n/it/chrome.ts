// Tradotto dal copy inglese approvato.

export const CHROME = {
    "home": "Home",
    "room": "Stanza",
    "chat": "Chat",
    "settings": "Impostazioni",
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
    "webSearchHint": "Su internet vanno solo le parole cercate. Le tue chat restano qui.",
    "webSearchMore": "Cosa esce da questo computer?",
    "webSearchNote": "Quando la tua domanda ha bisogno di qualcosa di attuale, l'assistente può cercare sul web e aprire una pagina. Quella ricerca — le parole che ha scelto e l'indirizzo che apre — esce da questo computer verso un servizio di ricerca su internet, e ciò che torna resta nella conversazione. Con questa opzione spenta non vengono inviate ricerche o richieste di pagine web e l'assistente risponde con ciò che già sa. La modifica viene applicata appena la tocchi.",
    "lede": "I tuoi messaggi e le risposte restano su questo computer.",
    "language": "Lingua",
    "languageSystem": "Come il sistema",
    "ai": "AI",
    "usingAi": (name: string) => `In uso: ${name}`,
    "aiDetails": "Cambia o vedi i dettagli"
  };

