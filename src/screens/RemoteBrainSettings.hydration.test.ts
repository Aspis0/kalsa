/**
 * Component test for the settings-panel data-loss bug.
 *
 * Repro: a URL and a token are already stored. The user opens Settings and
 * presses Test before the async hydration lands. The unhydrated fields are
 * "" — committing them wrote an empty URL and ran
 * SecureStore.deleteItemAsync, so the credential was gone for good.
 *
 * Storage and the RN primitives are mocked (the app ships no RN test
 * renderer); the component's own effect, guards and handlers are the real
 * ones, so this test fails if the hydration guards are removed.
 */
jest.mock("react-native", () => {
  const react = require("react") as typeof import("react");
  const host = (name: string) => (props: Record<string, unknown>) =>
    react.createElement(name, props, props.children as React.ReactNode);
  return {
    ActivityIndicator: host("ActivityIndicator"),
    Pressable: host("Pressable"),
    Text: host("Text"),
    TextInput: host("TextInput"),
    View: host("View"),
  };
});

jest.mock("../i18n", () => {
  // Production memoizes `t` per locale, so it must not change identity between
  // renders here either: that is what exposed the stale-callback bug.
  const t = (key: string, vars?: Record<string, string>) =>
    vars ? `${key} ${JSON.stringify(vars)}` : key;
  return { useLocale: () => ({ t }) };
});

jest.mock("../theme/components", () => ({
  GlassPanel2: (props: Record<string, unknown>) =>
    require("react").createElement(
      "GlassPanel2",
      null,
      props.children as React.ReactNode,
    ),
}));

jest.mock("../theme/tokens", () => ({
  radius: { md: 8 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
}));

jest.mock("../theme/typography", () => ({
  fontFamilies: { bodySemi: "semi" },
  useTypography: () => ({ bodySm: {}, bodyXs: {} }),
}));

jest.mock("../ui/labTheme", () => ({
  useLabTheme: () => ({
    colors: {
      accent: "#0af",
      bad: "#f00",
      ink: "#111",
      line: "#ccc",
      muted: "#777",
      primaryText: "#fff",
    },
  }),
}));

jest.mock("../engine/engineBackend", () => ({
  testRemoteConnection: jest.fn(),
}));

jest.mock("../engine/remote/remoteSettings", () => ({
  DEFAULT_REMOTE_MAX_TOKENS: 4096,
  hydrateRemoteBrainSettings: jest.fn(),
  isRemoteEngineBackend: () => false,
  setRemoteBrainUrl: jest.fn(),
  setRemoteMaxTokens: jest.fn(),
  setRemoteServerModelId: jest.fn(),
}));

jest.mock("../engine/remote/remoteSecret", () => ({
  getRemoteBrainToken: jest.fn(),
  setRemoteBrainToken: jest.fn(),
}));

import React from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";

import { RemoteBrainSettings } from "./RemoteBrainSettings";

// Save what we replace: a test that mutates the environment must put it back.
const previousActEnvironment = (
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// react-test-renderer logs a deprecation notice on every create(); this project
// ships no RN-flavoured renderer, so keep the suite output readable.
beforeAll(() => {
  const realError = console.error;
  jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("react-test-renderer is deprecated")
    ) {
      return;
    }
    realError(...args);
  });
});

afterAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  jest.restoreAllMocks();
});

const settingsMock = jest.requireMock("../engine/remote/remoteSettings") as {
  hydrateRemoteBrainSettings: jest.Mock;
  setRemoteBrainUrl: jest.Mock;
  setRemoteMaxTokens: jest.Mock;
  setRemoteServerModelId: jest.Mock;
};
const secretMock = jest.requireMock("../engine/remote/remoteSecret") as {
  getRemoteBrainToken: jest.Mock;
  setRemoteBrainToken: jest.Mock;
};
const backendMock = jest.requireMock("../engine/engineBackend") as {
  testRemoteConnection: jest.Mock;
};

