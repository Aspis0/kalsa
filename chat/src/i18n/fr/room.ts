// Tradotto dal copy inglese approvato.

import type { RoomTable } from "../en/room";

export const ROOM: RoomTable = {
  listJoin: (items) => {
    if (items.length < 3) return items.join(" et ");
    return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
  },
  closedRoom: "Allume Kalsa pour utiliser le salon.",
  emptyRoom: "Pas encore de messages. Dis quelque chose, ou demande à Kalsa.",
  queueNext: (name: string) => `Kalsa répondra d'abord à ${name}.`,
  queueThen: (name: string, rest: string) => `Kalsa répondra d'abord à ${name}, puis ${rest}.`,
  askKalsa: "Demande à Kalsa",
  writePlaceholder: "Écris, ou tape @Kalsa…",
  writeAria: "Message",
  nameAria: "Ton nom",
  namePlaceholder: "Ton nom",
  youAre: (name: string) => `Tu es ${name}`,
  left: " · n'est plus là",
  askedKalsa: "a demandé à Kalsa ·",
  readLast: (count: number) =>
    count === 1 ? " · a lu le dernier message" : ` · a lu les ${count} derniers messages`,
  sendFailed: "Le message n'est pas arrivé au salon. Réessaie.",
  notes: {
    "busy_waiting": "Kalsa est occupée avec une autre conversation. Tu gardes ton tour.",
    "unavailable": "Kalsa ne peut pas répondre dans ce salon pour le moment.",
    "empty_answer": "Kalsa n'a pas eu de réponse à cela.",
    "could_not_start": "Kalsa n'a pas pu démarrer. Réessaie.",
    "engine_problem": "Kalsa a eu un problème sur cet ordinateur et n'a pas pu répondre. Réessaie.",
    "seat_timeout": "Kalsa a attendu son tour au moteur et a renoncé. Redemande.",
    "too_large": "Ce message est trop long pour le salon. Raccourcis-le ou coupe-le en deux.",
    "read_only": "Le salon n'accepte pas de messages pour le moment. Réessaie dans un instant.",
    "client_msg_id_reused": "Ce message est déjà dans le salon.",
    "internal": "Quelque chose a mal tourné sur cet ordinateur. Réessaie.",
    "already_pending": "Tu as déjà une question en attente pour Kalsa.",
    "name_taken": "Quelqu'un dans ce salon utilise déjà ce nom. Choisis-en un autre.",
    "name_reserved": "Kalsa est le nom de l'assistant. Choisis-en un autre.",
    "name_framing": "Les noms ne peuvent pas contenir [ ni ].",
    "name_mixed_scripts": "Utilise les lettres d'un seul alphabet dans ton nom.",
    "name_too_long": "Ce nom est trop long. Essaie-en un plus court."
  },
};
