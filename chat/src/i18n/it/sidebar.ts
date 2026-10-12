// Tradotto dal copy inglese approvato.

export const SIDEBAR = {
    "aria": "Chat",
    "searchAria": "Cerca nelle conversazioni",
    "searchPlaceholder": "Cerca",
    "focusSearch": "Vai alla ricerca",
    "newChat": "Nuova chat",
    "titleAria": "Titolo della conversazione",
    "rename": "Rinomina",
    "enterToSave": "Invio per salvare",
    "cancel": "Annulla",
    "sure": "Eliminare questa conversazione?",
    "deleteBody": (title: string) => `«${title}»`,
    "delete": "Elimina",
    "liveAria": " (in generazione)",
    "noMatch": (query: string) => `Nessuna conversazione contiene “${query}”. Prova un'altra parola.`,
    "capped": (shown: number, total: number) => `Mostrate ${shown} su ${total}. Aggiungi una parola per restringere la ricerca.`,
    "groups": {
      "today": "Oggi",
      "yesterday": "Ieri",
      "thisWeek": "Questa settimana",
      "earlier": "Prima",
    } as Record<string, string>,
  };
