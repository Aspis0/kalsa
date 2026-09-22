/**
 * The download notifications' policy (`AppShell.tsx:2625-2712`, throttle at
 * `:459`) — everything observable lives behind the injected api and clock:
 * the 2-second window, the once-per-session permission check (a denial must
 * not re-prompt on every tick of a multi-minute transfer), the channels, and
 * the best-effort dismissal. A regression here is a notification storm on a
 * user's home screen or a silent download.
 */
import { en, it as italian, makeT } from "../i18n";
import {
  createDownloadNotifications,
  DOWNLOAD_NOTIFY_THROTTLE_MS,
  DOWNLOAD_PROGRESS_NOTIFICATION_ID,
  DOWNLOADS_CHANNEL_ID,
  type DownloadNotificationsApi,
} from "./downloadNotifications";

const t = makeT("en");

type Schedule = {
  identifier?: string;
  title: string;
  body: string;
  sticky: boolean;
  channelId: string;
  delaySeconds?: number;
};

function fakeApi(options?: { granted?: boolean; failChannel?: boolean }) {
  const granted = options?.granted ?? true;
  const schedules: Schedule[] = [];
  const channels: Array<{ id: string; name: string; importance: string }> = [];
  let dismissCount = 0;
  let requestCount = 0;
  const api: DownloadNotificationsApi = {
    getPermissions: async () => ({ granted }),
    requestPermissions: async () => {
      requestCount += 1;
      return { granted };
    },
    setChannel: async (id, name, importance) => {
      if (options?.failChannel) throw new Error("no channels here");
      channels.push({ id, name, importance });
    },
    schedule: async (request) => {
      schedules.push(request);
    },
    dismiss: async () => {
      dismissCount += 1;
    },
  };
  return {
    api,
    schedules,
    channels,
    requests: () => requestCount,
    dismissCount: () => dismissCount,
  };
}

/** A clock that starts far past the first window (`lastProgressAt = 0`). */
function clock() {
  let now = 1_000_000;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("the throttle constant is the controller's own", () => {
  it("2 s (App:459)", () => {
    expect(DOWNLOAD_NOTIFY_THROTTLE_MS).toBe(2_000);
  });
});

describe("progress notifications", () => {
  it("begin wires the low-importance downloads channel and emits 0 % immediately", async () => {
    const fake = fakeApi();
    const clocker = clock();
    const n = createDownloadNotifications(t, fake.api, clocker.now);
    await n.begin();
    expect(fake.channels).toEqual([
      { id: DOWNLOADS_CHANNEL_ID, name: en.notify.downloadsChannelName, importance: "low" },
    ]);
    await n.showProgress("LFM2.5 2.6B", 0);
    expect(fake.schedules).toHaveLength(1);
    expect(fake.schedules[0]).toMatchObject({
      identifier: DOWNLOAD_PROGRESS_NOTIFICATION_ID,
      sticky: true,
      channelId: DOWNLOADS_CHANNEL_ID,
      title: en.download.notifyProgressTitle.replace("{name}", "LFM2.5 2.6B"),
      body: en.download.notifyProgressBody.replace("{percent}", "0"),
    });
  });

  it("suppresses every update inside the 2 s window and lets the next one through", async () => {
    const fake = fakeApi();
    const clocker = clock();
    const n = createDownloadNotifications(t, fake.api, clocker.now);
    await n.begin();
    await n.showProgress("m", 1); // t0, emitted
    clocker.advance(1_999);
    await n.showProgress("m", 2); // inside the window
    clocker.advance(1);
    await n.showProgress("m", 3); // exactly at the window edge
    expect(fake.schedules.map((s) => s.body)).toEqual([
      en.download.notifyProgressBody.replace("{percent}", "1"),
      en.download.notifyProgressBody.replace("{percent}", "3"),
    ]);
  });

  it("a denied permission: one request at begin, zero schedules, no re-prompt", async () => {
    const fake = fakeApi({ granted: false });
    const clocker = clock();
    const n = createDownloadNotifications(t, fake.api, clocker.now);
    await n.begin();
    expect(fake.requests()).toBe(1);
    for (const percent of [1, 20, 40, 60, 80, 100]) {
      await n.showProgress("m", percent);
      clocker.advance(5_000);
    }
    expect(fake.schedules).toEqual([]);
    expect(fake.requests()).toBe(1);
  });

  it("a channel-setup failure never blocks the caller and stays silent", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = fakeApi({ failChannel: true });
    const n = createDownloadNotifications(t, fake.api, clock().now);
    await expect(n.begin()).resolves.toBeUndefined();
    await expect(n.showProgress("m", 50)).resolves.toBeUndefined();
    expect(fake.schedules).toEqual([]);
    warn.mockRestore();
  });
});

describe("the outcome notification (ready / failed)", () => {
  it("checks permission itself, then posts on the default channel after 1 s", async () => {
    const fake = fakeApi();
    const n = createDownloadNotifications(t, fake.api, clock().now);
    await n.notify(en.notify.channelName, en.download.notifyReady.replace("{name}", "Qwen"));
    expect(fake.channels[0]).toEqual({
      id: "default",
      name: en.notify.channelName,
      importance: "default",
    });
    expect(fake.schedules[0]).toMatchObject({
      channelId: "default",
      delaySeconds: 1,
      sticky: false,
      body: en.download.notifyReady.replace("{name}", "Qwen"),
    });
    expect(fake.schedules[0].identifier).toBeUndefined();
  });

  it("denied permission posts nothing at all", async () => {
    const fake = fakeApi({ granted: false });
    const n = createDownloadNotifications(t, fake.api, clock().now);
    await n.notify("title", "body");
    expect(fake.schedules).toEqual([]);
    expect(fake.requests()).toBe(1);
  });
});

describe("dismiss", () => {
  it("counts the sticky line's removal", async () => {
    const fake = fakeApi();
    const n = createDownloadNotifications(t, fake.api, clock().now);
    await n.dismiss();
    expect(fake.dismissCount()).toBe(1);
  });

  it("swallows a failing dismissal — best-effort, never throws at teardown", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const n = createDownloadNotifications(
      t,
      {
        ...fakeApi().api,
        dismiss: async () => {
          throw new Error("gone");
        },
      },
      clock().now,
    );
    await expect(n.dismiss()).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
