import type { DRIVER as ENGLISH } from "../en/driver";

export const DRIVER: typeof ENGLISH = {
  title: "Navegador",
  hint: "Kalsa conduce el navegador que ya hay en este ordenador. Su controlador es una descarga aparte.",
  needed: (size) => `Descargar el controlador del navegador (${size}).`,
  download: "Descargar",
  downloading: (percent) =>
    percent === null
      ? "Descargando el controlador del navegador…"
      : `Descargando el controlador del navegador… ${percent}%`,
  ready: "El controlador del navegador de Kalsa está listo.",
  failed: "Kalsa no ha podido descargar su controlador del navegador. Inténtalo de nuevo.",
  retry: "Inténtalo de nuevo",
  cancel: "Detener la descarga",
  cancelled: "Se ha detenido la descarga. No se ha instalado nada.",
  note: "Son unos 40 MB, se comprueba antes de usarlo y Kalsa no lo actualiza por su cuenta.",
  clearTitle: "Datos del navegador",
  clearHint: "Las sesiones y las páginas que guardó el navegador de Kalsa.",
  clear: "Borrar los datos del navegador de Kalsa",
  cleared: "Los datos del navegador de Kalsa se han borrado.",
  clearFailed: "Kalsa no ha podido borrar los datos del navegador. No se ha cambiado nada.",
  clearOpen: "Cierra la ventana del navegador para borrarlos.",
  back: "Volver a Ajustes",
};