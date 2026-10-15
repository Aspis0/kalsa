/**
 * The mail read sheet, mounted by the real HostLayout: it opens while a read is
 * loading and draws the mail once the read lands. Only the mail host is mocked
 * (it reaches the door); the provider and the sheet are the real ones, so a
 * sheet placed outside the provider draws nothing here, as it did on the phone.
 */
const mockUseMailHost = jest.fn((_params: unknown) => currentMail());
let mockMail: MailActions | null = null;
function currentMail(): MailActions {
  if (mockMail === null) throw new Error("no mail host set for this test");
  return mockMail;
}

jest.mock("./useMailHost", () => ({
  useMailHost: (params: unknown) => mockUseMailHost(params),
}));
jest.mock("react-native", () => ({
  Modal: "Modal",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  View: "View",
}));
jest.mock("../i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ mode: "light" }) }));
jest.mock("./HostChatSurface", () => ({ HostChatSurface: "HostChatSurface" }));
jest.mock("./HostDrawer", () => ({ HostDrawer: "HostDrawer" }));
jest.mock("./HostFurniture", () => ({ HostFurniture: "HostFurniture" }));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { HostLayout, type HostLayoutProps } from "./HostLayout";
import type { MailActions } from "./useMailHost";

const OPENED = {
  record: {
    id: "m1",
    from: { name: "", address: "sender@example.com" },
    subject: "Hello",
    gist: "",
    date: "",
    label: "",
    reasons: [],
  },
  body: "Body text",
};

function mailHost(openMail: MailActions["openMail"]): MailActions {
  return {
    draftReply: jest.fn(),
    readMail: jest.fn(),
    closeMail: jest.fn(),
    sendDraft: jest.fn(),
    openMail,
    sends: {},
  };
}

function layoutProps(conversationsReady: boolean): HostLayoutProps {
  return {
    insets: { top: 0, bottom: 0 },
    draft: "",
    onDraftChange: jest.fn(),
    view: {},
    modelHost: {},
    showNoticeKey: jest.fn(),
    sendHost: { send: jest.fn() },
    onMenuPress: jest.fn(),
    onNewChatPress: jest.fn(),
    flags: {},
    arms: {},
    attachments: {},
    actions: {},
    onMiniappOpen: jest.fn(),
    drawerOpen: false,
    setDrawerOpen: jest.fn(),
    conv: { conversationsReady, conversations: { activeId: "active" } },
    conversationActions: {},
    personas: {},
    onExportPress: jest.fn(),
    activeOverlay: null,
    setActiveOverlay: jest.fn(),
    notice: null,
    showNotice: jest.fn(),
    memory: {},
    library: { library: { docs: [] } },
    streaming: false,
  } as unknown as HostLayoutProps;
}

function mountLayout(props: HostLayoutProps): ReactTestRenderer {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(React.createElement(HostLayout, props));
  });
  return renderer;
}

function rerender(renderer: ReactTestRenderer, props: HostLayoutProps): void {
  act(() => {
    renderer.update(React.createElement(HostLayout, props));
  });
}

function sheetsIn(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => node.props.testID === "shell.mailRead.modal");
}

describe("the mail read sheet under the real HostLayout", () => {
  it("opens while a read is loading, then draws the mail", () => {
    mockMail = mailHost({ status: "loading" });
    const props = layoutProps(true);
    const renderer = mountLayout(props);
    expect(sheetsIn(renderer)).toHaveLength(1);

    mockMail = mailHost({ status: "ready", mail: OPENED });
    rerender(renderer, props);
    const body = renderer.root.findAll((node) => node.props.testID === "shell.mailRead.body");
    expect(body).toHaveLength(1);
    expect(body[0].props.children).toBe("Body text");
  });

  it("draws no sheet while nothing is open", () => {
    mockMail = mailHost({ status: "idle" });
    const renderer = mountLayout(layoutProps(true));
    expect(sheetsIn(renderer)).toHaveLength(0);
  });

  it("gives the mail host the conversation only once the conversations are ready", () => {
    mockMail = mailHost({ status: "idle" });
    mountLayout(layoutProps(false));
    expect(mockUseMailHost).toHaveBeenLastCalledWith(expect.objectContaining({ conversationId: undefined }));

    mountLayout(layoutProps(true));
    expect(mockUseMailHost).toHaveBeenLastCalledWith(expect.objectContaining({ conversationId: "active" }));
  });
});
