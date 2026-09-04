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
