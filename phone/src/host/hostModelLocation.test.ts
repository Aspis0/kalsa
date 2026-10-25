import { makeT, en, it } from "../i18n";
import { hostModelLocation } from "./hostModelLocation";
import { readFileSync } from "fs";
import { join } from "path";

const SURFACE = readFileSync(join(__dirname, "HostChatSurface.tsx"), "utf8");

describe("the strip reports the selected backend location", () => {
  test("remote selection uses the computer label and server glyph state", () => {
    expect(hostModelLocation({ remote: true, modelState: "ready", modelError: null, t: makeT("en") })).toEqual({
      location: "server",
      label: en.shell.where.pillComputer,
    });
    expect(SURFACE).toContain("hostModelLocation({");
    expect(SURFACE).toContain("location={location.location}");
  });

  test("a failed remote init does not claim the computer answers", () => {
    // The computer is still the selected backend, but nothing answers there:
    // the model bar's own error line would contradict "Your computer".
    expect(
      hostModelLocation({ remote: true, modelState: "error", modelError: en.settings.remoteBrainFailTimeout, t: makeT("en") }),
    ).toEqual({ location: "server", label: en.shell.where.computerNotResponding });
    expect(hostModelLocation({ remote: true, modelState: "error", modelError: null, t: makeT("it") }).label)
      .toBe(it.shell.where.computerNotResponding);
    // Loading is not a failure: the pill keeps the computer's name while its
    // init runs.
    expect(hostModelLocation({ remote: true, modelState: "loading", modelError: null, t: makeT("en") }).label)
      .toBe(en.shell.where.pillComputer);
  });

  test("a local hard refusal keeps the phone glyph but never claims the model runs here", () => {
    expect(hostModelLocation({ remote: false, modelState: "error", modelError: en.models.blockedTier, t: makeT("en") })).toEqual({
      location: "phone",
      label: en.shell.where.notRunning,
    });
    expect(hostModelLocation({ remote: false, modelState: "ready", modelError: null, t: makeT("it") }).label)
      .toBe(it.shell.where.thisPhone);
  });
});
