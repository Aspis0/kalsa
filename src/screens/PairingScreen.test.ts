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
  MODEL_REGISTRY: [{ id: "local-model", file: "local.gguf", sizeBytes: 1234 }],
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
  jest.restoreAllMocks();
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: originalCrypto });
  globalThis.fetch = originalFetch;
});

async function render(currentModelId = "local-model"): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(PairingScreen, {
        initialDoorUrl: "https://desktop.tailnet.ts.net",
        currentModelId,
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
  const bodies: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (typeof init?.body === "string") bodies.push(init.body);
    return {
      status: url.endsWith("/pair/claim") ? 200 : completeStatus,
      json: async () => ({
        credential_ciphertext: "19d0b3455e311a70ba202aea83ea569e8127f2f1936f67bdc557439a82222ba7",
        mac: "6d86a29391e258de9bb13dae9ceb3612143c4448050562a36ad2e6ac8dd4a849",
      }),
    } as Response;
  }) as typeof fetch;
  return { urls, bodies };
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
    const { urls, bodies } = installFetch(200);
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
    expect(bodies[1]).toContain('"weights_bytes":1234');
    expect(bodies[1]).toContain('"battery_powered":true');
    expect(bodies[1]).not.toContain('"weights_bytes":0');
    expect(renderer.root.findByProps({ testID: "pairing.waiting" }).props.children).toBe("pairing.waiting");
    await act(async () => renderer.unmount());
  });

  test.each([401, 403, 503])("HTTP %s refusal has the same copy and preserves an existing credential", async (status) => {
    const { urls } = installFetch(status);
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

  test("refuses before the desk request when there is no concrete local GGUF", async () => {
    globalThis.fetch = jest.fn() as unknown as typeof fetch;
    const renderer = await render("kalsa-remote-mac");
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.submit" }).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(renderer.root.findByProps({ testID: "pairing.model-required" }).props.children)
      .toBe("pairing.modelRequired");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(saveCredentialMock).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  test("the visible diagnostics switch logs wire hex and a credential hash, never the credential", async () => {
    const { urls } = installFetch(200);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const renderer = await render();
    const diagnostics = renderer.root.findByProps({ testID: "pairing.diagnostics" });
    expect(diagnostics.props.accessibilityState.checked).toBe(false);
    await act(async () => diagnostics.props.onPress());
    expect(renderer.root.findByProps({ testID: "pairing.diagnostics" }).props.accessibilityState.checked)
      .toBe(true);
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.submit" }).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(urls).toHaveLength(2);
    const records = log.mock.calls.map((call) => JSON.parse(String(call[1])) as Record<string, unknown>);
    expect(records.map((record) => record.event)).toEqual([
      "pairing.signed_request",
      "pairing.sealed_response",
    ]);
    expect(records[0]).toHaveProperty("payload_hex");
    expect(records[0]).toHaveProperty("mac_hex");
    expect(records[0]).toHaveProperty("delivery_token_hex", "c0".repeat(16));
    expect(records[1]).toHaveProperty("ciphertext_hex");
    expect(records[1]).toHaveProperty("credential_sha256_hex");
    expect(JSON.stringify(records)).not.toContain("ab".repeat(32));
    log.mockRestore();
    await act(async () => renderer.unmount());
  });

  test.each([
    ["code", "43".repeat(16)],
    ["nonce", "44".repeat(32)],
    ["reachable", "http://127.0.0.1:8133"],
  ])("a fresh square after changing %s gets a fresh delivery token", async (field, nextValue) => {
    const completeBodies: string[] = [];
    const claimBodies: string[] = [];
    let completeCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = String(init?.body ?? "");
      if (url.endsWith("/pair/claim")) {
        claimBodies.push(body);
        return { status: 200, json: async () => ({}) } as Response;
      }
      completeBodies.push(body);
      completeCount += 1;
      if (completeCount === 1) throw new Error("response lost");
      return { status: 403, json: async () => "" } as Response;
    }) as typeof fetch;
    let randomCalls = 0;
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: {
        getRandomValues: (bytes: Uint8Array) => {
          bytes.fill(randomCalls++ === 0 ? 0xc0 : 0x01);
          return bytes;
        },
      },
    });
    const renderer = await render();

    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.submit" }).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const first = JSON.parse(completeBodies[0]) as { mac: string; delivery_token: string };
    expect(first.delivery_token).toBe("c0".repeat(16));

    await act(async () => {
      renderer.root.findByProps({ testID: `pairing.${field}` }).props.onChangeText(nextValue);
    });
    expect(renderer.root.findByProps({ testID: `pairing.${field}` }).props.value).toBe(nextValue);
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.submit" }).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const second = JSON.parse(completeBodies[1]) as { mac: string; delivery_token: string };
    expect(claimBodies).toHaveLength(2);
    expect(completeBodies).toHaveLength(2);
    expect(second.delivery_token).toBe("01".repeat(16));
    expect(second.delivery_token).not.toBe(first.delivery_token);
    expect(second.mac).not.toBe(first.mac);
    if (field === "code") {
      expect(claimBodies[1]).toBe(`{"code":"${nextValue}"}`);
    }
    await act(async () => renderer.unmount());
  });
});
