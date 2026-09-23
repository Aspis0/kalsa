jest.mock("react-native", () => {
  const react = require("react") as typeof import("react");
  const host = (name: string) => (props: Record<string, unknown>) =>
    react.createElement(name, props, props.children as React.ReactNode);
  return {
    Pressable: host("Pressable"),
    ScrollView: host("ScrollView"),
    Text: host("Text"),
    TextInput: host("TextInput"),
    View: host("View"),
  };
});

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));

jest.mock("../theme/design", () => ({
  modes: { light: { page: "#fff", surface: "#fff", line: "#ccc", ink: "#111", ink2: "#444", ink3: "#777", danger: "#900", brand: "#063", brandDeep: "#042", onBrand: "#fff" } },
  radius: { field: 8, button: 8 },
  space: { xs: 4, sm: 8, md: 12, lg: 16 },
  type: { body: {}, bodyStrong: {}, secondary: {} },
}));

jest.mock("../theme/components", () => ({
  GlassPanel2: (props: Record<string, unknown>) =>
    require("react").createElement("GlassPanel2", null, props.children as React.ReactNode),
}));

jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ mode: "light" }) }));
jest.mock("../i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("./SettingsHeader", () => ({
  SettingsHeader: (props: Record<string, unknown>) =>
    require("react").createElement("SettingsHeader", props),
}));
jest.mock("../engine/ModelRegistry", () => ({
  MODEL_REGISTRY: [{ id: "local-model", sizeBytes: 1234 }],
}));
jest.mock("../pairing/pairingCredentialStore", () => ({
  savePairingCredential: jest.fn(),
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { savePairingCredential } from "../pairing/pairingCredentialStore";
import { PairingScreen } from "./PairingScreen";

const saveCredentialMock = savePairingCredential as jest.MockedFunction<typeof savePairingCredential>;
const originalCrypto = globalThis.crypto;
const originalFetch = globalThis.fetch;
const preexistingCredential = { credential: "12".repeat(32), doorUrl: "https://old-computer.example" };
let storedCredential = { ...preexistingCredential };

beforeEach(() => {
  jest.clearAllMocks();
  storedCredential = { ...preexistingCredential };
  saveCredentialMock.mockImplementation(async (credential, doorUrl) => {
    storedCredential = {
      credential: Array.from(credential, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      doorUrl,
    };
  });
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xc0) },
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
  globalThis.fetch = originalFetch;
});

async function render(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(PairingScreen, {
        initialDoorUrl: "https://desktop.tailnet.ts.net",
        currentModelId: "local-model",
        onBack: jest.fn(),
      }),
    );
  });
  for (const [id, value] of [
    ["pairing.reachable", "http://127.0.0.1:8132"],
    ["pairing.code", "41".repeat(16)],
    ["pairing.nonce", "42".repeat(32)],
  ]) {
    await act(async () => {
      renderer.root.findByProps({ testID: id }).props.onChangeText(value);
    });
  }
  return renderer;
}

function installFetch(completeStatus: number) {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return {
      status: url.endsWith("/pair/claim") ? 200 : completeStatus,
      json: async () => ({
        credential_ciphertext: "19d0b3455e311a70ba202aea83ea569e8127f2f1936f67bdc557439a82222ba7",
        mac: "6d86a29391e258de9bb13dae9ceb3612143c4448050562a36ad2e6ac8dd4a849",
      }),
    } as Response;
  }) as typeof fetch;
  return urls;
}

describe("PairingScreen", () => {
  test("door and desk share an initial host prefill but remain independently editable", async () => {
    const renderer = await render();
    expect(renderer.root.findByProps({ testID: "pairing.doorUrl" }).props.value).toBe(
      "https://desktop.tailnet.ts.net",
    );
    expect(renderer.root.findByProps({ testID: "pairing.deskUrl" }).props.value).toBe(
      "https://desktop.tailnet.ts.net:8443",
    );
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.doorUrl" }).props.onChangeText(
        "https://desktop.tailnet.ts.net:9443",
      );
    });
    expect(renderer.root.findByProps({ testID: "pairing.deskUrl" }).props.value).toBe(
      "https://desktop.tailnet.ts.net:8443",
    );
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.deskUrl" }).props.onChangeText(
        "https://desktop.tailnet.ts.net:10443",
      );
    });
    expect(renderer.root.findByProps({ testID: "pairing.doorUrl" }).props.value).toBe(
      "https://desktop.tailnet.ts.net:9443",
    );
    expect(renderer.root.findByProps({ testID: "pairing.deskUrl" }).props.value).toBe(
      "https://desktop.tailnet.ts.net:10443",
    );
    await act(async () => renderer.unmount());
  });

  test("a sealed credential is saved and the UI waits for confirmation without probing the door", async () => {
    const urls = installFetch(200);
    const renderer = await render();
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.submit" }).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(urls).toEqual([
      "https://desktop.tailnet.ts.net:8443/pair/claim",
      "https://desktop.tailnet.ts.net:8443/pair/complete",
    ]);
    expect(saveCredentialMock).toHaveBeenCalledWith(
      new Uint8Array(32).fill(0xab),
      "https://desktop.tailnet.ts.net",
    );
    expect(renderer.root.findByProps({ testID: "pairing.waiting" }).props.children).toBe("pairing.waiting");
    await act(async () => renderer.unmount());
  });

  test.each([401, 403, 503])("HTTP %s refusal has the same copy and preserves an existing credential", async (status) => {
    const urls = installFetch(status);
    const renderer = await render();
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.submit" }).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(urls).toHaveLength(2);
    expect(renderer.root.findByProps({ testID: "pairing.refused" }).props.children).toBe("pairing.refused");
    expect(saveCredentialMock).not.toHaveBeenCalled();
    expect(storedCredential).toEqual(preexistingCredential);
    await act(async () => renderer.unmount());
  });
});
