import { hostEngineErrorText, hostStreamErrorText } from "./remoteEngineError";
import { readFileSync } from "fs";
import { join } from "path";
import { makeT, en } from "../i18n";

const t = makeT("en");
const ENSURE = readFileSync(join(__dirname, "remoteHostEnsure.ts"), "utf8");
const STREAM = readFileSync(join(__dirname, "engineTurnStream.ts"), "utf8");

describe("remote engine failures never expose internal codes", () => {
  test("remote codes become human copy while local messages remain unchanged", () => {
    expect(hostEngineErrorText("remote_brain_network", true, t)).toBe(
      en.settings.remoteBrainFailNetwork,
    );
    expect(hostEngineErrorText("native local failure", false, t)).toBe(
      "native local failure",
    );
    expect(ENSURE).toContain("hostEngineErrorText(message, true, input.t)");
  });

  test("the stream humanizes remote codes but preserves non-code engine detail", () => {
    const displayStreamError = (message: string) => `⚠️ ${hostStreamErrorText(message, t)}`;

    expect(displayStreamError("remote_brain_network")).toBe(
      `⚠️ ${en.settings.remoteBrainFailNetwork}`,
    );
    expect(displayStreamError("fetch failed: connection refused")).toBe(
      "⚠️ fetch failed: connection refused",
    );
    expect(displayStreamError("remote_brain_unrecognized_code")).toBe(
      `⚠️ ${en.settings.remoteBrainFailGeneric}`,
    );
    // Keep the tested formatter on the live stream error callback.
    expect(STREAM).toContain("hostStreamErrorText(error.message, deps.t)");
  });
});
