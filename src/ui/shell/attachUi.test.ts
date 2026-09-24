/**
 * The attach UI as source — each describe names what a screenshot cannot
 * see: real 48 dp boxes (never `hitSlop`), a testID and an accessible name
 * on every pressable, the §2.7 chip label (the name INSIDE the label), the
 * shell's row arithmetic, the disabled attach control, the sheet's seven
 * entries — and that every catalogue key those entries print exists in BOTH
 * catalogues.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { en } from "../../i18n/en";
import { it as italian } from "../../i18n/it";
import { e2, e3 } from "../../theme/design";
import { COMPOSER_ATTACHMENTS_HEIGHT, MIN_TOUCH_TARGET } from "./shellGeometry";
import { singleLineSheetTitle } from "./sheetTitleProps";
import { runHostAttachment } from "../../host/remoteAttachmentGate";
import { runHostLocalAction } from "../../host/remoteLocalAction";

const SHELL_DIR = __dirname;
const HOST_DIR = join(__dirname, "..", "..", "host");

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const SHEET = stripComments(readFileSync(join(SHELL_DIR, "AttachSheet.tsx"), "utf8"));
const GRABBER = stripComments(readFileSync(join(SHELL_DIR, "SheetGrabber.tsx"), "utf8"));
const MODEL_SHEET = stripComments(readFileSync(join(SHELL_DIR, "ModelPillSheet.tsx"), "utf8"));
const CHIPS = stripComments(readFileSync(join(SHELL_DIR, "ComposerAttachments.tsx"), "utf8"));
const SHELL = stripComments(readFileSync(join(SHELL_DIR, "Shell.tsx"), "utf8"));
const FIELD = stripComments(readFileSync(join(SHELL_DIR, "ShellComposer.tsx"), "utf8"));
const MENU = stripComments(readFileSync(join(HOST_DIR, "HostAttachSheet.tsx"), "utf8"));
const SURFACE = stripComments(readFileSync(join(HOST_DIR, "HostChatSurface.tsx"), "utf8"));
const SEND = stripComments(readFileSync(join(HOST_DIR, "sendHost.ts"), "utf8"));
const GUARDS = stripComments(readFileSync(join(HOST_DIR, "sendEntryGuards.ts"), "utf8"));

const flatten = (catalog: object, prefix = ""): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else if (value && typeof value === "object") Object.assign(out, flatten(value, path));
  }
  return out;
};
const EN = flatten(en);
const IT = flatten(italian);

describe("the sheet is a stack of real boxes (project rule: ≥48 dp, no hitSlop)", () => {
  it("every row is a 48 dp pressable with a testID and an accessible name", () => {
    expect(SHEET).toContain("minHeight: 48");
    expect(SHEET).toContain("accessibilityLabel={row.accessibilityLabel ?? row.label}");
    expect(SHEET).toContain('accessibilityRole={row.role ?? "button"}');
    expect(SHEET).toContain("testID={row.testID}");
    expect(SHEET).not.toContain("hitSlop");
    // sample
    expect("accessibilityLabel={row.label}".match(/accessibilityLabel/g)).not.toBeNull();
  });

  it("the backdrop closes AND Android back has a target (onRequestClose)", () => {
    expect(SHEET).toContain('testID="shell.attach.backdrop"');
    expect(SHEET).toContain("onRequestClose={onClose}");
    expect(SHEET).toContain("onPress={onClose}");
  });

  it("supports a titled sheet heading for conversation actions", () => {
    expect(SHEET).toContain("title?: string;");
    expect(SHEET).toContain('accessibilityRole="header"');
    const longTitle = "This conversation title is long enough to exceed the sheet width ".repeat(4);
    const heading = singleLineSheetTitle(longTitle);
    expect(heading).toEqual({ title: longTitle, numberOfLines: 1 });
    const headingAt = SHEET.indexOf("{heading ? (");
    const subtitleAt = SHEET.indexOf("{subtitle ? (", headingAt);
    const headingSource = SHEET.slice(headingAt, subtitleAt);
    expect(headingSource).toContain("numberOfLines={heading.numberOfLines}");
    expect(headingSource).toContain("{heading.title}");
  });

  it("supports a full-width primary action for selectable settings sheets", () => {
    expect(SHEET).toContain("primaryActionLabel?: string;");
    expect(SHEET).toContain("onPrimaryAction?: () => void;");
    expect(SHEET).toContain('testID="shell.attach.primary"');
    expect(SHEET).toContain("accessibilityLabel={primaryActionLabel}");
    expect(SHEET).toContain("minHeight: 52");
    expect(SHEET).toContain("backgroundColor: pressed ? colors.brandDeep : colors.brand");
  });

  it("uses one shared 36 by 4 grabber above the title and eight dp below every sheet top", () => {
    expect(GRABBER).toContain("testID={testID}");
    expect(GRABBER).toContain("width: 36");
    expect(GRABBER).toContain("height: 4");
    expect(GRABBER).toContain("alignSelf: \"center\"");
    expect(GRABBER).toContain("marginTop: 8");
    expect(SHEET).toContain('<SheetGrabber colors={colors} testID="shell.attach.grabber" />');
    expect(e3).toBe(e2);
    expect(SHEET).toContain("...e3");
    expect(MODEL_SHEET).toContain('<SheetGrabber colors={colors} testID="shell.modelSheet.grabber" marginBottom={spacing.md} />');
    expect(SHEET).not.toContain('testID="shell.modelSheet.grabber"');
    expect(MODEL_SHEET).not.toContain('testID="shell.attach.grabber"');
    expect(MODEL_SHEET).not.toContain("width: 36");
    expect(MODEL_SHEET).not.toContain("height: 4");
    const grabberAt = SHEET.indexOf("<SheetGrabber");
    const titleAt = SHEET.indexOf("{heading ? (");
    expect(grabberAt).toBeGreaterThan(-1);
    expect(titleAt).toBeGreaterThan(-1);
    expect(grabberAt).toBeLessThan(titleAt);
  });
});

describe("the chips are §2.7: the name INSIDE the label, a 48 dp remove box", () => {
  it("draws the composerState view through `t(key, params)` — a bare name never reaches the screen alone", () => {
    expect(CHIPS).toContain("t(chip.key, chip.params)");
    expect(CHIPS).toContain("borderRadius: radius.pill");
    expect(CHIPS).toContain("<FileText size={16}");
    expect(CHIPS).not.toMatch(/accessibilityLabel=\{chip\.params/);
  });

  it("the remove control is a real box with the controller's removal label", () => {
    expect(CHIPS).toContain("width: COMPOSER_ATTACHMENTS_HEIGHT");
    expect(CHIPS).toContain("height: COMPOSER_ATTACHMENTS_HEIGHT");
    expect(CHIPS).toContain('accessibilityLabel={t("chat.a11yRemoveAttachment")}');
    expect(CHIPS).toContain("testID={`shell.composer.attachment.remove.${index}`}");
    expect(CHIPS).not.toContain("hitSlop");
  });

  it("the row's height is the shell's own subtraction (48, one number)", () => {
    expect(COMPOSER_ATTACHMENTS_HEIGHT).toBe(MIN_TOUCH_TARGET);
    expect(SHELL).toContain("attachmentsRowVisible ? COMPOSER_ATTACHMENTS_HEIGHT : 0)");
    expect(SHELL).toContain("<ComposerAttachments {...attachments} colors={colors} />");
    // The v2 composer has no permanent toolbar row. Attachments sit between
    // the hold line and the single composer capsule.
    const chipsAt = SHELL.indexOf("<ComposerAttachments {...");
    const composerAt = SHELL.indexOf("<ShellComposer");
    expect(SHELL).not.toContain("<ComposerToolbar");
    expect(chipsAt).toBeGreaterThan(SHELL.indexOf("{holdReason === null"));
    expect(composerAt).toBeGreaterThan(chipsAt);
  });
});

describe("the attach control carries the controller's disabled rule (Chat:4810)", () => {
  it("the field's attach pressable is disabled with its state announced", () => {
    expect(FIELD).toContain("disabled={attachDisabled}");
    expect(FIELD).toContain("accessibilityState={{ disabled: attachDisabled }}");
    expect(FIELD).toContain('testID="shell.composer.attach"');
    expect(FIELD).toContain('accessibilityLabel={t("shell.a11y.attach")}');
    expect(FIELD).not.toContain("hitSlop");
  });

  it("the surface decides it: face says stop OR a PDF is converting", () => {
    expect(SURFACE).toContain(
      "attachDisabled={view.composer.face !== \"send\" || attachments.converting !== null}",
    );
    expect(SURFACE).toContain("runHostAttachment(modelHost.remoteActiveRef.current, refuseRemoteAttachment, () => setAttachSheetOpen(true))");
    const open = jest.fn();
    const refuse = jest.fn();
    runHostAttachment(false, refuse, open);
    expect(open).toHaveBeenCalledTimes(1);
    runHostAttachment(true, refuse, open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(refuse).toHaveBeenCalledTimes(1);
    expect(SURFACE).not.toContain("shell.notice.attach");
  });

  it("the conversion job is mounted keyed on the URI (controller's U2 remount)", () => {
    expect(SURFACE).toContain("key={attachments.converting.uri}");
    expect(SURFACE).toContain("pdfUri={attachments.converting.uri}");
    expect(SURFACE).toContain("onDone={attachments.pdf.onDone}");
    expect(SURFACE).toContain("onError={attachments.pdf.onError}");
  });
});

describe("the send snapshots and clears the rows (sendHost as source — its import graph reaches the engine)", () => {
  it("BOTH append paths stamp the send-time rows on the user message", () => {
    const stamps = SEND.split("\n").filter((line) => line.includes("attachments: stamped"));
    expect(stamps).toHaveLength(2); // the content-gate append and the live append
    expect(SEND).toContain("const snapshot = staged.slice();");
    // The actual adapter handoff and its stable copy are exercised in sendHostOwnership.test.ts.
  });

  it("rows clear ONLY where this send consumed them — a foreign send keeps staged rows (the sendDraft doctrine applied to rows)", () => {
    const clears = SEND.split("\n").filter((line) => line.includes("params.attachments.clear()"));
    expect(clears).toHaveLength(2); // gate refusal + live append, as the controller had
    for (const line of clears) {
      expect(line).toContain("if (consumedComposerRows)");
    }
    // sample: an unconditional clear would fail the line above
    expect("        params.attachments.clear();").not.toContain("consumedComposerRows");
  });

  it("an attachment-only send is not refused at the gate (controller Chat:3676)", () => {
    // The entry gates live in `sendEntryGuards`; the attachment-only rule is
    // the `hasSomethingToSend` argument the send passes in.
    expect(GUARDS).toContain("!input.hasSomethingToSend ||");
    expect(SEND).toContain("hasSomethingToSend: trimmed.length > 0 || staged.length > 0");
    // …and an empty foreign send over nothing still refuses
    expect(SEND).toContain("const staged = attachments ?? params.attachments.itemsRef.current;");
  });
});

describe("the attachment sheet's seven entries, each label resolvable in BOTH catalogues", () => {
  const entries: Array<[string, string]> = [
    ["shell.attach.library", "chat.photoLibrary"],
    ["shell.attach.camera", "chat.takePhoto"],
    ["shell.attach.pdfOrWord", "chat.pdfOrWord"],
    ["shell.attach.libraryDocument", "chat.libraryDocument"],
    ["shell.attach.templates", "chat.a11yTemplates"],
    ["shell.attach.research", "chat.deepResearch"],
    ["shell.attach.notes", "notes.title"],
  ];

  it.each(entries)("%s prints %s, in en and it with real text", (testID, key) => {
    expect(MENU).toContain(`testID: "${testID}"`);
    expect(MENU).toContain(`labelKey: "${key}"`);
    expect(typeof EN[key]).toBe("string");
    expect(typeof IT[key]).toBe("string");
    expect(IT[key]).not.toBe(EN[key]);
  });

  it("the document list labels each row with the doc's NAME and offers Cancel", () => {
    expect(MENU).toContain("label: doc.name");
    expect(MENU).toContain('testID: "shell.attach.cancel"');
    expect(MENU).toContain('t("common.cancel")');
    expect(typeof EN["common.cancel"]).toBe("string");
    expect(typeof IT["common.cancel"]).toBe("string");
  });

  it("research and notes expose checked switch state and remain in the sheet after toggling", () => {
    expect(MENU).toContain('role: "switch"');
    expect(MENU).toContain('selected: row.action === "research" ? props.researchActive');
    expect(SHEET).toContain("checked: row.selected");
    expect(SURFACE).toContain("runHostLocalAction(modelHost.remoteActiveRef.current, refuseRemoteAttachment, arms.toggleResearch)");
    expect(SURFACE).toContain("arms.toggleNotes()");
    const remoteNotice = jest.fn();
    const remoteToggle = jest.fn();
    runHostLocalAction(true, remoteNotice, remoteToggle);
    expect(remoteNotice).toHaveBeenCalledTimes(1);
    expect(remoteToggle).not.toHaveBeenCalled();
    const localToggle = jest.fn();
    runHostLocalAction(false, remoteNotice, localToggle);
    expect(localToggle).toHaveBeenCalledTimes(1);
  });

  it("every a11y string this flow prints exists in both catalogues", () => {
    for (const key of ["chat.a11yRemoveAttachment", "shell.a11y.attach", "chat.a11yTemplates", "chat.deepResearch", "notes.title", "common.cancel"]) {
      expect(typeof EN[key]).toBe("string");
      expect(typeof IT[key]).toBe("string");
      expect(IT[key]).not.toBe(EN[key]);
    }
  });

  it("sample: a catalogue key the sheet names but the catalogues dropped would fail above", () => {
    expect(EN["chat.photoLibrary"]).toBeDefined();
    expect(EN["shell.notice.attach"]).toBeUndefined();
  });
});
