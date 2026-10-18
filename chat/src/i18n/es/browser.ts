// Traducido del copy inglés aprobado.

export const BROWSER = {
  home: "Inicio",
  searchHere: "Buscar aquí",
  attach: "Adjuntar",
  readingFolder: "Leyendo la carpeta…",
  truncated: "Primeras 500 entradas de la carpeta, por orden alfabético.",
  skippedEntries: (count: number) => `No se pudieron leer ${count} entradas.`,
  notDesktop: "Explorar el disco de este equipo solo es posible en la app de escritorio.",
  searchPlaceholder: "Buscar por nombre o ruta",
  searchButton: "Buscar",
  searchingIn: (scope: string) => `Buscando en ${scope}`,
  looking: "…",
  noScope: "No hay ninguna carpeta donde buscar.",
  viaIndex: "Los resultados vienen del índice de archivos de este Mac, que omite los archivos ocultos y algunas carpetas. ",
  skippedSome: (count: number) => `${count} entradas que el sistema no muestra se omitieron. `,
  limited: "Se muestran las primeras 500. Usa palabras más concretas para ver el resto.",
  readingFolders: "Leyendo las carpetas de este equipo…",
  folder: "carpeta",
};

/**
 * La tarjeta que una persona debe decidir, y el control Pausa.
 *
 * **Las dos respuestas son todo.** Lo demás cuenta a una persona qué está a
 * punto de recibir el sitio de un desconocido, así que se habla de la petición
 * y no del modelo: el botón dice qué le hace a la petición.
 */
export const CONFIRM = {
  wantsToSend: (host: string) => `${host} quiere enviar:`,
  /** Said under the host when the request goes over plain `http`. */
  insecure: "Conexión no segura",
  waiting: "Todavía no se ha enviado nada.",
  allow: "Enviarlo",
  decline: "No enviarlo",
  asking: "Enviando…",
  none: "Sin campos: solo la petición.",
  paused: "En pausa",
  resume: "Reanudar",
  pauseHint: "Pausar detiene la próxima acción. Lo ya enviado no se puede retirar.",
  runningHint: "En pausa. Kalsa no está actuando en el navegador.",

  /** What became of the request a person just answered, in their own words:
   *  the one thing they are told about it after the card goes. */
  sentTo: (host: string) => `Enviado a ${host}`,
  show: "Mostrar",
  hide: "Ocultar",
  notSentNo: "No enviado — no se autorizó",
  notSentLate: "No enviado — nadie respondió a tiempo",
  notSentGone: "No enviado — se cerró la ventana del navegador",
  notSentHidden: "No enviado — no se podía mostrarte",
  unclear: "No está claro — puede que se haya enviado",
};
