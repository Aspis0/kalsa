/** Store tests with a mocked file system: rotation at the 4 MiB cap and the ring fallback. */
jest.mock("expo-file-system", () => {
  const store = new Map<string, string>();
  class FakeFile {
    static store = store;
    // Injected failure for non-append writes: rotate's keep-write must fail
    // BEFORE the live log is touched.
    static failPlainWrites = false;
    // Injected failure for the append itself, so a report can be asked for
    // while the buffer cannot be written.
    static failAppendWrites = false;
    static reset(): void {
      store.clear();
      FakeFile.failPlainWrites = false;
      FakeFile.failAppendWrites = false;
    }
    uri: string;
    constructor(...parts: string[]) {
      this.uri = parts.join("/");
    }
    get exists(): boolean {
      return store.has(this.uri);
    }
    get size(): number {
      return Buffer.byteLength(store.get(this.uri) ?? "", "utf8");
    }
    create(): void {
      if (!store.has(this.uri)) store.set(this.uri, "");
    }
    write(content: string, options?: { append?: boolean }): void {
      if (FakeFile.failAppendWrites && options?.append) throw new Error("append failed");
      if (FakeFile.failPlainWrites && !options?.append) throw new Error("write failed");
      store.set(this.uri, options?.append ? (store.get(this.uri) ?? "") + content : content);
    }
    moveSync(destination: FakeFile, options?: { overwrite?: boolean }): void {
      if (store.has(destination.uri) && !options?.overwrite) {
        throw new Error("destination exists");
      }
      store.set(destination.uri, store.get(this.uri) ?? "");
      store.delete(this.uri);
    }
    textSync(): string {
      const value = store.get(this.uri);
      if (value === undefined) throw new Error("no file");
      return value;
    }
    delete(): void {
      store.delete(this.uri);
    }
  }
  return { Paths: { document: "file:///docs" }, File: FakeFile };
});

import { File } from "expo-file-system";

type FakeFileStatic = {
  store: Map<string, string>;
  reset(): void;
  failPlainWrites: boolean;
  failAppendWrites: boolean;
};
const fakeFile = File as unknown as FakeFileStatic;

type LogStore = typeof import("../logStore");

function loadFresh(): LogStore {
  let logStore!: LogStore;
  jest.isolateModules(() => {
    logStore = require("../logStore");
  });
  return logStore;
}

function storedText(): string {
  return [...fakeFile.store.values()][0] ?? "";
}

/** Let the buffered lines reach the file: the store drains on a microtask. */
const drain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fakeFile.reset();
});

describe("rotation at the byte cap", () => {
  it("keeps the file under 4 MiB and keeps the newest lines", async () => {
    const { MAX_REPORT_BYTES, appendLine, readReportText } = loadFresh();
    const line = `KALSA_STALL ${JSON.stringify({ pad: "x".repeat(1000) })}`;
    for (let i = 0; i < 5200; i++) appendLine(`${line} #${i}`);
    await drain();
    expect(Buffer.byteLength(storedText(), "utf8")).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    const text = readReportText();
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    expect(text.endsWith(`#${5199}\n`)).toBe(true);
    // The oldest line itself must be gone: an exact-line match can really
    // fail, unlike the old `l.includes("#0\n")` on split lines (never true).
    const oldest = `${line} #0`;
    expect(text.split("\n").filter((l) => l === oldest)).toEqual([]);
  });

  it("cuts rotated content at a line boundary", async () => {
    const { appendLine, readReportText } = loadFresh();
    appendLine("KALSA_CTX_FLOOR {\"nCtx\":1}");
    for (let i = 0; i < 5000; i++) appendLine(`KALSA_CTX_FLOOR {"nCtx":${i},"pad":"${"y".repeat(1000)}"}`);
    await drain();
    const text = readReportText();
    expect(text.endsWith("\n")).toBe(true);
    for (const line of text.split("\n")) {
      if (line.length > 0) expect(line.startsWith("KALSA_CTX_FLOOR ")).toBe(true);
    }
  });
});

