import {
  canRegen,
  editedFlagForResend,
  findRegenTarget,
  type RegenCandidate,
} from "./regenTarget";

const transcript: RegenCandidate[] = [
  { id: "u1", role: "user", text: "first question" },
  { id: "a1", role: "assistant", text: "first answer" },
  { id: "u2", role: "user", text: "second question" },
  { id: "a2", role: "assistant", text: "second answer" },
];

describe("canRegen gating", () => {
  it("shows the row only for an assistant message while idle", () => {
    expect(canRegen("assistant", false)).toBe(true);
  });

  it("hides the row while sending", () => {
    expect(canRegen("assistant", true)).toBe(false);
  });

  it("hides the row for user messages", () => {
    expect(canRegen("user", false)).toBe(false);
  });
});

describe("editedFlagForResend", () => {
  it("defaults to true so Edit -> Save keeps the badge", () => {
    expect(editedFlagForResend()).toBe(true);
  });

  it("stays true when edited is explicitly true", () => {
    expect(editedFlagForResend({ edited: true })).toBe(true);
  });

  it("is false for Regenerate, which resends unchanged text", () => {
    expect(editedFlagForResend({ edited: false })).toBe(false);
  });
});

describe("findRegenTarget", () => {
  it("returns the nearest preceding user id and text", () => {
    expect(findRegenTarget(transcript, "a2")).toEqual({
      id: "u2",
      text: "second question",
    });
  });

  it("skips back over prior assistant turns to the right user", () => {
    expect(findRegenTarget(transcript, "a1")).toEqual({
      id: "u1",
      text: "first question",
    });
  });

  it("returns null when no user message precedes the assistant", () => {
    const orphan: RegenCandidate[] = [
      { id: "a1", role: "assistant", text: "answer with no user turn" },
    ];
    expect(findRegenTarget(orphan, "a1")).toBeNull();
  });

  it("returns null for an unknown assistant id", () => {
    expect(findRegenTarget(transcript, "missing")).toBeNull();
  });
});
