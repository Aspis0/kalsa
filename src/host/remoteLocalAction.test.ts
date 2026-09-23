import { readFileSync } from "fs";
import { join } from "path";
import { runHostLocalAction } from "./remoteLocalAction";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

describe("local-only controls explain remote mode without pretending to run", () => {
  test("translate stays offered and refuses with its reason instead of starting the failing operation", () => {
    const menuRows = read("messageMenuRows.ts");
    const messageActions = read("messageActions.ts");
    const translateHook = read("useTranslateMessage.ts");
    const refuse = jest.fn();
    const translate = jest.fn();

    expect(menuRows).toContain('id: "translate"');
    expect(messageActions).toContain("runTranslate(payload.id, payload.text)");
    expect(translateHook).toMatch(/runHostLocalAction\(isRemoteEngineBackend\(\)/);
    expect(translateHook).toContain('noticeRef.current("settings.remoteGated")');
    expect(runHostLocalAction(true, refuse, translate)).toBeUndefined();
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(translate).not.toHaveBeenCalled();
  });

  test("local mode still runs the selected action exactly once", () => {
    const surface = read("HostChatSurface.tsx");
    const refuse = jest.fn();
    const toggleResearch = jest.fn(() => true);

    expect(surface).toContain("runHostLocalAction(modelHost.remoteActiveRef.current");
    expect(runHostLocalAction(false, refuse, toggleResearch)).toBe(true);
    expect(toggleResearch).toHaveBeenCalledTimes(1);
    expect(refuse).not.toHaveBeenCalled();
    expect(surface).toContain('const refuseRemoteAttachment = () => showNoticeKey("settings.remoteGated")');
  });

  test("remote research tap gives its reason and never arms the chip", () => {
    const surface = read("HostChatSurface.tsx");
    const notice = jest.fn();
    const toggleResearch = jest.fn();

    runHostLocalAction(true, () => notice("settings.remoteGated"), toggleResearch);

    expect(notice).toHaveBeenCalledWith("settings.remoteGated");
    expect(toggleResearch).not.toHaveBeenCalled();
    expect(surface).toMatch(/runHostLocalAction\(modelHost\.remoteActiveRef\.current,\s*refuseRemoteAttachment,\s*arms\.toggleResearch\)/);
  });
});
