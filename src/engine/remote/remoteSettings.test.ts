import { validateServedModel } from "./remoteSettings";

describe("validateServedModel", () => {
  test("requires a configured id", () => {
    expect(validateServedModel("", ["ornith"])).toBe("remote_brain_model_required");
    expect(validateServedModel("  ", [])).toBe("remote_brain_model_required");
  });

  test("rejects an id not on the server", () => {
    expect(validateServedModel("nope", ["ornith", "other"])).toBe(
      "remote_brain_model_missing",
    );
  });

  test("accepts a matching id", () => {
    expect(validateServedModel("ornith", ["ornith"])).toBeNull();
  });

  test("skips membership when the server list is empty", () => {
    expect(validateServedModel("ornith", [])).toBeNull();
  });
});
