// Traduit du copy anglais approuvé.

export const RUST: {
  startup: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  choice: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  app: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  invite: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  pairing: Record<string, (params: Record<string, unknown>, tag: string) => string>;
} = {
  startup: {
    cannot_run_yet: () => "Kalsa ne peut pas encore tourner sur cet ordinateur. Cherche une mise à jour de l'app.",
    no_suitable_choice: () => "Kalsa n'a pas encore d'IA qui tourne bien sur cet ordinateur. Cherche une mise à jour de l'app.",
    connection_lost: () => "Kalsa n'a pas pu télécharger ce qu'il lui faut. Vérifie ta connexion et réessaie.",
    network_blocks_download: () => "Kalsa n'a pas pu télécharger ce qu'il lui faut sur ce réseau. Essaie un autre réseau.",
    download_failed: () => "Kalsa n'a pas fini de télécharger. Réessaie plus tard.",
    needs_check: () => "Kalsa doit examiner cet ordinateur avant de pouvoir démarrer. Réessaie.",
    choice_too_large: () => "Cette IA est trop grande pour cet ordinateur. Choisis-en une plus petite sur la page IA.",
    choice_unavailable: () => "Kalsa n'a pas pu démarrer avec cette IA. Choisis-en une autre sur la page IA.",
    conversation_too_long: () => "Cette longueur de conversation est trop pour cette IA. Choisis-en une plus petite dans la page IA.",
    check_failed: () => "Kalsa n'a pas pu examiner cet ordinateur. Attends un moment et réessaie.",
    could_not_start: () => "Kalsa n'a pas pu démarrer. Réessaie.",
    awaiting_choice: () => "Kalsa n'est pas encore prête. Va à Accueil et appuie sur Démarrer.",
    disk_full: (params, tag) =>
      typeof params.gb === "number"
        ? `Kalsa a besoin de plus de place. Libère ${new Intl.NumberFormat(tag, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
          }).format(params.gb)} Go et réessaie.`
        : "Kalsa a besoin de plus de place. Libère un peu de place et réessaie.",
    restart: () => "Kalsa n'a pas pu démarrer. Redémarre cet ordinateur et réessaie.",
    stopped: () => "Kalsa s'est arrêtée d'elle-même. Rallume-la.",
    took_too_long: () => "Kalsa a mis trop de temps à se préparer. Réessaie.",
    stop_unconfirmed: () => "Kalsa est peut-être encore allumée. Redémarre cet ordinateur pour l'éteindre.",
    already_starting: () => "Kalsa démarre déjà. Attends un moment.",
  },
  choice: {
    save_failed: () => "Kalsa n'a pas pu enregistrer ce choix. Réessaie.",
  },
  app: {
    unexpected: () => "Kalsa n'a pas pu le faire. Réessaie.",
  },
  invite: {
    "invite.no_road": () => "Les invitations ont besoin de la connexion internet. Allume-la dans la page IA.",
    "invite.full": () => "Tu as déjà le maximum d'invitations à la fois. Annule-en une pour en faire une nouvelle.",
    "invite.could_not_make": () => "Kalsa n'a pas pu faire l'invitation. Réessaie.",
    "invite.could_not_save": () => "Kalsa n'a pas pu enregistrer l'invitation. Réessaie.",
    "invite.expired": () => "Cette invitation a expiré. Fais-en une nouvelle.",
  },
  pairing: {
    "pairing.save_failed": () => "Kalsa n'a pas pu enregistrer ce changement. Réessaie.",
    "pairing.phone_with_ai": (params, tag) =>
      typeof params.gb === "number" && Number.isFinite(params.gb) && params.gb > 0
        ? `Téléphone avec sa propre IA (${new Intl.NumberFormat(tag).format(params.gb)} Go)`
        : "Téléphone sans IA propre",
    "pairing.phone_without_ai": () => "Téléphone sans IA propre",
    "pairing.host_forget": () => "La connexion de cet ordinateur ne peut pas être oubliée.",
  },
};
