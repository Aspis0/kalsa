/**
 * The mini-app definition across its three boundaries (D1 rows 4/28 and the
 * volatility rule): it IS persisted (the controller persisted it —
 * `historyMessages.ts`), the save → disk → restore → save cycle is
 * byte-stable (the hash contract of D2 row 2 runs over
 * `toPersistableHistoryMessages` output), the mapper hands the same envelope
 * to the transcript card, and the text-only migration still finds old
 * cards. Tool rows stay on the other side of this line: they are the
 * volatile capture and never enter the record (D1 row 23).
 */
import { normalizeMiniapp } from "../domain/askAssistant";
import { buildPersistableMessages, sanitizeHistoryMessages } from "./historyMessages";
import { toTranscriptMessage, type MapperOptions } from "./messageMapper";
import { validateHistoryMessages } from "./turnCorpus";
import type { Message } from "./hostMessage";

const opts: MapperOptions = { thinkingStatus: "Thinking" };

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
  actions: [{ id: "export_csv", label: "CSV" }],
  state: { reviewed: true },
};

function assistantWithMiniapp(): Message {
  const normalized = normalizeMiniapp(envelope);
  if (!normalized) throw new Error("fixture must normalize");
  return {
    id: "a1",
    role: "assistant",
    text: "Here is your quiz.",
    createdAt: 6,
    miniapp: normalized as Message["miniapp"],
  };
}

describe("a mini-app definition survives save → disk → restore → save", () => {
  test("byte-identically, so the frozen hash path still accepts the record", () => {
    const saved = buildPersistableMessages([assistantWithMiniapp()]);
    const onDisk = JSON.parse(JSON.stringify(saved)) as unknown;
    const restored = sanitizeHistoryMessages(onDisk, "en");

    expect(restored).toHaveLength(1);
    expect(restored[0].miniapp).toEqual(normalizeMiniapp(envelope));

    const resaved = buildPersistableMessages(restored);
    // The hash contract: both directions stringify the same shape
    // (`sessionPersistence.ts` hashes exactly this output).
    expect(JSON.stringify(resaved)).toBe(JSON.stringify(saved));
  });

  test("streaming never rides along with it (no live flag on a restored card)", () => {
    const live: Message = { ...assistantWithMiniapp(), streaming: true };
    const saved = buildPersistableMessages([live]);
    expect(saved).toEqual([]);
    const partial = buildPersistableMessages([live], { allowStreamingPartial: true });
    expect(partial).toHaveLength(1);
    expect(partial[0].streaming).toBeUndefined();
    expect(partial[0].miniapp).toEqual(normalizeMiniapp(envelope));
  });
});

describe("the transcript card's data (mapper, D1 row 28)", () => {
  test("an answer's envelope crosses whole to the transcript", () => {
    const restored = sanitizeHistoryMessages(
      JSON.parse(JSON.stringify(buildPersistableMessages([assistantWithMiniapp()]))),
      "en",
    );
    const mapped = toTranscriptMessage(restored[0], opts);
    expect(mapped.miniapp).toEqual(expect.objectContaining({
      schema: "miniapp_v1",
      kind: "quiz",
      title: "Photosynthesis quiz",
    }));
    // The full envelope rides at runtime — the sheet renders from THIS object.
    expect(mapped.miniapp).toHaveProperty("blocks");
    expect(mapped.miniapp).toHaveProperty("actions");
  });

  test("a user turn never carries a card", () => {
    const user: Message = {
      id: "u1",
      role: "user",
      text: "make me a quiz",
      createdAt: 5,
      miniapp: normalizeMiniapp(envelope) as Message["miniapp"],
    };
    const mapped = toTranscriptMessage(user, opts);
    expect(mapped.miniapp).toBeUndefined();
  });
});

describe("old histories whose mini-app lives only in the text (Chat:731-734)", () => {
  test("restore migrates the JSON out of the text and the card comes back", () => {
    const json = JSON.stringify(envelope);
    const restored = sanitizeHistoryMessages(
      [{ id: "a1", role: "assistant", text: `Your quiz is ready. ${json}`, createdAt: 7 }],
      "en",
    );
    expect(restored[0].miniapp).toEqual(expect.objectContaining({ kind: "quiz" }));
    expect(restored[0].text).not.toContain("miniapp_v1");
    const mapped = toTranscriptMessage(restored[0], opts);
    expect(mapped.miniapp).toEqual(expect.objectContaining({ title: "Photosynthesis quiz" }));
  });
});

