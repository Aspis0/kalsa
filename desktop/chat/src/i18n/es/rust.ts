// Traducido del copy inglés aprobado.

/** La línea de una apertura rechazada: el host pedido, qué pasó y qué puede
    hacer la persona. **El host es la lectura de la app de su propio
    argumento**: un host, nunca la dirección entera, y nunca una dirección que
    no sea http(s) público. */
const refusedOpen = (params: Record<string, unknown>, said: string): string =>
  `Kalsa no pudo abrir ${typeof params.host === "string" && params.host !== "" ? params.host : "esa página"}: ${said}`;

/** La línea de un rechazo: la de la apertura cuando la llamada era una
    apertura, y la simple cuando no lo era. **Un clic, una escritura, una
    lectura y una foto no son una apertura**, y una línea que dice "no pudo
    abrir" para una de ellas habla de algo que nunca pasó. */
const refused = (params: Record<string, unknown>, open: string, step: string): string => {
  const action = params.action;
  if (action === "browser_open" || action === "web_fetch") return refusedOpen(params, open);
  return `Kalsa no puede hacer eso aquí: ${step}`;
};

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
    cannot_run_yet: () => "Kalsa aún no puede funcionar en este equipo. Busca una actualización de la app.",
    no_suitable_choice: () => "Kalsa todavía no tiene una IA que funcione bien en este equipo. Busca una actualización de la app.",
    connection_lost: () => "Kalsa no pudo descargar lo que necesita. Comprueba la conexión y prueba de nuevo.",
    network_blocks_download: () => "Kalsa no pudo descargar lo que necesita en esta red. Prueba con otra red.",
    download_failed: () => "Kalsa no terminó de descargar. Prueba de nuevo más tarde.",
    needs_check: () => "Kalsa necesita revisar este equipo antes de poder arrancar. Prueba de nuevo.",
    choice_too_large: () => "Esta IA es demasiado grande para este equipo. Elige una más pequeña en Tu IA.",
    choice_unavailable: () => "Kalsa no pudo arrancar con esta IA. Elige otra en Tu IA.",
    conversation_too_long: () => "Esta IA no admite conversaciones tan largas. Empieza un chat nuevo, o reduce «Tamaño del contexto» en Tu IA → Para expertos → Ajustes del servidor.",
    check_failed: () => "Kalsa no pudo revisar este equipo. Espera un momento y prueba de nuevo.",
    could_not_start: () => "Kalsa no pudo arrancar. Prueba de nuevo.",
    awaiting_choice: () => "Kalsa aún no está lista. Ve a Inicio y pulsa Iniciar.",
    disk_full: (params, tag) =>
      typeof params.gb === "number"
        ? `Kalsa necesita más espacio. Libera ${new Intl.NumberFormat(tag, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 1,
          }).format(params.gb)} GB y prueba de nuevo.`
        : "Kalsa necesita más espacio. Libera algo de sitio y prueba de nuevo.",
    restart: () => "Kalsa no pudo arrancar. Reinicia este equipo y prueba de nuevo.",
    stopped: () => "Kalsa se detuvo de forma inesperada. Vuelve a encenderla.",
    took_too_long: () => "Kalsa tardó demasiado en prepararse. Prueba de nuevo.",
    stop_unconfirmed: () => "Kalsa puede seguir encendida. Reinicia este equipo para apagarla.",
    already_starting: () => "Kalsa ya se está encendiendo. Espera un momento.",
  },
  choice: {
    save_failed: () => "Kalsa no pudo guardar esta elección. Prueba de nuevo.",
  },
  app: {
    unexpected: () => "Kalsa no pudo hacerlo. Prueba de nuevo.",
  },
  invite: {
    "invite.no_road": () => "Las invitaciones necesitan una conexión por internet. Activa «Conexión por internet» en Tu IA → Para expertos → Ajustes del servidor.",
    "invite.full": () => "Has alcanzado el máximo de invitaciones. Cancela una para crear otra.",
    "invite.could_not_make": () => "Kalsa no pudo crear la invitación. Prueba de nuevo.",
    "invite.could_not_save": () => "Kalsa no pudo guardar la invitación. Prueba de nuevo.",
    "invite.expired": () => "Esta invitación ha caducado. Haz una nueva.",
  },
  pairing: {
    "pairing.save_failed": () => "Kalsa no pudo guardar este cambio. Prueba de nuevo.",
    "pairing.phone_with_ai": (params) =>
      typeof params.gb === "number" && Number.isFinite(params.gb) && params.gb > 0
        ? "Teléfono con IA propia"
        : "Teléfono sin IA propia",
    "pairing.phone_without_ai": () => "Teléfono sin IA propia",
    "pairing.host_forget": () => "La conexión de este equipo no se puede quitar.",
  },
  update: {
    check_failed: () => "Kalsa no pudo buscar actualizaciones. Inténtalo más tarde.",
    download_failed: () => "Kalsa no pudo descargar la actualización. Inténtalo de nuevo.",
    signature_failed: () => "No se pudo verificar la actualización, así que Kalsa no la instaló.",
    install_failed: () => "Kalsa no pudo instalar la actualización. Inténtalo de nuevo.",
    busy: () => "Kalsa está arrancando. Inténtalo de nuevo cuando esté lista.",
    up_to_date: () => "Kalsa ya está al día.",
    replying: () => "Kalsa está escribiendo una respuesta. Instala la actualización cuando termine.",
    changed: () => "La actualización cambió desde la comprobación. Busca de nuevo.",
  },
  road: {
    off: () => "La conexión por internet está desactivada. El teléfono se conecta mediante Tailscale.",
    waiting: () => "La conexión por internet espera a que Kalsa esté encendida.",
    opening: () => "La conexión por internet se está abriendo.",
    open: () => "La conexión por internet está activada.",
    unavailable: () => "La conexión por internet no se pudo abrir en este equipo.",
  },
  files: {
    list_failed: () => "Kalsa no puede abrir esta carpeta. Elige otra.",
    not_found: () => "Kalsa no encuentra este archivo. Elige otro.",
    permission_denied: () => "Kalsa no tiene permiso para abrir este archivo. Elige otro.",
    unsupported: () => "Kalsa no puede abrir este archivo. Elige otro.",
    is_folder: () => "Es una carpeta. Elige un archivo dentro de ella.",
    too_large: (params) =>
      typeof params.limit === "string"
        ? `Este archivo es demasiado grande (límite ${params.limit}). Prueba con uno más pequeño.`
        : "Este archivo es demasiado grande. Prueba con uno más pequeño.",
  },
  vision: {
    does_not_fit: () => "Este equipo no tiene memoria suficiente para que esta IA vea imágenes.",
    busy: () => "Kalsa ya está preparando la compatibilidad con imágenes. Espera un momento.",
    none: () => "La compatibilidad con imágenes no está disponible para esta IA.",
  },
  web: {
    page_too_long: () => "Esa página es demasiado larga para que Kalsa la lea.",
    search_failed: () => "Kalsa no pudo buscar en la web. Prueba de nuevo.",
    page_failed: () => "Kalsa no pudo abrir esa página. Prueba de nuevo.",
    open_failed: () => "Este equipo no pudo abrir el enlace.",
    link_unseen: (params) => refusedOpen(params, "esa dirección nunca apareció en este chat. Dale a Kalsa la dirección exacta para abrirla."),
    armed: (params) => refused(params, "en este chat están tus correos o tus documentos, así que Kalsa no abre sitios web aquí. Ábrela tú.", "en este chat están tus correos o tus documentos, así que Kalsa no hace nada en sitios web. Puedes hacerlo tú."),
    switch_off: (params) => refused(params, "la web está apagada en Ajustes. Activa «Deja que Kalsa busque en la web» y Kalsa podrá abrir páginas.", "la web está apagada en Ajustes. Activa «Deja que Kalsa busque en la web» y Kalsa podrá trabajar en el navegador."),
  },
  browser: {
    unsupported_platform: () => "Este equipo no tiene un navegador que Kalsa pueda usar.",
    busy: () => "Kalsa ya está usando el navegador. Prueba de nuevo en un momento.",
    cancelled: () => "Se ha detenido la descarga. No se ha instalado nada.",
    download_failed: () => "Kalsa no ha podido descargar su controlador del navegador. Prueba de nuevo.",
    driver_corrupt: () => "El controlador del navegador está dañado, así que Kalsa no ha instalado nada.",
    driver_changed: () => "El controlador del navegador del disco no es el que Kalsa instaló.",
    unpack_failed: () => "El controlador del navegador no se ha descomprimido en algo utilizable.",
    storage: () => "Kalsa no ha podido leer o escribir su propia carpeta.",
    failed: () => "Kalsa no ha podido llegar al navegador. Prueba de nuevo.",
    refused: () => "Kalsa no ha querido abrir eso.",
    no_pending_request: () => "Esa peticion ya no esta esperando respuesta.",
    read_again: () => "Kalsa ya había leído esa parte de la página.",
    robot_check: () => "El sitio pidió una verificación humana. Kalsa no puede superarla, pero tú puedes, en la ventana del navegador.",
  },
};