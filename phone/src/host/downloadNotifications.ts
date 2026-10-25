/**
 * The download notifications — lifted from `AppShell.tsx:2625-2712` with the
 * throttle constant at `:459`: a low-importance sticky progress notification
 * on the "downloads" channel (never more than once per
 * `DOWNLOAD_NOTIFY_THROTTLE_MS`, permission checked ONCE per session so a
 * denial cannot re-prompt on every tick), plus the completion/failure
 * notification on the default channel.
 *
 * The platform is injected (`DownloadNotificationsApi`) so the whole policy
 * runs under node tests; the default adapter lazily requires
 * `expo-notifications` — the `useBatteryEta` idiom — because this module's
 * import must never touch native code the test stack cannot load.
 *
 * These are SYSTEM notifications, not the one-slot notice: the only download
 * line that reaches the notice slot is the ready notice (`useModelDownload`),
 * and it writes through `noticePort`, so the slot stays single and
 * last-write-wins (D2 row 17) — never a queue.
 */
import type { TranslateFn } from "../i18n";

/** Never post a progress update more than once per this window (App:459). */
export const DOWNLOAD_NOTIFY_THROTTLE_MS = 2_000;
export const DOWNLOADS_CHANNEL_ID = "downloads";
export const DOWNLOAD_PROGRESS_NOTIFICATION_ID = "kalsa-model-download-progress";

const DEFAULT_CHANNEL_ID = "default";

export interface DownloadNotificationsApi {
  getPermissions: () => Promise<{ granted: boolean }>;
  requestPermissions: () => Promise<{ granted: boolean }>;
  setChannel: (id: string, name: string, importance: "low" | "default") => Promise<void>;
  schedule: (request: {
    identifier?: string;
    title: string;
    body: string;
    sticky: boolean;
    channelId: string;
    delaySeconds?: number;
  }) => Promise<void>;
  dismiss: (identifier: string) => Promise<void>;
}

export interface DownloadNotifications {
  /** Channel + permission, once per download session (controller `begin`). */
  begin: () => Promise<void>;
  /** Throttled sticky progress; a no-op until `begin` got permission. */
  showProgress: (modelName: string, percent: number) => Promise<void>;
  /** Best-effort removal of the sticky progress line. */
  dismiss: () => Promise<void>;
  /** Title/body on the default channel — ready and failed outcomes. */
  notify: (title: string, body: string) => Promise<void>;
}

function expoDownloadNotifications(): DownloadNotificationsApi {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require("expo-notifications") as {
    AndroidImportance: { LOW: number; DEFAULT: number };
    getPermissionsAsync: () => Promise<{ granted: boolean }>;
    requestPermissionsAsync: () => Promise<{ granted: boolean }>;
    setNotificationChannelAsync: (
      id: string,
      spec: { name: string; importance: number; sound?: null },
    ) => Promise<unknown>;
    scheduleNotificationAsync: (request: {
      content: {
        title: string;
        body: string;
        sticky?: boolean;
        autoDismiss?: boolean;
        sound?: boolean;
      };
      trigger: { channelId: string; type?: string; seconds?: number };
      identifier?: string;
    }) => Promise<unknown>;
    dismissNotificationAsync: (identifier: string) => Promise<unknown>;
    SchedulableTriggerInputTypes: { TIME_INTERVAL: string };
  };
  return {
    getPermissions: () => Notifications.getPermissionsAsync(),
    requestPermissions: () => Notifications.requestPermissionsAsync(),
    setChannel: (id, name, importance) =>
      Notifications.setNotificationChannelAsync(id, {
        name,
        importance:
          importance === "low"
            ? Notifications.AndroidImportance.LOW
            : Notifications.AndroidImportance.DEFAULT,
        ...(importance === "low" ? { sound: null } : {}),
      }).then(() => undefined),
    schedule: (request) =>
      Notifications.scheduleNotificationAsync({
        ...(request.identifier !== undefined ? { identifier: request.identifier } : {}),
        // Content keys mirror the controller exactly: the sticky progress
        // line carries sticky/autoDismiss/sound (`App:2694-2698`), the
        // ready/failed notification is title+body only (`App:2638`).
        content: request.sticky
          ? {
              title: request.title,
              body: request.body,
              sticky: true,
              autoDismiss: false,
              sound: false,
            }
          : { title: request.title, body: request.body },
        // channelId lives in the trigger: a bare trigger uses Android's
        // fallback channel (controller comment at `App:2641`).
        trigger:
          request.delaySeconds !== undefined
            ? {
                type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
                seconds: request.delaySeconds,
                channelId: request.channelId,
              }
            : { channelId: request.channelId },
      }).then(() => undefined),
    dismiss: (identifier) =>
      Notifications.dismissNotificationAsync(identifier).then(() => undefined),
  };
}

export function createDownloadNotifications(
  t: TranslateFn,
  api: DownloadNotificationsApi = expoDownloadNotifications(),
  now: () => number = Date.now,
): DownloadNotifications {
  let allowed = false;
  let lastProgressAt = 0;

  const begin = async (): Promise<void> => {
    lastProgressAt = 0;
    allowed = false;
    try {
      await api.setChannel(DOWNLOADS_CHANNEL_ID, t("notify.downloadsChannelName"), "low");
      const settings = await api.getPermissions();
      const granted =
        settings.granted || (await api.requestPermissions()).granted;
      allowed = granted;
    } catch (error) {
      // Never block the download on notification setup — skip silently.
      allowed = false;
      console.warn("[beginDownloadNotifications]", error);
    }
  };

  const showProgress = async (modelName: string, percent: number): Promise<void> => {
    if (!allowed) return;
    const time = now();
    if (time - lastProgressAt < DOWNLOAD_NOTIFY_THROTTLE_MS) return;
    lastProgressAt = time;
    try {
      await api.schedule({
        identifier: DOWNLOAD_PROGRESS_NOTIFICATION_ID,
        title: t("download.notifyProgressTitle", { name: modelName }),
        body: t("download.notifyProgressBody", { percent }),
        sticky: true,
        channelId: DOWNLOADS_CHANNEL_ID,
      });
    } catch (error) {
      console.warn("[showDownloadProgressNotification]", error);
    }
  };

  const dismiss = async (): Promise<void> => {
    try {
      await api.dismiss(DOWNLOAD_PROGRESS_NOTIFICATION_ID);
    } catch {
      // best-effort
    }
  };

  const notify = async (title: string, body: string): Promise<void> => {
    try {
      const settings = await api.getPermissions();
      if (!settings.granted && !(await api.requestPermissions()).granted) return;
      await api.setChannel(DEFAULT_CHANNEL_ID, t("notify.channelName"), "default");
      await api.schedule({
        title,
        body,
        sticky: false,
        channelId: DEFAULT_CHANNEL_ID,
        delaySeconds: 1,
      });
    } catch (error) {
      // Notifications unavailable: non-blocking, but not silent in debug.
      console.warn("[notifyDownload]", error);
    }
  };

  return { begin, showProgress, dismiss, notify };
}