const STORED_URL = "http://192.168.1.50:8000";
const STORED_TOKEN = "sk-mac-token";
const STORED_MODEL = "ornith-35b";
const STORED_SNAPSHOT = {
  backend: "remote",
  url: STORED_URL,
  urlNeverSet: false,
  hydrationOk: true,
  urlParseError: null,
  serverModelId: STORED_MODEL,
  maxTokens: 2048,
  temperature: 0.7,
  ctx: 32768,
};

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let snapshot!: Deferred<unknown>;
let tokenRead!: Deferred<string | null>;

beforeEach(() => {
  jest.clearAllMocks();
  snapshot = deferred<unknown>();
  tokenRead = deferred<string | null>();
  settingsMock.hydrateRemoteBrainSettings.mockReturnValue(snapshot.promise);
  secretMock.getRemoteBrainToken.mockReturnValue(tokenRead.promise);
  secretMock.setRemoteBrainToken.mockResolvedValue(undefined);
  settingsMock.setRemoteBrainUrl.mockResolvedValue(undefined);
  settingsMock.setRemoteMaxTokens.mockResolvedValue(undefined);
  settingsMock.setRemoteServerModelId.mockResolvedValue(undefined);
  backendMock.testRemoteConnection.mockResolvedValue({
    ok: true,
    modelId: STORED_MODEL,
  });
});

/** Host components in the mocked tree carry their tag name as `type`. */
function hasType(node: ReactTestInstance, type: string): boolean {
  return (node.type as unknown as string) === type;
}

function nodesOfType(
  renderer: ReactTestRenderer,
  type: string,
): ReactTestInstance[] {
  return renderer.root.findAll((node) => hasType(node, type));
}

function urlInput(renderer: ReactTestRenderer): ReactTestInstance {
  return node(renderer, (props) => props.keyboardType === "url");
}

function tokenInput(renderer: ReactTestRenderer): ReactTestInstance {
  return node(renderer, (props) => props.secureTextEntry === true);
}

function maxTokensInput(renderer: ReactTestRenderer): ReactTestInstance {
  return node(renderer, (props) => props.keyboardType === "number-pad");
}

function modelInput(renderer: ReactTestRenderer): ReactTestInstance {
  return node(
    renderer,
    (props) => props.keyboardType === undefined && !props.secureTextEntry,
  );
}

function node(
  renderer: ReactTestRenderer,
  match: (props: { [key: string]: any }) => boolean,
): ReactTestInstance {
  const found = nodesOfType(renderer, "TextInput").find((instance) =>
    match(instance.props),
  );
  if (!found) throw new Error("input not found");
  return found;
}

function testButton(renderer: ReactTestRenderer): ReactTestInstance {
  return pressableWithLabel(renderer, "settings.remoteBrainTest");
}

function selectComputerButton(renderer: ReactTestRenderer): ReactTestInstance {
  return pressableWithLabel(renderer, "settings.remoteSelect");
}

function pressableWithLabel(
  renderer: ReactTestRenderer,
  label: string,
): ReactTestInstance {
  const found = nodesOfType(renderer, "Pressable").find((instance) =>
    instance
      .findAll((child) => hasType(child, "Text"))
      .some((child) => child.props.children === label),
  );
  if (!found) throw new Error(`pressable ${label} not found`);
  return found;
}

/** Any text node on screen, e.g. a status message. */
function showsText(renderer: ReactTestRenderer, text: string): boolean {
  return nodesOfType(renderer, "Text").some(
    (instance) => instance.props.children === text,
  );
}

function fieldInput(
  renderer: ReactTestRenderer,
  field: "url" | "serverModel" | "maxTokens" | "token",
): ReactTestInstance {
  switch (field) {
    case "url":
      return urlInput(renderer);
    case "token":
      return tokenInput(renderer);
    case "maxTokens":
      return maxTokensInput(renderer);
    case "serverModel":
      return modelInput(renderer);
  }
}

async function render(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(RemoteBrainSettings, {
        currentModelId: "local-model",
        busy: false,
        onSelectModel: jest.fn(),
      }),
    );
  });
  return renderer;
}

/** Storage answers: both reads land, hydration completes. */
async function finishHydration(
  hydrated: unknown = STORED_SNAPSHOT,
  token: string | null = STORED_TOKEN,
): Promise<void> {
  await act(async () => {
    snapshot.resolve(hydrated);
  });
  await act(async () => {
    tokenRead.resolve(token);
  });
}

