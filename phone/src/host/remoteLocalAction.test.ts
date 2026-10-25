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
    const refuse = jest.fn();
    const toggleResearch = jest.fn(() => true);

    expect(runHostLocalAction(false, refuse, toggleResearch)).toBe(true);
    expect(toggleResearch).toHaveBeenCalledTimes(1);
    expect(refuse).not.toHaveBeenCalled();
  });

  test("a remote-mode press gives its reason and never runs the action", () => {
    const notice = jest.fn();
    const action = jest.fn();

    runHostLocalAction(true, () => notice("settings.remoteGated"), action);

    expect(notice).toHaveBeenCalledWith("settings.remoteGated");
    expect(action).not.toHaveBeenCalled();
  });
});
