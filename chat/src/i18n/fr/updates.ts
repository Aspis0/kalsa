import type { UPDATES as ENGLISH } from "../en/updates";

export const UPDATES: typeof ENGLISH = {
  title: "Mises à jour",
  currentVersion: "Version",
  check: "Rechercher des mises à jour",
  checking: "Recherche de mises à jour…",
  upToDate: "Kalsa est à jour.",
  available: (version: string) => `Kalsa ${version} est disponible.`,
  install: "Redémarrer pour mettre à jour",
  downloading: (percent: number | null) =>
    percent === null ? "Téléchargement de la mise à jour…" : `Téléchargement de la mise à jour… ${percent} %`,
  busy: "Kalsa est en train de répondre. Installe quand elle a fini.",
  note: "Kalsa cherche les mises à jour peu après son démarrage.",
  ready: "Une nouvelle version de Kalsa est prête",
  whatsNew: "Nouveautés",
  later: "Plus tard",
};
