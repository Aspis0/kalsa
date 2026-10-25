import { resolveAdmissionModel } from "./admissionModel";

describe("resolveAdmissionModel", () => {
  test.each([
    [
      "active selected",
      { activeModelId: "A", lostModelId: null, selectedModelId: "A" },
      { mid: "A", alreadyResidentPossible: true },
    ],
    [
      "active differs from selected",
      { activeModelId: "A", lostModelId: null, selectedModelId: "B" },
      { mid: "B", alreadyResidentPossible: false },
    ],
    [
      "lost differs from selected",
      { activeModelId: null, lostModelId: "A", selectedModelId: "B" },
      { mid: "B", alreadyResidentPossible: false },
    ],
    [
      "cold selected",
      { activeModelId: null, lostModelId: null, selectedModelId: "B" },
      { mid: "B", alreadyResidentPossible: false },
    ],
  ])("resolves %s", (_name, input, expected) => {
    expect(resolveAdmissionModel(input)).toEqual(expected);
  });
});
