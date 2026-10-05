import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";

jest.mock("react-native", () => {
  const react = require("react") as typeof import("react");
  const host = (name: string) => (props: Record<string, unknown>) =>
    react.createElement(name, props, props.children as React.ReactNode);
  return {
    BackHandler: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
    Pressable: host("Pressable"),
    Text: host("Text"),
    TextInput: host("TextInput"),
    View: host("View"),
  };
});
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock("lucide-react-native", () => ({ ArrowUp: "ArrowUp" }));
jest.mock("../i18n", () => ({ useLocale: () => ({ t: (key: string) => key, locale: "en" }) }));
jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ mode: "light" }) }));
jest.mock("../ui/shell/useKeyboardHeight", () => ({ useKeyboardHeight: () => 0 }));
jest.mock("./SettingsHeader", () => ({ SettingsHeader: () => null }));
jest.mock("./room/RoomPeople", () => ({ RoomPeople: () => null }));
jest.mock("./room/RoomTranscript", () => ({ RoomTranscript: () => null }));

const mockSend = jest.fn();
let mockSetSendErrorCode: ((code: string | null) => void) | null = null;
jest.mock("../room/useRoom", () => ({
  useRoom: () => {
    const react = require("react") as typeof import("react");
    const [sendErrorCode, setSendErrorCode] = react.useState<string | null>(null);
    mockSetSendErrorCode = setSendErrorCode;
    return {
      feed: {
        status: "ready",
        info: { members: [], ai: { youPending: false, queue: [], running: null } },
        live: null,
        noteCode: null,
        callRefusalCode: null,
        reconnecting: false,
      },
      rows: [],
      pending: [],
      nameErrorCode: null,
      sendErrorCode,
      pageErrorCode: null,
      loadingOlder: false,
      setName: jest.fn(),
      send: mockSend,
      retry: jest.fn(),
      discard: jest.fn(),
      loadOlder: jest.fn(),
      reload: jest.fn(),
    };
  },
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { RoomScreen } from "./RoomScreen";

let renderer: ReactTestRenderer;

beforeEach(() => {
  mockSend.mockReset().mockImplementation(async () => {
    mockSetSendErrorCode?.("unexpected");
    return false;
  });
});

afterEach(() => renderer?.unmount());

test("a refused send restores the composer draft and shows the trouble alert", async () => {
  await act(async () => {
    renderer = create(<RoomScreen localId="p-lid-room" onBack={jest.fn()} />);
  });
  const composer = renderer.root.findByProps({ testID: "room.composer" });
  await act(async () => composer.props.onChangeText("keep these words"));
  expect(renderer.root.findAllByProps({ testID: "room.trouble" })).toHaveLength(0);
  await act(async () => renderer.root.findByProps({ testID: "room.send" }).props.onPress());

  expect(renderer.root.findByProps({ testID: "room.composer" }).props.value).toBe("keep these words");
  expect(renderer.root.findByProps({ testID: "room.trouble" }).props.children).toBe("room.noteFallback");
  expect(mockSend).toHaveBeenCalledWith("keep these words", false);
});
