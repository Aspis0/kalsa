/**
 * The pill's where-choices as a table: which rows the sheet offers given the
 * pairing state, and what a press on one does. The pill's tap opens a STATUS
 * sheet — there is no local model catalog behind it — so choices exist only
 * where a second place can answer, and the strip may draw its chevron exactly
 * then. A press must be the Settings control's own switch (never a second
 * policy) and must be disabled while a turn generates, so no switch can
 * dispose the engine under a running answer.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { en } from "../i18n/en";
import { modelBarChoices } from "./modelBarChoices";

const read = (...parts: string[]) => readFileSync(join(__dirname, ...parts), "utf8");
const STRIP = read("..", "ui", "shell", "ShellStrip.tsx");
const SHEET = read("..", "ui", "shell", "ModelPillSheet.tsx");
const HOOK = read("useModelBar.ts");
const FURNITURE = read("HostFurniture.tsx");

const LABELS = { phone: en.shell.where.thisPhone, computer: en.shell.where.pillComputer };

function build(overrides: Partial<Parameters<typeof modelBarChoices>[0]> = {}) {
  return modelBarChoices({
    usablePairing: true,
    remoteActive: false,
    sending: false,
    localModelName: "LFM2.5 2.6B",
    labels: LABELS,
    selectLocation: () => true,
    ...overrides,
  });
}

describe("which places the pill's sheet offers", () => {
  test("one place to answer is no choice: no rows, so the strip draws no chevron", () => {
    expect(build({ usablePairing: false })).toEqual([]);
    // The pill keeps its status sheet (name, bar rows, retry) but claims no
    // picker, on screen and for a screen reader.
    expect(STRIP).toContain("const hasChoices = locationRows.length > 0;");
    expect(STRIP).toMatch(/hasChoices \? <ChevronDown/);
    expect(STRIP).toContain('t("shell.a11y.modelStatus"');
  });

  test("a usable pairing offers both places, the phone row naming the local model", () => {
    expect(build()).toEqual([
      {
        testID: "shell.modelSheet.location.phone",
        label: `${LABELS.phone} · LFM2.5 2.6B`,
        role: "radio",
        selected: true,
        disabled: false,
        onPress: expect.any(Function),
      },
      {
        testID: "shell.modelSheet.location.computer",
        label: LABELS.computer,
        role: "radio",
        selected: false,
        disabled: false,
        onPress: expect.any(Function),
      },
    ]);
  });

  test("the computer answering through a manual door keeps the chooser", () => {
    const rows = build({ usablePairing: false, remoteActive: true });
    expect(rows.map((row) => row.testID)).toEqual([
      "shell.modelSheet.location.phone",
      "shell.modelSheet.location.computer",
    ]);
    expect(rows.map((row) => row.selected)).toEqual([false, true]);
  });

  test("the rows reach the sheet: host to shell to strip to the drawn rows", () => {
    expect(read("HostChatSurface.tsx")).toContain("locationRows={modelBar.locationRows}");
    expect(read("..", "ui", "shell", "Shell.tsx")).toContain("locationRows={locationRows}");
    expect(STRIP).toContain("rows={locationRows}");
    expect(SHEET).toContain("rows.length > 0");
  });
});

describe("what a press does", () => {
  test("each row asks the Settings switch for its own place", () => {
    const selectLocation = jest.fn(() => true);
    const [phone, computer] = build({ selectLocation });

    phone.onPress();
    expect(selectLocation).toHaveBeenLastCalledWith("local");
    computer.onPress();
    expect(selectLocation).toHaveBeenLastCalledWith("remote");
    expect(selectLocation).toHaveBeenCalledTimes(2);
  });

  test("a refused switch is the Settings answer, and nothing else runs", () => {
    const selectLocation = jest.fn(() => false);
    build({ selectLocation })[1].onPress();
    expect(selectLocation).toHaveBeenCalledTimes(1);
    expect(selectLocation).toHaveBeenCalledWith("remote");
  });

  test("it is the SAME function the Settings rows call — one switch policy", () => {
    expect(HOOK).toContain("selectLocation: modelHost.selectLocation");
    expect(FURNITURE).toContain("selectLocation={modelHost.selectLocation}");
  });

  test("a choice dismisses the sheet: a refusal must not sit over its own notice", () => {
    expect(SHEET).toContain("<SheetRow");
    expect(SHEET).toMatch(/row\.onPress\(\);\s*\n\s*onClose\(\);/);
  });
});

describe("the running answer is never cut", () => {
  test("a generating turn disables both rows", () => {
    expect(build({ sending: true }).map((row) => row.disabled)).toEqual([true, true]);
  });

  test("the host hands in the composer's own generating state", () => {
    expect(read("HostChatSurface.tsx")).toContain(
      'useModelBar(modelHost, view.composer.face !== "send")',
    );
  });
});
