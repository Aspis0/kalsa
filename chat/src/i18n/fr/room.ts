// Tradotto dal copy inglese approvato.

import type { RoomTable } from "../en/room";

export const ROOM: RoomTable = {
  listJoin: (items) => items.join(" et "),
  closedRoom: "Allume Kalsa pour utiliser le salon.",
  emptyRoom: "Pas encore de messages. Dis quelque chose, ou demande à Kalsa.",
  answering: (name: string) => `Kalsa répond à ${name}.`,
  queueNext: (name: string) => `Kalsa répondra d'abord à ${name}.`,
  queueThen: (name: string, rest: string) => `Kalsa répondra d'abord à ${name}, puis ${rest}.`,
  stop: "Arrêter",
  askKalsa: "Demander à Kalsa",
  writePlaceholder: "Écris, ou tape @Kalsa…",
  writeAria: "Message",
  nameAria: "Ton nom",
  namePlaceholder: "Ton nom",
  youAre: (name: string) => `Tu es ${name}`,
  left: " · parti",
  askedKalsa: "a demandé à Kalsa · ",
  readLast: (count: number) => ` · a lu les ${count} derniers`,
  notes: {
    "busy_waiting": "Kalsa est occupé avec une autre conversation. Tu gardes ton tour.",
    "unavailable": "Kalsa ne peut pas répondre dans ce salon pour le moment.",
    "empty_answer": "Kalsa n'a pas eu de réponse à cela.",
    "could_not_start": "Kalsa n'a pas pu démarrer. Réessaie.",
    "engine_problem": "Kalsa a eu un problème sur ce computer et n'a pas pu répondre. Réessaie.",
    "already_pending": "Tu as déjà une question en attente pour Kalsa.",
    "name_taken": "Quelqu'un dans ce salon utilise déjà ce nom. Choisis-en un autre.",
    "name_reserved": "Kalsa est le nom de l'assistant. Choisis-en un autre.",
    "name_framing": "Les noms ne peuvent pas contenir [ ni ].",
    "name_mixed_scripts": "Utilise les lettres d'un seul alphabet dans ton nom.",
    "name_too_long": "Ce nom est trop long. Essaie plus court."
  },
};