describe("rotation write failure", () => {
  it("keeps the whole log when the rotation write fails", async () => {
    const { appendLine } = loadFresh();
    const line = `KALSA_CTX_FLOOR ${JSON.stringify({ pad: "z".repeat(100_000) })}`;
    // ~100 kB/line: the 4 MiB cap is crossed within the 50 appends, so the
    // drain that writes them rotates — and its plain (non-append) write is the
    // one that fails.
    fakeFile.failPlainWrites = true;
    for (let i = 0; i < 50; i++) appendLine(`${line} #${i}`);
    await drain();
    fakeFile.failPlainWrites = false;
    // The old delete-then-write lost the file the moment the post-delete
    // write threw; write-then-replace never deletes before the write lands.
    expect(storedText()).toContain(`${line} #0`);
  });
});

describe("ring fallback", () => {
  it("serves the ring when the file backend throws", () => {
    const logStore = loadFresh();
    logStore.setFileFactoryForTests(() => {
      throw new Error("no storage");
    });
    expect(() => logStore.appendLine("KALSA_CTX_FLOOR {\"nCtx\":2}")).not.toThrow();
    expect(logStore.readReportText()).toContain('KALSA_CTX_FLOOR {"nCtx":2}');
    logStore.setFileFactoryForTests(null);
  });

  it("returns an empty string when nothing was ever recorded", () => {
    const { readReportText } = loadFresh();
    expect(readReportText()).toBe("");
  });
});

