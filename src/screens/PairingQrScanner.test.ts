jest.mock("react-native", () => {
  const react = require("react") as typeof import("react");
  const host = (name: string) => (props: Record<string, unknown>) =>
    react.createElement(name, props, props.children as React.ReactNode);
  // One live listener per event source; remove() clears it so unmount
  // cleanup is observable from the test.
  const capture = <H>() => {
    const state: { handler: H | null; remove: jest.Mock | null } = { handler: null, remove: null };
    const addEventListener = jest.fn((_type: string, handler: H) => {
      state.handler = handler;
      state.remove = jest.fn(() => {
        state.handler = null;
      });
      return { remove: state.remove };
    });
    return { state, addEventListener };
  };
  const back = capture<() => boolean>();
  const appState = capture<(state: string) => void>();
  return {
    Pressable: host("Pressable"),
    Text: host("Text"),
    View: host("View"),
    Linking: { openSettings: jest.fn(async () => undefined) },
    BackHandler: { addEventListener: back.addEventListener, state: back.state },
    AppState: { addEventListener: appState.addEventListener, state: appState.state },
  };
});

jest.mock("expo-camera", () => {
  const react = require("react") as typeof import("react");
  const store: {
    permission: Record<string, unknown> | null;
    setPermission: ((value: Record<string, unknown> | null) => void) | null;
    get: jest.Mock;
    request: jest.Mock;
  } = {
    permission: null,
    setPermission: null,
    get: jest.fn(async () => {
      store.setPermission?.(store.permission);
      return store.permission;
    }),
    request: jest.fn(async () => {
      store.setPermission?.(store.permission);
      return store.permission;
    }),
  };
  return {
    store,
    CameraView: (props: Record<string, unknown>) =>
      react.createElement("CameraView", { cameraStub: true, ...props }),
    // Mirrors useCameraPermissions: stable get/request identities, state
    // driven by the store the test mutates.
    useCameraPermissions: () => {
      const [permission, setPermission] = react.useState(store.permission);
      store.setPermission = setPermission;
      return [permission, store.request, store.get];
    },
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

jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ mode: "light" }) }));
jest.mock("../i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { PairingSquare } from "../pairing/pairingTransport";
import { PairingQrScanner } from "./PairingQrScanner";

type Permission = { status: string; granted: boolean; canAskAgain: boolean };

const UNDETERMINED: Permission = { status: "undetermined", granted: false, canAskAgain: true };
const GRANTED: Permission = { status: "granted", granted: true, canAskAgain: true };
const DENIED_ASKABLE: Permission = { status: "denied", granted: false, canAskAgain: true };
const DENIED_BLOCKED: Permission = { status: "denied", granted: false, canAskAgain: false };

const camera = jest.requireMock("expo-camera") as {
  store: { permission: Permission | null; get: jest.Mock; request: jest.Mock };
};
const rn = jest.requireMock("react-native") as {
  BackHandler: { addEventListener: jest.Mock; state: { handler: (() => boolean) | null; remove: jest.Mock | null } };
  AppState: { addEventListener: jest.Mock; state: { handler: ((state: string) => void) | null; remove: jest.Mock | null } };
  Linking: { openSettings: jest.Mock };
};

const validSquare = (reachable = "http://127.0.0.1:9500") =>
  JSON.stringify({ v: 3, reachable, code: "41".repeat(16), nonce: "42".repeat(32) });

async function renderScanner(permission: Permission) {
  camera.store.permission = permission;
  const onFound = jest.fn();
  const onCancel = jest.fn();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(PairingQrScanner, { onFound, onCancel }));
  });
  return { renderer, onFound, onCancel };
}

beforeEach(() => {
  jest.clearAllMocks();
  camera.store.permission = null;
});

