function formatCacheAge(savedAt, now = Date.now()) {
  if (!savedAt) return "never";
  const diffMs = Math.max(0, now - savedAt);
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

function getOfflineBanner({ lastUpdatedAt = 0, stale = false, status = "online" }) {
  if (status === "online" && !stale) {
    return {
      actionLabel: "",
      detail: `Last updated ${formatCacheAge(lastUpdatedAt)}.`,
      kind: "ok",
      title: "Online",
    };
  }

  return {
    actionLabel: "Retry",
    detail: `Showing cached data. Last updated ${formatCacheAge(lastUpdatedAt)}.`,
    kind: stale ? "warning" : "muted",
    title: status === "offline" ? "Offline mode" : "Cached data",
  };
}

module.exports = {
  formatCacheAge,
  getOfflineBanner,
};
