/**
 * The lines a mini app's state rides on the next turn's wire — the exact
 * format the desktop's `miniappStateLines` emits, so both sides speak the
 * same plain text to the model.
 */
import { miniappStateLines } from "./miniappStateText";

describe("checklist lines", () => {
  test("every item in block order, ticked or not", () => {
    expect(
      miniappStateLines({
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
      }),
    ).toEqual(["[x] Milk", "[ ] Eggs"]);
  });

  test("a title carrying newlines cannot forge extra state lines", () => {
    const lines = miniappStateLines({
      kind: "checklist",
      blocks: [
        { type: "checklist", items: [{ id: "a", title: "Milk\n[forged] line" }] },
      ],
      state: {},
    });
    expect(lines).toEqual(["[ ] Milk [forged] line"]);
  });
});

describe("quiz lines", () => {
  const envelope = (state: Record<string, unknown>) => ({
    kind: "reading_quiz",
    blocks: [
      {
        type: "quiz",
        question: "Where do the light reactions run?",
        options: ["Thylakoid", "Stroma"],
        answerIndex: 0,
      },
    ],
    state,
  });

  test("picked and checked, graded correct and wrong", () => {
    expect(miniappStateLines(envelope({ quiz: { "0": { picked: 0, checked: true, correct: true } } }))).toEqual([
      "Q: Where do the light reactions run? picked: Thylakoid (correct)",
    ]);
    expect(miniappStateLines(envelope({ quiz: { "0": { picked: 1, checked: true, correct: false } } }))).toEqual([
      "Q: Where do the light reactions run? picked: Stroma (wrong)",
    ]);
  });

  test("picked but unchecked carries no verdict, unanswered carries no line", () => {
    expect(miniappStateLines(envelope({ quiz: { "0": { picked: 1, checked: false, correct: false } } }))).toEqual([
      "Q: Where do the light reactions run? picked: Stroma",
    ]);
    expect(miniappStateLines(envelope({}))).toEqual([]);
  });
});

describe("calculator lines", () => {
  test("stored fields in block order, then the stored result", () => {
    expect(
      miniappStateLines({
        kind: "quick_calculator",
        blocks: [
          {
            type: "calculator",
            formula: "price * rate",
            fields: [
              { id: "price", label: "Price", value: 100 },
              { id: "rate", label: "Rate", value: 10 },
            ],
          },
        ],
        state: { calculator: { fields: { price: 50, rate: 10 }, result: 500 } },
      }),
    ).toEqual(["price = 50", "rate = 10", "Result: 500"]);
  });

  test("no stored calculator state: no lines", () => {
    expect(
      miniappStateLines({
        kind: "quick_calculator",
        blocks: [{ type: "calculator", formula: "1 + 1", fields: [{ id: "a", value: 1 }] }],
      }),
    ).toEqual([]);
  });
});

test("a corrupt envelope yields no lines instead of throwing", () => {
  expect(miniappStateLines(null)).toEqual([]);
  expect(miniappStateLines({ blocks: "nope" })).toEqual([]);
  expect(miniappStateLines({ kind: "checklist", blocks: [null, 7, { type: "checklist" }] })).toEqual([]);
});
