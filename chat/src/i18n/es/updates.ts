import type { UPDATES as ENGLISH } from "../en/updates";

export const UPDATES: typeof ENGLISH = {
  title: "Actualizaciones",
  currentVersion: "Versión",
  check: "Buscar actualizaciones",
  checking: "Buscando actualizaciones…",
  upToDate: "Kalsa está al día.",
  available: (version: string) => `Hay una nueva versión de Kalsa: ${version}.`,
  install: "Reiniciar para actualizar",
  downloading: (percent: number | null) =>
    percent === null ? "Descargando la actualización…" : `Descargando la actualización… ${percent} %`,
  busy: "Kalsa está escribiendo una respuesta. Instala cuando termine.",
  note: "Kalsa busca actualizaciones poco después de arrancar.",
  ready: "Ya hay una nueva versión de Kalsa",
  whatsNew: "Novedades",
  later: "Más tarde",
};
