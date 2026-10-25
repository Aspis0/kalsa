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
    expect(STREAM).toContain("const shownError = hostStreamErrorText(");
  });

  test("a turn-route failure is a code, known or not, and never shown as itself", () => {
    expect(hostStreamErrorText("no_runner", t, true)).toBe(en.chat.mail.failNoRunner);
    expect(hostStreamErrorText("mail.keychain", t, true)).toBe(en.chat.mail.failKeychain);
    expect(hostStreamErrorText("remote_brain_timeout", t, true)).toBe(
      en.settings.remoteBrainFailTimeout,
    );
    // A code a newer computer invented, and our own malformed-frame marker:
    // both read as the generic sentence.
    expect(hostStreamErrorText("mail.newflag", t, true)).toBe(en.chat.mail.failGeneric);
    expect(hostStreamErrorText("stream_malformed", t, true)).toBe(en.chat.mail.failGeneric);
    // The same string without the flag is the engine's own text, shown as it is.
    expect(hostStreamErrorText("Generation was interrupted.", t)).toBe(
      "Generation was interrupted.",
    );
  });
});
