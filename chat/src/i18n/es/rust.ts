// Traducido del copy inglés aprobado.

export const RUST: {
  startup: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  choice: Record<string, (params: Record<string, unknown>, tag: string) => string>;
  app: Record<string, (params: Record<string, unknown>, tag: string) => string>;
} = {
  startup: {
    cannot_run_yet: () => "Kalsa aún no puede funcionar en este equipo. Busca una actualización de la app.",
    no_suitable_choice: () => "Kalsa todavía no tiene una IA que funcione bien en este equipo. Busca una actualización de la app.",
    connection_lost: () => "Kalsa no pudo descargar lo que necesita. Comprueba la conexión y prueba de nuevo.",
    network_blocks_download: () => "Kalsa no pudo descargar lo que necesita en esta red. Prueba con otra red.",
    download_failed: () => "Kalsa no terminó de descargar. Prueba de nuevo más tarde.",
    needs_check: () => "Kalsa necesita revisar este equipo antes de poder arrancar. Prueba de nuevo.",
    choice_too_large: () => "Esta IA es demasiado grande para este equipo. Elige una más pequeña en la página IA.",
    choice_unavailable: () => "Kalsa no pudo arrancar con esta IA. Elige otra en la página IA.",
    conversation_too_long: () => "Esta longitud de conversación es demasiado para esta IA. Elige una más pequeña en Avanzado.",
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
    stopped: () => "Kalsa se detuvo por sí sola. Vuelve a encenderla.",
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
};
