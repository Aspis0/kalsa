import { buildMiniappV1 } from "./miniappBuilders";

describe("create_miniapp builder (buildMiniappV1)", () => {
  test("compare_data → data_table with columns", () => {
    const miniapp = buildMiniappV1("compare_data", {
      title: "Plan comparison",
      columns: ["Free", "Pro"],
      rows: [
        { storage: "5 GB", "price": "$0" },
        { storage: "100 GB", "price": "$10" },
      ],
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.schema).toBe("miniapp_v1");
    expect(miniapp?.title).toBe("Plan comparison");
    expect(miniapp?.blocks[0]).toMatchObject({
      type: "data_table",
      columns: ["Free", "Pro"],
    });
  });

  test("compare_data rejects missing/empty columns", () => {
    expect(buildMiniappV1("compare_data", { rows: [] })).toBeNull();
    expect(buildMiniappV1("compare_data", { columns: [] })).toBeNull();
    expect(buildMiniappV1("compare_data", { columns: "nope" })).toBeNull();
  });

  test("compare_data rejects a non-array rows value", () => {
    expect(buildMiniappV1("compare_data", { columns: ["a"], rows: {} })).toBeNull();
  });

  test("reading_quiz → one quiz block per question (N questions)", () => {
    const miniapp = buildMiniappV1("reading_quiz", {
      title: "Geo quiz",
      questions: [
        { question: "Capital of France?", options: ["Berlin", "Paris", "Rome"], answerIndex: 1 },
        { question: "2+2?", options: ["3", "4"], answerIndex: 1 },
      ],
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.blocks).toHaveLength(2);
    expect(miniapp?.blocks[0]).toMatchObject({
      type: "quiz",
      question: "Capital of France?",
      options: ["Berlin", "Paris", "Rome"],
      answerIndex: 1,
    });
    expect(miniapp?.blocks[1]).toMatchObject({ type: "quiz", question: "2+2?" });
  });

  test("reading_quiz emits 8 quiz blocks at the cap", () => {
    const questions = Array.from({ length: 8 }, (_, i) => ({
      question: `Q${i}`,
      options: ["A", "B"],
    }));
    const miniapp = buildMiniappV1("reading_quiz", { questions });
    expect(miniapp?.blocks).toHaveLength(8);
    expect(miniapp?.blocks[7]).toMatchObject({ type: "quiz", question: "Q7" });
  });

  test("reading_quiz rejects 0 questions", () => {
    expect(buildMiniappV1("reading_quiz", { questions: [] })).toBeNull();
  });

  test("reading_quiz rejects 9 questions (over the 1..8 cap)", () => {
    const questions = Array.from({ length: 9 }, (_, i) => ({
      question: `Q${i}`,
      options: ["A", "B"],
    }));
    expect(buildMiniappV1("reading_quiz", { questions })).toBeNull();
  });

  test("reading_quiz rejects a question with fewer than 2 options", () => {
    expect(
      buildMiniappV1("reading_quiz", { questions: [{ question: "Q?", options: ["A"] }] }),
    ).toBeNull();
  });

  test("reading_quiz rejects a question with more than 4 options (F2)", () => {
    // >4 options would truncate to 4 and invalidate a safe answerIndex, so the
    // builder rejects the slots outright instead of producing a broken quiz.
    expect(
      buildMiniappV1("reading_quiz", {
        questions: [{ question: "Q?", options: ["A", "B", "C", "D", "E"], answerIndex: 4 }],
      }),
    ).toBeNull();
  });

  test("reading_quiz disables grading per-question when answerIndex is out of range", () => {
    const miniapp = buildMiniappV1("reading_quiz", {
      questions: [
        { question: "Q1?", options: ["A", "B"], answerIndex: 5 },
        { question: "Q2?", options: ["A", "B"], answerIndex: 0 },
      ],
    });
    // First question's index 5 addresses no option → grading disabled (null);
    // second question's index 0 is valid.
    expect(miniapp?.blocks[0].answerIndex).toBeNull();
    expect(miniapp?.blocks[1].answerIndex).toBe(0);
  });

  test("reading_quiz rejects a question missing its text", () => {
    expect(
      buildMiniappV1("reading_quiz", { questions: [{ options: ["A", "B"] }] }),
    ).toBeNull();
  });

  test("reading_quiz rejects a non-array questions value", () => {
    expect(buildMiniappV1("reading_quiz", { questions: "nope" })).toBeNull();
  });

  test("checklist → tickable items with minted ids", () => {
    const miniapp = buildMiniappV1("checklist", {
      title: "Setup",
      steps: ["Install", "Configure", "Launch"],
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.kind).toBe("checklist");
    expect(miniapp?.blocks[0]).toMatchObject({ type: "checklist", title: "Setup" });
    expect((miniapp?.blocks[0] as any).items).toEqual([
      { id: "item-1", title: "Install" },
      { id: "item-2", title: "Configure" },
      { id: "item-3", title: "Launch" },
    ]);
  });

  test("checklist keeps provided ids and mints the rest", () => {
    const miniapp = buildMiniappV1("checklist", {
      items: [{ id: "milk", title: "Buy milk" }, { title: "No id" }, "plain step"],
    });
    expect((miniapp?.blocks[0] as any).items).toEqual([
      { id: "milk", title: "Buy milk" },
      { id: "item-1", title: "No id" },
      { id: "item-2", title: "plain step" },
    ]);
  });

  test("checklist mints over a colliding, unsafe or over-cap id", () => {
    const colliding = buildMiniappV1("checklist", {
      items: [{ id: "item-1", title: "A" }, { id: "item-1", title: "B" }],
    });
    expect((colliding?.blocks[0] as any).items.map((item: any) => item.id)).toEqual(["item-1", "item-2"]);
    const unsafe = buildMiniappV1("checklist", {
      items: [
        { id: "__proto__", title: "A" },
        { id: "constructor", title: "B" },
        { id: "x".repeat(65), title: "C" },
      ],
    });
    expect((unsafe?.blocks[0] as any).items.map((item: any) => item.id)).toEqual([
      "item-1",
      "item-2",
      "item-3",
    ]);
  });

  test("checklist promotes body to the visible title and drops it (F-3)", () => {
    const miniapp = buildMiniappV1("checklist", {
      items: [
        { title: "Step 1", body: "do it" },
        { body: "Only body" },
        "plain step",
      ],
    });
    expect((miniapp?.blocks[0] as any).items.map((item: any) => item.title)).toEqual([
      "Step 1",
      "Only body",
      "plain step",
    ]);
    expect(((miniapp?.blocks[0] as any).items[0] as any).body).toBeUndefined();
    expect(buildMiniappV1("checklist", { steps: [] })).toBeNull();
    expect(buildMiniappV1("checklist", { steps: [{}] })).toBeNull(); // no title/body
    expect(buildMiniappV1("checklist", {})).toBeNull();
  });

  test("checklist rejects more than 12 steps", () => {
    const steps = Array.from({ length: 13 }, (_, i) => `S${i}`);
    expect(buildMiniappV1("checklist", { steps })).toBeNull();
  });

  test("unknown template → null", () => {
    expect(buildMiniappV1("not_a_template", {})).toBeNull();
  });

  test("the removed templates are rejected, not silently rebuilt", () => {
    expect(buildMiniappV1("kpi_strip", { metrics: [{ label: "L", value: 1 }] })).toBeNull();
    expect(buildMiniappV1("pros_cons", { rows: [{ pro: "fast" }] })).toBeNull();
  });

  // ── F-5: per-field string cap + per-block 64 KiB serialized guard ──

  test("F-5: a single oversized required field rejects the whole build", () => {
    const overCap = "x".repeat(5000); // > MAX_SLOT_CHARS (4000)
    // required scalar field (quiz question) rejected per-field
    expect(
      buildMiniappV1("reading_quiz", {
        questions: [{ question: overCap, options: ["A", "B"] }],
      }),
    ).toBeNull();
    // oversized plain-string checklist step rejected per-field
    expect(buildMiniappV1("checklist", { steps: [overCap] })).toBeNull();
    // a normal step (under the cap) still builds
    expect(
      buildMiniappV1("checklist", { steps: ["Install", "Configure"] }),
    ).not.toBeNull();
  });

  test("F-5: a single block exceeding 64 KiB is rejected, not silently degraded", () => {
    // compare_data passes rows through; ~12 rows of 4000-char cells total
    // > 64 KiB in that single data_table block, so the serialized guard
    // rejects the whole miniapp instead of rendering a degraded one.
    const big = "x".repeat(4000);
    const rows = Array.from({ length: 12 }, () => ({ a: big, b: big }));
    expect(buildMiniappV1("compare_data", { columns: ["a", "b"], rows })).toBeNull();
  });

  test("F-5: a normal-sized checklist still builds", () => {
    const miniapp = buildMiniappV1("checklist", {
      steps: ["One", "Two", "Three"],
    });
    expect(miniapp).not.toBeNull();
    expect(miniapp?.blocks[0].type).toBe("checklist");
  });
});
