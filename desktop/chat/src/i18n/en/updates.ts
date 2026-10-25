export const UPDATES = {
  title: "Updates",
  currentVersion: "Version",
  check: "Check for updates",
  checking: "Checking for updates…",
  upToDate: "Kalsa is up to date.",
  available: (version: string) => `Kalsa ${version} is available.`,
  install: "Restart to update",
  downloading: (percent: number | null) =>
    percent === null ? "Downloading the update…" : `Downloading the update… ${percent}%`,
  busy: "Kalsa is writing a reply. Install when it finishes.",
  note: "Kalsa checks for updates shortly after it starts.",
  ready: "A new version of Kalsa is ready",
  whatsNew: "What’s new",
  later: "Later",
};
