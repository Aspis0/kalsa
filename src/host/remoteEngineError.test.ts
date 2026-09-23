import { hostEngineErrorText } from "./remoteEngineError";
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
    expect(STREAM).toContain("hostEngineErrorText(");
  });
});
