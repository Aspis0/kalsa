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
    "webSearchNote": "Quand ta question a besoin d'une information récente, l'assistant peut chercher sur le web et ouvrir une page. Cette recherche — les mots qu'il a choisis et l'adresse qu'il ouvre — quitte cet ordinateur pour un service de recherche sur internet, et ce qui revient reste dans la conversation. Avec ceci éteint, rien n'est envoyé et l'assistant répond avec ce qu'il sait déjà. Le changement s'applique dès que tu le touches.",
    "lede": "À tes messages répond cet ordinateur, et tout reste ici.",
    "language": "Langue",
    "languageSystem": "Comme le système",
    "ai": "IA",
    "usingAi": (name: string) => `Actuellement : ${name}`,
    "aiDetails": "Changer ou voir les détails"
  };