describe("PairingQrScanner acceptance", () => {
  test("exactly one accepted square per scanner lifetime", async () => {
    const { renderer, onFound } = await renderScanner(GRANTED);
    const cameraNode = renderer.root.findByProps({ cameraStub: true });
    expect(cameraNode.props.barcodeScannerSettings).toEqual({ barcodeTypes: ["qr"] });
    await act(async () => {
      cameraNode.props.onBarcodeScanned({ data: validSquare("http://127.0.0.1:9500") });
      cameraNode.props.onBarcodeScanned({ data: validSquare("http://127.0.0.1:9600") });
    });
    expect(onFound).toHaveBeenCalledTimes(1);
    expect(onFound).toHaveBeenCalledWith({
      reachable: "http://127.0.0.1:9500",
      code: "41".repeat(16),
      nonce: "42".repeat(32),
      node: "",
    } satisfies PairingSquare);
    await act(async () => renderer.unmount());
  });

  test("an invalid scan shows the parser error and scanning continues", async () => {
    const { renderer, onFound } = await renderScanner(GRANTED);
    const cameraNode = renderer.root.findByProps({ cameraStub: true });
    await act(async () => {
      cameraNode.props.onBarcodeScanned({ data: "not a pairing square" });
    });
    expect(onFound).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ testID: "pairing.scan.error" }).props.children)
      .toBe("pairing.scanErrors.notJson");
    expect(renderer.root.findAllByProps({ cameraStub: true })).toHaveLength(1);
    await act(async () => {
      cameraNode.props.onBarcodeScanned({ data: validSquare() });
    });
    expect(onFound).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });
});

describe("PairingQrScanner permission states", () => {
  test("undetermined renders neutrally: no denial copy, no action buttons, no camera", async () => {
    const { renderer } = await renderScanner(UNDETERMINED);
    expect(renderer.root.findAllByProps({ testID: "pairing.scan.denied" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: "pairing.scan.allow" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ testID: "pairing.scan.openSettings" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ cameraStub: true })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: "pairing.scan.cancel" })).toBeDefined();
    await act(async () => renderer.unmount());
  });

  test("denied with canAskAgain offers a request instead of Settings", async () => {
    const { renderer } = await renderScanner(DENIED_ASKABLE);
    expect(renderer.root.findByProps({ testID: "pairing.scan.denied" })).toBeDefined();
    expect(renderer.root.findAllByProps({ testID: "pairing.scan.openSettings" })).toHaveLength(0);
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.scan.allow" }).props.onPress();
      await Promise.resolve();
    });
    expect(camera.store.request).toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  test("denied without canAskAgain offers Settings instead of a request", async () => {
    const { renderer } = await renderScanner(DENIED_BLOCKED);
    expect(renderer.root.findAllByProps({ testID: "pairing.scan.allow" })).toHaveLength(0);
    await act(async () => {
      renderer.root.findByProps({ testID: "pairing.scan.openSettings" }).props.onPress();
      await Promise.resolve();
    });
    expect(rn.Linking.openSettings).toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  test("the foreground re-check wakes the camera after a grant in Settings", async () => {
    const { renderer } = await renderScanner(DENIED_BLOCKED);
    expect(rn.AppState.addEventListener.mock.calls[0][0]).toBe("change");
    await act(async () => {
      rn.AppState.state.handler?.("background");
      await Promise.resolve();
    });
    expect(renderer.root.findAllByProps({ cameraStub: true })).toHaveLength(0);
    camera.store.permission = GRANTED;
    await act(async () => {
      rn.AppState.state.handler?.("active");
      await Promise.resolve();
    });
    expect(renderer.root.findAllByProps({ cameraStub: true })).toHaveLength(1);
    await act(async () => renderer.unmount());
  });
});

describe("PairingQrScanner navigation", () => {
  test("hardware back is consumed and calls onCancel", async () => {
    const { renderer, onCancel } = await renderScanner(GRANTED);
    expect(rn.BackHandler.addEventListener.mock.calls[0][0]).toBe("hardwareBackPress");
    const handler = rn.BackHandler.state.handler;
    expect(handler).not.toBeNull();
    let handled = false;
    await act(async () => {
      handled = handler!();
    });
    expect(handled).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  test("both event listeners are removed on unmount", async () => {
    const { renderer } = await renderScanner(GRANTED);
    const backRemove = rn.BackHandler.state.remove;
    const appStateRemove = rn.AppState.state.remove;
    await act(async () => renderer.unmount());
    expect(backRemove).toHaveBeenCalled();
    expect(appStateRemove).toHaveBeenCalled();
    expect(rn.BackHandler.state.handler).toBeNull();
    expect(rn.AppState.state.handler).toBeNull();
  });
});
