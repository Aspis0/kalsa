// Traduit du copy anglais approuvé.

export const RUST: {
  startup: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  choice: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  app: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  invite: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  pairing: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  update: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  road: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  files: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  vision: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  web: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  browser: Record<string, (params: Record<string, unknown>, tag: string) => string>;
} = {
  startup: {
    cannot_run_yet: () => "Kalsa ne peut pas encore fonctionner sur cet ordinateur. Cherche une mise à jour de l'app.",
    no_suitable_choice: () => "Kalsa n'a pas encore d'IA qui fonctionne bien sur cet ordinateur. Cherche une mise à jour de l'app.",
    connection_lost: () => "Kalsa n'a pas pu télécharger ce qu'il lui faut. Vérifie ta connexion et réessaie.",
    network_blocks_download: () => "Kalsa n'a pas pu télécharger ce qu'il lui faut sur ce réseau. Essaie un autre réseau.",
    download_failed: () => "Kalsa n'a pas fini de télécharger. Réessaie plus tard.",
    needs_check: () => "Kalsa doit examiner cet ordinateur avant de pouvoir démarrer. Réessaie.",
    choice_too_large: () => "Cette IA est trop grande pour cet ordinateur. Choisis-en une plus petite dans Ton IA.",
    choice_unavailable: () => "Kalsa n'a pas pu démarrer avec cette IA. Choisis-en une autre dans Ton IA.",
    conversation_too_long: () => "Cette IA ne gère pas des conversations aussi longues. Démarre une nouvelle discussion, ou réduis « Taille du contexte » dans Ton IA → Pour les experts → Réglages du serveur.",
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
    stopped: () => "Kalsa s'est arrêtée de façon inattendue. Rallume-la.",
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
    "invite.no_road": () => "Les invitations ont besoin d'une connexion via internet. Active « Connexion via internet » dans Ton IA → Pour les experts → Réglages du serveur.",
    "invite.full": () => "Tu as atteint le maximum d'invitations. Annule-en une pour en créer une nouvelle.",
    "invite.could_not_make": () => "Kalsa n'a pas pu créer l'invitation. Réessaie.",
    "invite.could_not_save": () => "Kalsa n'a pas pu enregistrer l'invitation. Réessaie.",
    "invite.expired": () => "Cette invitation a expiré. Fais-en une nouvelle.",
  },
  pairing: {
    "pairing.save_failed": () => "Kalsa n'a pas pu enregistrer ce changement. Réessaie.",
    "pairing.phone_with_ai": (params) =>
      typeof params.gb === "number" && Number.isFinite(params.gb) && params.gb > 0
        ? "Téléphone avec sa propre IA"
        : "Téléphone sans IA propre",
    "pairing.phone_without_ai": () => "Téléphone sans IA propre",
    "pairing.host_forget": () => "La connexion de cet ordinateur ne peut pas être retirée.",
  },
  update: {
    check_failed: () => "Kalsa n'a pas pu rechercher les mises à jour. Réessaie plus tard.",
    download_failed: () => "Kalsa n'a pas pu télécharger la mise à jour. Réessaie.",
    signature_failed: () => "La mise à jour n'a pas pu être vérifiée, donc Kalsa ne l'a pas installée.",
    install_failed: () => "Kalsa n'a pas pu installer la mise à jour. Réessaie.",
    busy: () => "Kalsa démarre. Réessaie quand elle sera prête.",
    up_to_date: () => "Kalsa est déjà à jour.",
    replying: () => "Kalsa est en train de répondre. Installe la mise à jour quand elle a fini.",
    changed: () => "La mise à jour a changé depuis la vérification. Recherche-la de nouveau.",
  },
  road: {
    off: () => "La connexion via internet est désactivée. Le téléphone se connecte par Tailscale.",
    waiting: () => "La connexion via internet attend que Kalsa soit allumée.",
    opening: () => "La connexion via internet est en cours d'ouverture.",
    open: () => "La connexion via internet est activée.",
    unavailable: () => "La connexion via internet n'a pas pu s'ouvrir sur cet ordinateur.",
  },
  files: {
    list_failed: () => "Kalsa ne peut pas ouvrir ce dossier. Choisis-en un autre.",
    not_found: () => "Kalsa ne trouve pas ce fichier. Choisis-en un autre.",
    permission_denied: () => "Kalsa n'a pas la permission d'ouvrir ce fichier. Choisis-en un autre.",
    unsupported: () => "Kalsa ne peut pas ouvrir ce fichier. Choisis-en un autre.",
    is_folder: () => "C'est un dossier. Choisis un fichier à l'intérieur.",
    too_large: (params) =>
      typeof params.limit === "string"
        ? `Ce fichier est trop volumineux (limite : ${params.limit}). Essaie-en un plus petit.`
        : "Ce fichier est trop volumineux. Essaie-en un plus petit.",
  },
  vision: {
    does_not_fit: () => "Cet ordinateur n'a pas assez de mémoire pour que cette IA voie les images.",
    busy: () => "Kalsa prépare déjà la prise en charge des images. Patiente un instant.",
    none: () => "La prise en charge des images n'est pas disponible pour cette IA.",
  },
  web: {
    page_too_long: () => "Cette page est trop longue pour que Kalsa la lise.",
    search_failed: () => "Kalsa n'a pas pu chercher sur le web. Réessaie.",
    page_failed: () => "Kalsa n'a pas pu ouvrir cette page. Réessaie.",
    open_failed: () => "Cet ordinateur n'a pas pu ouvrir le lien.",
  },
  browser: {
    unsupported_platform: () => "Cet ordinateur n'a pas de navigateur que Kalsa puisse utiliser.",
    busy: () => "Kalsa utilise déjà le navigateur. Réessaie dans un instant.",
    cancelled: () => "Le téléchargement a été arrêté. Rien n'a été installé.",
    download_failed: () => "Kalsa n'a pas pu télécharger son pilote de navigateur. Réessaie.",
    driver_corrupt: () => "Le pilote du navigateur est endommagé, Kalsa n'a rien installé.",
    driver_changed: () => "Le pilote du navigateur sur le disque n'est pas celui que Kalsa a installé.",
    unpack_failed: () => "Le pilote du navigateur ne s'est pas décompressé en quelque chose d'utilisable.",
    storage: () => "Kalsa n'a pas pu lire ou écrire son propre dossier.",
    failed: () => "Kalsa n'a pas pu joindre le navigateur. Réessaie.",
    refused: () => "Kalsa n'a pas voulu ouvrir cela.",
    no_pending_request: () => "Cette requete n’attend plus de reponse.",
  },
};