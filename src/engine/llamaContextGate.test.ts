import {
  isChatModel2BClass,
  isChatModel4BClass,
} from "./llamaContextGate";

describe("chat model size-class helpers", () => {
  it("uses ModelInfo.sizeClass for the two listed chat models", () => {
    expect(isChatModel2BClass("lfm2.5-2.6b")).toBe(true);
    expect(isChatModel4BClass("lfm2.5-2.6b")).toBe(false);
    expect(isChatModel2BClass("qwen3.5-4b")).toBe(false);
    expect(isChatModel4BClass("qwen3.5-4b")).toBe(true);
  });

  it("does not classify stale or unknown ids as the default model", () => {
    expect(isChatModel2BClass("removed-model")).toBe(false);
    expect(isChatModel4BClass("removed-model")).toBe(false);
    expect(isChatModel2BClass(null)).toBe(false);
    expect(isChatModel4BClass(undefined)).toBe(false);
  });
});
