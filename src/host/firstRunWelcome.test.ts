/**
 * The one-time alpha notice: it speaks through the host's single notice slot
 * on the first launch where telemetry is on — whatever the chat holds — and
 * marks itself seen only on the NEXT launch, never from the call that fired
 * it. File name kept: this is the first-run notice suite.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";
import {
  __resetTelemetryForTests,
  initTelemetry,
  setTelemetryEnabled,
  type StorageLike,
} from "../telemetry/telemetry";
import { maybeShowAlphaTelemetryNotice } from "./alphaTelemetryNotice";
import { noticePort } from "./useNotice";

jest.mock("@react-native-async-storage/async-storage", () => {
  const data = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (key: string) => data.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: async (key: string) => {
        data.delete(key);
      },
    },
    __data: data,
  };
});
jest.mock("react-native", () => ({}));

const asyncData = (
  jest.requireMock("@react-native-async-storage/async-storage") as {
    __data: Map<string, string>;
  }
).__data;
const SHOWN_KEY = "kalsa.notice.alphaTelemetry.shown";
const SEEN_KEY = "kalsa.notice.alphaTelemetry.seen";

function telemetryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

function depsFor(storage: StorageLike) {
  return {
    storage,
    fetchImpl: (async () => new Response("{}", { status: 500 })) as unknown as typeof fetch,
    now: () => 1_700_000_000_000,
    getAppState: () => "active",
    getAppVersion: () => "1.0.0",
    getDeviceContext: () => ({
      ramTier: null,
      totalMemoryBytes: null,
      osVersion: null,
      modelId: null,
      hadWebTools: false,
    }),
  };
}

const spoken: string[] = [];
const port = (text: string) => {
  spoken.push(text);
};

beforeEach(() => {
  __resetTelemetryForTests();
  asyncData.clear();
  spoken.length = 0;
  noticePort.current = null;
});

afterEach(() => {
  noticePort.current = null;
});

test("fires once through the notice slot; seen is written only on the next launch", async () => {
  await initTelemetry(depsFor(telemetryStorage()));
  noticePort.current = port;

  await maybeShowAlphaTelemetryNotice();
  expect(spoken).toHaveLength(1);
  expect(spoken[0]).toContain(en.settings.alphaTelemetryNotice);
  expect(spoken[0]).toContain(italian.settings.alphaTelemetryNotice);
  expect(asyncData.get(SHOWN_KEY)).toBe("1");
  expect(asyncData.get(SEEN_KEY)).toBeUndefined();

  await maybeShowAlphaTelemetryNotice();
  expect(spoken).toHaveLength(1);
  expect(asyncData.get(SEEN_KEY)).toBe("1");

  await maybeShowAlphaTelemetryNotice();
  expect(spoken).toHaveLength(1);
});

test("nothing is recorded while the notice slot is unmounted", async () => {
  await initTelemetry(depsFor(telemetryStorage()));

  await maybeShowAlphaTelemetryNotice();
  expect(spoken).toHaveLength(0);
  expect(asyncData.get(SHOWN_KEY)).toBeUndefined();

  // The slot comes up on a later launch → the notice still gets its one show.
  noticePort.current = port;
  await maybeShowAlphaTelemetryNotice();
  expect(spoken).toHaveLength(1);
  expect(asyncData.get(SHOWN_KEY)).toBe("1");
});

test("an install with telemetry off is never told", async () => {
  await initTelemetry(depsFor(telemetryStorage()));
  expect(await setTelemetryEnabled(false)).toBe(true);
  noticePort.current = port;

  await maybeShowAlphaTelemetryNotice();
  expect(spoken).toHaveLength(0);
  expect(asyncData.get(SHOWN_KEY)).toBeUndefined();
});

test("the owner's exact sentences, and no 'anonymous' claim in the alpha copy", () => {
  expect(en.settings.alphaTelemetryNotice).toBe(
    "During the alpha, Kalsa sends error reports with technical details (which AI, the phone's model and memory use) to help fix problems. Never your chats or text. You can turn this off in Settings.",
  );
  expect(italian.settings.alphaTelemetryNotice).toBe(
    "Durante la alpha, Kalsa invia report di errore con dettagli tecnici (quale IA, il modello del telefono e l'uso della memoria) per aiutarci a risolvere i problemi. Mai le tue chat o i testi. Puoi disattivarlo nelle Impostazioni.",
  );
  for (const copy of [
    en.settings.alphaTelemetryNotice,
    en.settings.privacyBody,
    en.help.privacy.body,
    italian.settings.alphaTelemetryNotice,
    italian.settings.privacyBody,
    italian.help.privacy.body,
  ]) {
    expect(copy).not.toMatch(/anonymous|anonim/i);
  }
});
