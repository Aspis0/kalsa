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
const CHAT = readFileSync(join(__dirname, "..", "screens", "AiChatPage.tsx"), "utf8");

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
    expect(ROOT).toContain("const { notice, showNoticeKey } = useNotice();");
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

describe("the string: the controller's own, in both catalogues", () => {
  test("the key exists and is a non-empty string in en and it", () => {
    expect(typeof en.chat.notesContextTruncated).toBe("string");
    expect(en.chat.notesContextTruncated.length).toBeGreaterThan(0);
    expect(typeof italian.chat.notesContextTruncated).toBe("string");
    expect(italian.chat.notesContextTruncated.length).toBeGreaterThan(0);
  });

  test("the controller ships this exact line to its voice-note toast", () => {
    expect(CHAT).toContain(
      'onNotice: () => showVoiceNote(t("chat.notesContextTruncated"))',
    );
  });
});
