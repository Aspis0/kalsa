/** Store tests with a mocked file system: rotation at the 4 MiB cap and the ring fallback. */
jest.mock("expo-file-system", () => {
  const store = new Map<string, string>();
  class FakeFile {
    static store = store;
    static reset(): void {
      store.clear();
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
      store.set(this.uri, options?.append ? (store.get(this.uri) ?? "") + content : content);
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

type FakeFileStatic = { store: Map<string, string>; reset(): void };
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

beforeEach(() => {
  fakeFile.reset();
});

describe("rotation at the byte cap", () => {
  it("keeps the file under 4 MiB and keeps the newest lines", () => {
    const { MAX_REPORT_BYTES, appendLine, readReportText } = loadFresh();
    const line = `KALSA_STALL ${JSON.stringify({ pad: "x".repeat(1000) })}`;
    for (let i = 0; i < 5200; i++) appendLine(`${line} #${i}`);
    expect(Buffer.byteLength(storedText(), "utf8")).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    const text = readReportText();
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(MAX_REPORT_BYTES);
    expect(text.endsWith(`#${5199}\n`)).toBe(true);
    expect(text.split("\n").filter((l) => l.includes(`#${0}\n`))).toEqual([]);
  });

  it("cuts rotated content at a line boundary", () => {
    const { appendLine, readReportText } = loadFresh();
    appendLine("KALSA_CTX_FLOOR {\"nCtx\":1}");
    for (let i = 0; i < 5000; i++) appendLine(`KALSA_CTX_FLOOR {"nCtx":${i},"pad":"${"y".repeat(1000)}"}`);
    const text = readReportText();
    expect(text.endsWith("\n")).toBe(true);
    for (const line of text.split("\n")) {
      if (line.length > 0) expect(line.startsWith("KALSA_CTX_FLOOR ")).toBe(true);
    }
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
