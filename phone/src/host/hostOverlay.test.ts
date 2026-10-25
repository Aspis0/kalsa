/**
 * The overlay union's mini-app half (`hostOverlay.ts`): the restored kind
 * and the controller's open policy (`AppShell.tsx:7035-7046`), pinned as
 * behaviour — an exclusive overlay wins, a live sheet is replaced, and a
 * payload the domain layer refuses opens nothing (never a sheet of garbage).
 */
import { withMiniappOverlay, type HostOverlay } from "./hostOverlay";

const envelope = {
  schema: "miniapp_v1",
  kind: "quiz",
  title: "Photosynthesis quiz",
  blocks: [
    {
      id: "b1",
      type: "quiz",
      question: "Where do the light reactions run?",
      options: ["Thylakoid", "Stroma"],
      answerIndex: 0,
    },
  ],
};

describe("withMiniappOverlay — the controller's open policy (App:7035-7046)", () => {
  test("from nothing, the sheet opens with a normalized envelope", () => {
    const next = withMiniappOverlay(null, envelope);
    expect(next).toEqual({ kind: "miniapp", miniapp: expect.objectContaining({
      schema: "miniapp_v1",
      kind: "quiz",
      title: "Photosynthesis quiz",
    }) });
  });

  test("an exclusive overlay wins: the open is ignored, the overlay object itself is kept", () => {
    for (const previous of [
      { kind: "settings" },
      { kind: "notes", focusId: "n-1" },
      { kind: "personas" },
      { kind: "documents" },
    ] as HostOverlay[]) {
      const next = withMiniappOverlay(previous, envelope);
      expect(next).toBe(previous);
    }
  });

  test("a mini-app already open is replaced, not stacked", () => {
    const first = withMiniappOverlay(null, envelope);
    const second = withMiniappOverlay(first, { ...envelope, title: "Second quiz" });
    expect(second).toEqual(
      expect.objectContaining({ kind: "miniapp", miniapp: expect.objectContaining({ title: "Second quiz" }) }),
    );
  });

  test("a payload the domain layer refuses opens nothing", () => {
    expect(withMiniappOverlay(null, null)).toBeNull();
    expect(withMiniappOverlay(null, {})).toBeNull();
    expect(withMiniappOverlay(null, { schema: "miniapp_v1" })).toBeNull();
    expect(withMiniappOverlay(null, "garbage")).toBeNull();
  });
});