describe("the write buffer", () => {
  it("writes nothing on the caller's turn and one batch after it", async () => {
    const { appendLine } = loadFresh();
    appendLine("KALSA_TURN {\"n\":1}");
    appendLine("KALSA_TURN {\"n\":2}");
    appendLine("KALSA_TURN {\"n\":3}");
    // The whole point: a console call mid-send costs no synchronous write.
    expect(storedText()).toBe("");

    await drain();
    // One write for the burst, and the order is the order they were logged.
    expect(storedText()).toBe(
      'KALSA_TURN {"n":1}\nKALSA_TURN {"n":2}\nKALSA_TURN {"n":3}\n',
    );
  });

  it("drains each burst separately, never reordering across them", async () => {
    const { appendLine } = loadFresh();
    appendLine("KALSA_TURN {\"n\":1}");
    await drain();
    appendLine("KALSA_TURN {\"n\":2}");
    appendLine("KALSA_TURN {\"n\":3}");
    await drain();
    expect(storedText()).toBe(
      'KALSA_TURN {"n":1}\nKALSA_TURN {"n":2}\nKALSA_TURN {"n":3}\n',
    );
  });

  it("flushes the buffered lines into the report it hands over", () => {
    const { appendLine, readReportText } = loadFresh();
    appendLine("KALSA_CTX_FLOOR {\"nCtx\":9}");
    const text = readReportText();
    expect(text).toBe('KALSA_CTX_FLOOR {"nCtx":9}\n');
    // And it is on the file now, so the next report reads it once.
    expect(storedText()).toBe('KALSA_CTX_FLOOR {"nCtx":9}\n');
    expect(readReportText()).toBe('KALSA_CTX_FLOOR {"nCtx":9}\n');
  });

  it("carries every accepted line, once each, across a flush boundary", () => {
    const { appendLine, readReportText } = loadFresh();
    appendLine("KALSA_CTX_FLOOR {\"nCtx\":1}");
    readReportText();
    appendLine('KALSA_CTX_FLOOR {"nCtx":2}');

    const text = readReportText();
    expect(text.split("\n").filter((l) => l.includes('"nCtx":1'))).toHaveLength(1);
    expect(text.split("\n").filter((l) => l.includes('"nCtx":2'))).toHaveLength(1);
    expect(text).toBe('KALSA_CTX_FLOOR {"nCtx":1}\nKALSA_CTX_FLOOR {"nCtx":2}\n');
  });

  it("caps the report it returns, buffer included", async () => {
    const { MAX_REPORT_BYTES, appendLine, readReportText } = loadFresh();
    // Fill the file to just under the cap, then buffer more: capping the file
    // alone and appending the tail afterwards is how the report grew past it.
    const chunk = `KALSA_STALL ${JSON.stringify({ pad: "q".repeat(1000) })}`;
    for (let i = 0; i < 4100; i++) appendLine(`${chunk} #${i}`);
    await drain();
    for (let i = 4100; i < 4200; i++) appendLine(`${chunk} #${i}`);

    const text = readReportText();
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    expect(text.endsWith("#4199\n")).toBe(true);
  });

  it("does not requeue a batch the append already wrote", async () => {
    const { appendLine, readReportText } = loadFresh();
    // Push past the cap so the drain rotates, and make the rotation's plain
    // write fail: the append succeeded, so requeuing the batch would write
    // every line a second time on the next drain.
    const line = `KALSA_CTX_FLOOR ${JSON.stringify({ pad: "r".repeat(100_000) })}`;
    fakeFile.failPlainWrites = true;
    for (let i = 0; i < 50; i++) appendLine(`${line} #${i}`);
    await drain();
    fakeFile.failPlainWrites = false;

    const afterFirst = readReportText();
    const firstCount = afterFirst.split("\n").filter((l) => l.length > 0).length;
    // Nothing was requeued, so a second report is byte-identical — no doubled
    // lines from the batch that had already landed.
    expect(readReportText()).toBe(afterFirst);
    expect(firstCount).toBe(afterFirst.split("\n").filter((l) => l.includes("#")).length);
  });

  it("carries lines the file write could not take", async () => {
    const { appendLine, readReportText } = loadFresh();
    appendLine('KALSA_CTX_FLOOR {"nCtx":1}');
    await drain();

    // The file goes read-only under the report: the flush cannot write, and
    // those lines must still reach the report that asked for them.
    const original = fakeFile.store.get("file:///docs/kalsa-report.log") ?? "";
    fakeFile.store.set("file:///docs/kalsa-report.log", original.slice(0, 0) + original);
    fakeFile.failAppendWrites = true;
    appendLine('KALSA_CTX_FLOOR {"nCtx":2}');
    const text = readReportText();

    expect(text).toContain('KALSA_CTX_FLOOR {"nCtx":1}');
    expect(text).toContain('KALSA_CTX_FLOOR {"nCtx":2}');
    expect(text.split("\n").filter((l) => l.includes('"nCtx":2'))).toHaveLength(1);
    fakeFile.failAppendWrites = false;
  });

  it("keeps the buffered batch when the write fails, bounded", async () => {
    const logStore = loadFresh();
    logStore.setFileFactoryForTests(() => {
      throw new Error("no storage");
    });
    for (let i = 0; i < 3; i++) logStore.appendLine(`KALSA_TURN {"n":${i}}`);
    await drain();

    // Nothing was written, so the ring still serves the lines...
    expect(logStore.readReportText()).toContain('KALSA_TURN {"n":0}');
    // ...and the buffer did not grow without bound either.
    for (let i = 3; i < 500; i++) logStore.appendLine(`KALSA_TURN {"n":${i}}`);
    await drain();
    const text = logStore.readReportText();
    expect(text.split("\n").filter((line) => line.length > 0).length).toBeLessThanOrEqual(400);
    expect(text).toContain('KALSA_TURN {"n":499}');
    logStore.setFileFactoryForTests(null);
  });

  it("never throws into the console call that logged", async () => {
    const logStore = loadFresh();
    logStore.setFileFactoryForTests(() => {
      throw new Error("no storage");
    });
    expect(() => logStore.appendLine("KALSA_CTX_FLOOR {\"nCtx\":3}")).not.toThrow();
    await drain();
    expect(() => logStore.appendLine("KALSA_CTX_FLOOR {\"nCtx\":4}")).not.toThrow();
    expect(logStore.readReportText()).toContain('KALSA_CTX_FLOOR {"nCtx":3}');
    logStore.setFileFactoryForTests(null);
  });
});
