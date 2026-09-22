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
