jest.mock("react-native", () => {
  const react = require("react") as typeof import("react");
  const host = (name: string) => (props: Record<string, unknown>) =>
    react.createElement(name, props, props.children as React.ReactNode);
  return {
    Keyboard: { dismiss: jest.fn() },
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

// A square may carry a valid node; the screen asks the real module whether
// the iroh road exists, and the default in jest must stay "no" — the road
// gate itself is covered in road.test. Tests that take the iroh road flip
// these two in their own case (beforeEach restores the defaults).
jest.mock("../remote/irohBridge", () => ({
  irohModulePresent: jest.fn(() => false),
  openIrohTunnel: jest.fn(),
}));

// The scanner pulls in expo-camera (native); PairingScreen is under test,
// not the camera, so the scanner is a host stub with its props exposed.
jest.mock("./PairingQrScanner", () => ({
  PairingQrScanner: (props: Record<string, unknown>) =>
    require("react").createElement("PairingQrScanner", { scannerStub: true, ...props }),
}));

// The transport lazily requires expo-crypto for its default random source;
// a queue of fill bytes stands in for the CSPRNG (jest.mock factories may
// only close over "mock"-prefixed bindings). Setting mockRandomError makes
// the constructor throw, the one path that escapes the ceremony's own catches.
let mockRandomFills: number[] = [0xc0];
let mockRandomError: Error | null = null;
jest.mock("expo-crypto", () => ({
  getRandomBytes: (length: number) => {
    if (mockRandomError) throw mockRandomError;
    return new Uint8Array(length).fill(mockRandomFills.shift() ?? 0xc0);
  },
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Keyboard } from "react-native";
import { savePairingCredential } from "../pairing/pairingCredentialStore";
import { irohModulePresent, openIrohTunnel } from "../remote/irohBridge";
import type { IrohTunnel } from "../remote/irohHttp";
import { PairingScreen } from "./PairingScreen";

const saveCredentialMock = savePairingCredential as jest.MockedFunction<typeof savePairingCredential>;
const originalFetch = globalThis.fetch;
const preexistingCredential = { credential: "12".repeat(32), doorUrl: "https://old-computer.example" };
let storedCredential = { ...preexistingCredential };

beforeEach(() => {
  jest.clearAllMocks();
  (irohModulePresent as jest.Mock).mockReturnValue(false);
  (openIrohTunnel as jest.Mock).mockReset();
  mockRandomFills = [0xc0];
  mockRandomError = null;
  storedCredential = { ...preexistingCredential };
  saveCredentialMock.mockImplementation(async (credential, doorUrl) => {
    storedCredential = {
      credential: Array.from(credential, (byte) => byte.toString(16).padStart(2, "0")).join(""),
      doorUrl,
    };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

async function render(
  currentModelId = "local-model",
  initialDoorUrl = "https://desktop.tailnet.ts.net",
): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(PairingScreen, {
        initialDoorUrl,
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

const SEAL = {
  credential_ciphertext: "19d0b3455e311a70ba202aea83ea569e8127f2f1936f67bdc557439a82222ba7",
  mac: "6d86a29391e258de9bb13dae9ceb3612143c4448050562a36ad2e6ac8dd4a849",
};

function installFetch(completeStatus: number) {
  const urls: string[] = [];
  const bodies: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (typeof init?.body === "string") bodies.push(init.body);
    return {
      status: url.endsWith("/pair/claim") ? 200 : completeStatus,
      json: async () => SEAL,
    } as Response;
  }) as typeof fetch;
  return { urls, bodies };
}

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function requestText(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function cannedResponse(statusLine: string, body: string): Uint8Array {
  return ascii(`HTTP/1.1 ${statusLine}\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
}

/** One canned response per read for the desk lane's fake tunnels. */
function fakeDeskTunnel(reads: Uint8Array[]): IrohTunnel & { writes: Uint8Array[] } {
  const queue = [...reads];
  return {
    writes: [],
    async write(bytes: Uint8Array) {
      this.writes.push(bytes);
    },
    async read(max: number) {
      if (queue.length === 0) return new Uint8Array(0);
      const next = queue.shift() as Uint8Array;
      if (next.length <= max) return next;
      queue.unshift(next.subarray(max));
      return next.subarray(0, max);
    },
    async shutdown() {
      // Nothing to release: the fake holds no native handle.
    },
  };
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

  test("a scanned square fills the form fields and drives the same pairing flow", async () => {
    const { bodies } = installFetch(200);
    const renderer = await render();
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.scan" }).props.onPress();
    });
    expect(Keyboard.dismiss).toHaveBeenCalled();
    const scanner = renderer.root.findByProps({ scannerStub: true });
    await act(async () => {
      scanner.props.onFound({
        reachable: "http://127.0.0.1:9500",
        code: "41".repeat(16),
        nonce: "42".repeat(32),
        node: "ab".repeat(32),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer.root.findByProps({ testID: "pairing.reachable" }).props.value)
      .toBe("http://127.0.0.1:9500");
    expect(renderer.root.findByProps({ testID: "pairing.node" }).props.value).toBe("ab".repeat(32));
    expect(bodies[0]).toBe(`{"code":"${"41".repeat(16)}"}`);
    expect(saveCredentialMock).toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ scannerStub: true })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: "pairing.waiting" })).toBeDefined();
    await act(async () => renderer.unmount());
  });

  test("a scanned square with a node rides the iroh desk lane and saves that pairing road", async () => {
    const node = "ab".repeat(32);
    (irohModulePresent as jest.Mock).mockReturnValue(true);
    const claimTunnel = fakeDeskTunnel([cannedResponse("200 OK", "")]);
    const completeTunnel = fakeDeskTunnel([cannedResponse("200 OK", JSON.stringify(SEAL))]);
    (openIrohTunnel as jest.Mock)
      .mockResolvedValueOnce(claimTunnel)
      .mockResolvedValueOnce(completeTunnel);
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const renderer = await render();
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.scan" }).props.onPress();
    });
    const scanner = renderer.root.findByProps({ scannerStub: true });
    await act(async () => {
      scanner.props.onFound({
        reachable: "http://127.0.0.1:9500",
        code: "41".repeat(16),
        nonce: "42".repeat(32),
        node,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The ceremony never touched the URL fields' host: claim and complete
    // both rode desk tunnels, byte-identical to the HTTPS wire.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(openIrohTunnel).toHaveBeenCalledTimes(2);
    expect(openIrohTunnel).toHaveBeenNthCalledWith(1, node, "desk");
    expect(openIrohTunnel).toHaveBeenNthCalledWith(2, node, "desk");
    expect(requestText(claimTunnel.writes[0])).toContain("POST /pair/claim HTTP/1.1\r\n");
    expect(requestText(completeTunnel.writes[0])).toContain("POST /pair/complete HTTP/1.1\r\n");
    expect(saveCredentialMock).toHaveBeenCalledWith(
      new Uint8Array(32).fill(0xab),
      "https://desktop.tailnet.ts.net",
      { node, pairedVia: "iroh" },
    );
    expect(renderer.root.findByProps({ testID: "pairing.waiting" })).toBeDefined();
    await act(async () => renderer.unmount());
  });

  test("unmounting with a desk request in flight aborts it and closes its tunnel", async () => {
    const node = "ab".repeat(32);
    (irohModulePresent as jest.Mock).mockReturnValue(true);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let shutdowns = 0;
    (openIrohTunnel as jest.Mock).mockResolvedValueOnce({
      async write() {
        // The claim is accepted; the response never arrives.
      },
      async read() {
        await blocked;
        throw new Error("tunnel closed");
      },
      async shutdown() {
        shutdowns++;
        release();
      },
    });
    const fetchSpy = jest.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const renderer = await render();
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.scan" }).props.onPress();
    });
    const scanner = renderer.root.findByProps({ scannerStub: true });
    await act(async () => {
      scanner.props.onFound({
        reachable: "http://127.0.0.1:9500",
        code: "41".repeat(16),
        nonce: "42".repeat(32),
        node,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(shutdowns).toBe(0);

    await act(async () => {
      renderer.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // The screen's signal fired on unmount: the claim's tunnel is shut,
    // and no complete ever opens a second one.
    expect(shutdowns).toBeGreaterThan(0);
    expect(openIrohTunnel).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("the scan button is disabled while waiting so a pending completion retry cannot be dropped", async () => {
    installFetch(200);
    const renderer = await render();
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.submit" }).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer.root.findByProps({ testID: "pairing.waiting" })).toBeDefined();
    const scan = renderer.root.findByProps({ testID: "pairing.scan" });
    expect(scan.props.disabled).toBe(true);
    expect(scan.props.accessibilityState.disabled).toBe(true);
    await act(async () => renderer.unmount());
  });

  test("a scan on a fresh install with no computer address names the missing address", async () => {
    globalThis.fetch = jest.fn() as unknown as typeof fetch;
    const renderer = await render("local-model", "");
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.scan" }).props.onPress();
    });
    const scanner = renderer.root.findByProps({ scannerStub: true });
    await act(async () => {
      scanner.props.onFound({
        reachable: "http://127.0.0.1:8132",
        code: "41".repeat(16),
        nonce: "42".repeat(32),
        node: "",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer.root.findByProps({ testID: "pairing.door-required" }).props.children)
      .toBe("pairing.doorRequired");
    expect(renderer.root.findAllByProps({ testID: "pairing.refused" })).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(saveCredentialMock).not.toHaveBeenCalled();
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
      { node: "", pairedVia: "https" },
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

  test("an unusable desk address logs stage validate and refuses before dialling", async () => {
    globalThis.fetch = jest.fn() as unknown as typeof fetch;
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const renderer = await render();
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.deskUrl" }).props.onChangeText(
        "ftp://desktop.example",
      );
    });
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.submit" }).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer.root.findByProps({ testID: "pairing.refused" })).toBeDefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    const fails = log.mock.calls.filter((call) => call[0] === "KALSA_PAIRING_FAIL");
    expect(JSON.parse(String(fails[0][1]))).toEqual({ stage: "validate", status: null });
    log.mockRestore();
    await act(async () => renderer.unmount());
  });

  test("a save failure logs stage save and refuses with the uniform text", async () => {
    installFetch(200);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    saveCredentialMock.mockRejectedValueOnce(new Error("secure store unavailable"));
    const renderer = await render();
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.submit" }).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer.root.findByProps({ testID: "pairing.refused" })).toBeDefined();
    expect(renderer.root.findAllByProps({ testID: "pairing.waiting" })).toHaveLength(0);
    const fails = log.mock.calls.filter((call) => call[0] === "KALSA_PAIRING_FAIL");
    expect(fails).toHaveLength(1);
    expect(JSON.parse(String(fails[0][1]))).toEqual({ stage: "save", status: null });
    expect(String(fails[0][1])).not.toContain("c0".repeat(16));
    log.mockRestore();
    await act(async () => renderer.unmount());
  });

  test("a throw that escapes every named stage logs unexpected and refuses", async () => {
    installFetch(200);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    mockRandomError = new Error("native crypto missing");
    const renderer = await render();
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.submit" }).props.onPress();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(renderer.root.findByProps({ testID: "pairing.refused" })).toBeDefined();
    const stages = log.mock.calls
      .filter((call) => call[0] === "KALSA_PAIRING_FAIL")
      .map((call) => JSON.parse(String(call[1])).stage);
    // The transport names the random failure, then the rethrow lands here.
    expect(stages).toEqual(["random", "unexpected"]);
    log.mockRestore();
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
    expect(records[0]).toHaveProperty("mac_hex");
    // The toggle promises fingerprints only: the live ceremony inputs stay out.
    expect(records[0]).not.toHaveProperty("payload_hex");
    expect(records[0]).not.toHaveProperty("delivery_token_hex");
    expect(records[1]).toHaveProperty("ciphertext_hex");
    expect(records[1]).toHaveProperty("credential_sha256_hex");
    const logged = JSON.stringify(records);
    expect(logged).not.toContain("ab".repeat(32));
    expect(logged).not.toContain("c0".repeat(16));
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
    mockRandomFills = [0xc0, 0x01];
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
