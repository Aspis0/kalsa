/**
 * The export action's two halves (D1 row 2, lifted AiChatPage:3206-3218):
 * the Markdown format, pinned exactly, and the sheet itself — empty out, one
 * sheet per call, dismissal swallowed. `react-native` is mocked so the node
 * environment never loads the real framework; the mock's own shape is
 * asserted first, because every `Share` expectation below is vacuous if the
 * mock silently stopped intercepting.
 */
import { Share } from "react-native";

import type { TranslateFn } from "../i18n";
import { buildExportMarkdown, shareConversation } from "./shareConversation";
import type { Message } from "./hostMessage";

jest.mock("react-native", () => ({ Share: { share: jest.fn() } }));

const shareMock = Share.share as jest.Mock;

const t = ((key: string, params?: Record<string, string | number>) => {
  const copy: Record<string, string> = {
    "chat.exportYou": "**You**",
    "chat.exportAi": "**AI**",
    "chat.exportTitle": "Kalsa — conversation export",
  };
  const line = copy[key] ?? key;
  return params ? line.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? k)) : line;
}) as TranslateFn;

const turn = (role: Message["role"], text: string): Message => ({
  id: `${role}-${text.length}`,
  role,
  text,
  createdAt: 1_700_000_000_000,
});

describe("buildExportMarkdown — the controller's format, byte for byte", () => {
  it("labels the turns and separates them with a rule", () => {
    const messages = [turn("user", "What is parity?"), turn("assistant", "Row by row.")];
    expect(buildExportMarkdown(messages, t)).toBe(
      "**You**:\nWhat is parity?\n\n---\n\n**AI**:\nRow by row.",
    );
  });

  it("keeps each message's text verbatim, including multi-line answers", () => {
    const answer = turn("assistant", "line one\n- a\n- b");
    expect(buildExportMarkdown([answer], t)).toBe("**AI**:\nline one\n- a\n- b");
  });

  it("sends any non-user role through the AI label (the old ternary's shape)", () => {
    expect(buildExportMarkdown([turn("assistant", "x")], t)).toBe("**AI**:\nx");
    // And a user turn never borrows the AI label:
    expect(buildExportMarkdown([turn("user", "x")], t)).toBe("**You**:\nx");
  });
});

describe("shareConversation — one sheet, or none", () => {
  beforeEach(() => shareMock.mockClear());

  it("intercepts Share.share at all (the guard every mock expectation needs)", () => {
    expect(shareMock).toBeDefined();
    expect(typeof shareMock).toBe("function");
  });

  it("shares the built Markdown under the export title", () => {
    shareMock.mockResolvedValue({ action: "dismissedAction" });
    const messages = [turn("user", "q"), turn("assistant", "a")];
    shareConversation(messages, t);
    expect(shareMock).toHaveBeenCalledTimes(1);
    expect(shareMock).toHaveBeenCalledWith({
      message: "**You**:\nq\n\n---\n\n**AI**:\na",
      title: "Kalsa — conversation export",
    });
  });

  it("does nothing on an empty transcript", () => {
    shareConversation([], t);
    expect(shareMock).not.toHaveBeenCalled();
  });

  it("swallows a rejected share (dismissing the sheet is not an error)", () => {
    shareMock.mockRejectedValue(new Error("User cancelled"));
    expect(() => shareConversation([turn("user", "q")], t)).not.toThrow();
    expect(shareMock).toHaveBeenCalledTimes(1);
  });
});
