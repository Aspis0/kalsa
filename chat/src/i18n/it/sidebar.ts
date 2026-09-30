// Tradotto dal copy inglese approvato.

export const SIDEBAR = {
    "aria": "Conversazioni",
    "searchAria": "Cerca nelle conversazioni",
    "searchPlaceholder": "Cerca",
    "focusSearch": "Vai alla ricerca",
    "newChat": "+ Nuova chat",
    "titleAria": "Titolo della conversazione",
    "rename": "Rinomina",
    "sure": "Sicuro?",
    "delete": "Elimina",
    "liveAria": " (in generazione)",
    "noMatch": (query: string) => `Nessuna conversazione contiene “${query}”.`,
    "capped": (shown: number, total: number) => `Vengono mostrati i primi ${shown} di ${total} risultati.`,
    "groups": {
      "today": "Oggi",
      "yesterday": "Ieri",
      "thisWeek": "Questa settimana",
      "earlier": "Prima",
    } as Record<string, string>,
  };
