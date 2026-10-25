import { buildMiniappV1 } from "./miniappBuilders";
import { quickCalculatorRefusal } from "./miniappQuickCalculator";

describe("create_miniapp builder: quick_calculator", () => {
  test("quick_calculator → calculator with formula", () => {
    const miniapp = buildMiniappV1("quick_calculator", {
      formula: "a + b * r",
      fields: [
        { id: "a", label: "Principal", value: 1000 },
        { id: "b", label: "Rate", value: 5 },
        { id: "r", label: "Step", value: 0.1 },
      ],
    });
    expect(miniapp).not.toBeNull();
    // Fields given: nothing is lifted, the formula reads the fields as they are.
    expect(miniapp?.blocks[0]).toMatchObject({ type: "calculator", formula: "a + b * r" });
    expect((miniapp?.blocks[0] as any).fields).toEqual([
      { id: "a", label: "Principal", value: 1000 },
      { id: "b", label: "Rate", value: 5 },
      { id: "r", label: "Step", value: 0.1 },
    ]);
    // The initial values and result seed the envelope's state: the next
    // turn's wire carries them before anyone edits anything.
    expect(miniapp?.state).toEqual({ calculator: { fields: { a: 1000, b: 5, r: 0.1 }, result: 1000.5 } });
  });

  test("quick_calculator rejects a missing formula", () => {
    expect(buildMiniappV1("quick_calculator", { fields: [] })).toBeNull();
    expect(buildMiniappV1("quick_calculator", {})).toBeNull();
  });

  test("quick_calculator lifts every bare literal into an editable field", () => {
    const miniapp = buildMiniappV1("quick_calculator", { formula: "50 / 4" });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.blocks[0]).toMatchObject({ type: "calculator", formula: "n1 / n2" });
    expect((miniapp?.blocks[0] as any).fields).toEqual([
      { id: "n1", value: 50 },
      { id: "n2", value: 4 },
    ]);
    expect(miniapp?.state).toEqual({ calculator: { fields: { n1: 50, n2: 4 }, result: 12.5 } });
  });

  test("an empty field list lifts like no fields at all", () => {
    const miniapp = buildMiniappV1("quick_calculator", { formula: "50 / 4", fields: [] });
    expect(miniapp?.blocks[0]).toMatchObject({ formula: "n1 / n2" });
  });

  test("a lifted id never shadows an identifier the formula already uses", () => {
    // With no fields, n1 is unknown to the evaluator, so the build is refused
    // rather than reading the model's n1 as the lifted literal.
    expect(buildMiniappV1("quick_calculator", { formula: "n1 + 5" })).toBeNull();
  });

  test("digits inside identifiers lift nothing", () => {
    // The 0 of f0 belongs to the identifier; a lifted 0 would need a field of 0.
    const identifier = buildMiniappV1("quick_calculator", {
      formula: "f0 + 1",
      fields: [
        { id: "f0", label: "F", value: 2 },
        { id: "one", label: "One", value: 1 },
      ],
    });
    expect(identifier?.blocks[0]).toMatchObject({ formula: "f0 + one" });
  });

  test("a field value may write its decimal with a comma, and a literal matches it", () => {
    const miniapp = buildMiniappV1("quick_calculator", {
      formula: "a * 2",
      fields: [
        { id: "a", label: "A", value: "1,5" },
        { id: "two", label: "Two", value: "2,0" },
      ],
    });
    expect(miniapp?.blocks[0]).toMatchObject({ formula: "a * two" });
    expect(miniapp?.state).toEqual({ calculator: { fields: { a: 1.5, two: 2 }, result: 3 } });
  });

  test("quick_calculator rejects an invalid formula (F3)", () => {
    // Unbalanced parens / bad charset / referencing an unknown field id.
    expect(buildMiniappV1("quick_calculator", { formula: "a + " })).toBeNull();
    expect(buildMiniappV1("quick_calculator", { formula: "a @ b" })).toBeNull();
    expect(
      buildMiniappV1("quick_calculator", {
        formula: "x + 1",
        fields: [{ id: "a", label: "A", value: 1 }],
      }),
    ).toBeNull();
  });

  test("quick_calculator rejects empty or duplicate field ids (F4)", () => {
    expect(
      buildMiniappV1("quick_calculator", {
        formula: "a + b",
        fields: [{ label: "A", value: 1 }], // no id
      }),
    ).toBeNull();
    expect(
      buildMiniappV1("quick_calculator", {
        formula: "a + b",
        fields: [
          { id: "a", label: "A", value: 1 },
          { id: "a", label: "A2", value: 2 },
        ],
      }),
    ).toBeNull();
  });

  test("quick_calculator rejects unsafe or over-cap field ids (F4)", () => {
    for (const id of ["__proto__", "constructor", "x".repeat(65)]) {
      expect(
        buildMiniappV1("quick_calculator", {
          formula: "f + 1",
          fields: [{ id, label: "F", value: 1 }],
        }),
      ).toBeNull();
    }
  });

  test("quick_calculator rejects a field list past the renderer's cap", () => {
    const fields = Array.from({ length: 25 }, (_, i) => ({
      id: `f${i}`,
      label: `F${i}`,
      value: i,
    }));
    expect(buildMiniappV1("quick_calculator", { formula: "f0", fields })).toBeNull();
    // Every one of the 24 fields is used, so none is a dead input.
    const formula = fields.slice(0, 24).map((field) => field.id).join(" + ");
    expect(
      buildMiniappV1("quick_calculator", {
        formula,
        fields: fields.slice(0, 24),
      }),
    ).not.toBeNull();
  });

  test("the owner's case: 50 stays a constant, and the field it leaves dead is refused", () => {
    const slots = {
      formula: "50 / 4",
      fields: [
        { id: "start", label: "Valore iniziale", value: 60 },
        { id: "div", label: "Divisore", value: 4 },
      ],
    };
    expect(buildMiniappV1("quick_calculator", slots)).toBeNull();
    expect(quickCalculatorRefusal(slots)).toBe(
      "create_miniapp: the field start is not used in the formula. Every field must appear in it; drop the ones that do not.",
    );
  });

  test("a bare number equal to a field's value is written as that field's id", () => {
    const miniapp = buildMiniappV1("quick_calculator", {
      formula: "50 / b",
      fields: [
        { id: "a", label: "A", value: 50 },
        { id: "b", label: "B", value: 4 },
      ],
    });
    expect(miniapp?.blocks[0]).toMatchObject({ formula: "a / b" });
    expect(miniapp?.state).toEqual({ calculator: { fields: { a: 50, b: 4 }, result: 12.5 } });
  });

  test("a literal equal to a field the formula already names stays a constant", () => {
    // `a` is 1 and the literal is 1, but the formula names `a`: the 1 is not
    // read as a second `a` ("a + a"), so `b` is left dead and refused.
    const slots = {
      formula: "a + 1",
      fields: [
        { id: "a", label: "A", value: 1 },
        { id: "b", label: "B", value: 5 },
      ],
    };
    expect(buildMiniappV1("quick_calculator", slots)).toBeNull();
    expect(quickCalculatorRefusal(slots)).toBe(
      "create_miniapp: the field b is not used in the formula. Every field must appear in it; drop the ones that do not.",
    );
  });

  test("an unknown identifier is refused, naming it", () => {
    const slots = {
      formula: "a / c",
      fields: [
        { id: "a", label: "A", value: 1 },
        { id: "b", label: "B", value: 2 },
      ],
    };
    expect(buildMiniappV1("quick_calculator", slots)).toBeNull();
    expect(quickCalculatorRefusal(slots)).toBe(
      "create_miniapp: the formula references c, which is not one of the fields. Write the formula from the field ids you gave.",
    );
  });

  test("a field the formula never uses is refused as a dead input, naming it", () => {
    const slots = {
      formula: "a + 2",
      fields: [
        { id: "a", label: "A", value: 1 },
        { id: "b", label: "B", value: 2 },
        { id: "c", label: "C", value: 3 },
      ],
    };
    expect(buildMiniappV1("quick_calculator", slots)).toBeNull();
    expect(quickCalculatorRefusal(slots)).toBe(
      "create_miniapp: the field c is not used in the formula. Every field must appear in it; drop the ones that do not.",
    );
  });

  test("a formula that is merely malformed keeps the generic refusal", () => {
    expect(quickCalculatorRefusal({ formula: "a + ", fields: [{ id: "a", value: 1 }] })).toBeNull();
  });

  test("a literal no free field holds stays a constant: amount * 1.22", () => {
    const miniapp = buildMiniappV1("quick_calculator", {
      formula: "amount * 1.22",
      fields: [{ id: "amount", label: "Amount", value: 10 }],
    });
    expect(miniapp?.blocks[0]).toMatchObject({ formula: "amount * 1.22" });
    expect(miniapp?.state).toEqual({ calculator: { fields: { amount: 10 }, result: 12.2 } });
  });

  test("a literal substitutes only a field the formula does not reference yet", () => {
    // a + 4 with a=4 and b=4 becomes a + b: substituting the 4 for `a` would
    // leave `b` dead.
    const miniapp = buildMiniappV1("quick_calculator", {
      formula: "a + 4",
      fields: [
        { id: "a", label: "A", value: 4 },
        { id: "b", label: "B", value: 4 },
      ],
    });
    expect(miniapp?.blocks[0]).toMatchObject({ formula: "a + b" });
    expect(miniapp?.state).toEqual({ calculator: { fields: { a: 4, b: 4 }, result: 8 } });
  });

  test("a unary minus matches a negative field and is absorbed into it", () => {
    const fields = [
      { id: "discount", label: "Discount", value: -5 },
      { id: "quantity", label: "Quantity", value: 3 },
    ];
    const leading = buildMiniappV1("quick_calculator", { formula: "-5 * quantity", fields });
    expect(leading?.blocks[0]).toMatchObject({ formula: "discount * quantity" });
    expect(leading?.state).toEqual({ calculator: { fields: { discount: -5, quantity: 3 }, result: -15 } });

    const parenthesised = buildMiniappV1("quick_calculator", { formula: "quantity * (-5)", fields });
    expect(parenthesised?.blocks[0]).toMatchObject({ formula: "quantity * (discount)" });
  });

  test("a binary minus stays a positive constant", () => {
    const negativeField = buildMiniappV1("quick_calculator", {
      formula: "a - 5",
      fields: [
        { id: "a", label: "A", value: 10 },
        { id: "neg", label: "Neg", value: -5 },
      ],
    });
    expect(negativeField).toBeNull();

    const positiveField = buildMiniappV1("quick_calculator", {
      formula: "a - 5",
      fields: [
        { id: "a", label: "A", value: 10 },
        { id: "five", label: "Five", value: 5 },
      ],
    });
    expect(positiveField?.blocks[0]).toMatchObject({ formula: "a - five" });
  });

  test("a unary minus that matches no field stays a constant", () => {
    const miniapp = buildMiniappV1("quick_calculator", {
      formula: "-1.5 * quantity",
      fields: [{ id: "quantity", label: "Quantity", value: 2 }],
    });
    expect(miniapp?.blocks[0]).toMatchObject({ formula: "-1.5 * quantity" });
    expect(miniapp?.state).toEqual({ calculator: { fields: { quantity: 2 }, result: -3 } });
  });

  test("a calculator stores the title it was given, and none otherwise", () => {
    const named = buildMiniappV1("quick_calculator", {
      title: "Mutuo",
      formula: "a * 2",
      fields: [{ id: "a", label: "A", value: 1 }],
    });
    expect(named?.title).toBe("Mutuo");
    expect(buildMiniappV1("quick_calculator", { formula: "2 * 3" })?.title).toBe("");
  });
});