async function unmount(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => {
    renderer.unmount();
  });
}

describe("RemoteBrainSettings hydration", () => {
  test("Test pressed before hydration ends wipes nothing and calls no storage", async () => {
    const renderer = await render();

    // Storage is still slow: the draft is empty and the panel is locked.
    expect(urlInput(renderer).props.value).toBe("");
    expect(urlInput(renderer).props.editable).toBe(false);
    expect(tokenInput(renderer).props.editable).toBe(false);
    expect(modelInput(renderer).props.editable).toBe(false);
    expect(maxTokensInput(renderer).props.editable).toBe(false);
    expect(testButton(renderer).props.disabled).toBe(true);

    await act(async () => {
      testButton(renderer).props.onPress();
    });

    expect(settingsMock.setRemoteBrainUrl).not.toHaveBeenCalled();
    expect(secretMock.setRemoteBrainToken).not.toHaveBeenCalled();
    expect(backendMock.testRemoteConnection).not.toHaveBeenCalled();

    await finishHydration();

    // The stored credential survived and is on screen.
    expect(urlInput(renderer).props.value).toBe(STORED_URL);
    expect(tokenInput(renderer).props.value).toBe(STORED_TOKEN);
    expect(urlInput(renderer).props.editable).toBe(true);
    expect(testButton(renderer).props.disabled).toBe(false);
    await unmount(renderer);
  });

  test("after hydration, Test persists the stored URL and token", async () => {
    const renderer = await render();
    await finishHydration();

    await act(async () => {
      testButton(renderer).props.onPress();
    });

    expect(settingsMock.setRemoteBrainUrl).toHaveBeenCalledWith(STORED_URL);
    expect(secretMock.setRemoteBrainToken).toHaveBeenCalledWith(STORED_TOKEN);
    expect(backendMock.testRemoteConnection).toHaveBeenCalledTimes(1);
    await unmount(renderer);
  });

  test.each(["url", "serverModel", "maxTokens", "token"] as const)(
    "an edit in %s before hydration survives while the other fields are filled",
    async (field) => {
      const renderer = await render();

      // Simulates the type event on one field before storage answers.
      await act(async () => {
        fieldInput(renderer, field).props.onChangeText("my-own-value");
      });
      await finishHydration();

      expect(fieldInput(renderer, field).props.value).toBe("my-own-value");
      for (const other of ["url", "serverModel", "maxTokens", "token"] as const) {
        if (other === field) continue;
        expect(fieldInput(renderer, other).props.value).not.toBe("");
      }
      await unmount(renderer);
    },
  );

  test("an edit before hydration cannot make Test delete the stored token", async () => {
    const renderer = await render();

    // The data-loss path: one field dirty, everything else dropped, then commit.
    await act(async () => {
      modelInput(renderer).props.onChangeText("my-own-model");
    });
    await finishHydration();

    await act(async () => {
      testButton(renderer).props.onPress();
    });

    expect(secretMock.setRemoteBrainToken).toHaveBeenCalledWith(STORED_TOKEN);
    expect(secretMock.setRemoteBrainToken).not.toHaveBeenCalledWith("");
    expect(settingsMock.setRemoteBrainUrl).toHaveBeenCalledWith(STORED_URL);
    expect(settingsMock.setRemoteServerModelId).toHaveBeenCalledWith(
      "my-own-model",
    );
    await unmount(renderer);
  });

  test("an unreadable SecureStore token is never committed as empty", async () => {
    secretMock.getRemoteBrainToken.mockRejectedValue(
      new Error("keystore unavailable"),
    );
    const renderer = await render();
    await act(async () => {
      snapshot.resolve(STORED_SNAPSHOT);
    });
    await act(async () => {});

    // The form is unlocked, but the token field cannot show what it could not read.
    expect(urlInput(renderer).props.value).toBe(STORED_URL);
    expect(testButton(renderer).props.disabled).toBe(false);

    await act(async () => {
      testButton(renderer).props.onPress();
    });

    expect(secretMock.setRemoteBrainToken).not.toHaveBeenCalled();
    // Fields whose hydration succeeded are still committed.
    expect(settingsMock.setRemoteBrainUrl).toHaveBeenCalledWith(STORED_URL);
    expect(settingsMock.setRemoteServerModelId).toHaveBeenCalledWith(
      STORED_MODEL,
    );
    await unmount(renderer);
  });

  test("Test writes what is typed while its earlier writes are in flight", async () => {
    const tokenWrite = deferred<void>();
    secretMock.setRemoteBrainToken.mockReturnValue(tokenWrite.promise);
    const renderer = await render();
    await finishHydration(STORED_SNAPSHOT, "");

    await act(async () => {
      testButton(renderer).props.onPress();
    });
    // The token write is still in flight: the user types the url now.
    await act(async () => {
      urlInput(renderer).props.onChangeText("http://typed-while-busy:9000");
    });
    await act(async () => {
      tokenWrite.resolve();
    });

    expect(settingsMock.setRemoteBrainUrl).toHaveBeenCalledWith(
      "http://typed-while-busy:9000",
    );
    await unmount(renderer);
  });

  test("selecting the remote computer with an empty address writes nothing", async () => {
    const renderer = await render();
    await finishHydration(
      { ...STORED_SNAPSHOT, url: "", urlNeverSet: true },
      null,
    );

    await act(async () => {
      selectComputerButton(renderer).props.onPress();
    });

    expect(settingsMock.setRemoteBrainUrl).not.toHaveBeenCalled();
    expect(showsText(renderer, "settings.remoteBrainUrlMissing")).toBe(true);
    await unmount(renderer);
  });

  test("Test writes the credential before the cheapest field", async () => {
    const renderer = await render();
    await finishHydration();

    await act(async () => {
      testButton(renderer).props.onPress();
    });

    const tokenOrder = secretMock.setRemoteBrainToken.mock.invocationCallOrder[0];
    const maxOrder = settingsMock.setRemoteMaxTokens.mock.invocationCallOrder[0];
    expect(tokenOrder).toBeLessThan(maxOrder);
    await unmount(renderer);
  });

  test("a failed save is reported instead of a connection result", async () => {
    settingsMock.setRemoteMaxTokens.mockRejectedValue(new Error("disk full"));
    const renderer = await render();
    await finishHydration();

    await act(async () => {
      testButton(renderer).props.onPress();
    });

    expect(backendMock.testRemoteConnection).not.toHaveBeenCalled();
    expect(showsText(renderer, "settings.remoteBrainSaveFailed")).toBe(true);
    await unmount(renderer);
  });

  test.each(["serverModel", "maxTokens", "token"] as const)(
    "a rejected blur save on %s is shown, not swallowed",
    async (field) => {
      const reject = () => Promise.reject(new Error("storage full"));
      if (field === "serverModel") {
        settingsMock.setRemoteServerModelId.mockImplementation(reject);
      } else if (field === "maxTokens") {
        settingsMock.setRemoteMaxTokens.mockImplementation(reject);
      } else {
        secretMock.setRemoteBrainToken.mockImplementation(reject);
      }
      const renderer = await render();
      await finishHydration();

      await act(async () => {
        fieldInput(renderer, field).props.onChangeText("typed");
      });
      await act(async () => {
        fieldInput(renderer, field).props.onEndEditing();
      });

      expect(showsText(renderer, "settings.remoteBrainSaveFailed")).toBe(true);
      await unmount(renderer);
    },
  );

  test("a fresh install leaves Test working instead of a silent no-op", async () => {
    const renderer = await render();
    // Hydrated values equal the initial ones: only `hydratedReady` changes.
    await finishHydration(
      {
        ...STORED_SNAPSHOT,
        url: "",
        urlNeverSet: true,
        serverModelId: "",
        maxTokens: 4096,
      },
      null,
    );

    await act(async () => {
      testButton(renderer).props.onPress();
    });

    expect(backendMock.testRemoteConnection).toHaveBeenCalledTimes(1);
    await unmount(renderer);
  });
});
