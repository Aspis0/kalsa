import { LatestSave } from "./latestSave";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("LatestSave", () => {
  test("a value typed while a write is in flight is written when it lands", async () => {
    let field = "T0";
    const writes: string[] = [];
    const first = deferred<void>();
    const save = new LatestSave<string>(
      async (value) => {
        writes.push(value);
        if (writes.length === 1) await first.promise;
      },
      () => field,
      (error) => {
        throw error;
      },
    );

    const inFlight = save.save();
    // The user keeps typing while that write is on its way.
    field = "T1";
    save.markEdited();
    first.resolve();
    await inFlight;

    expect(writes).toEqual(["T0", "T1"]);
  });

  test("two saves while one write is in flight share one drain", async () => {
    let field = "value";
    const writes: string[] = [];
    const first = deferred<void>();
    const save = new LatestSave<string>(
      async (value) => {
        writes.push(value);
        if (writes.length === 1) await first.promise;
      },
      () => field,
      () => undefined,
    );
    const a = save.save();
    field = "changed while saving";
    save.markEdited();
    const b = save.save();
    expect(b).toBe(a);
    first.resolve();
    await a;
    // One drain, and what it leaves in the store is what the field holds.
    expect(writes).toEqual(["value", "changed while saving"]);
  });

  test("a failing store is reported once and not retried in a loop", async () => {
    const errors: unknown[] = [];
    let writes = 0;
    const save = new LatestSave<string>(
      async () => {
        writes += 1;
        throw new Error("keystore unavailable");
      },
      () => "value",
      (error) => errors.push(error),
    );
    save.markEdited();
    await save.save();
    expect(writes).toBe(1);
    expect(errors).toHaveLength(1);
  });

  test("nothing is written before it is asked for", () => {
    let writes = 0;
    const save = new LatestSave<string>(
      async () => {
        writes += 1;
      },
      () => "value",
      () => undefined,
    );
    save.markEdited();
    expect(writes).toBe(0);
  });
});
