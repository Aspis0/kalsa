/**
 * The export action's two halves (D1 row 2): the Markdown format, pinned
 * exactly, and the sheet itself — empty out, one sheet per call, dismissal
 * swallowed. `react-native` is mocked so the node environment never loads the
 * real framework; the mock's own shape is asserted first, because every
 * `Share` expectation below is vacuous if the mock silently stopped
 * intercepting.
 */
import { Share } from "react-native";
import { readFileSync } from "fs";
import { join } from "path";

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

/**
 * Where export LIVES, as source — the strip's width arithmetic forced a move
 * and a moved action is exactly the kind of promise a test must keep honest.
 * WITH five strip controls the pill's text column was 14 dp and the model name
 * rendered as a bare ellipsis — so export, the RARE control, moved to the
 * drawer, three strip buttons give the pill 154 dp, and NOTHING was shrunk
 * below 48 dp. These assertions fail if the row, the wiring, or the old button
 * comes back on its own.
 */
describe("export's home: the drawer, since the strip needed the width", () => {
  const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("the drawer holds the row: controller's label, keyboard down, drawer closed, then share", () => {
    const drawer = stripComments(read("HostDrawer.tsx"));
    expect(drawer).toContain('id: "export"');
    // Both catalogues already carry this key (en/it `chat.a11yExport`); a new
    // string for the same action is how the two apps start drifting.
    expect(drawer).toContain('t("chat.a11yExport")');
    expect(drawer).toMatch(/Keyboard\.dismiss\(\);[\s\S]*?clearChatSearch\(\);[\s\S]*?setOpen\(false\);[\s\S]*?onExportPress\(\);/);
  });

  it("the root wires the same shareConversation it once handed the strip", () => {
    const root = stripComments(read("HostRoot.tsx"));
    expect(root).toContain("onExportPress={() => shareConversation(history.messages, t)}");
    // …to the DRAWER: the chat surface no longer receives the prop at all.
    const surfaceCall = root.match(/<HostChatSurface[\s\S]*?\/>/)?.[0] ?? "";
    expect(surfaceCall.length).toBeGreaterThan(0);
    expect(surfaceCall).not.toContain("onExportPress");
  });

  it("the strip no longer draws it (the width the pill got back)", () => {
    const shell = stripComments(read("../ui/shell/Shell.tsx"));
    expect(shell).not.toContain('testID="shell.strip.export"');
    expect(shell).not.toContain("onExportPress");
  });

  it("every drawer row the export one rides has a testID and a real 48 dp box", () => {
    const content = stripComments(read("../theme/components/DrawerContent.tsx"));
    expect(content).toContain("testID={`drawer.item.${id}`}");
    expect(content).toContain("minHeight: 48");
    // The floor is a height, never a slop: no hitSlop on the row.
    expect(content).not.toContain("hitSlop");
  });
});
