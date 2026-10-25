import type { UPDATES as ENGLISH } from "../en/updates";

export const UPDATES: typeof ENGLISH = {
  title: "Aggiornamenti",
  currentVersion: "Versione",
  check: "Cerca aggiornamenti",
  checking: "Cerco aggiornamenti…",
  upToDate: "Kalsa è aggiornata.",
  available: (version: string) => `È disponibile Kalsa ${version}.`,
  install: "Riavvia per aggiornare",
  downloading: (percent: number | null) =>
    percent === null ? "Scarico l'aggiornamento…" : `Scarico l'aggiornamento… ${percent}%`,
  busy: "Kalsa sta scrivendo una risposta. Potrai installare quando avrà finito.",
  note: "Kalsa cerca aggiornamenti poco dopo l'avvio.",
  ready: "È pronta una nuova versione di Kalsa",
  whatsNew: "Novità",
  later: "Più tardi",
};
