/**
 * Badge privacy per i tool — generalizzati (non bio).
 * Ogni tool dichiara dove vanno i suoi dati: local / cloud / export.
 */
const TOOL_PRIVACY_BADGES = {
  chat: {
    detail: "Messages stay on this device. The local model never sends your text anywhere.",
    label: "Local only",
    mode: "local",
  },
  websearch: {
    detail: "Your query is sent to the search provider only when you run a search; sources are cited in chat.",
    label: "Cloud on demand",
    mode: "export",
  },
  web_fetch: {
    detail:
      "Only opens pages already returned by search or links you pasted; the page text is fetched on demand and cited in chat.",
    label: "Cloud on demand",
    mode: "export",
  },
  calculator: {
    detail: "Math runs on device. Exports only happen when you share a file.",
    label: "Local only",
    mode: "local",
  },
  files: {
    detail: "Files are read on device. Nothing is uploaded unless you choose a cloud action.",
    label: "Local only",
    mode: "local",
  },
};

function getToolPrivacyBadge(id) {
  const badge = TOOL_PRIVACY_BADGES[id];
  if (!badge) throw new Error(`Unknown privacy badge: ${id}`);
  return badge;
}

module.exports = {
  TOOL_PRIVACY_BADGES,
  getToolPrivacyBadge,
};
