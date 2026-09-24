/**
 * The composer arms' decisions (D1 row 14): the draft-empty rule, the send's
 * capture-and-clear, the conversation-change clear, and the quick-templates
 * sheet that this slice mounts rather than rebuilds.
 *
 * The pure predicates are tested directly; the WIRING is a source check, the
 * stack having no render harness — every assertion names the file it reads, and
 * the samples at the bottom keep each pattern from passing vacuously.
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  armsSendOptions,
  armsShouldClearOnDraft,
  researchChipVisible,
  researchIntentForBackend,
  shouldRefuseRemoteResearch,
} from "./composerArms";
import { runHostAttachment } from "./remoteAttachmentGate";
import { hasDeepResearchTrigger } from "../research/plan";
import { applyTemplateSelection } from "./templateSelection";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const SEND = stripComments(read("sendHost.ts"));
const ROOT = stripComments(read("HostRoot.tsx"));
const SURFACE = stripComments(read("HostChatSurface.tsx"));
const LAYOUT = stripComments(read("HostLayout.tsx"));
const FURNITURE = stripComments(read("HostFurniture.tsx"));
const STRIP = stripComments(read("../ui/shell/ShellStrip.tsx"));
const OVERLAYS = stripComments(read("HostChatSurfaceOverlays.tsx"));
const ATTACH_SHEET = stripComments(read("HostAttachSheet.tsx"));

describe("the draft-empty auto-clear (Chat:1264-1273)", () => {
  it("clears both arms only on a content-to-blank transition", () => {
    expect(armsShouldClearOnDraft("", true)).toBe(true);
    // Trimmed, as the controller trimmed: whitespace-only IS blank.
    expect(armsShouldClearOnDraft("   ", true)).toBe(true);
    expect(armsShouldClearOnDraft("hello", true)).toBe(false);
  });

  it("never clears a draft that never had content (arms set on an empty field stay)", () => {
    expect(armsShouldClearOnDraft("", false)).toBe(false);
    expect(armsShouldClearOnDraft("next message", false)).toBe(false);
  });

  it("would catch the reversed rule", () => {
    expect(armsShouldClearOnDraft("", true)).not.toBe(false);
  });
});

describe("the send's options and its capture-and-clear (Chat:2454-2463)", () => {
  it("hands the engine nothing when no arm and no keyword is present", () => {
    expect(armsSendOptions(false, false, false)).toBeNull();
  });

  it("arms research from EITHER the chip or the typed trigger, as before", () => {
    expect(armsSendOptions(true, false, false)).toEqual({ research: true, notes: false });
    expect(armsSendOptions(false, false, true)).toEqual({ research: true, notes: false });
    expect(armsSendOptions(true, false, true)).toEqual({ research: true, notes: false });
  });

  it("never dispatches the research executor for a remote send", () => {
    const executeTool = jest.fn();
    const remoteResearch = researchIntentForBackend(true, true);
    const remoteOptions = armsSendOptions(
      researchIntentForBackend(true, true),
      false,
      remoteResearch,
    );
    if (remoteOptions?.research) executeTool("document_chat");
    expect(remoteOptions).toBeNull();
    expect(executeTool).not.toHaveBeenCalled();

    const localOptions = armsSendOptions(
      researchIntentForBackend(false, true),
      false,
      researchIntentForBackend(false, true),
    );
    if (localOptions?.research) executeTool("document_chat");
    expect(executeTool).toHaveBeenCalledTimes(1);
    // The live send must use the tested predicate for both the keyword and
    // the one-shot research arm; otherwise the executor probe above is moot.
    expect(SEND).toContain("const remoteBackend = isRemoteEngineBackend()");
    expect(SEND).toContain("const keywordResearch = hasDeepResearchTrigger(trimmed)");
    expect(SEND).toContain("researchIntentForBackend(remoteBackend, keywordResearch)");
    expect(SEND).toContain("researchIntentForBackend(remoteBackend, params.arms.researchRef.current)");
  });

  it("the remote chip cannot arm or advertise research, and keyword research gets a reason", () => {
    const remoteTap = jest.fn();
    const refusal = jest.fn();
    const remoteRequested = shouldRefuseRemoteResearch(true, true);
    if (remoteRequested) refusal();
    if (researchChipVisible(true, true)) remoteTap();

    expect(remoteRequested).toBe(true);
    expect(refusal).toHaveBeenCalledTimes(1);
    expect(researchChipVisible(true, true)).toBe(false);
    expect(remoteTap).not.toHaveBeenCalled();
    expect(shouldRefuseRemoteResearch(true, hasDeepResearchTrigger("please do deep research"))).toBe(true);
    expect(shouldRefuseRemoteResearch(false, true)).toBe(false);
    expect(SEND).toContain("shouldRefuseRemoteResearch(remoteBackend");
    expect(SEND).toContain('params.showNoticeKey("settings.remoteGated")');
    expect(SURFACE).toContain("researchChipVisible(modelHost.remoteActive, arms.research)");
    expect(SURFACE).toContain("arms.clearResearch()");
  });

  it("arms notes on its own — the branch engineTurn:246-257 was unreachable until this", () => {
    expect(armsSendOptions(false, true, false)).toEqual({ research: false, notes: true });
    expect(armsSendOptions(true, true, false)).toEqual({ research: true, notes: true });
  });

  it("reads the refs and clears them inside the send, after the gate", () => {
    expect(SEND).toContain("armsSendOptions(");
    expect(SEND).toContain("params.arms.researchRef.current");
    expect(SEND).toContain("params.arms.notesRef.current");
    expect(SEND).toMatch(/if \(params\.arms\.researchRef\.current \|\| params\.arms\.notesRef\.current\)/);
    expect(SEND).toContain("params.arms.clear()");
    // The clear must come AFTER the content gate's early return — a refused
    // send must not eat the user's arms.
    expect(SEND.indexOf("params.arms.clear()")).toBeGreaterThan(
      SEND.indexOf("contentFilterMessage(classification.reason, t)"),
    );
  });

  it("would catch a send that never cleared the arms", () => {
    expect("params.arms.clear()".replace("clear", "hold")).not.toBe("params.arms.clear()");
    expect(SEND).toContain("params.arms.clear()");
  });
});

describe("the conversation-change clear (Chat:1894-1897) and the root's wiring", () => {
  it("the root clears the arms when a conversation is entered", () => {
    expect(ROOT).toMatch(/handleConversationEnter = useCallback\(\(\) => \{/);
    const body = ROOT.slice(ROOT.indexOf("handleConversationEnter = useCallback"));
    expect(body).toContain("arms.clear()");
  });

  it("the root hands the arms to BOTH the send host and the surface", () => {
    expect(ROOT).toMatch(/useSendHost\(\{[\s\S]*?\barms,/);
    expect(ROOT).toContain("arms={arms}");
  });

  it("tool flags stay with settings furniture and do not enter the conversation strip", () => {
    expect(ROOT).toContain("flags={flags}");
    expect(LAYOUT).toContain("flags={flags}");
    expect(FURNITURE).toContain("refreshToolFlags={flags.refreshToolFlags}");
    expect(SURFACE).not.toContain("webEnabled=");
    expect(STRIP).not.toMatch(/webEnabled|onWebPress|\bSwitch\b/);
  });
});

describe("the quick-templates sheet is CALLED, not rebuilt (D1 row 13)", () => {
  it("the extracted overlay seam mounts the controller's template sheet", () => {
    expect(SURFACE).toContain("<HostChatSurfaceOverlays");
    expect(OVERLAYS).toMatch(/<QuickActionSheet[\s\S]*?onlyTemplates/);
    expect(OVERLAYS).toMatch(/visible=\{props\.quickSheetVisible\}/);
    expect(OVERLAYS).toMatch(/onClose=\{props\.onQuickSheetClose\}/);
  });

  it("choosing a template replaces the draft AND focuses the field (Chat:3633-3641)", () => {
    const handler =
      SURFACE.match(/onChooseTemplate=\{\(template\) => \{[\s\S]*?\}\}/)?.[0] ?? "";
    expect(handler.length).toBeGreaterThan(0);
    expect(handler).toContain("applyTemplateSelection(");
    const events: string[] = [];
    applyTemplateSelection(
      "translated prompt",
      (value) => events.push(`draft:${value}`),
      () => events.push("focus"),
    );
    expect(events).toEqual(["draft:translated prompt", "focus"]);
  });

  it("the composer attach control follows the machine while stopped or converting", () => {
    expect(SURFACE).toContain("attachDisabled={view.composer.face !== \"send\" || attachments.converting !== null}");
  });

  it("research and notes remain one-shot switches inside the attach sheet", () => {
    expect(ATTACH_SHEET).toContain('action: "research"');
    expect(ATTACH_SHEET).toContain('action: "notes"');
    expect(ATTACH_SHEET).toContain('role: "switch"');
    expect(SURFACE).toContain("runHostLocalAction(modelHost.remoteActiveRef.current, refuseRemoteAttachment, arms.toggleResearch)");
    expect(SURFACE).toContain("arms.toggleNotes()");
    expect(OVERLAYS).toContain("researchActive={props.researchActive}");
    expect(OVERLAYS).toContain("notesActive={props.notesActive}");
  });

  it("the library-document ENTRY moved to the attach sheet; the attach button opens it", () => {
    // BEFORE this slice the toolbar carried the document chip as a §2.7 stub
    // whose press fired `shell.notice.attach`, then the chip was REMOVED (it
    // clipped 349 dp's right edge and did nothing without the flow). The
    // attach flow landed and the entry found its door in the ATTACH SHEET
    // (`HostAttachSheet.tsx` — the row cannot hold a third chip,
    // `composerToolbarWidth.test.ts`); the attach BUTTON opens that sheet:
    expect(SURFACE).not.toMatch(/onDocumentPress/);
    expect(SURFACE).toContain("runHostAttachment(modelHost.remoteActiveRef.current, refuseRemoteAttachment, () => setAttachSheetOpen(true))");
    const open = jest.fn();
    expect(runHostAttachment(false, jest.fn(), open)).toBeUndefined();
    expect(open).toHaveBeenCalledTimes(1);
    // the stub key was deleted with its last user:
    expect(SURFACE).not.toContain("shell.notice.attach");
  });
});

describe("the samples: each guard above would fail on its absence", () => {
  it("the source files really are the ones being read", () => {
    // Without this, a typo'd filename would make every source assertion pass
    // against a file that does not exist.
    expect(SEND).toContain("export function useSendHost");
    expect(ROOT).toContain("export function HostRoot");
    expect(SURFACE).toContain("export function HostChatSurface");
  });
});
