// Traducido del copy inglés aprobado.

export const REPORT = {
  title: "Informar de un problema",
  privacy: "El registro nunca contiene tus mensajes, las respuestas de Kalsa, tus archivos, ni ningún código o clave.",
  facts:
    "Contiene lo que hizo Kalsa y lo que tiene este equipo: versiones, procesador, tarjeta gráfica, memoria, errores.",
  send: "Enviar el registro",
  open: "Abrir la carpeta de registros",
  openFailed: "Kalsa no pudo abrir la carpeta de registros.",
  sending: "Enviando…",
  sentWithId: (id: string) => `Enviado. Tu número de informe es ${id}: dinos este número.`,
  errRateLimited: "Espera un minuto e inténtalo de nuevo.",
  errTryTomorrow: "Hoy hemos recibido demasiados informes. Inténtalo de nuevo mañana.",
  errSend: "No se pudo enviar. Comprueba la conexión a internet e inténtalo de nuevo.",
  crashTitle: "Algo ha ido mal",
  crashUncleanTitle: "Kalsa no se cerró correctamente la última vez",
  crashUncleanBody: "Si algo fue mal, enviar el registro nos ayuda a arreglarlo.",
  notNow: "Ahora no",
};
