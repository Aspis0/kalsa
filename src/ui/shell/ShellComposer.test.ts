jest.mock("react-native", () => ({
  ActivityIndicator: "ActivityIndicator",
  Pressable: "Pressable",
  Text: "Text",
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
  measure: { gutter: 16 },
  space: { xs: 8, xxs: 4 },
  spacing: { xs: 4 },
  type: {
    caption: { fontFamily: "system", fontSize: 11, lineHeight: 16 },
    meta: { fontFamily: "system", fontSize: 11, lineHeight: 14 },
  },
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
import { ComposerDisclaimer } from "./ComposerDisclaimer";
import { ShellComposer, type ShellComposerProps } from "./ShellComposer";

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
        showDisclaimer: true,
      }));
    });

    const input = renderer.root.findByProps({ testID: "shell.composer.field" });
    expect(input.props.placeholder).toBeUndefined();
    expect(input.props.accessibilityLabel).toBe("Message input");
    expect(input.props.accessibilityLabel.trim()).not.toBe("");

    await act(async () => renderer.unmount());
  });
});

describe("the disclaimer line under the field", () => {
  async function mount(showDisclaimer: boolean) {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(ShellComposer, {
        height: 98,
        bottomOffset: 0,
        colors,
        draft: "",
        editable: true,
        face: "send",
        faceEnabled: true,
        sendEnabled: false,
        showDisclaimer,
      }));
    });
    return renderer;
  }

  test("is drawn when the band has its full height", async () => {
    const renderer = await mount(true);
    expect(renderer.root.findAllByType(ComposerDisclaimer)).toHaveLength(1);
    await act(async () => renderer.unmount());
  });

  test("is dropped when the band is squeezed, and the field stays", async () => {
    const renderer = await mount(false);
    expect(renderer.root.findAllByType(ComposerDisclaimer)).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: "shell.composer.field" })).toBeTruthy();
    await act(async () => renderer.unmount());
  });
});

describe("the field is a phone composer field", () => {
  const defaults: ShellComposerProps = {
    height: 98,
    bottomOffset: 0,
    colors,
    draft: "ciao",
    editable: true,
    face: "send",
    faceEnabled: true,
    sendEnabled: true,
    showDisclaimer: true,
  };

  async function mount(over: Partial<ShellComposerProps>) {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(ShellComposer, { ...defaults, ...over }));
    });
    return renderer;
  }

  const field = (renderer: ReactTestRenderer) =>
    renderer.root.findByProps({ testID: "shell.composer.field" });

  test("multiline: Return is a newline, and Send stays the button", async () => {
    const onSendPress = jest.fn();
    const renderer = await mount({ onSendPress });
    const input = field(renderer);

    expect(input.props.multiline).toBe(true);
    // The single-line Enter-to-send is gone with the shape that needed it.
    expect(input.props.onSubmitEditing).toBeUndefined();
    expect(input.props.returnKeyType).toBeUndefined();
    // Send is still there, and it is the only thing that sends.
    expect(renderer.root.findByProps({ testID: "shell.composer.send" }).props.onPress).toBe(
      onSendPress,
    );
    await act(async () => renderer.unmount());
  });

  test("draws the box it is given, so a grown field grows", async () => {
    const oneLine = await mount({ fieldHeight: 56 });
    expect(oneLine.root.findByProps({ testID: "shell.composer.field" }).props.style).toEqual([
      expect.anything(),
      { height: 56 },
    ]);
    await act(async () => oneLine.unmount());

    const fiveLines = await mount({ fieldHeight: 105 });
    expect(fiveLines.root.findByProps({ testID: "shell.composer.field" }).props.style).toEqual([
      expect.anything(),
      { height: 105 },
    ]);
    await act(async () => fiveLines.unmount());
  });

  test("reports what the input measured, so the shell can re-partition", async () => {
    const onContentHeightChange = jest.fn();
    const renderer = await mount({ onContentHeightChange });
    field(renderer).props.onContentSizeChange({ nativeEvent: { contentSize: { height: 63 } } });

    expect(onContentHeightChange).toHaveBeenCalledWith(63);
    // Nothing measured, nothing reported: the band never re-partitions on a tap.
    await act(async () => renderer.unmount());

    const silent = await mount({});
    silent.root
      .findByProps({ testID: "shell.composer.field" })
      .props.onContentSizeChange({ nativeEvent: { contentSize: { height: 63 } } });
    await act(async () => silent.unmount());
  });
});
