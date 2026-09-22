/**
 * The download slice's seams, pinned as source — the properties a diff would
 * hide and this stack cannot render: where `downloadedById` is written (the
 * reconnaissance question, answered in code), that its ONLY full re-derivation
 * is the settings-open scan and never a boot scan; that the guards the
 * controller read `downloadInFlight` from are back; that the notice slot is
 * still written through the one hook that owns its timer; and that every
 * catalogue key this path speaks exists in BOTH catalogues with the same
 * placeholders.
 *
 * Source pins are this project's idiom for wiring (`stripWebSwitch.test.ts`,
 * `notesNotice.test.ts`): the alternative is a render harness DESIGN.md
 * declares the stack does not have.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { en, it as italian } from "../i18n";

const HOST = (file: string) => readFileSync(join(__dirname, file), "utf8");
const OVERLAYS = HOST("HostOverlays.tsx");
const DOWNLOAD = HOST("useModelDownload.ts");
const CONFIRM_GATE = HOST("confirmDownloadGate.ts");
const WARNING = HOST("confirmGateWarning.ts");
const SWITCH = HOST("modelSwitch.ts");
const IDLE = HOST("foregroundIdle.ts");
const NOTICE = HOST("useNotice.ts");
const SURFACE = HOST("HostChatSurface.tsx");

describe("downloadedById: written on success, re-scanned on open — never at boot", () => {
  test("the controller's three live writes collapse to one mark, after the bundle verifies", () => {
    // App:4914, 4933, 5046 — all three fire only once the bytes are on disk.
    expect(DOWNLOAD).toContain("markDownloaded(model.id);");
    expect(DOWNLOAD.match(/markDownloaded\(model\.id\)/g)).toHaveLength(1);
  });

  test("the full scan gates on Settings open BEFORE any probe — there is no boot rescan", () => {
    // The gate is the first statement of the effect body (controller
    // `App:5323`): a boot mount runs the effect once and returns untouched.
    expect(OVERLAYS).toMatch(
      /useEffect\(\(\) => \{\s*\n\s*if \(overlay\?\.kind !== "settings"\) return;/,
    );
    // And it re-runs on state changes while open — the controller's deps.
    expect(OVERLAYS).toContain("}, [overlay, modelState, onDownloadedScan]);");
  });

  test("the scan writes UP into the download host: one map, two writers, no local copy", () => {
    expect(OVERLAYS).toContain("onDownloadedScan(map);");
    expect(OVERLAYS).not.toContain("setDownloadedById");
    expect(OVERLAYS).not.toContain("useState<Record<string, boolean>>");
    expect(DOWNLOAD).toContain("const [downloadedById, setDownloadedById]");
  });

  test("the strip and Settings read the same map (surface never builds its own)", () => {
    expect(SURFACE).not.toContain("downloadedById");
    expect(OVERLAYS).toContain("downloadedById,");
  });
});

describe("the guards that consult downloadInFlight, as the controller did", () => {
  test("selectModel refuses mid-transfer (App:4452)", () => {
    expect(SWITCH).toMatch(
      /if \(\s*\n\s*downloadInFlightRef\.current \|\|\s*\n\s*modelSwitchInFlightRef\.current \|\|/,
    );
  });

  test("the idle governor counts a download as engine work (App:3267)", () => {
    expect(IDLE).toContain("downloadInFlightRef.current ||");
    expect(IDLE).toMatch(/regenInFlightRef\.current \|\|\s*\n\s*downloadInFlightRef\.current/);
  });

  test("a download start bumps the foreground-idle clock (App:4677)", () => {
    expect(DOWNLOAD).toContain("bumpForegroundIdleRef.current();");
  });

  test("both abort sites exist: the thermal edge (App:3684) and unmount (App:3776)", () => {
    expect(DOWNLOAD.match(/downloadAbortRef\.current\?\.abort\(\)/g)?.length).toBe(2);
  });
});

describe("the notice slot stays one slot (D2 row 17)", () => {
  test("the ready notice writes through the port, never a second state", () => {
    expect(DOWNLOAD).toContain("noticePort.current?.(");
    expect(DOWNLOAD).not.toContain("setNotice(");
    expect(DOWNLOAD).not.toContain("useState<string | null>");
  });

  test("the port points at the hook that owns the timer — still the only writer of the state", () => {
    expect(NOTICE).toContain("noticePort.current = showNotice;");
    expect(NOTICE).toContain("setNotice(value);");
    // The authoritative `setNotice(` grep over every host file lives in
    // notesNotice.test.ts and still names exactly one file.
  });

  test("the root's pinned one-slot line is untouched", () => {
    const root = HOST("HostRoot.tsx");
    expect(root).toContain("const { notice, showNotice, showNoticeKey } = useNotice();");
  });
});

describe("the confirm sheet knows the load that follows the download", () => {
  test("the verdict runs with the volatile axis ON, priced as the load prices it", () => {
    // It was `false` before: disk-only, RAM deferred to a load the user only
    // meets after paying for the bytes. This is item 1's whole probe.
    expect(CONFIRM_GATE).toMatch(/\/\/ Volatile RAM ON[\s\S]*?\n\s*true,/);
    expect(CONFIRM_GATE).toContain("readUserContextSize(model.contextLength)");
    expect(CONFIRM_GATE).toContain("readKvCacheChoice()");
    // Fresh sample: the sheet's numbers are about NOW, not about boot.
    expect(CONFIRM_GATE).toContain("profileWithFreshMemory(cachedProfile)");
  });

  test("a RAM refusal warns in the SAME sheet; tier and disk still refuse outright", () => {
    expect(DOWNLOAD).toContain('gate.reason !== "blocked_ram"');
    expect(DOWNLOAD).toContain("confirmGateWarning({");
    expect(DOWNLOAD).toContain("${confirmBody}\\n\\n${memoryWarning}");
    // No second dialog, no second state: one Alert whose body grows one sentence.
    expect(DOWNLOAD).toContain("memoryWarning === null ? confirmBody :");
  });

  test("the warning sentence quotes the gate's numbers and never invents them", () => {
    expect(WARNING).toContain('t("download.confirmLowMemory"');
    expect(WARNING).toContain('t("models.blockedRam")');
    expect(WARNING).toContain("gate.nonEvictableMiB * BYTES_PER_MIB");
  });
});

describe("every key this path speaks exists in BOTH catalogues, same placeholders", () => {
  const KEYS: Array<[string, string, string]> = [
    ["download.title", en.download.title, italian.download.title],
    ["download.confirmBody", en.download.confirmBody, italian.download.confirmBody],
    ["download.confirmLowMemory", en.download.confirmLowMemory, italian.download.confirmLowMemory],
    ["download.checking", en.download.checking, italian.download.checking],
    ["download.missing", en.download.missing, italian.download.missing],
    ["download.downloading", en.download.downloading, italian.download.downloading],
    ["download.loading", en.download.loading, italian.download.loading],
    ["download.failedRetry", en.download.failedRetry, italian.download.failedRetry],
    ["download.loadFailedRetry", en.download.loadFailedRetry, italian.download.loadFailedRetry],
    ["download.readyLocal", en.download.readyLocal, italian.download.readyLocal],
    ["download.incomplete", en.download.incomplete, italian.download.incomplete],
    ["download.readyNotice", en.download.readyNotice, italian.download.readyNotice],
    ["download.keepOpenHint", en.download.keepOpenHint, italian.download.keepOpenHint],
    ["download.notifyReady", en.download.notifyReady, italian.download.notifyReady],
    ["download.notifyFailed", en.download.notifyFailed, italian.download.notifyFailed],
    ["download.notifyProgressTitle", en.download.notifyProgressTitle, italian.download.notifyProgressTitle],
    ["download.notifyProgressBody", en.download.notifyProgressBody, italian.download.notifyProgressBody],
    ["chat.lazyReload", en.chat.lazyReload, italian.chat.lazyReload],
    ["embedding.restartHint", en.embedding.restartHint, italian.embedding.restartHint],
    ["notify.channelName", en.notify.channelName, italian.notify.channelName],
    ["notify.downloadsChannelName", en.notify.downloadsChannelName, italian.notify.downloadsChannelName],
    ["common.download", en.common.download, italian.common.download],
    ["common.cancel", en.common.cancel, italian.common.cancel],
  ];

  const placeholders = (value: string) => (value.match(/\{(\w+)\}/g) ?? []).sort();

  it("non-empty in en and it, with identical {placeholders}", () => {
    for (const [key, enValue, itValue] of KEYS) {
      expect([key, enValue.length > 0]).toEqual([key, true]);
      expect([key, itValue.length > 0]).toEqual([key, true]);
      expect([key, placeholders(itValue)]).toEqual([key, placeholders(enValue)]);
    }
  });

  it("the held controls kept their own whys, and the model download's why is gone", () => {
    const notice = en.shell.notice as unknown as Record<string, string | undefined>;
    const noticeIt = italian.shell.notice as unknown as Record<string, string | undefined>;
    // Deleted with its last user: the pill and Settings run confirmDownload now.
    expect(notice.download).toBeUndefined();
    expect(noticeIt.download).toBeUndefined();
    // Held with a reason — the voice pipeline does not exist in this build.
    for (const held of ["mic", "voiceDownload", "embeddingDownload", "semanticRebuild"] as const) {
      expect(typeof notice[held]).toBe("string");
      expect(typeof noticeIt[held]).toBe("string");
    }
    expect(SURFACE).not.toContain("shell.notice.download");
    expect(OVERLAYS).not.toContain("shell.notice.download");
  });
});
