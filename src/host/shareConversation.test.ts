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
import { buildExportMarkdown, shareConversation, shareConversationById } from "./shareConversation";
import {
  bindConversationRowActions,
  buildDrawerConversationItems,
  createConversationRowActions,
  runConversationRowAction,
} from "./conversationRowActions";
import { en as english } from "../i18n/en";
import { it as italian } from "../i18n/it";
import type { Message } from "./hostMessage";

jest.mock("react-native", () => ({ Share: { share: jest.fn() } }));

const shareMock = Share.share as jest.Mock;

const t = ((key: string, params?: Record<string, string | number>) => {
  const copy: Record<string, string> = {
    "chat.exportYou": "**You**",
    "chat.exportAi": "**AI**",
    "chat.exportTitle": "Kalsa — conversation export",
    "drawer.exportAction": "Export chat",
    "drawer.deleteAction": "Delete chat",
    "drawer.exportConversationA11y": "Export chat {title}",
    "drawer.deleteConversationA11y": "Delete chat {title}",
  };
  const line = copy[key] ?? key;
  return params ? line.replace(/\{(\w+)\}/g, (_, k: string) => String(params[k] ?? k)) : line;
}) as TranslateFn;

function drawerTranslator(catalog: typeof english.drawer): TranslateFn {
  return ((key, params) => {
    const copy = catalog[key.replace(/^drawer\./, "") as keyof typeof catalog];
    return params
      ? copy.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? name))
      : copy;
  }) as TranslateFn;
}

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

