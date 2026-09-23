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

  it("scrolls 56 dp conversation rows with title, preview and active state", () => {
    expect(CONTENT).toContain('testID="drawer.conversations"');
    expect(CONTENT).toContain("minHeight: 56");
    expect(CONTENT).toContain("accessibilityState={{ selected: Boolean(item.active) }}");
    expect(CONTENT).toContain("item.preview");
    expect(CONTENT).toContain("onLongPress={item.onLongPress}");
  });

  it("shows the four unboxed global footer destinations in the specified order", () => {
    const code = CODE(CONTENT);
    expect(code).toContain('["documents", "notes", "settings", "account"]');
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
