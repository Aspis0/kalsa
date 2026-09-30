// Tradotto dal copy inglese approvato.

import type { RoomTable } from "../en/room";

export const ROOM: RoomTable = {
  listJoin: (items) => {
    if (items.length < 3) return items.join(" y ");
    return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`;
  },
  closedRoom: "Enciende Kalsa para usar la sala.",
  emptyRoom: "Aún no hay mensajes. Di algo, o pregunta a Kalsa.",
  answering: (name: string) => `Kalsa está respondiendo a ${name}.`,
  queueNext: (name: string) => `Kalsa responderá primero a ${name}.`,
  queueThen: (name: string, rest: string) => `Kalsa responderá primero a ${name}, luego a ${rest}.`,
  stop: "Detener",
  askKalsa: "Preguntar a Kalsa",
  writePlaceholder: "Escribe, o teclea @Kalsa…",
  writeAria: "Mensaje",
  nameAria: "Tu nombre",
  namePlaceholder: "Tu nombre",
  youAre: (name: string) => `Eres ${name}`,
  left: " · ya no está",
  askedKalsa: "preguntó a Kalsa ·",
  readLast: (count: number) =>
    count === 1 ? " · leyó el último mensaje" : ` · leyó los últimos ${count} mensajes`,
  notes: {
    "busy_waiting": "Kalsa está ocupada con otra conversación. Conservas tu turno.",
    "unavailable": "Kalsa no puede responder en esta sala ahora mismo.",
    "empty_answer": "Kalsa no tuvo respuesta para eso.",
    "could_not_start": "Kalsa no pudo arrancar. Inténtalo de nuevo.",
    "engine_problem": "Kalsa tuvo un problema en este equipo y no pudo responder. Inténtalo de nuevo.",
    "already_pending": "Ya tienes una pregunta esperando a Kalsa.",
    "name_taken": "Alguien en esta sala ya usa ese nombre. Elige otro.",
    "name_reserved": "Kalsa es el nombre del asistente. Elige otro.",
    "name_framing": "Los nombres no pueden usar [ ni ].",
    "name_mixed_scripts": "Usa letras de un solo alfabeto en el nombre.",
    "name_too_long": "Ese nombre es demasiado largo. Prueba uno más corto."
  },
};
