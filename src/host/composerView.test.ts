/**
 * `composerView`'s attachment answers — each test names the wrong control it
 * catches: a send face dimmed over an attachment-only send, chips drawn from
 * a parallel shape instead of `composerState`'s, or a converting PDF that
 * fails to hold the composer.
 */
import type { ModelPipelineState } from "./hostPipelineState";
import { composerView, type ComposerViewInput } from "./composerView";
import type { LocalAttachment, Message } from "./hostMessage";

const fisica: LocalAttachment = {
  id: "d",
  kind: "document",
  name: "fisica.pdf",
  uri: "",
  libraryDocId: "doc-1",
};
const shot: LocalAttachment = { id: "i", kind: "image", name: "shot.jpg", uri: "file:///s" };

function input(over: Partial<ComposerViewInput> = {}): ComposerViewInput {
  return {
    messages: [] as Message[],
    toolsById: new Map(),
    draft: "",
    thinkingStatus: "thinking…",
    coolingStatus: "Cooling down",
    historyLoaded: true,
    thermalGated: false,
    sending: false,
    stopping: false,
    hasTokens: false,
    translating: false,
    modelState: "ready" as ModelPipelineState,
    engineResident: true,
    attachments: [],
    converting: false,
    ...over,
  };
}

describe("a live cooling status label is the governor's pause, not writing", () => {
  it("holds with the cooling line while the face stays an enabled stop", () => {
    const view = composerView(
      input({
        sending: true,
        messages: [
          {
            id: "a1",
            role: "assistant",
            text: "",
            streaming: true,
            statusLabel: "Cooling down",
            createdAt: 0,
          } as Message,
        ],
      }),
    );
    expect(view.composer.hold).toBe("shell.held.cooling");
    expect(view.composer.face).toBe("stop");
    expect(view.composer.faceEnabled).toBe(true);
    expect(view.sendEnabled).toBe(false);
    expect(view.composer.field.editable).toBe(true);
  });
});

describe("the send face counts rows as something to send (controller Chat:3603)", () => {
  it("attachment-only, machine idle → the face is enabled", () => {
    expect(composerView(input({ attachments: [fisica] })).sendEnabled).toBe(true);
  });

  it("empty draft AND empty rows → the face dims with no reason line", () => {
    const view = composerView(input());
    expect(view.sendEnabled).toBe(false);
    expect(view.composer.hold).toBeNull();
  });

  it("a translate still holds the face even over staged rows", () => {
    expect(composerView(input({ attachments: [fisica], translating: true })).sendEnabled).toBe(
      false,
    );
  });

  it("a live run holds the face (machine refusal), rows or not", () => {
    expect(composerView(input({ attachments: [fisica], sending: true })).sendEnabled).toBe(false);
  });
});

describe("a ready model the engine does not hold (the idle unload) still sends", () => {
  it("keeps the face enabled over a typed draft — the send reloads through ensure", () => {
    const view = composerView(input({ engineResident: false, draft: "ciao" }));
    expect(view.sendEnabled).toBe(true);
    expect(view.composer.hold).toBeNull();
    expect(view.composer.faceEnabled).toBe(true);
  });

  it("a missing or error model still holds with the unloaded line", () => {
    for (const modelState of ["missing", "error"] as const) {
      const view = composerView(input({ modelState, draft: "ciao" }));
      expect(view.sendEnabled).toBe(false);
      expect(view.composer.hold).toBe("shell.held.unloaded");
    }
  });

  it("once the send's reload is running, the prefill line holds (truthful while it reloads)", () => {
    const view = composerView(input({ engineResident: false, draft: "ciao", sending: true }));
    expect(view.sendEnabled).toBe(false);
    expect(view.composer.hold).toBe("shell.held.prefill");
  });
});

describe("a converting PDF is the composer's own phase (controller Chat:3620)", () => {
  it("holds with `converting` and refuses the send", () => {
    const view = composerView(input({ converting: true }));
    expect(view.composer.hold).toBe("shell.held.converting");
    expect(view.composer.canSend).toBe(false);
    expect(view.sendEnabled).toBe(false);
    // typing survives the wait (§2.7 — only sending is held)
    expect(view.composer.field.editable).toBe(true);
  });

  it("not converting never says converting", () => {
    expect(composerView(input()).composer.hold).toBeNull();
  });
});

describe("the chips are `composerState`'s shape, one per row (§2.7)", () => {
  it("each chip is the labelled view with the trimmed name inside — never a bare filename", () => {
    const view = composerView(
      input({ attachments: [fisica, { ...shot, name: "  shot.jpg " }] }),
    );
    expect(view.attachmentChips).toEqual([
      { key: "shell.composer.attachment", params: { name: "fisica.pdf" } },
      { key: "shell.composer.attachment", params: { name: "shot.jpg" } },
    ]);
  });

  it("a blank name cannot produce a chip (it would be a rebus)", () => {
    expect(composerView(input({ attachments: [{ ...shot, name: "   " }] })).attachmentChips).toEqual([]);
    expect(composerView(input()).attachmentChips).toEqual([]);
  });

  it("the single `attachment` field names the last-staged file", () => {
    const view = composerView(input({ attachments: [fisica, shot] }));
    expect(view.composer.attachment).toEqual({
      key: "shell.composer.attachment",
      params: { name: "shot.jpg" },
    });
    expect(composerView(input()).composer.attachment).toBeNull();
  });
});
