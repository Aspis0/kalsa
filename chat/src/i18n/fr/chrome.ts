// Tradotto dal copy inglese approvato.

export const CHROME = {
    "home": "Accueil",
    "room": "Salon",
    "chat": "Discussion",
    "settings": "Réglages",
    "navigation": "Pages",
    // The settings surfaces' names, keyed as the shell looks them up.
    pages: {
    "help": "Aide",
      "models": "Ton IA",
      "devices": "Téléphones",
      "settings": "Réglages",
    } as Record<string, string>,
    "showConversations": "Afficher les discussions"
  };

export const SETTINGS = {
    "title": "Réglages",
    "look": "Apparence",
    "lookLight": "Clair",
    "lookDark": "Sombre",
    "lookAuto": "Automatique",
    "webSearch": "Laisser Kalsa chercher sur le web",
    "webSearchHint": "Seuls les mots de la recherche partent sur internet. Tes conversations restent ici.",
    "webSearchMore": "Qu'est-ce qui quitte cet ordinateur ?",
    "webSearchNote": "Quand une question demande une information récente, Kalsa peut chercher sur le web et ouvrir des pages. Chaque recherche envoie les mots choisis par Kalsa, et l'adresse de chaque page qu'elle ouvre, à un service de recherche sur internet. Les résultats restent dans la conversation. Si c'est désactivé, rien n'est recherché ni demandé, et Kalsa répond avec ce qu'elle sait déjà.",
    "lede": "À tes messages répond cet ordinateur, et tout reste ici.",
    "language": "Langue",
    "languageSystem": "Comme le système",
    "ai": "IA",
    "usingAi": (name: string) => `Actuellement : ${name}`,
    "aiDetails": "Changer ou voir les détails"
  };

