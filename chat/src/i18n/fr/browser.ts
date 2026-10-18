// Traduit du copy anglais approuvé.

export const BROWSER = {
  home: "Accueil",
  searchHere: "Chercher ici",
  attach: "Joindre",
  readingFolder: "Lecture du dossier…",
  truncated: "500 premières entrées du dossier, par ordre alphabétique.",
  skippedEntries: (count: number) => `Impossible de lire ${count} entrées.`,
  notDesktop: "Parcourir le disque de cet ordinateur n'est possible que dans l'app de bureau.",
  searchPlaceholder: "Chercher par nom ou chemin",
  searchButton: "Chercher",
  searchingIn: (scope: string) => `Recherche dans ${scope}`,
  looking: "…",
  noScope: "Aucun dossier où chercher.",
  viaIndex: "Les résultats viennent de l'index des fichiers de ce Mac, qui ignore les fichiers cachés et certains dossiers. ",
  skippedSome: (count: number) => `${count} entrées que le système ne montre pas ont été ignorées. `,
  limited: "Les 500 premières sont affichées. Précise ta recherche pour voir le reste.",
  readingFolders: "Lecture des dossiers de cet ordinateur…",
  folder: "dossier",
};

/**
 * La carte qu'une personne doit trancher, et la commande Pause.
 *
 * **Les deux réponses sont tout le sujet.** Le reste dit à une personne ce qu'un
 * site inconnu s'apprête à recevoir, donc on parle de la requête et pas du
 * modèle : le bouton dit ce qu'il fait à la requête.
 */
export const CONFIRM = {
  title: "Kalsa veut envoyer ceci",
  waiting: "Rien n'a encore été envoyé.",
  allow: "L'envoyer",
  decline: "Ne pas l'envoyer",
  asking: "Envoi…",
  fields: "Ce qu'il enverrait",
  none: "Aucun champ : juste la requête.",
  paused: "En pause",
  resume: "Reprendre",
  pauseHint: "Mettre en pause arrête la prochaine action. Ce qui est déjà envoyé ne se rappelle pas.",
  runningHint: "En pause. Kalsa n'agit pas dans le navigateur.",

  /** What became of the request a person just answered, in their own words:
   *  the one thing they are told about it after the card goes. */
  sentTo: (host: string) => `Envoyé à ${host}`,
  show: "Afficher",
  hide: "Masquer",
  notSentNo: "Non envoyé — il n’a pas été autorisé",
  notSentLate: "Non envoyé — personne n’a répondu à temps",
  notSentGone: "Non envoyé — la fenêtre du navigateur a été fermée",
  notSentHidden: "Non envoyé — elle ne pouvait pas vous être montrée",
  unclear: "Incertain — cela a peut-être été envoyé",
};
