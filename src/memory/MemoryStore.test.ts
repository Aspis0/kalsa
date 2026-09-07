jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    },
  };
});

const FACTS_KEY = "kalsa.memory.facts";

async function loadStore() {
  jest.resetModules();
  return import("./MemoryStore");
}

describe("MemoryStore sensitive facts", () => {
  test("addFact accepts a bare card number", async () => {
    const { addFact, listFacts } = await loadStore();

    await expect(addFact("4111111111111111")).resolves.toBeUndefined();

    expect((await listFacts()).map((fact) => fact.text)).toContain("4111111111111111");
  });

  test("applyExtractResults stores a bare card number", async () => {
    const { applyExtractResults, getEpoch, listFacts, setEnabled } = await loadStore();
    await setEnabled(true);

    const applied = await applyExtractResults(["4111111111111111"], [], getEpoch());

    expect(applied).toBe(true);
    expect((await listFacts()).map((fact) => fact.text)).toContain("4111111111111111");
  });

  test("listFacts keeps a seeded sensitive fact during migration", async () => {
    jest.resetModules();
    const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
    await AsyncStorage.setItem(
      FACTS_KEY,
      JSON.stringify([
        { id: "seed", text: "4111111111111111", createdAt: 1 },
      ]),
    );
    const { listFacts } = await import("./MemoryStore");

    expect((await listFacts()).map((fact) => fact.text)).toContain("4111111111111111");
  });
});

describe("MemoryStore capacity", () => {
  test("manual add at MAX_FACTS throws MemoryCapacityError without evicting", async () => {
    const { addFact, listFacts, MAX_FACTS, MemoryCapacityError } = await loadStore();
    const existingFacts = await listFacts();

    for (let index = existingFacts.length; index < MAX_FACTS; index += 1) {
      await addFact(`capacity-fact-${index}`);
    }

    const fullFacts = await listFacts();
    expect(fullFacts).toHaveLength(MAX_FACTS);
    await expect(addFact("capacity-overflow")).rejects.toBeInstanceOf(MemoryCapacityError);
    expect(await listFacts()).toEqual(fullFacts);
  });
});

describe("MemoryStore updateFact", () => {
  test("changes text while keeping id and createdAt", async () => {
    const { addFact, clearFacts, listFacts, updateFact } = await loadStore();
    await clearFacts();
    await addFact("old wording");
    const before = (await listFacts())[0];

    await updateFact(before.id, "new wording");

    expect(await listFacts()).toEqual([
      { id: before.id, text: "new wording", createdAt: before.createdAt },
    ]);
  });

  test("empty text is a no-op", async () => {
    const { addFact, clearFacts, listFacts, updateFact } = await loadStore();
    await clearFacts();
    await addFact("unchanged");
    const before = await listFacts();

    await updateFact(before[0].id, " \n\t ");

    expect(await listFacts()).toEqual(before);
  });

  test("a nonexistent id is a no-op", async () => {
    const { addFact, clearFacts, listFacts, updateFact } = await loadStore();
    await clearFacts();
    await addFact("unchanged");
    const before = await listFacts();

    await updateFact("missing-id", "new wording");

    expect(await listFacts()).toEqual(before);
  });

  test("rejects an edit that duplicates another fact", async () => {
    const {
      addFact,
      clearFacts,
      listFacts,
      MemoryDuplicateError,
      updateFact,
    } = await loadStore();
    await clearFacts();
    await addFact("first fact");
    await addFact("second fact");
    const before = await listFacts();
    const firstFact = before.find((fact) => fact.text === "first fact");

    await expect(updateFact(firstFact!.id, " SECOND   FACT ")).rejects.toBeInstanceOf(
      MemoryDuplicateError,
    );
    expect(await listFacts()).toEqual(before);
  });

  test("normalizes whitespace", async () => {
    const { addFact, clearFacts, listFacts, updateFact } = await loadStore();
    await clearFacts();
    await addFact("old wording");
    const fact = (await listFacts())[0];

    await updateFact(fact.id, "  hello   world  ");

    expect((await listFacts())[0].text).toBe("hello world");
  });

  test("truncates text at MAX_TEXT_LEN", async () => {
    const { addFact, clearFacts, listFacts, updateFact } = await loadStore();
    await clearFacts();
    await addFact("old wording");
    const fact = (await listFacts())[0];

    await updateFact(fact.id, "x".repeat(300));

    expect((await listFacts())[0].text).toBe("x".repeat(200));
  });

  test("bumps epoch after a successful update", async () => {
    const { addFact, clearFacts, getEpoch, listFacts, updateFact } = await loadStore();
    await clearFacts();
    await addFact("old wording");
    const fact = (await listFacts())[0];
    const before = getEpoch();

    await updateFact(fact.id, "new wording");

    expect(getEpoch()).toBe(before + 1);
  });

  test("does not change the count when the store is at MAX_FACTS", async () => {
    const { addFact, clearFacts, listFacts, MAX_FACTS, updateFact } = await loadStore();
    await clearFacts();
    for (let index = 0; index < MAX_FACTS; index += 1) {
      await addFact(`capacity-fact-${index}`);
    }
    const before = await listFacts();

    await updateFact(before[0].id, "updated capacity fact");

    expect(await listFacts()).toHaveLength(MAX_FACTS);
  });
});
