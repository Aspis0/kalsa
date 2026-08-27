export type OfflineStatus = "online" | "offline";

export type OfflineBanner = {
  actionLabel: string;
  detail: string;
  kind: "ok" | "warning" | "muted";
  title: string;
};

export function formatCacheAge(savedAt: number, now?: number): string;
export function getOfflineBanner(input: {
  lastUpdatedAt?: number;
  stale?: boolean;
  status?: OfflineStatus;
}): OfflineBanner;
