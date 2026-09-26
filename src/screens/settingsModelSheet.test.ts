/**
 * The Model sheet's row plan: phone models are the choices only in local
 * mode; in computer mode the sheet answers "what runs on the computer"
 * from the door probe and never offers a phone model as selectable.
 */

import { REMOTE_COMPUTER_MODEL_ID } from "../engine/remote/remoteComputerModel";
import {
  computerProbeFromResult,
  modelSheetRows,
  type ComputerModelProbe,
  type ModelSheetParams,
} from "./settingsModelSheet";

const LABELS = {
  computerName: "Model on your computer",
  checking: "Checking what your computer runs…",
  unknownModel: "Your computer did not report a model.",
};

const PHONE_OPTIONS = [
  { id: "qwen-3.5-4b", label: "Qwen 3.5 4B", detail: "Q4_K_M" },
  { id: "lfm2.5-2.6b", label: "LFM2.5 2.6B", detail: "QAD-Q4_0", disabled: true },
];

const okProbe: ComputerModelProbe = { state: "ok", modelId: "ornith" };

function params(overrides: Partial<ModelSheetParams> = {}): ModelSheetParams {
  return {
    remoteActive: false,
    phoneOptions: PHONE_OPTIONS,
    currentModelId: "qwen-3.5-4b",
    probe: okProbe,
    labels: LABELS,
    onSelectPhone: jest.fn(),
    onSelectComputer: jest.fn(),
    ...overrides,
  };
}

describe("local mode lists this phone's models", () => {
  test("every phone model keeps its label, gate and selection", () => {
    const onSelectPhone = jest.fn();
    const rows = modelSheetRows(params({ onSelectPhone }));

    expect(rows.map((row) => row.testID)).toEqual([
      "settings.sheet.model.qwen-3.5-4b",
      "settings.sheet.model.lfm2.5-2.6b",
    ]);
    expect(rows[0]).toMatchObject({ label: "Qwen 3.5 4B · Q4_K_M", selected: true, disabled: false });
    expect(rows[1]).toMatchObject({ selected: false, disabled: true });
    rows[1].onPress();
    expect(onSelectPhone).toHaveBeenCalledWith("lfm2.5-2.6b");
  });
});

describe("computer mode replaces the phone list with the computer's model", () => {
  test("no phone model row exists at all in computer mode", () => {
    const rows = modelSheetRows(params({ remoteActive: true, currentModelId: REMOTE_COMPUTER_MODEL_ID }));

    expect(rows).toHaveLength(1);
    expect(rows[0].testID).toBe("settings.sheet.model.computer");
    expect(rows.map((row) => row.label)).not.toContain("Qwen 3.5 4B · Q4_K_M");
  });

  test("the served model names the row and the row stays selectable", () => {
    const onSelectComputer = jest.fn();
    const rows = modelSheetRows(
      params({ remoteActive: true, currentModelId: REMOTE_COMPUTER_MODEL_ID, onSelectComputer }),
    );

    expect(rows[0]).toMatchObject({
      label: `${LABELS.computerName} · ornith`,
      selected: true,
      disabled: false,
    });
    rows[0].onPress();
    expect(onSelectComputer).toHaveBeenCalledTimes(1);
  });

  test("an unreachable computer says so in the row instead of a stale name", () => {
    const rows = modelSheetRows(
      params({
        remoteActive: true,
        currentModelId: REMOTE_COMPUTER_MODEL_ID,
        probe: { state: "unreachable", message: "Could not reach your computer." },
      }),
    );

    expect(rows[0].label).toBe("Could not reach your computer.");
    expect(rows[0].disabled).toBe(true);
  });

  test("while the probe runs, or reports nothing, the row is honest and inert", () => {
    const checking = modelSheetRows(
      params({ remoteActive: true, probe: { state: "checking" } }),
    );
    expect(checking[0]).toMatchObject({ label: LABELS.checking, disabled: true });

    const silent = modelSheetRows(
      params({ remoteActive: true, probe: { state: "ok", modelId: null } }),
    );
    expect(silent[0]).toMatchObject({ label: LABELS.unknownModel, disabled: true });
  });
});

describe("the probe verdict becomes row words", () => {
  const identity = (key: string) => key;

  test("a healthy probe prefers the configured id and falls back to what is served", () => {
    expect(computerProbeFromResult({ ok: true, modelId: "ornith", models: ["other"] }, identity))
      .toEqual({ state: "ok", modelId: "ornith" });
    expect(computerProbeFromResult({ ok: true, modelId: null, models: ["served"] }, identity))
      .toEqual({ state: "ok", modelId: "served" });
    expect(computerProbeFromResult({ ok: true, modelId: "", models: [] }, identity))
      .toEqual({ state: "ok", modelId: null });
  });

  test("a failed probe maps to human copy, never to an internal code", () => {
    const probe = computerProbeFromResult(
      { ok: false, modelId: null, error: "remote_brain_network" },
      identity,
    );

    expect(probe).toEqual({
      state: "unreachable",
      message: "settings.remoteBrainFailNetwork",
    });
  });
});
