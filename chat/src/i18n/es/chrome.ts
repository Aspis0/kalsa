// Tradotto dal copy inglese approvato.

export const CHROME = {
    "home": "Inicio",
    "room": "Sala",
    "chat": "Chat",
    "settings": "Ajustes",
    "navigation": "Páginas",
    // The settings surfaces' names, keyed as the shell looks them up.
    pages: {
    "help": "Ayuda",
      "models": "Tu IA",
      "devices": "Teléfonos",
      "settings": "Ajustes",
    } as Record<string, string>,
    "showConversations": "Mostrar chats"
  };

export const SETTINGS = {
    "title": "Ajustes",
    "look": "Aspecto",
    "lookLight": "Claro",
    "lookDark": "Oscuro",
    "lookAuto": "Automático",
    "webSearch": "Deja que Kalsa busque en la web",
    "webSearchHint": "Solo las palabras de la búsqueda salen a internet. Tus chats se quedan aquí.",
    "webSearchMore": "¿Qué sale de este equipo?",
    "webSearchNote": "Cuando tu pregunta necesita algo actual, el asistente puede buscar en la web y abrir una página. Esa búsqueda — las palabras que eligió y la dirección que abre — sale de este equipo hacia un servicio de búsqueda en internet, y lo que vuelve queda en la conversación. Con esto apagado no se envía nada y el asistente responde con lo que ya sabe. El cambio se aplica en cuanto lo tocas.",
    "lede": "A tus mensajes responde este equipo, y todo se queda aquí.",
    "language": "Idioma",
    "languageSystem": "Según el sistema",
    "ai": "IA",
    "usingAi": (name: string) => `Usando ${name}`,
    "aiDetails": "Cambiar o ver detalles"
  };

