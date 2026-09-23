import { readFileSync } from "fs";
import { join } from "path";
import { runHostAttachment } from "./remoteAttachmentGate";

const SURFACE = readFileSync(join(__dirname, "HostChatSurface.tsx"), "utf8");
const SHARES = readFileSync(join(__dirname, "useShareIn.ts"), "utf8");
const ROOT = readFileSync(join(__dirname, "HostRoot.tsx"), "utf8");

describe("remote attachment refusals guard every host entry", () => {
  test("composer, picker, library row, and shared document cannot attach remotely", () => {
    const notice = jest.fn();
    const picker = jest.fn(() => "picked");
    const attach = jest.fn(() => true);

    expect(runHostAttachment(true, notice, picker)).toBeUndefined();
    expect(runHostAttachment(true, notice, attach)).toBeUndefined();
    expect(picker).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledTimes(2);
    expect(SURFACE.match(/runHostAttachment\(modelHost\.remoteActiveRef\.current/g)).toHaveLength(4);
    expect(SHARES).toContain("runHostAttachment(");
    expect(SHARES.indexOf('if (payload.kind === "text")')).toBeLessThan(SHARES.indexOf("runHostAttachment("));
    expect(ROOT).toContain("remoteActiveRef: modelHost.remoteActiveRef");
  });

  test("local attachment work keeps the existing operation and result", () => {
    const notice = jest.fn();
    const attach = jest.fn(() => true);

    expect(runHostAttachment(false, notice, attach)).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(notice).not.toHaveBeenCalled();
  });
});
