/**
 * The reply draft card, driven through the rendered tree: the send belongs to
 * the phone's own confirm (PHONE-CHAT-PROTOCOL §5), so pressing Send on the
 * card must send nothing, and only the second press — the confirm's — sends
 * the text the person left on it.
 */
const mockSendDraft = jest.fn();

jest.mock("../../engine/remote/mailApi", () => ({
  sendRemoteMailDraft: (...args: unknown[]) => mockSendDraft(...args),
}));

jest.mock("react-native", () => {
  const react = require("react") as typeof import("react");
  const host = (name: string) => (props: Record<string, unknown>) =>
    react.createElement(name, props, props.children as React.ReactNode);
  return {
    Modal: host("Modal"),
    Pressable: host("Pressable"),
    Text: host("Text"),
    TextInput: host("TextInput"),
    View: host("View"),
  };
});

jest.mock("../../i18n", () => ({
  useLocale: () => ({ t: (key: string, params?: Record<string, unknown>) =>
    params === undefined ? key : `${key}:${JSON.stringify(params)}` }),
}));

const mockUseMailActions = jest.fn(() => ({ sendDraft: mockSendDraft, sends: {} }));
jest.mock("./mailActions", () => ({
  useMailActions: () => mockUseMailActions(),
}));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import { MailDraftCard } from "./MailDraftCard";
import type { MailDraft } from "../../domain/mailPayload";
import { modes } from "../../theme/design";

const DRAFT: MailDraft = {
  draftId: "abc123",
  to: "marco@dominic8.it",
  toName: "Marco",
  subject: "Cena",
  body: "Giovedì va bene.",
};

async function render(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(MailDraftCard, {
        draft: DRAFT,
        colors: modes.light,
      }),
    );
  });
  return renderer;
}

async function press(renderer: ReactTestRenderer, testID: string): Promise<void> {
  await act(async () => {
    renderer.root.find((node) => node.props.testID === testID).props.onPress();
  });
}

async function type(renderer: ReactTestRenderer, testID: string, text: string): Promise<void> {
  await act(async () => {
    renderer.root.find((node) => node.props.testID === testID).props.onChangeText(text);
  });
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => typeof node.props.children === "string")
    .map((node) => node.props.children as string);
}

/** What Send actually draws: the pressable hands the style function to the
 *  platform, so the resolved style is the only way to see a disabled button. */
function sendLooks(renderer: ReactTestRenderer): { opacity?: number } {
  const send = renderer.root.find((node) => node.props.testID === "transcript.mailDraft.send");
  const [base, live] = send.props.style({ pressed: false }) as object[];
  return Object.assign({}, base, live);
}

describe("the reply draft card", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows the computer's recipient and subject, never its body as a sentence of ours", async () => {
    const renderer = await render();
    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        "chat.mail.to: Marco <marco@dominic8.it>",
        "Cena",
        "chat.mail.body",
      ]),
    );
  });

  it("pressing Send opens the confirm and sends nothing", async () => {
    const renderer = await render();
    await press(renderer, "transcript.mailDraft.send");
    expect(mockSendDraft).not.toHaveBeenCalled();
    // The confirm carries the three things that cannot be taken back.
    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        "chat.mail.confirmSendTitle",
        "chat.mail.to: marco@dominic8.it",
        "chat.mail.subject: Cena",
      ]),
    );
  });

  it("the confirm sends the edited text, once", async () => {
    const renderer = await render();
    await type(renderer, "transcript.mailDraft.body", "Giovedì alle 20 va bene.");
    await press(renderer, "transcript.mailDraft.send");
    await press(renderer, "shell.mailConfirm.send");
    expect(mockSendDraft).toHaveBeenCalledTimes(1);
    expect(mockSendDraft).toHaveBeenCalledWith("abc123", "Giovedì alle 20 va bene.");
  });

  it("a cancelled confirm sends nothing", async () => {
    const renderer = await render();
    await press(renderer, "transcript.mailDraft.send");
    await press(renderer, "shell.mailConfirm.cancel");
    expect(mockSendDraft).not.toHaveBeenCalled();
  });

  it("a blank body cannot be confirmed: the computer would send its own words", async () => {
    const renderer = await render();
    await type(renderer, "transcript.mailDraft.body", "   ");
    const send = renderer.root.find((node) => node.props.testID === "transcript.mailDraft.send");
    expect(send.props.disabled).toBe(true);
    expect(texts(renderer)).toContain("chat.mail.bodyEmpty");
  });

  it("a send that cannot happen must not look like one that can", async () => {
    const armed = await render();
    expect(sendLooks(armed).opacity).toBe(1);

    const blank = await render();
    await type(blank, "transcript.mailDraft.body", "   ");
    expect(sendLooks(blank).opacity).toBeLessThan(1);
  });

  it("a sent draft is read-only and offers no second send", async () => {
    mockUseMailActions.mockReturnValueOnce({
      sendDraft: mockSendDraft,
      sends: { abc123: { status: "sent", sentTo: "marco@dominic8.it" } },
    });
    const renderer = await render();
    expect(
      renderer.root.find((node) => node.props.testID === "transcript.mailDraft.body").props.editable,
    ).toBe(false);
    expect(
      renderer.root.find((node) => node.props.testID === "transcript.mailDraft.send").props.disabled,
    ).toBe(true);
    // The guard is invisible on screen unless the style follows it: a spent
    // draft drew a full-strength accent button, so it read as armed.
    expect(sendLooks(renderer).opacity).toBeLessThan(1);
  });
});

describe("two draft cards side by side", () => {
  const SECOND: MailDraft = {
    draftId: "second99",
    to: "altro@x.it",
    toName: "",
    subject: "Vacanze",
    body: "Body del secondo.",
  };

  async function renderTwo(): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        React.createElement(
          "View",
          null,
          React.createElement(MailDraftCard, { draft: DRAFT, colors: modes.light, key: DRAFT.draftId }),
          React.createElement(MailDraftCard, { draft: SECOND, colors: modes.light, key: SECOND.draftId }),
        ),
      );
    });
    return renderer;
  }

  it("sending the first card posts that draft's id with that draft's text", async () => {
    const renderer = await renderTwo();
    // The mocked react-native host reports one element twice — the component
    // and the element it renders — so a value list keeps only its first of each.
    const bodies = renderer.root.findAll(
      (node) => node.props.testID === "transcript.mailDraft.body",
    );
    expect([...new Set(bodies.map((node) => node.props.value))]).toEqual([
      DRAFT.body,
      SECOND.body,
    ]);

    await act(async () => {
      bodies[0].props.onChangeText("Riscritto solo sul primo.");
    });
    const sends = renderer.root.findAll((node) => node.props.testID === "transcript.mailDraft.send");
    await act(async () => {
      sends[0].props.onPress();
    });
    const confirms = renderer.root.findAll(
      (node) => node.props.testID === "shell.mailConfirm.send",
    );
    await act(async () => {
      confirms[0].props.onPress();
    });

    expect(mockSendDraft).toHaveBeenCalledTimes(1);
    expect(mockSendDraft).toHaveBeenCalledWith("abc123", "Riscritto solo sul primo.");
  });
});