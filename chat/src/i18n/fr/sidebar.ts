// Traduit du copy anglais approuvé.

export const SIDEBAR = {
    "aria": "Conversations",
    "searchAria": "Chercher dans les conversations",
    "searchPlaceholder": "Chercher",
    "focusSearch": "Aller à la recherche",
    "newChat": "+ Nouvelle discussion",
    "titleAria": "Titre de la conversation",
    "rename": "Renommer",
    "sure": "Sûr ?",
    "delete": "Supprimer",
    "liveAria": " (en génération)",
    "noMatch": (query: string) => `Aucune conversation ne correspond à « ${query} ».`,
    "capped": (shown: number, total: number) => `Les ${shown} premières sur ${total} résultats sont montrées.`,
    "groups": {
      "today": "Aujourd'hui",
      "yesterday": "Hier",
      "thisWeek": "Cette semaine",
      "earlier": "Avant",
    } as Record<string, string>,
  };
