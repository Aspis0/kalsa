/** Source contract for the v2 menu, replacing the leaf-fold pointer-events pins. */
import { readFileSync } from "fs";
import { join } from "path";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");
const DRAWER = read("Drawer.tsx");
const CONTENT = read("DrawerContent.tsx");
const CODE = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("the full-height v2 menu", () => {
  it("mounts as a modal, respects safe areas, and closes through the header or BACK", () => {
    expect(DRAWER).toContain('visible={open}');
    expect(DRAWER).toContain("onRequestClose={onClose}");
    expect(DRAWER).toContain("useSafeAreaInsets");
    expect(CONTENT).toContain('testID="drawer.close"');
    expect(CONTENT).toContain('accessibilityLabel={t("common.close")}');
  });

  it("shows the 36 dp brand mark, Kalsa title and full-width primary new-chat action", () => {
    expect(CONTENT).toContain('source={require("../../../assets/icon.png")}');
    expect(CONTENT).toContain("width: 36, height: 36");
    expect(CONTENT).toContain("fontSize: 24");
    expect(CONTENT).toContain('testID="drawer.newChat"');
    expect(CONTENT).toContain("minHeight: 52");
    expect(CONTENT).toContain("backgroundColor: pressed ? colors.brandDeep : colors.brand");
  });

  it("keeps the labeled search field clearable and routes queries to the host", () => {
    expect(CONTENT).toContain('testID="drawer.search"');
    expect(CONTENT).toContain("onChangeText={onSearchChange}");
    expect(CONTENT).toContain('testID="drawer.search.clear"');
    expect(CONTENT).toContain("onSearchChange(\"\")");
    expect(CONTENT).toContain("drawer.yourChats");
  });

  it("keeps only a compact entry in the menu and opens the full-screen list", () => {
    const code = CODE(CONTENT);
    expect(code).toContain('testID="drawer.conversations.open"');
    expect(code).toContain('accessibilityLabel={t("drawer.yourChats")}');
    expect(code).toContain("onPress={onConversationsPress}");
    expect(code).not.toContain("drawer.conversations\"");
    expect(code).not.toContain("conversationItems.map");

    const list = CODE(readFileSync(join(__dirname, "../../screens/ConversationListScreen.tsx"), "utf8"));
    expect(list).toContain('testID="conversationList.rows"');
    expect(list).toContain("style={{ flex: 1 }}");
    expect(list).toContain("minHeight: 64");
    expect(list).toContain("accessibilityState={{ selected: Boolean(item.active) }}");
    expect(list).toContain("item.preview");
  });

  it("offers row actions through an accessible action on the full-screen list", () => {
    const list = CODE(readFileSync(join(__dirname, "../../screens/ConversationListScreen.tsx"), "utf8"));
    expect(list).toMatch(/accessibilityActions=\{\s*item\.onLongPress\s*\?/);
    expect(list).toContain('accessibilityHint={item.onLongPress ? t("drawer.conversationActionsHint") : undefined}');
    expect(list).toContain('if (nativeEvent.actionName === "conversationActions") item.onLongPress?.();');
  });

  it("shows the five unboxed global footer destinations in the specified order", () => {
    const code = CODE(CONTENT);
    expect(code).toContain('["documents", "notes", "settings", "account", "personas"]');
    expect(code).not.toContain('"export"');
    expect(code).toContain('testID={`drawer.item.${id}`}');
    expect(code).toContain("minHeight: 56");
    expect(code).toContain("colors.accent");
    expect(CODE(CONTENT)).not.toContain("personaLabel");
  });

  it("does not keep the leaf-fold implementation in the new drawer", () => {
    expect(CODE(DRAWER)).not.toMatch(/LeafPaper|leafPath|useLeafFold/);
    expect(CODE(DRAWER)).toContain("DrawerContent");
    expect(CODE(DRAWER)).not.toContain("transformOrigin");
  });
});
