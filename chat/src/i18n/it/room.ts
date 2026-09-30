// Tradotto dal copy inglese approvato.

import type { RoomTable } from "../en/room";

export const ROOM: RoomTable = {
  listJoin: (items) => {
    if (items.length < 3) return items.join(" e ");
    return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
  },
  closedRoom: "Accendi Kalsa per usare la stanza.",
  emptyRoom: "Ancora nessun messaggio. Dì qualcosa, o chiedi a Kalsa.",
  answering: (name: string) => `Kalsa sta rispondendo a ${name}.`,
  queueNext: (name: string) => `Kalsa risponderà prima a ${name}.`,
  queueThen: (name: string, rest: string) => `Kalsa risponderà prima a ${name}, poi ${rest}.`,
  stop: "Ferma",
  askKalsa: "Chiedi a Kalsa",
  writePlaceholder: "Scrivi, oppure @Kalsa…",
  writeAria: "Messaggio",
  nameAria: "Il tuo nome",
  namePlaceholder: "Il tuo nome",
  youAre: (name: string) => `Tu sei ${name}`,
  left: " · uscito",
  askedKalsa: "ha chiesto a Kalsa · ",
  readLast: (count: number) => ` · ha letto gli ultimi ${count}`,
  notes: {
    "busy_waiting": "Kalsa è impegnato con un'altra conversazione. Tieni il tuo turno.",
    "unavailable": "Kalsa non può rispondere in questa stanza adesso.",
    "empty_answer": "Kalsa non ha dato una risposta.",
    "could_not_start": "Kalsa non è riuscito a partire. Riprova.",
    "engine_problem": "Kalsa ha avuto un problema su questo computer e non ha potuto rispondere. Riprova.",
    "already_pending": "Hai già una domanda in attesa di Kalsa.",
    "name_taken": "In questa stanza qualcuno usa già quel nome. Scegline un altro.",
    "name_reserved": "Kalsa è il nome dell'assistente. Scegline un altro.",
    "name_framing": "I nomi non possono contenere [ o ].",
    "name_mixed_scripts": "Usa le lettere di un solo alfabeto nel nome.",
    "name_too_long": "Quel nome è troppo lungo. Prova più corto."
  },
};
