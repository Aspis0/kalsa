// Traducido del copy inglés aprobado.

export const SIDEBAR = {
    "aria": "Chats",
    "searchAria": "Buscar en las conversaciones",
    "searchPlaceholder": "Buscar",
    "focusSearch": "Ir a la búsqueda",
    "newChat": "Nueva conversación",
    "titleAria": "Título de la conversación",
    "rename": "Renombrar",
    "enterToSave": "Enter para guardar",
    "cancel": "Cancelar",
    "sure": "¿Eliminar esta conversación?",
    "deleteBody": (title: string) => `«${title}»`,
    "delete": "Eliminar",
    "liveAria": " (generando)",
    "noMatch": (query: string) => `Ninguna conversación coincide con “${query}”. Prueba otra palabra.`,
    "capped": (shown: number, total: number) => `Se muestran ${shown} de ${total}. Añade una palabra para afinar.`,
    "groups": {
      "today": "Hoy",
      "yesterday": "Ayer",
      "thisWeek": "Esta semana",
      "earlier": "Antes",
    } as Record<string, string>,
  };
