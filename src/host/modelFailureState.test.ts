/**
 * The failure state's two statements, held apart from the bar's own
 * derivations because they answer a different question: not what the bar
 * SAYS, but what the screen PROMISES while the engine has refused this model
 * — a control name for the retry sentence, and a where-line for the pill that
 * stops claiming a model the device just refused. Both driven against the
 * SHIPPED catalogues in both locales.
 */
import { readFileSync } from "fs";
import { join } from "path";
import type { ModelPipelineState } from "../app/AppShell";
import { makeT, en, it as italian } from "../i18n";
import { modelBarStatus, pillWhereLabel } from "./modelBar";
import { hostModelLocation } from "./hostModelLocation";
import { decideModelPress } from "./modelBarPress";

const t = makeT("en");
const tIt = makeT("it");
const HOST_SURFACE = readFileSync(join(__dirname, "HostChatSurface.tsx"), "utf8");
const SHELL = readFileSync(join(__dirname, "../ui/shell/Shell.tsx"), "utf8");
const STRIP = readFileSync(join(__dirname, "../ui/shell/ShellStrip.tsx"), "utf8");
const MODEL_REGISTRY = readFileSync(join(__dirname, "../engine/ModelRegistry.ts"), "utf8");
const ALL_MODEL_STATES: Record<ModelPipelineState, true> = {
  checking: true, missing: true, downloading: true, loading: true, ready: true, error: true,
};

function status(overrides: Partial<Parameters<typeof modelBarStatus>[0]> = {}) {
  return modelBarStatus({
    modelState: "error",
    jsReady: false,
    activeMatches: false,
    hung: false,
    errorKind: "engine",
    percent: 0,
    model: { sizeBytes: 1 } as Parameters<typeof modelBarStatus>[0]["model"],
    t,
    ...overrides,
  });
}

describe("the retry sentence names a control exactly while a tap would answer", () => {
  it("agrees with decideModelPress, which two derivations compute separately", () => {
    for (const errorKind of ["download", "engine", null] as const) {
      const s = status({ errorKind });
      const decision = decideModelPress({
        modelState: "error",
        errorKind,
        resident: false,
        hung: false,
      });
      expect(s.retryLabel).toBe(en.shell.action.retry);
      expect(decision.control).toBe("enabled");
      expect(decision.action).toBe(errorKind === "engine" ? "reload" : "download");
    }
  });

  it("never names a control on a non-failure bar", () => {
    for (const modelState of ["checking", "missing", "downloading", "loading", "ready"] as const) {
      expect([modelState, status({ modelState }).retryLabel]).toEqual([modelState, undefined]);
    }
  });

  it("draws the Italian catalogue's own control name", () => {
    expect(status({ t: tIt }).retryLabel).toBe(italian.shell.action.retry);
    expect(italian.shell.action.retry).not.toBe(en.shell.action.retry);
  });
});

describe("the pill's where-line stays true when the device refuses the model", () => {
  const label = (
    modelState: "error" | "ready" | "missing",
    modelError: string | null,
    useIt = false,
  ) => pillWhereLabel({ modelState, modelError, t: useIt ? tIt : t });

  it("swaps the local claim for a true one on the host's RAM/tier refusal", () => {
    expect(label("error", en.models.blockedRam)).toBe("shell.where.notRunning");
    expect(label("error", en.models.blockedTier)).toBe("shell.where.notRunning");
    expect(t("shell.where.notRunning")).toBe(en.shell.where.notRunning);
    expect(tIt("shell.where.notRunning")).toBe(italian.shell.where.notRunning);
    expect(italian.shell.where.notRunning).not.toBe(en.shell.where.notRunning);
  });

  it("routes a hard refusal into the pill instead of the old Locale shortcut", () => {
    const key = label("error", en.models.blockedRam);
    expect(key).toBe("shell.where.notRunning");
    expect(t(key)).not.toBe("Locale");
    const where = hostModelLocation({ remote: false, modelState: "error", modelError: en.models.blockedRam, t });
    expect(where).toEqual({ location: "phone", label: en.shell.where.notRunning });
    expect(HOST_SURFACE).toContain("hostModelLocation({");
    expect(HOST_SURFACE).toContain("whereLabel={whereLabel}");
    expect(HOST_SURFACE).not.toContain('location="phone"');
    expect(SHELL).toContain("whereLabel={whereLabel}");
    expect(SHELL).toContain('location = "phone"');
    expect(STRIP).toContain("const locationLabel = whereLabel ??");
    expect(STRIP).toContain('const DeviceIcon = location === "phone" ? Smartphone : Monitor;');
    expect(STRIP).toContain("backgroundColor: refused ? colors.tint : colors.surface");
    expect(STRIP).toContain("refused ? colors.ink3 : colors.accent");
  });

  it("uses backend state for remote location; the catalog itself has no location field", () => {
    for (const modelState of Object.keys(ALL_MODEL_STATES) as ModelPipelineState[]) {
      for (const modelError of [null, en.models.blockedRam, en.models.blockedTier, en.model.tooLarge, en.errors.connectionLost]) {
        const location = hostModelLocation({ remote: false, modelState, modelError, t });
        expect(["phone", "server"]).toContain(location.location);
        expect([en.shell.where.thisPhone, en.shell.where.notRunning]).toContain(location.label);
      }
    }
    expect(hostModelLocation({ remote: true, modelState: "ready", modelError: null, t })).toEqual({
      location: "server",
      label: en.shell.where.pillComputer,
    });
    expect(HOST_SURFACE).toContain("remote: modelHost.remoteActive");
    const modelInfo = MODEL_REGISTRY.match(/export type ModelInfo = \{([\s\S]*?)^\};/m)?.[1];
    expect(modelInfo).toBeDefined();
    expect(modelInfo).not.toMatch(/^\s*(?:backend|location)\??:/m);
  });

  it("keeps the local claim for every other state and every other error", () => {
    // Another model's fit refusal, a connectivity error, an unset error —
    // none of them makes the where-line a lie, so none may swap it.
    expect(label("error", en.model.tooLarge)).toBe("shell.where.thisPhone");
    expect(label("error", en.errors.connectionLost)).toBe("shell.where.thisPhone");
    expect(label("error", null)).toBe("shell.where.thisPhone");
    expect(label("ready", en.models.blockedRam)).toBe("shell.where.thisPhone");
    expect(label("missing", null)).toBe("shell.where.thisPhone");
    // Italian draws the same decision, its own words.
    expect(label("error", italian.models.blockedRam, true)).toBe("shell.where.notRunning");
    expect(label("ready", null, true)).toBe("shell.where.thisPhone");
  });
});
