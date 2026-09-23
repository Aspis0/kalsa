import React from "react";

const mockDismissKeyboard = jest.fn();

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useMemo: (factory: () => unknown) => factory(),
}));
jest.mock("react-native", () => ({
  Alert: { alert: jest.fn() },
  Keyboard: { dismiss: () => mockDismissKeyboard() },
}));
jest.mock("../../assets/icon.png", () => "brand-mark");
jest.mock("lucide-react-native", () => new Proxy({}, { get: (_target, key) => String(key) }));
jest.mock("../i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ mode: "light" }) }));
jest.mock("../util/filterByTokens", () => ({ tokensFromQuery: () => null }));
jest.mock("../conversations/ConversationsStore", () => ({}));
jest.mock("../engine/sessionPersistence", () => ({}));
jest.mock("../engine/engineBackend", () => ({ getActiveModelId: () => null, isEngineReady: () => false }));
jest.mock("../chat/historyQuarantine", () => ({}));
jest.mock("./turnCorpus", () => ({}));
jest.mock("./conversationRowActions", () => ({ buildDrawerConversationItems: () => [] }));

import { createConversationActions, type ConversationActionCtx } from "./conversationActions";
import { DrawerContent } from "../theme/components/DrawerContent";

type Element = React.ReactElement<Record<string, any>>;

function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}

it("opens Personas by pressing its fifth menu destination", () => {
  const clearChatSearch = jest.fn();
  const setDrawerOpen = jest.fn();
  const setActiveOverlay = jest.fn();
  const actions = createConversationActions({
    t: ((key: string) => key) as any,
    conversationsRef: { current: { activeId: "chat-active", items: [] } as any },
    applyConversations: jest.fn(),
    bindActiveConversation: jest.fn(),
    clearChatSearch,
    flushPartial: jest.fn(),
    isActiveChatEmpty: () => false,
    bumpPersistEpoch: jest.fn(),
    sendingInFlightRef: { current: false },
    setDrawerOpen,
    setActiveOverlay,
  } as unknown as ConversationActionCtx);
  const tree = DrawerContent({
    brand: "Kalsa",
    items: actions.drawerItems(),
    onClose: jest.fn(),
  });
  const footerIds = elements(tree)
    .filter((node) => String(node.props.testID).startsWith("drawer.item."))
    .map((node) => node.props.testID);
  const destination = elements(tree).find((node) => node.props.testID === "drawer.item.personas");

  expect(footerIds).toEqual([
    "drawer.item.documents",
    "drawer.item.notes",
    "drawer.item.settings",
    "drawer.item.account",
    "drawer.item.personas",
  ]);
  expect(destination).toBeDefined();
  destination?.props.onPress();

  expect(mockDismissKeyboard).toHaveBeenCalledTimes(1);
  expect(clearChatSearch).toHaveBeenCalledTimes(1);
  expect(setDrawerOpen).toHaveBeenCalledWith(false);
  expect(setActiveOverlay).toHaveBeenCalledWith({ kind: "personas" });
});
