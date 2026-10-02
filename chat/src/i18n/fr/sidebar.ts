// Traduit du copy anglais approuvé.

export const SIDEBAR = {
    "aria": "Conversations",
    "searchAria": "Chercher dans les conversations",
    "searchPlaceholder": "Chercher",
    "focusSearch": "Aller à la recherche",
    "newChat": "+ Nouvelle conversation",
    "titleAria": "Titre de la conversation",
    "rename": "Renommer",
    "sure": "Supprimer cette discussion ?",
    "delete": "Supprimer",
    "liveAria": " (en génération)",
    "noMatch": (query: string) => `Aucune conversation ne correspond à « ${query} ». Essaie un autre mot.`,
    "capped": (shown: number, total: number) => `${shown} sur ${total} sont montrées. Ajoute un mot pour affiner.`,
    "groups": {
      "today": "Aujourd'hui",
      "yesterday": "Hier",
      "thisWeek": "Cette semaine",
      "earlier": "Avant",
    } as Record<string, string>,
  };
