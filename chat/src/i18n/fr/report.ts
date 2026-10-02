// Traduit du texte anglais approuvé.

export const REPORT = {
  title: "Signaler un problème",
  privacy: "Le journal ne contient jamais vos conversations, vos fichiers ni aucun code d'appairage.",
  facts: "Il contient ce que Kalsa a fait et ce que cet ordinateur a : versions, carte graphique, mémoire, erreurs.",
  send: "Envoyer le journal",
  open: "Ouvrir le dossier des journaux",
  openFailed: "Kalsa n'a pas pu ouvrir le dossier des journaux.",
  sending: "Envoi…",
  sentWithId: (id: string) => `Envoyé. Votre numéro de rapport est ${id} : communiquez-nous ce numéro.`,
  errRateLimited: "Attendez une minute et réessayez.",
  errTryTomorrow: "Nous avons reçu trop de rapports aujourd'hui. Réessayez demain.",
  errSend: "Impossible d'envoyer. Vérifiez la connexion internet et réessayez.",
  crashTitle: "Un problème est survenu",
  notNow: "Pas maintenant",
};
