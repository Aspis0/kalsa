jest.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  TextInput: "TextInput",
  View: "View",
}));

jest.mock("lucide-react-native", () => ({
  ArrowUp: "ArrowUp",
  Mic: "Mic",
  Plus: "Plus",
  Square: "Square",
}));

jest.mock("../../i18n", () => ({
  useLocale: () => ({
    t: (key: string) => (key === "shell.a11y.field" ? "Message input" : key),
  }),
}));

jest.mock("../../theme/design", () => ({
  families: { sans: "system" },
  space: { xxs: 4 },
}));

jest.mock("./shellStyles", () => ({
  createShellStyles: () => ({
    composerBand: {},
    field: {},
    fieldIcon: {},
    input: {},
    send: {},
    sendCircle: {},
  }),
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { DesignColors } from "../../theme/design";
import { ShellComposer } from "./ShellComposer";

const colors = {
  surface: "#fff",
  line: "#ddd",
  ink: "#111",
  ink3: "#777",
  tint: "#eee",
  brand: "#063",
  onBrand: "#fff",
} as DesignColors;

describe("ShellComposer field naming", () => {
  test.each([true, false])("renders no visible placeholder when editable=%s and keeps its accessible name", async (editable) => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(ShellComposer, {
        height: 60,
        bottomOffset: 0,
        colors,
        draft: "",
        editable,
        face: "send",
        faceEnabled: true,
        sendEnabled: false,
      }));
    });

    const input = renderer.root.findByProps({ testID: "shell.composer.field" });
    expect(input.props.placeholder).toBeUndefined();
    expect(input.props.accessibilityLabel).toBe("Message input");
    expect(input.props.accessibilityLabel.trim()).not.toBe("");

    await act(async () => renderer.unmount());
  });
});
