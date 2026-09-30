// Traducido del copy inglés aprobado.

export const SIDEBAR = {
    "aria": "Conversaciones",
    "searchAria": "Buscar en las conversaciones",
    "searchPlaceholder": "Buscar",
    "focusSearch": "Ir a la búsqueda",
    "newChat": "+ Nueva conversación",
    "titleAria": "Título de la conversación",
    "rename": "Renombrar",
    "sure": "¿Seguro?",
    "delete": "Eliminar",
    "liveAria": " (generando)",
    "noMatch": (query: string) => `Ninguna conversación coincide con “${query}”.`,
    "capped": (shown: number, total: number) => `Se muestran las primeras ${shown} de ${total} coincidencias.`,
    "groups": {
      "today": "Hoy",
      "yesterday": "Ayer",
      "thisWeek": "Esta semana",
      "earlier": "Antes",
    } as Record<string, string>,
  };
