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

  test("a local hard refusal keeps the phone glyph but never claims the model runs here", () => {
    expect(hostModelLocation({ remote: false, modelState: "error", modelError: en.models.blockedTier, t: makeT("en") })).toEqual({
      location: "phone",
      label: en.shell.where.notRunning,
    });
    expect(hostModelLocation({ remote: false, modelState: "ready", modelError: null, t: makeT("it") }).label)
      .toBe(it.shell.where.thisPhone);
  });
});
