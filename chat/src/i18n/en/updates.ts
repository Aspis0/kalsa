export const UPDATES = {
  title: "Updates",
  currentVersion: "Version",
  check: "Check for updates",
  checking: "Checking for updates…",
  upToDate: "Kalsa is up to date.",
  available: (version: string) => `Kalsa ${version} is available.`,
  install: "Install and restart",
  downloading: (percent: number | null) =>
    percent === null ? "Downloading the update…" : `Downloading the update… ${percent}%`,
  busy: "Kalsa is writing a reply. Install when it finishes.",
  note: "Kalsa checks for updates a little after she starts. Nothing is installed without you.",
  ready: (version: string) => `Kalsa ${version} is ready.`,
};
