/**
 * Unit tests for the AppShell → EngineCallbacks bridge.
 *
 * onThinkingText was once silently dropped in the hand-written literal this
 * module replaced: optional on both sides, tsc blind, so three engine
 * producers were runtime no-ops while every suite stayed green. These tests
 * pin the bridge against that failure mode.
 */

import {
  ENGINE_CALLBACK_KEYS,
  bridgeEngineCallbacks,
} from "./engineCallbackBridge";

function build() {
  const ui = {
    onDelta: jest.fn(),
    onModelEmittedText: jest.fn(),
    onThinkingText: jest.fn(),
    onStatus: jest.fn(),
    onSources: jest.fn(),
    onMiniapp: jest.fn(),
    onActions: jest.fn(),
  };
  const hooks = {
    onDeltaFull: jest.fn(),
    mapSource: jest.fn((sources: any[]) => sources.map((s: any) => ({ mapped: s }))),
    onDone: jest.fn(),
    onError: jest.fn(),
  };
  return { ui, hooks, bridged: bridgeEngineCallbacks(ui, hooks) };
}

describe("engineCallbackBridge", () => {
  test("bridges every EngineCallbacks key — none silently dropped", () => {
    const { bridged } = build();
    for (const key of ENGINE_CALLBACK_KEYS) {
      expect(typeof bridged[key]).toBe("function");
    }
    // Pinned shape: a new EngineCallbacks key breaks the satisfies guard in
    // engineCallbackBridge.ts at tsc time, and this list here makes the drift
    // visible to a reader of the failure.
    expect(ENGINE_CALLBACK_KEYS).toEqual([
      "onDelta",
      "onStatus",
      "onTool",
      "onSources",
      "onMiniapp",
      "onModelEmittedText",
      "onThinkingText",
      "onDone",
      "onError",
    ]);
  });

  test("forwards onThinkingText (the once-dropped key)", () => {
    const { ui, bridged } = build();
    bridged.onThinkingText?.("the reasoning span");
    expect(ui.onThinkingText).toHaveBeenCalledWith("the reasoning span");
  });

  test("onDelta forwards delta+full and notifies the full tracker", () => {
    const { ui, hooks, bridged } = build();
    bridged.onDelta("tok", "stream");
    expect(ui.onDelta).toHaveBeenCalledWith("tok", "stream");
    expect(hooks.onDeltaFull).toHaveBeenCalledWith("stream");
  });

  test("onModelEmittedText forwards text AND provenance source verbatim", () => {
    const { ui, bridged } = build();
    bridged.onModelEmittedText?.("raw", "parsed");
    expect(ui.onModelEmittedText).toHaveBeenCalledWith("raw", "parsed");
    bridged.onModelEmittedText?.("partial", "raw");
    expect(ui.onModelEmittedText).toHaveBeenLastCalledWith("partial", "raw");
    bridged.onStatus?.({ label: "Sto pensando" });
    expect(ui.onStatus).toHaveBeenCalledWith({ label: "Sto pensando" });
    bridged.onMiniapp?.({ kind: "miniapp_v1" });
    expect(ui.onMiniapp).toHaveBeenCalledWith({ kind: "miniapp_v1" });
  });

  test("onSources maps through mapSource", () => {
    const { ui, hooks, bridged } = build();
    bridged.onSources?.([{ url: "https://x" } as any]);
    expect(hooks.mapSource).toHaveBeenCalledWith([{ url: "https://x" }]);
    expect(ui.onSources).toHaveBeenCalledWith([{ mapped: { url: "https://x" } }]);
  });

  test("onTool arrives as an onActions tool payload", () => {
    const { ui, bridged } = build();
    bridged.onTool?.({ name: "web_search" });
    expect(ui.onActions).toHaveBeenCalledWith({
      kind: "tool",
      tool: { name: "web_search" },
    });
  });

  test("onDone/onError land on the hooks", () => {
    const { hooks, bridged } = build();
    const err = new Error("boom");
    bridged.onDone();
    bridged.onError(err);
    expect(hooks.onDone).toHaveBeenCalledTimes(1);
    expect(hooks.onError).toHaveBeenCalledWith(err);
  });
});
