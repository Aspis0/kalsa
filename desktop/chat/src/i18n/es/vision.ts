// Traducido del copy inglés aprobado.

const offerName = "Deja que Kalsa vea imágenes";

export const VISION = {
  offerName,
  offer: (size: string) => `${offerName} · ${size}`,
  downloadQ: (size: string) =>
    `¿Descargar ${size} para que Kalsa pueda ver imágenes? Kalsa se reinicia al terminar.`,
  download: "Descargar",
  notNow: "Ahora no",
  restarting: "Reiniciando Kalsa…",
  tryAgain: "Probar de nuevo",
  doesNotFit: "Este equipo no tiene memoria suficiente para que esta IA vea imágenes.",
};
