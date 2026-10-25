// Tradotto dal copy inglese approvato.

const offerName = "Fai vedere le immagini a Kalsa";

export const VISION = {
  offerName,
  offer: (size: string) => `${offerName} · ${size}`,
  downloadQ: (size: string) =>
    `Scaricare ${size} perché Kalsa possa vedere le immagini? Al termine Kalsa si riavvia.`,
  download: "Scarica",
  notNow: "Non ora",
  restarting: "Riavvio di Kalsa…",
  tryAgain: "Riprova",
  doesNotFit: "Su questo computer non c'è abbastanza memoria perché questa AI veda le immagini.",
};
