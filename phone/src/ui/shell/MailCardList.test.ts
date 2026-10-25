/**
 * The card list's own rhythm: a turn is not a page, so the list draws eight
 * cards and asks before the rest. The rest are already in hand — the button
 * reveals them and fetches nothing.
 */
jest.mock("react-native", () => {
  const react = require("react") as typeof import("react");
  const host = (name: string) => (props: Record<string, unknown>) =>
    react.createElement(name, props, props.children as React.ReactNode);
  return {
    Pressable: host("Pressable"),
    Text: host("Text"),
    View: host("View"),
  };
});

jest.mock("../../i18n", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params === undefined ? key : `${key}:${JSON.stringify(params)}`,
  }),
}));

jest.mock("./mailActions", () => ({ useMailActions: () => null }));

import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

import { MailCardList } from "./MailCardList";
import type { MailCardItem, MailCards } from "../../domain/mailPayload";
import { modes } from "../../theme/design";

function card(n: number): MailCardItem {
  return {
    id: `m${n}`,
    from: { name: "", address: `sender${n}@example.com` },
    subject: `Subject ${n}`,
    gist: "",
    date: "",
    label: "",
    reasons: [],
  };
}

function cards(count: number, bulk = 0): MailCards {
  return { kind: "cards", items: Array.from({ length: count }, (_, i) => card(i + 1)), bulk };
}

async function render(list: MailCards): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(MailCardList, { cards: list, colors: modes.light }));
  });
  return renderer;
}

async function pressMore(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => {
    renderer.root.find((node) => node.props.testID === "transcript.mail.more").props.onPress();
  });
}

/** Drawn card ids, deduplicated: the mocked host reports each element twice. */
function drawnIds(renderer: ReactTestRenderer): string[] {
  const ids = renderer.root
    .findAll((node) => typeof node.props.testID === "string")
    .map((node) => node.props.testID as string)
    .filter((testID) => testID.startsWith("transcript.mail.card."));
  return [...new Set(ids)];
}

/** The mocked host reports one element twice — the component and what it
 *  renders — so a value list keeps only its first of each. */
function moreLabels(renderer: ReactTestRenderer): string[] {
  const labels = renderer.root
    .findAll((node) => node.props.testID === "transcript.mail.more")
    .map((node) => node.props.accessibilityLabel as string);
  return [...new Set(labels)];
}

function moreCount(renderer: ReactTestRenderer): number {
  return renderer.root.findAll((node) => node.props.testID === "transcript.mail.more").length;
}

describe("a long mail list", () => {
  it("draws eight and asks before the rest", async () => {
    const renderer = await render(cards(12));
    expect(drawnIds(renderer)).toHaveLength(8);
    expect(moreLabels(renderer)).toEqual(['chat.mail.moreMail:{"count":4}']);
  });

  it("the button reveals the rest in place, with nothing new to fetch", async () => {
    const renderer = await render(cards(12));
    await pressMore(renderer);
    expect(drawnIds(renderer)).toHaveLength(12);
    expect(renderer.root.findAll((node) => node.props.testID === "transcript.mail.more")).toHaveLength(0);
  });

  it("asks for one mail in the singular", async () => {
    const renderer = await render(cards(9));
    expect(moreLabels(renderer)).toEqual(["chat.mail.oneMoreMail"]);
  });

  it("draws every card and no button at eight or fewer", async () => {
    const eight = await render(cards(8));
    expect(drawnIds(eight)).toHaveLength(8);
    expect(moreCount(eight)).toBe(0);

    const three = await render(cards(3));
    expect(drawnIds(three)).toHaveLength(3);
    expect(moreCount(three)).toBe(0);
  });

  it("keeps the newsletter count line under the cards", async () => {
    const renderer = await render(cards(12, 3));
    expect(
      renderer.root.find((node) => node.props.testID === "transcript.mail.bulk").props.children,
    ).toBe('chat.mail.newsletters:{"count":3}');
  });
});