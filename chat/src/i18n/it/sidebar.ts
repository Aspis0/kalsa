// Tradotto dal copy inglese approvato.

export const SIDEBAR = {
    "aria": "Conversazioni",
    "searchAria": "Cerca nelle conversazioni",
    "searchPlaceholder": "Cerca",
    "focusSearch": "Vai alla ricerca",
    "newChat": "+ Nuova chat",
    "titleAria": "Titolo della conversazione",
    "rename": "Rinomina",
    "sure": "Eliminare questa conversazione?",
    "delete": "Elimina",
    "liveAria": " (in generazione)",
    "noMatch": (query: string) => `Nessuna conversazione contiene “${query}”. Prova un'altra parola.`,
    "capped": (shown: number, total: number) => `Vengono mostrate ${shown} su ${total}. Aggiungi una parola per restringere.`,
    "groups": {
      "today": "Oggi",
      "yesterday": "Ieri",
      "thisWeek": "Questa settimana",
      "earlier": "Prima",
    } as Record<string, string>,
  };
