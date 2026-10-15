/**
 * A link in a turn-route answer (PHONE-CHAT-PROTOCOL §3): the answer may stay
 * markdown, but a mail the model read can put an address into it — so the
 * link is shown with its destination and no tap opens it. Every other answer
 * (local engine, `/v1/chat/completions`) keeps its links tappable.
 */
jest.mock("react-native", () => ({ Text: "Text", Linking: { openURL: jest.fn() } }));

import type { InlineNode } from "../../chat/markdown";
import type { TranslateFn } from "../../i18n";
import type { TranscriptStyles } from "./TranscriptParts";
import { renderInline, type InlineContext } from "./TranscriptInline";

const LINK: InlineNode[] = [
  { type: "text", text: "Rientra qui: " },
  { type: "link", text: "la tua banca", href: "https://banca.example/login" },
];

function context(linksAsText?: boolean): InlineContext {
  return {
    color: "#111",
    idPrefix: "answer.block.0",
    linksAsText,
    styles: {} as TranscriptStyles,
    t: ((key: string) => key) as TranslateFn,
  };
}

function rendered(nodes: InlineNode[], ctx: InlineContext): string[] {
  return renderInline(nodes, ctx).flatMap((node) =>
    node && typeof node === "object" && "props" in node
      ? [String((node as { props: { children?: unknown } }).props.children ?? "")]
      : [],
  );
}

function pressable(nodes: InlineNode[], ctx: InlineContext): boolean {
  return renderInline(nodes, ctx).some(
    (node) =>
      node !== null &&
      typeof node === "object" &&
      "props" in node &&
      typeof (node as { props: { onPress?: unknown } }).props.onPress === "function",
  );
}

describe("a link in an answer", () => {
  it("is shown with its address on the turn route, and opens on nothing", () => {
    const ctx = context(true);
    expect(rendered(LINK, ctx).join("")).toContain("la tua banca (https://banca.example/login)");
    expect(pressable(LINK, ctx)).toBe(false);
  });

  it("stays tappable everywhere else", () => {
    expect(pressable(LINK, context())).toBe(true);
    expect(rendered(LINK, context()).join("")).not.toContain("https://banca.example/login");
  });

  it("the same nodes render differently per route: the memo keys on the flag", () => {
    expect(rendered(LINK, context(true)).join("")).not.toBe(
      rendered(LINK, context(false)).join(""),
    );
  });
});