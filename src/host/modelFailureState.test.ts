/**
 * The failure state's two statements, held apart from the bar's own
 * derivations because they answer a different question: not what the bar
 * SAYS, but what the screen PROMISES while the engine has refused this model
 * — a control name for the retry sentence, and a where-line for the pill that
 * stops claiming a model the device just refused. Both driven against the
 * SHIPPED catalogues in both locales.
 */
import { makeT, en, it as italian } from "../i18n";
import { modelBarStatus, pillWhereLabel } from "./modelBar";
import { decideModelPress } from "./modelBarPress";

const t = makeT("en");
const tIt = makeT("it");

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