describe("the widget state rides the envelope (save → restore → save)", () => {
  const checklist = () =>
    normalizeMiniapp({
      schema: "miniapp_v1",
      kind: "checklist",
      title: "Groceries",
      blocks: [
        {
          type: "checklist",
          items: [
            { id: "milk", title: "Milk" },
            { id: "eggs", title: "Eggs" },
          ],
        },
      ],
      state: { checked: { milk: true } },
    });

  test("a tick survives save → disk → restore → save byte-identically", () => {
    const ticked: Message = {
      id: "a1",
      role: "assistant",
      text: "Here is your list.",
      createdAt: 6,
      miniapp: checklist() as Message["miniapp"],
    };
    const saved = buildPersistableMessages([ticked]);
    const onDisk = JSON.parse(JSON.stringify(saved)) as unknown;
    const restored = sanitizeHistoryMessages(onDisk, "en");
    expect(restored[0].miniapp?.state).toEqual({ checked: { milk: true } });
    expect(restored[0].miniapp?.blocks[0]).toMatchObject({ type: "checklist" });

    const resaved = buildPersistableMessages(restored);
    expect(JSON.stringify(resaved)).toBe(JSON.stringify(saved));
  });

  test("an old timeline-shaped checklist restores as the tickable block, keyed by step index", () => {
    const restored = sanitizeHistoryMessages(
      [
        {
          id: "a1",
          role: "assistant",
          text: "Steps below.",
          createdAt: 7,
          miniapp: {
            schema: "miniapp_v1",
            kind: "checklist",
            title: "Setup",
            blocks: [{ type: "timeline", title: "Setup", steps: [{ title: "Install" }, { title: "Launch" }] }],
            state: { checked: { "1": true } },
          },
        },
      ],
      "en",
    );
    expect(restored[0].miniapp?.blocks[0]).toEqual({
      type: "checklist",
      title: "Setup",
      items: [
        { id: "0", title: "Install" },
        { id: "1", title: "Launch" },
      ],
    });
    expect(restored[0].miniapp?.state).toEqual({ checked: { "1": true } });
  });
});

describe("the state a later turn's history carries", () => {
  const tickedList: Message = {
    id: "a1",
    role: "assistant",
    text: "Here is your list.",
    createdAt: 8,
    miniapp: normalizeMiniapp({
      schema: "miniapp_v1",
      kind: "checklist",
      title: "Groceries",
      blocks: [
        {
          type: "checklist",
          items: [
            { id: "milk", title: "Milk" },
            { id: "eggs", title: "Eggs" },
          ],
        },
      ],
      state: { checked: { milk: true } },
    }) as Message["miniapp"],
  };

  test("the injected history text carries [x]", () => {
    const [rec] = validateHistoryMessages([tickedList]);
    expect(rec.text).toBe("Here is your list.\n[x] Milk\n[ ] Eggs");
  });

  test("modelEmittedText — the string both engines replay — carries it too", () => {
    const [rec] = validateHistoryMessages([
      { ...tickedList, modelEmittedText: "Here is your list." },
    ]);
    expect(rec.modelEmittedText).toBe("Here is your list.\n[x] Milk\n[ ] Eggs");
    // Provenance travels with the string, unchanged.
    expect(rec.emissionSource).toBeUndefined();
  });

  test("a message without a miniapp, and a user turn, carry no state lines", () => {
    const [plain] = validateHistoryMessages([{ ...tickedList, miniapp: undefined }]);
    expect(plain.text).toBe("Here is your list.");
    const [user] = validateHistoryMessages([
      { id: "u1", role: "user", text: "make me a list", createdAt: 7, miniapp: tickedList.miniapp },
    ]);
    expect(user.text).toBe("make me a list");
  });
});

test("restore gives a hand-written checklist safe, unique item ids", () => {
  const [restored] = sanitizeHistoryMessages(
    [
      {
        id: "a1",
        role: "assistant",
        text: "List below.",
        createdAt: 9,
        miniapp: {
          schema: "miniapp_v1",
          kind: "checklist",
          title: "Hand written",
          blocks: [
            {
              type: "checklist",
              items: [
                { id: "__proto__", title: "A" },
                { id: "milk", title: "B" },
                { id: "milk", title: "C" },
                { id: "x".repeat(65), title: "D" },
              ],
            },
          ],
        },
      },
    ],
    "en",
  );
  // Unsafe, duplicate and over-cap ids mint like the builder does; the
  // safe unique id is kept, and the tick it keys still resolves.
  expect(restored.miniapp?.blocks[0].items).toEqual([
    { id: "item-1", title: "A" },
    { id: "milk", title: "B" },
    { id: "item-2", title: "C" },
    { id: "item-3", title: "D" },
  ]);
});
