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

jest.mock("./mailActions", () => ({
  useMailActions: () => ({ sendDraft: mockSendDraft, sends: {} }),
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
});