// Tradotto dal copy inglese approvato.

export const CHROME = {
    "home": "Inicio",
    "room": "Sala",
    "chat": "Chat",
    "settings": "Ajustes",
      "mail": "Correo",
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
    "webSearchNote": "Cuando una pregunta necesita información actual, Kalsa puede buscar en la web y abrir páginas. Cada búsqueda envía las palabras que Kalsa eligió, y la dirección de cada página que abre, a un servicio de búsqueda en internet. Los resultados se quedan en la conversación. Con esto desactivado no se busca ni se pide nada, y Kalsa responde con lo que ya sabe.",
    "lede": "A tus mensajes responde este equipo, y todo se queda aquí.",
    "language": "Idioma",
    "languageSystem": "Según el sistema",
    "ai": "IA",
    "usingAi": (name: string) => `Usando ${name}`,
    "mail": "",
    "mailHint": "Lee tu buzón en el chat y responde.",
    "mailOpen": "Configurar el correo",
    "aiDetails": "Cambiar o ver detalles"
  };

