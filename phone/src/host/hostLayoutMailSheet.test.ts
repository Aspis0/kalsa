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
  useLocale: () => ({ t: (key: string) => key, locale: "en" }),
}));
jest.mock("../ui/labTheme", () => ({ useLabTheme: () => ({ mode: "light" }) }));
jest.mock("./HostChatSurface", () => ({ HostChatSurface: "HostChatSurface" }));
jest.mock("./HostDrawer", () => ({ HostDrawer: "HostDrawer" }));
jest.mock("./HostFurniture", () => ({ HostFurniture: "HostFurniture" }));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { HostLayout, type HostLayoutProps } from "./HostLayout";
import type { MailActions } from "./useMailHost";
import { formatAddedDate } from "../documents/DocumentLibrary";
import { spacing } from "../theme/design";

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

function opened(date: string) {
  return { ...OPENED, record: { ...OPENED.record, date } };
}

function mailHost(openMail: MailActions["openMail"], openedFor = "active"): MailActions {
  return {
    draftReply: jest.fn(),
    readMail: jest.fn(),
    closeMail: jest.fn(),
    sendDraft: jest.fn(),
    openMail,
    openedFor,
    sends: {},
  };
}

function layoutProps(
  conversationsReady: boolean,
  activeId = "active",
  insets = { top: 0, bottom: 0 },
): HostLayoutProps {
  return {
    insets,
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
    conv: { conversationsReady, conversations: { activeId } },
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

  it("draws no sheet on the first render after the conversation switches", () => {
    mockMail = mailHost({ status: "loading" });
    const renderer = mountLayout(layoutProps(true));
    expect(sheetsIn(renderer)).toHaveLength(1);

    // The host still holds the read made in "active" until its own reset runs.
    rerender(renderer, layoutProps(true, "next"));
    expect(sheetsIn(renderer)).toHaveLength(0);
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

  it("dates the mail the way the app dates things, never as the wire stamp", () => {
    const stamp = "2026-10-13T18:13:38Z";
    mockMail = mailHost({ status: "ready", mail: opened(stamp) });
    const renderer = mountLayout(layoutProps(true));
    const dates = renderer.root.findAll((node) => node.props.testID === "shell.mailRead.date");
    expect(dates).toHaveLength(1);
    const text = dates[0].props.children as string;
    expect(text).toBe(formatAddedDate(Date.parse(stamp), "en"));
    expect(text).not.toContain("2026-10-13T");
  });

  it("draws no date at all when the wire stamp cannot be read", () => {
    mockMail = mailHost({ status: "ready", mail: opened("ieri pomeriggio") });
    const renderer = mountLayout(layoutProps(true));
    expect(renderer.root.findAll((node) => node.props.testID === "shell.mailRead.date")).toHaveLength(0);
  });

  it("keeps the close row clear of the Android navigation bar", () => {
    mockMail = mailHost({ status: "ready", mail: OPENED });
    const renderer = mountLayout(layoutProps(true, "active", { top: 24, bottom: 48 }));
    const card = renderer.root.find((node) => node.props.testID === "shell.mailRead.card");
    const style = Object.assign({}, ...(card.props.style as object[]));
    expect(style.paddingBottom).toBe(spacing.lg + 48);
  });

  it("closes on the sheet's own padding when the phone has no navigation bar", () => {
    mockMail = mailHost({ status: "ready", mail: OPENED });
    const renderer = mountLayout(layoutProps(true, "active", { top: 24, bottom: 0 }));
    const card = renderer.root.find((node) => node.props.testID === "shell.mailRead.card");
    const style = Object.assign({}, ...(card.props.style as object[]));
    expect(style.paddingBottom).toBe(spacing.lg);
  });
});
