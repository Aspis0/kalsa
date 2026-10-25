import type { DRIVER as ENGLISH } from "../en/driver";

export const DRIVER: typeof ENGLISH = {
  title: "Navigateur",
  hint: "Kalsa pilote le navigateur déjà présent sur cet ordinateur. Son pilote est un téléchargement à part.",
  needed: (size) => `Télécharger le pilote du navigateur (${size}).`,
  download: "Télécharger",
  downloading: (percent) =>
    percent === null ? "Téléchargement du pilote du navigateur…" : `Téléchargement du pilote du navigateur… ${percent}%`,
  ready: "Le pilote du navigateur de Kalsa est prêt.",
  failed: "Kalsa n'a pas pu télécharger son pilote de navigateur. Réessayez.",
  retry: "Réessayer",
  cancel: "Arrêter le téléchargement",
  cancelled: "Le téléchargement a été arrêté. Rien n'a été installé.",
  note: "Environ 40 Mo, vérifié avant d'être utilisé, et Kalsa ne le met pas à jour toute seule.",
  clearTitle: "Données du navigateur",
  clearHint: "Les connexions et les pages gardées par le navigateur de Kalsa.",
  clear: "Effacer les données du navigateur de Kalsa",
  cleared: "Les données du navigateur de Kalsa ont été effacées.",
  clearFailed: "Kalsa n'a pas pu effacer les données de son navigateur. Rien n'a été modifié.",
  clearOpen: "Fermez la fenêtre du navigateur pour les effacer.",
  back: "Retour aux Réglages",
};