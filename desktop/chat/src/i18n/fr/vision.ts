// Traduit du copy anglais approuvé.

const offerName = "Laisse Kalsa voir les images";

export const VISION = {
  offerName,
  offer: (size: string) => `${offerName} · ${size}`,
  downloadQ: (size: string) =>
    `Télécharger ${size} pour que Kalsa puisse voir les images ? Kalsa redémarre une fois le téléchargement terminé.`,
  download: "Télécharger",
  notNow: "Pas maintenant",
  restarting: "Redémarrage de Kalsa…",
  tryAgain: "Réessaie",
  doesNotFit: "Cet ordinateur n'a pas assez de mémoire pour que cette IA voie les images.",
};
