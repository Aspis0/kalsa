jest.mock("react-native", () => ({ Text: "Text", Linking: { openURL: jest.fn() } }));

import type { InlineNode } from "../../chat/markdown";
import type { TranslateFn } from "../../i18n";
import type { TranscriptStyles } from "./TranscriptParts";
import { renderInline } from "./TranscriptInline";

test("reuses inline elements for the same parsed block and rendering context", () => {
  const nodes: InlineNode[] = [{ type: "text", text: "stable prose" }];
  const context = {
    color: "#111",
    idPrefix: "answer.block.0",
    styles: {} as TranscriptStyles,
    t: ((key: string) => key) as TranslateFn,
  };

  expect(renderInline(nodes, context)).toBe(renderInline(nodes, context));
});