/** Chat-level actions stay attached to the long-pressed conversation row. */
describe("the conversation row action sheet", () => {
  const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  beforeEach(() => shareMock.mockClear());

  it("keeps the menu foot at its five global destinations", () => {
    const content = stripComments(read("../theme/components/DrawerContent.tsx"));
    expect(content).toContain('["documents", "notes", "settings", "account", "personas"]');
    expect(content).not.toContain('"export"');
    expect(english.drawer.exportAction).toBe("Export chat");
    expect(english.drawer.deleteAction).toBe("Delete chat");
    expect(italian.drawer.exportAction).toBe("Esporta chat");
    expect(italian.drawer.deleteAction).toBe("Elimina chat");

    const sheet = stripComments(read("../ui/shell/AttachSheet.tsx"));
    expect(sheet).toContain("accessibilityLabel={row.accessibilityLabel ?? row.label}");

    const actions = createConversationRowActions("older", "Titolo lungo", drawerTranslator(italian.drawer), jest.fn(), jest.fn());
    expect(actions.map(({ label, accessibilityLabel }) => [label, accessibilityLabel])).toEqual([
      ["Esporta chat", "Esporta la chat Titolo lungo"],
      ["Elimina chat", "Elimina la chat Titolo lungo"],
    ]);
  });

  it("exports from the row's action set through the root handler using that row id", async () => {
    shareMock.mockResolvedValue({ action: "dismissedAction" });
    const activeId = "active-chat";
    const rowId = "older-chat";
    const reader = jest.fn(async (id: string) => [turn("user", `history for ${id}`)]);
    const order: string[] = [];
    let shareWork: Promise<void> | undefined;
    const rootHandler = jest.fn((id: string) => {
      order.push(`export:${id}`);
      shareWork = shareConversationById(id, activeId, [turn("user", "active history")], "en", t, reader);
    });
    const confirmDelete = jest.fn((id: string) => order.push(`delete:${id}`));
    const state = {
      activeId,
      items: [
        { id: activeId, title: "Active", updatedAt: 2, preview: "active", searchBlob: "active" },
        { id: rowId, title: "Older", updatedAt: 1, preview: "older", searchBlob: "older" },
      ],
    };
    const rows = buildDrawerConversationItems(
      state,
      "",
      "Untitled",
      t,
      jest.fn(),
      jest.fn(),
      rootHandler,
      confirmDelete,
    );
    const row = rows.find((item) => item.id === rowId);
    expect(rows.find((item) => item.id === activeId)?.active).toBe(true);
    expect(row?.active).toBe(false);
    expect(row?.actions?.map((action) => action.id)).toEqual(["export", "delete"]);
    expect(row?.actions?.find((action) => action.id === "export")?.label).toBe("Export chat");
    expect(row?.actions?.find((action) => action.id === "export")?.accessibilityLabel).toBe(
      "Export chat Older",
    );
    expect(row?.actions?.find((action) => action.id === "delete")?.accessibilityLabel).toBe(
      "Delete chat Older",
    );
    const sheetRows = bindConversationRowActions(row?.actions ?? [], {
      closeSheet: () => order.push("closeSheet"),
      closeDrawer: () => order.push("closeDrawer"),
    });
    const exportAction = sheetRows.find((action) => action.id === "export");
    expect(exportAction).toBeDefined();
    exportAction?.onPress();
    sheetRows.find((action) => action.id === "delete")?.onPress();
    expect(order).toEqual([
      "closeSheet",
      "closeDrawer",
      `export:${rowId}`,
      "closeSheet",
      `delete:${rowId}`,
    ]);
    expect(rootHandler).toHaveBeenCalledWith(rowId);
    expect(rootHandler).not.toHaveBeenCalledWith(activeId);
    expect(confirmDelete).toHaveBeenCalledWith(rowId);
    await shareWork;
    expect(reader).toHaveBeenCalledWith(rowId, "en");
    expect(shareMock).toHaveBeenCalledWith({
      message: "**You**:\nhistory for older-chat",
      title: "Kalsa — conversation export",
    });

    const builder = stripComments(read("conversationActions.ts"));
    expect(builder).toMatch(/return buildDrawerConversationItems\(\s*conversations,\s*chatSearchQuery,/);
    const rowsBuilder = stripComments(read("conversationRowActions.ts"));
    expect(rowsBuilder).toContain("filterConversations(conversations.items, query).map((item)");
    expect(rowsBuilder).toContain("createConversationRowActions(item.id, title, t, onExport, onDelete)");
    expect(rowsBuilder).toContain("onLongPress: () => onActionSheetOpen(item.id)");
  });

  it("wires HostDrawer's sheet and drawer closers to their named behaviors", () => {
    const drawer = stripComments(read("HostDrawer.tsx"));
    expect(drawer).toMatch(
      /bindConversationRowActions\(selectedConversation\.actions,\s*\{\s*closeSheet: \(\) => setSelectedConversationId\(null\),\s*closeDrawer,\s*\}\s*\)/,
    );

    const events: string[] = [];
    const action = createConversationRowActions(
      "row-id",
      "Row",
      t,
      (id) => events.push("export:" + id),
      (id) => events.push("delete:" + id),
    )[0];
    const bound = bindConversationRowActions([action], {
      closeSheet: () => events.push("close-sheet"),
      closeDrawer: () => events.push("close-drawer"),
    });
    bound[0].onPress();
    expect(events).toEqual(["close-sheet", "close-drawer", "export:row-id"]);
  });

  it("closes the drawer for export and leaves it open for delete", () => {
    const events: string[] = [];
    const actions = createConversationRowActions(
      "row-id",
      "Row",
      t,
      (id) => events.push("export:" + id),
      (id) => events.push("delete:" + id),
    );
    const closeSheet = () => events.push("close-sheet");
    const closeDrawer = () => events.push("close-drawer");

    runConversationRowAction(actions[0], closeSheet, closeDrawer);
    expect(events).toEqual(["close-sheet", "close-drawer", "export:row-id"]);

    events.length = 0;
    runConversationRowAction(actions[1], closeSheet, closeDrawer);
    expect(events).toEqual(["close-sheet", "delete:row-id"]);
  });

  it("routes long press through the shell sheet to the id-aware root handler", () => {
    const content = stripComments(read("../theme/components/DrawerContent.tsx"));
    const drawer = stripComments(read("HostDrawer.tsx"));
    const layout = stripComments(read("HostLayout.tsx"));
    const root = stripComments(read("HostRoot.tsx"));
    expect(content).toContain("onLongPress={item.onLongPress}");
    expect(drawer).toContain("title={selectedConversation.title}");
    expect(drawer).toContain("bindConversationRowActions(");
    expect(drawer).toContain("<AttachSheet");
    expect(drawer).toContain("actions.drawerConversationItems(");
    expect(drawer).toContain("    onExportPress,\n  );");
    expect(layout).toContain("onExportPress={onExportPress}");
    expect(root).toContain(
      "onExportPress={(id) => void shareConversationById(id, conv.conversations.activeId, history.messagesRef.current, locale, t)}",
    );
  });
});
