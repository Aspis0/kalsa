import { readFileSync } from "fs";
import { join } from "path";
import { runHostAttachment, runRemoteImagePick } from "./remoteAttachmentGate";

const SURFACE = readFileSync(join(__dirname, "HostChatSurface.tsx"), "utf8");
const SHARES = readFileSync(join(__dirname, "useShareIn.ts"), "utf8");

describe("remote attachment refusals guard every host entry", () => {
  test("documents and shared files cannot attach remotely, and every entry is gated", () => {
    const notice = jest.fn();
    const picker = jest.fn(() => "picked");

    expect(runHostAttachment(true, notice, picker)).toBeUndefined();
    expect(picker).not.toHaveBeenCalled();
    expect(notice).toHaveBeenCalledTimes(1);
    // The document row and the library-document row on the surface; the
    // attach button itself opens the sheet in both modes (a picture may
    // cross to a seeing desk).
    expect(SURFACE.match(/runHostAttachment\(modelHost\.remoteActiveRef\.current/g)).toHaveLength(2);
    expect(SURFACE).toContain("onAttachPress={() => setAttachSheetOpen(true)}");
    expect(SHARES).toContain("runHostAttachment(");
    expect(SHARES.indexOf('if (payload.kind === "text")')).toBeLessThan(SHARES.indexOf("runHostAttachment("));
  });

  test("the picture road asks the desk BEFORE the picker opens", async () => {
    const run = jest.fn();
    const refuse = jest.fn();
    const probe = jest.fn(async () => "cannot" as const);

    await runRemoteImagePick({ remoteActive: true, probeVision: probe, onRefusal: refuse, run });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(refuse).toHaveBeenCalledWith("cannot");

    // A fresh yes lets the pick through.
    await runRemoteImagePick({
      remoteActive: true,
      probeVision: async () => "sees",
      onRefusal: refuse,
      run,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(refuse).toHaveBeenCalledTimes(1);

    // A desk nobody could ask is not a desk that said no.
    await runRemoteImagePick({
      remoteActive: true,
      probeVision: async () => "unreachable",
      onRefusal: refuse,
      run,
    });
    expect(refuse).toHaveBeenLastCalledWith("unreachable");
    expect(run).toHaveBeenCalledTimes(1);

    // Local mode never pays for a probe.
    await runRemoteImagePick({
      remoteActive: false,
      probeVision: async () => {
        throw new Error("the local road must not probe");
      },
      onRefusal: refuse,
      run,
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("local attachment work keeps the existing operation and result", () => {
    const notice = jest.fn();
    const attach = jest.fn(() => true);

    expect(runHostAttachment(false, notice, attach)).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);
    expect(notice).not.toHaveBeenCalled();
  });
});
