import { readFileSync } from "fs";
import { join } from "path";
import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";

const read = (name: string) => readFileSync(join(__dirname, name), "utf8");
const readSource = (path: string) => readFileSync(path, "utf8");
const HOME = read("SettingsHomeScreen.tsx");
const SETTINGS = read("SettingsScreen.tsx");
const FURNITURE = readSource(join(__dirname, "..", "host", "HostFurniture.tsx"));
const OVERLAYS = readSource(join(__dirname, "..", "host", "HostOverlays.tsx"));
const FLAGS = readSource(join(__dirname, "..", "host", "toolFlags.ts"));

function flatten(catalog: object, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else if (value && typeof value === "object") Object.assign(out, flatten(value, path));
  }
  return out;
}

describe("Settings v2 home and advanced pages", () => {
  it("orders the five home groups and keeps the first page to everyday rows", () => {
    const groups = [...HOME.matchAll(/title={t\("settings\.(groupAssistant|groupAppearance|groupPrivacy|groupEngine)"\)}/g)]
      .map((match) => match[1]);
    expect(groups).toEqual(["groupAssistant", "groupAppearance", "groupPrivacy", "groupEngine"]);
    const kalsaGroup = HOME.indexOf('<Group title="Kalsa"');
    expect(kalsaGroup).toBeGreaterThan(HOME.indexOf('title={t("settings.groupEngine")}'));
    const homeIds = [...HOME.matchAll(/testID="(settings\.home\.[^"]+)"/g)].map((match) => match[1]);
    expect(homeIds).toEqual([
      "settings.home.scroll",
      "settings.home.where",
      "settings.home.model",
      "settings.home.theme",
      "settings.home.fontSize",
      "settings.home.language",
      "settings.home.web",
      "settings.home.telemetry",
      "settings.home.permissions",
      "settings.home.advanced",
      "settings.home.kalsa",
    ]);
    expect(HOME).toContain('testID="settings.home.kalsa"');
    expect(HOME).toContain('require("../../assets/icon.png")');
    expect(HOME).toContain('t("settings.brandVersion", { version: appVersion })');
    expect(HOME).not.toMatch(/settings\.(contextSize|kvCache|thinking|governor|thermal|sessionPool)/);
    expect(HOME).toContain('title={t("settings.advanced")}');
    expect(HOME).toContain("disabled: option.disabled");
    expect(HOME).toContain("detail, disabled }) =>");
    expect(SETTINGS).toContain("selectDisabled: modelBusy || hardBlocked || profilePending");
    expect(SETTINGS).toContain("disabled: selectDisabled");
  });

  it("keeps cards from shrinking inside the scrolling column", () => {
    expect(HOME).toContain("flexGrow: 1");
    expect(HOME).toContain("flexGrow: 0, flexShrink: 0");
  });

  it("opens Advanced as a second page and keeps engine controls behind it", () => {
    expect(SETTINGS).toContain('useState<"home" | "advanced">("home")');
    expect(SETTINGS).toContain('if (page === "home")');
    expect(SETTINGS).toContain('onOpenAdvanced={() => setPage("advanced")}');
    expect(SETTINGS).toContain('title={t("settings.advanced")} onBack={() => setPage("home")}');
    for (const key of ["contextSize", "kvCache", "thinking", "governor", "diagnostics"]) {
      expect(SETTINGS).toContain(`settings.${key}`);
    }
    expect(SETTINGS).toContain("MODEL_REGISTRY.map((entry)");
    expect(SETTINGS).toContain("onPress={handleReportProblem}");
  });

  it("carries Web from the real host flag handler to the Privacy switch", () => {
    expect(FURNITURE).toContain("webToolsEnabled={flags.webToolsEnabled}");
    expect(FURNITURE).toContain("toggleWebTools={flags.toggleWebTools}");
    expect(OVERLAYS).toContain("webToolsEnabled={webToolsEnabled}");
    expect(OVERLAYS).toContain("onToggleWebTools={toggleWebTools}");
    expect(SETTINGS).toContain("onToggleWeb={onToggleWebTools}");
    expect(HOME).toContain("onPress={onToggleWeb}");
    expect(FLAGS).toContain("const toggleWebTools = useCallback(() => {");
    expect(FLAGS).toContain("AsyncStorage.setItem(WEB_TOOLS_ENABLED_KEY");
  });

  it("gives settings choice sheets a title and a localized Done action", () => {
    expect(HOME).toContain("title={sheetTitle}");
    expect(HOME).toContain('primaryActionLabel={t("common.done")}');
    const enStrings = flatten(en);
    const itStrings = flatten(italian);
    expect(enStrings["common.done"]).toBe("Done");
    expect(itStrings["common.done"]).toBe("Fatto");
    expect(enStrings["settings.advancedCount"]).toContain("{count}");
    expect(itStrings["settings.advancedCount"]).toContain("{count}");
  });
});
