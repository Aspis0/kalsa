import { CHROME } from "./chrome";
import { COMPOSER } from "./composer";
import { HOME } from "./home";
import { SETUP } from "./setup";
import { MACHINE } from "./machine";
import { POWER } from "./power";
import { SIDEBAR } from "./sidebar";
import { SHELL } from "./shell";
import { THREAD } from "./thread";
import { FILES } from "./files";
import { VISION } from "./vision";
import { TOOLS } from "./tools";
import { MINIAPP } from "./miniapp";
import { DEVICES } from "./devices";
import { INVITE } from "./invite";
import { REPORT } from "./report";
import { ROOM } from "./room";
import type { English } from "../en/all";

export const HELP: English["help"] = {
  sections: [
    {
      title: "Qué es Kalsa",
      paragraphs: ["Kalsa es una asistente de IA que funciona en tu equipo y también en tu teléfono. Las dos trabajan juntas:"],
      items: [
        "El teléfono tiene su propia IA pequeña, así que funciona aunque el equipo esté apagado.",
        "Cuando el equipo está encendido, el teléfono puede usar la IA más grande del equipo para responder.",
      ],
    },
    {
      title: `La ${CHROME.room}`,
      paragraphs: [`La ${CHROME.room} es un chat de grupo donde Kalsa puede responder.`],
      items: [
        "Todos escriben en la misma conversación, desde un equipo o un teléfono.",
        `Escribe **@Kalsa** en un mensaje, o pulsa **${ROOM.askKalsa}**, y Kalsa lee la conversación y responde.`,
        `Cada persona elige un nombre para la ${CHROME.room}. Kalsa responde a una pregunta cada vez, por orden.`,
        "Puedes compartir fotos y vídeos cortos.",
      ],
    },
    {
      title: "Primeros pasos",
      paragraphs: [],
      items: [
        `Pulsa **${SETUP.start}**. Kalsa revisa tu equipo y propone la IA que mejor funciona en él.`,
        `Elige **${MACHINE.smartest}** o **${MACHINE.quickest}**, pulsa **${SETUP.continue}** y confirma la descarga. Antes ves su tamaño.`,
        "Después Kalsa prueba el equipo para encontrar la forma más rápida de usar la IA. Solo ocurre una vez.",
        "Si ninguna IA funciona lo bastante bien en este equipo, Kalsa lo dice y no arranca.",
      ],
    },
    {
      title: CHROME.home,
      paragraphs: [],
      items: [
        "El botón grande **enciende** o **apaga** Kalsa.",
        `**${POWER.onAsleep}**: tras unos minutos sin mensajes (5 por defecto), Kalsa libera memoria. Tu siguiente mensaje la reactiva.`,
        `**${HOME.details}** en **${CHROME.home}** abre **${CHROME.pages.models}**: qué IA usa Kalsa y a qué velocidad. **${CHROME.pages.devices}** conecta un teléfono.`,
      ],
    },
    {
      title: "Chatear",
      paragraphs: [],
      items: [
        "Escribe en el cuadro y pulsa Intro. Mayús+Intro pasa a una nueva línea.",
        `**${SIDEBAR.newChat}** empieza una conversación. **${SHELL.conversations}**, arriba del chat, lista tus chats anteriores, que puedes buscar, renombrar o borrar.`,
        `**${COMPOSER.think}**: Kalsa reflexiona antes de responder. Las respuestas tardan más pero son más cuidadas. No todas las IA lo tienen.`,
        `**${THREAD.tryAgain}** aparece cuando una respuesta falla.`,
        "Kalsa puede equivocarse. Comprueba la información importante.",
      ],
    },
    {
      title: "Archivos e imágenes",
      paragraphs: [],
      items: [
        "Usa el clip, o arrastra un archivo a la ventana: texto, PDF, Word (.docx), PowerPoint (.pptx), CSV.",
        `Un archivo se lee con tu siguiente mensaje. Pulsa la chincheta (**${FILES.pinName}**) para mantenerlo durante toda la conversación.`,
        "Los PDF escaneados (fotos de páginas) todavía no se pueden leer.",
        `Para usar fotos y vídeos, Kalsa puede ofrecerte antes una pequeña descarga: **${VISION.offerName}**.`,
      ],
    },
    {
      title: "Búsqueda web",
      paragraphs: [],
      items: [
        `Kalsa puede buscar en la web cuando una pregunta necesita información actual. Puedes desactivarlo en **${CHROME.settings}**.`,
        "Una búsqueda envía solo las palabras buscadas, o la dirección de la página que se abre, nunca toda tu conversación.",
        `Si has adjuntado un documento, Kalsa te muestra antes exactamente qué enviaría y pregunta: **${TOOLS.sendIt}** o **${TOOLS.refuse}**.`,
      ],
    },
    {
      title: "Respuestas interactivas",
      paragraphs: [`A veces Kalsa crea una pequeña herramienta dentro de la respuesta. Por ejemplo: **${MINIAPP.named.quick_calculator}**, **${MINIAPP.named.reading_quiz}**, **${MINIAPP.named.checklist}** o **${MINIAPP.named.compare_data}**.`],
      items: [],
    },
    {
      title: "Conectar un teléfono",
      paragraphs: [],
      items: [
        `Abre **${CHROME.pages.devices}** y apunta la cámara del teléfono al cuadro. Luego pulsa **${DEVICES.allow}** en el equipo. Muestra el cuadro solo a tu propio teléfono.`,
        `Para añadir a alguien que no está en casa, usa **${INVITE.inviteByLink}**. El enlace funciona una vez y caduca.`,
        "Varios teléfonos pueden usar Kalsa. Si preguntan a la vez, algunos esperan su turno.",
      ],
    },
    {
      title: "Si algo va mal",
      // Help draws the Report a problem block under this section.
      report: true,
      paragraphs: [
        "Durante la alfa, Kalsa envía informes de error con detalles técnicos y, cuando algo grave falla, el registro de la app. Tus chats y tus textos nunca se envían. Puedes desactivarlo en Ajustes.",
        `En **${REPORT.title}**, pulsa **${REPORT.send}**.`,
      ],
      items: [],
    },
    {
      title: "Por qué Kalsa",
      // Its figures are the ones the sources line cites; Help prints it here only.
      cited: true,
      paragraphs: [],
      items: [
        "La mayor parte de lo que la gente pregunta a los chatbots es ayuda cotidiana: consejos prácticos, buscar información y escribir. Casi el 80 % de las conversaciones de ChatGPT son de este tipo (estudio NBER, septiembre de 2025).",
        "Para esto no hace falta una IA gigante en un centro de datos. Basta una buena IA en el equipo que ya tienes, y tus chats se quedan en él. Algunas cosas sí pueden salir: las búsquedas web, un documento que decides enviar, los informes de error y la comprobación de actualizaciones.",
        "La IA de Kalsa solo puede hacer tres cosas por sí sola: buscar en la web, abrir una página y crear una pequeña app en el chat. No puede abrir tus archivos, ejecutar programas, instalar nada ni enviar mensajes. Además es una IA pequeña, por ahora menos capaz que las grandes IA de internet. Cuando tenga nuevas capacidades, las usará en un espacio cerrado, separado del resto del equipo.",
        "En 2024, los centros de datos usaron cerca de 415 TWh de electricidad, aproximadamente el 1,5 % de la electricidad mundial, y la Agencia Internacional de la Energía prevé que esa cifra sea más del doble en 2030.",
        "La mayor parte de la huella de un equipo a lo largo de su vida procede de fabricarlo (informes de producto de Dell), y en 2022 el mundo generó 62 millones de toneladas de residuos electrónicos (Global E-waste Monitor 2024). Kalsa está pensada para aprovechar el equipo que ya tienes, aunque no sea nuevo.",
      ],
    },
  ],
  sources: "Fuentes: NBER Working Paper 34255 (2025); AIE, Energy and AI (2025); huella de carbono de los productos de Dell; Global E-waste Monitor 2024.",
};
