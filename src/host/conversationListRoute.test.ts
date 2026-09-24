import React from "react";

const mockRouteEvents: string[] = [];
const mockHookStates: unknown[] = [];
let mockHookCursor = 0;

jest.mock("react", () => ({
  ...jest.requireActual("react"),
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
  useState: (initial: unknown) => {
    const index = mockHookCursor++;
    if (!(index in mockHookStates)) mockHookStates[index] = initial;
    return [mockHookStates[index], (next: unknown) => {
      mockHookStates[index] = typeof next === "function"
        ? (next as (current: unknown) => unknown)(mockHookStates[index])
        : next;
    }];
  },
}));
jest.mock("react-native", () => ({
  BackHandler: { addEventListener: () => ({ remove: jest.fn() }) },
  Image: "Image",
  Keyboard: { dismiss: jest.fn(() => mockRouteEvents.push("keyboard")) },
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Modal: "Modal",
  Platform: { OS: "android" },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 12 }) }));
jest.mock("lucide-react-native", () => ({
  ChevronLeft: "ChevronLeft",
  ChevronRight: "ChevronRight",
  EllipsisVertical: "EllipsisVertical",
  MessageSquare: "MessageSquare",
  Plus: "Plus",
  Search: "Search",
  X: "X",
}));
jest.mock("../i18n", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${params.title}` : key,
  }),
}));
jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ mode: "light" }) }));
jest.mock("../screens/SettingsHeader", () => ({ SettingsHeader: "SettingsHeader" }));
jest.mock("../../assets/icon.png", () => "brand-icon");
jest.mock("./HostChatSurface", () => ({ HostChatSurface: "HostChatSurface" }));
jest.mock("./HostFurniture", () => ({ HostFurniture: "HostFurniture" }));

import { DrawerContent } from "../theme/components/DrawerContent";
import { ConversationListScreen } from "../screens/ConversationListScreen";
import { HostDrawer } from "./HostDrawer";
import { HostConversations } from "./HostConversations";
import { HostLayout } from "./HostLayout";
import { AttachSheet } from "../ui/shell/AttachSheet";
import { buildDrawerConversationItems } from "./conversationRowActions";

type Element = React.ReactElement<Record<string, any>>;

function findElement(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (!React.isValidElement(node)) return undefined;
  const element = node as Element;
  if (predicate(element)) return element;
  return findElement(element.props.children, predicate);
}

function pressableTree(node: Element, testID: string): Element {
  const found = findElement(node, (element) => element.props.testID === testID);
  if (!found) throw new Error(`Missing rendered control ${testID}`);
  return found;
}

describe("conversation list destination", () => {
  beforeEach(() => {
    mockRouteEvents.length = 0;
    mockHookStates.length = 0;
    mockHookCursor = 0;
  });

  it("opens from the real drawer entry, closes the drawer, and preserves the search", () => {
    const setOverlay = jest.fn((overlay: { kind?: string } | null) => mockRouteEvents.push(`overlay:${overlay?.kind ?? "closed"}`));
    const setDrawerOpen = jest.fn((open: boolean) => mockRouteEvents.push(`drawer:${open}`));
    const layout = HostLayout({
      insets: { top: 0, bottom: 0 },
      draft: "",
      onDraftChange: jest.fn(),
      view: {},
      modelHost: {},
      showNoticeKey: jest.fn(),
      sendHost: {},
      onMenuPress: jest.fn(),
      onNewChatPress: jest.fn(),
      flags: {},
      arms: {},
      attachments: {},
      actions: {},
      onMiniappOpen: jest.fn(),
      drawerOpen: true,
      setDrawerOpen,
      conv: {
        conversationsReady: true,
        conversations: { activeId: "active" },
        chatSearch: "meeting notes",
        chatSearchQuery: "meeting notes",
        handleChatSearchChange: jest.fn(),
        clearChatSearch: jest.fn(() => mockRouteEvents.push("search-cleared")),
      },
      conversationActions: { drawerItems: () => [], handleNewConversation: jest.fn() },
      personas: {},
      onExportPress: jest.fn(),
      activeOverlay: null,
      setActiveOverlay: setOverlay,
      notice: null,
      showNotice: jest.fn(),
      memory: {},
      library: { library: { docs: [] } },
      streaming: false,
    } as any) as Element;
    const drawerElement = findElement(layout, (element) => element.type === HostDrawer);
    if (!drawerElement) throw new Error("HostLayout did not mount HostDrawer");

    const drawer = HostDrawer(drawerElement.props as any) as Element;
    const drawerScreen = (drawer.type as (props: Record<string, unknown>) => Element)(drawer.props);
    const contentElement = findElement(drawerScreen, (element) => element.type === DrawerContent);
    if (!contentElement) throw new Error("Drawer did not mount DrawerContent");
    const content = DrawerContent(contentElement.props as any) as Element;
    pressableTree(content, "drawer.conversations.open").props.onPress();

    expect(mockRouteEvents).toEqual(["keyboard", "drawer:false", "overlay:conversations"]);
    expect(setDrawerOpen).toHaveBeenCalledWith(false);
    expect(setOverlay).toHaveBeenCalledWith({ kind: "conversations" });
  });

  it("keeps the list scrollable and routes row selection and visible accessible actions", () => {
    const onPress = jest.fn();
    const onActionsPress = jest.fn();
    const onQueryChange = jest.fn();
    const screen = ConversationListScreen({
      items: [{ id: "chat-1", title: "Planning", preview: "Next steps", active: true, onPress, onActionsPress }],
      query: "plan",
      onQueryChange,
      onBack: jest.fn(),
    }) as Element;
    const scroll = pressableTree(screen, "conversationList.rows");
    expect(scroll.props.style).toMatchObject({ flex: 1 });
    expect(scroll.props.contentContainerStyle).toMatchObject({ flexGrow: 0 });

    const row = pressableTree(screen, "conversationList.row.chat-1");
    expect(row.props.accessibilityState).toEqual({ selected: true });
    expect(row.props.style({ pressed: false })).toMatchObject({ flex: 1, minHeight: 64 });
    expect(row.props).not.toHaveProperty("onLongPress");
    row.props.onPress();

    const actions = pressableTree(screen, "conversationList.actions.chat-1");
    expect(actions.props.accessibilityRole).toBe("button");
    expect(actions.props.accessibilityLabel).toBe("drawer.conversationActionsFor:Planning");
    expect(actions.props.style({ pressed: false })).toMatchObject({ width: 48, height: 48 });
    actions.props.onPress();
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onActionsPress).toHaveBeenCalledTimes(1);

    pressableTree(screen, "conversationList.search").props.onChangeText("plan revised");
    expect(onQueryChange).toHaveBeenCalledWith("plan revised");
  });

  it("opens the selected row's action sheet with only that conversation's actions", () => {
    const switchConversation = jest.fn();
    const setOverlay = jest.fn();
    const onExportPress = jest.fn();
    const onDelete = jest.fn();
    const conversations = {
      activeId: "active-chat",
      items: [
        { id: "active-chat", title: "Current chat", updatedAt: 2, preview: "Current", searchBlob: "current chat" },
        { id: "older-chat", title: "Older chat", updatedAt: 1, preview: "Older", searchBlob: "older chat" },
      ],
    };
    const t = ((key: string, params?: Record<string, string | number>) =>
      params ? `${key}:${params.title}` : key) as any;
    const drawerConversationItems = (
      state: typeof conversations,
      query: string,
      onActionSheetOpen: (id: string) => void,
      onExport: (id: string) => void,
    ) => buildDrawerConversationItems(
      state as any,
      query,
      "Untitled",
      t,
      switchConversation,
      onActionSheetOpen,
      onExport,
      onDelete,
    );
    const actions = {
      drawerConversationItems,
    };
    const props = {
      conv: {
        conversations,
        chatSearch: "",
        chatSearchQuery: "",
        handleChatSearchChange: jest.fn(),
      } as any,
      actions: actions as any,
      setOverlay,
      onExportPress,
    };
    const host = HostConversations({
      ...props,
    }) as Element;
    const list = findElement(host, (element) => element.type === ConversationListScreen);
    if (!list) throw new Error("HostConversations did not mount the list screen");
    const screen = ConversationListScreen(list.props as any) as Element;
    pressableTree(screen, "conversationList.actions.older-chat").props.onPress();
    expect(setOverlay).not.toHaveBeenCalled();
    expect(switchConversation).not.toHaveBeenCalled();

    mockHookCursor = 0;
    const openedHost = HostConversations(props) as Element;
    const sheet = findElement(openedHost, (element) => element.type === AttachSheet);
    if (!sheet) throw new Error("Pressing the row action control did not open its sheet");
    expect(sheet.props.title).toBe("Older chat");
    expect(sheet.props.rows.map(({ testID, label, accessibilityLabel }: any) => [testID, label, accessibilityLabel])).toEqual([
      ["drawer.conversation.older-chat.export", "drawer.exportAction", "drawer.exportConversationA11y:Older chat"],
      ["drawer.conversation.older-chat.delete", "drawer.deleteAction", "drawer.deleteConversationA11y:Older chat"],
    ]);
    expect(sheet.props.rows.map(({ testID }: any) => testID)).not.toContain("drawer.conversation.active-chat.export");

    sheet.props.rows[0].onPress();
    expect(onExportPress).toHaveBeenCalledWith("older-chat");
    expect(setOverlay).toHaveBeenCalledWith(null);
  });
});
