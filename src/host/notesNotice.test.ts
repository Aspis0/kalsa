/**
 * The truncated-notes line has a home (D1 row 40 / gap 7): `engineTurn` fires
 * `sendOpts.onNotice` only when a notes context was actually truncated, and
 * the send routes it through this build's SINGLE notice slot on the
 * controller's own catalogue string. What a diff could break silently: the
 * slot handshake (send ↔ host), the key leaving a catalogue, a second writer
 * appearing beside the one slot, or the firing side growing a second notice.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import { en } from "../i18n/en";
import { it as italian } from "../i18n/it";

const SEND = readFileSync(join(__dirname, "sendHost.ts"), "utf8");
const ROOT = readFileSync(join(__dirname, "HostRoot.tsx"), "utf8");
const TURN = readFileSync(join(__dirname, "engineTurn.ts"), "utf8");

jest.mock("react-native", () => ({ Text: "Text", View: "View" }));
jest.mock("../theme/typography", () => ({ useTypography: () => ({ bodyXs: {} }) }));
jest.mock("../ui/labTheme", () => ({
  useLabTheme: () => ({ colors: { panelSolid: "panel", line: "line", ink: "ink" } }),
}));
import { HostNotice } from "./HostNotice";

describe("the wire: engine half → send options → the one-slot notice", () => {
  test("the send hands the engine the notice, on the controller's key", () => {
    expect(SEND).toContain(
      'onNotice: () => params.showNoticeKey("chat.notesContextTruncated")',
    );
    expect(SEND).toMatch(/showNoticeKey: \(key: TranslationKey\) => void/);
  });

  test("the host gives the send the slot it asks for", () => {
    const block = ROOT.match(/useSendHost\(\{[\s\S]*?\n {2}\}\)/)?.[0] ?? "";
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/\n    showNoticeKey,\n/);
    // CHANGED with the share-in/mini-app slice: the destructure now also
    // names `showNotice` — the RAW-string writer the mini-app sheet's block
    // actions need (the controller passed the same `showNotice` at
    // App:5346-5362). Same hook, same single slot; the one-writer test below
    // is untouched and remains the enforcement.
    expect(ROOT).toContain("const { notice, showNotice, showNoticeKey } = useNotice();");
  });

  test("the firing side speaks only on an actual truncation, and never twice", () => {
    expect(TURN).toContain("notesRes.truncated");
    expect(TURN).toContain("sendOpts.onNotice?.()");
    // One writer, one slot (D2 row 17): no host file may write the notice
    // state except the hook that owns its timer.
    const writers = readdirSync(__dirname)
      .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"))
      .filter((file) => readFileSync(join(__dirname, file), "utf8").includes("setNotice("));
    expect(writers).toEqual(["useNotice.ts"]);
  });
});

describe("the notice text in both catalogues and the host surface", () => {
  test("the key exists and is a non-empty string in en and it", () => {
    expect(typeof en.chat.notesContextTruncated).toBe("string");
    expect(en.chat.notesContextTruncated.length).toBeGreaterThan(0);
    expect(typeof italian.chat.notesContextTruncated).toBe("string");
    expect(italian.chat.notesContextTruncated.length).toBeGreaterThan(0);
  });

  test("the host notice renders the translated truncation line accessibly", () => {
    const message = en.chat.notesContextTruncated;
    const notice = HostNotice({ text: message });
    expect(notice).not.toBeNull();
    expect(notice?.props).toMatchObject({
      testID: "host.notice",
      accessibilityRole: "text",
      accessibilityLabel: message,
    });
    expect(notice?.props.children.props.children).toBe(message);
    expect(HostNotice({ text: null })).toBeNull();
  });
});
