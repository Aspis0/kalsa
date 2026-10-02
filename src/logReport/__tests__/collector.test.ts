/** Collector wiring tests with a mocked file system: passthrough, rejection, error chaining. */
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

type Collector = typeof import("../collector");
type LogStore = typeof import("../logStore");

function loadFresh(): { collector: Collector; logStore: LogStore } {
  let collector!: Collector;
  let logStore!: LogStore;
  jest.isolateModules(() => {
    collector = require("../collector");
    logStore = require("../logStore");
  });
  return { collector, logStore };
}

function storedLines(): string[] {
  const text = [...fakeFile.store.values()][0] ?? "";
  return text.length === 0 ? [] : text.split("\n").filter((line) => line.length > 0);
}

let savedConsole: Partial<Record<"log" | "info" | "warn" | "error", unknown>> = {};

beforeEach(() => {
  fakeFile.reset();
  savedConsole = {};
  for (const name of ["log", "info", "warn", "error"] as const) {
    savedConsole[name] = console[name];
  }
  delete (globalThis as unknown as { ErrorUtils?: unknown }).ErrorUtils;
});

afterEach(() => {
  for (const [name, fn] of Object.entries(savedConsole)) {
    (console as unknown as Record<string, unknown>)[name] = fn;
  }
  delete (globalThis as unknown as { ErrorUtils?: unknown }).ErrorUtils;
});

describe("console passthrough", () => {
  it("calls through with the exact arguments for all four levels", () => {
    const { collector } = loadFresh();
    const printed: unknown[][] = [];
    for (const name of ["log", "info", "warn", "error"] as const) {
      const before = console[name];
      console[name] = ((...args: unknown[]) => {
        printed.push(args);
        (before as (...a: unknown[]) => void).apply(console, args);
      }) as never;
    }
    collector.installLogReportCollector();
    console.log("KALSA_CTX_FLOOR", JSON.stringify({ nCtx: 4096 }), { extra: true }, 7);
    console.info("plain info");
    console.warn("plain warn");
    console.error("plain error");
    expect(printed).toEqual([
      ["KALSA_CTX_FLOOR", '{"nCtx":4096}', { extra: true }, 7],
      ["plain info"],
      ["plain warn"],
      ["plain error"],
    ]);
  });

  it("keeps working when the file backend throws", () => {
    const { collector, logStore } = loadFresh();
    logStore.setFileFactoryForTests(() => {
      throw new Error("storage gone");
    });
    collector.installLogReportCollector();
    expect(() => console.error('KALSA_CTX_FLOOR {"nCtx":4096}')).not.toThrow();
    expect(logStore.readReportText()).toContain('"nCtx":4096');
    logStore.setFileFactoryForTests(null);
  });
});

describe("accepted and rejected console lines", () => {
  it("writes a real single-arg line and the two-arg shape", () => {
    const { collector, logStore } = loadFresh();
    collector.installLogReportCollector();
    console.log('KALSA_STALL {"gapMs":10143,"tokens":1,"turnId":"9","reason":"gap","tokPerSec":0.098}');
    console.log("KALSA_PREWARM", JSON.stringify({ op: "skip", reason: "kv_holds_chat" }));
    console.info("KALSA_PAIRING_FAIL", JSON.stringify({ stage: "claim_network", status: 503 }));
    const lines = storedLines();
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('KALSA_STALL {"gapMs":10143,"tokens":1,"turnId":"9","reason":"gap","tokPerSec":0.098}');
    expect(lines[1]).toContain('KALSA_PREWARM {"op":"skip","reason":"kv_holds_chat"}');
    expect(lines[2]).toContain('KALSA_PAIRING_FAIL {"stage":"claim_network","status":503}');
    expect(logStore.readReportText()).toContain("KALSA_PAIRING_FAIL");
  });

  it("excluded tags are never written", () => {
    const { collector } = loadFresh();
    collector.installLogReportCollector();
    console.log('KALSA_SESSION {"op":"save","stemHash":"abc"}');
    console.log('KALSA_NATIVE {"raw":"the user said hello"}');
    console.log("not a tag at all");
    expect(storedLines()).toEqual([]);
  });

  it("a field of the wrong kind is dropped and the remaining record still counts", () => {
    const { collector } = loadFresh();
    collector.installLogReportCollector();
    console.log('KALSA_CTX_FLOOR {"nCtx":"4096"}');
    expect(storedLines()).toEqual([expect.stringContaining('KALSA_CTX_FLOOR {}')]);
  });

  it("a deny word inside a schema-dropped field never reaches the store", () => {
    const { collector } = loadFresh();
    collector.installLogReportCollector();
    console.log('KALSA_PREWARM {"op":"skip","reason":"last read: 12 tokens"}');
    const lines = storedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("last read");
  });
});

describe("global JS error handler", () => {
  it("chains the previous handler and records name and first frame only", () => {
    const { collector, logStore } = loadFresh();
    const seen: unknown[] = [];
    const handlers: Array<(...args: unknown[]) => void> = [];
    (globalThis as unknown as { ErrorUtils: unknown }).ErrorUtils = {
      getGlobalHandler() {
        return (error: unknown, fatal: unknown) => {
          seen.push([error, fatal]);
          return "prev-result";
        };
      },
      setGlobalHandler(handler: (...args: unknown[]) => void) {
        handlers.push(handler);
      },
    };
    collector.installLogReportCollector();
    const handler = handlers[0];
    const error = new TypeError("secret user message in the error text");
    error.stack = "TypeError: x\n    at doThing (file:///data/user/0/com.kalsa/index.bundle?platform=android:42:7)\n    at other (bundle.js:9:1)";
    const result = handler(error, true);
    expect(seen).toEqual([[error, true]]);
    expect(result).toBe("prev-result");
    const lines = storedLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/js_error name=TypeError frame=index\.bundle:42:7$/);
    expect(logStore.readReportText()).not.toContain("secret user message");
  });

  it("falls back to name=Error and frame=none without a usable stack", () => {
    const { collector, logStore } = loadFresh();
     (globalThis as unknown as { ErrorUtils: unknown }).ErrorUtils = {
      getGlobalHandler: () => undefined,
      setGlobalHandler: (handler: (error: unknown) => void) => {
        handler({ name: "very-long-name-with-7chars!!", message: "boom" });
      },
    };
    collector.installLogReportCollector();
    const lines = storedLines();
    expect(lines[0]).toContain("js_error name=Error frame=none");
    expect(logStore.readReportText()).not.toContain("boom");
  });

  it("survives a throwing error object", () => {
    const { collector } = loadFresh();
     (globalThis as unknown as { ErrorUtils: unknown }).ErrorUtils = {
      getGlobalHandler: () => undefined,
      setGlobalHandler: (handler: (error: unknown) => void) => {
        handler({
          get name(): string {
            throw new Error("getter bomb");
          },
        });
      },
    };
    collector.installLogReportCollector();
    expect(storedLines()[0]).toContain("js_error name=Error frame=none");
  });
});

describe("install lifecycle", () => {
  it("uninstall restores the previous handler and the original console methods", () => {
    const { collector } = loadFresh();
    const previous = (error: unknown, fatal?: unknown) => ({ error, fatal });
    let handler: unknown = previous;
    (globalThis as unknown as { ErrorUtils: unknown }).ErrorUtils = {
      getGlobalHandler: () => handler,
      setGlobalHandler: (h: unknown) => {
        handler = h;
      },
    };
    const uninstall = collector.installLogReportCollector();
    expect(handler).not.toBe(previous);
    uninstall();
    expect(console.log).toBe(savedConsole.log);
    expect(console.error).toBe(savedConsole.error);
    expect(handler).toBe(previous);
  });

  it("a second install after uninstall wraps and captures again", () => {
    const { collector, logStore } = loadFresh();
    const first = collector.installLogReportCollector();
    first();
    collector.installLogReportCollector();
    console.log('KALSA_CTX_FLOOR {"nCtx":4096}');
    expect(storedLines()).toHaveLength(1);
    expect(logStore.readReportText()).toContain('"nCtx":4096');
  });

  it("a re-evaluated module does not wrap twice, and its uninstall fully restores", () => {
    const previous = (error: unknown) => error;
    let handler: unknown = previous;
    (globalThis as unknown as { ErrorUtils: unknown }).ErrorUtils = {
      getGlobalHandler: () => handler,
      setGlobalHandler: (h: unknown) => {
        handler = h;
      },
    };
    // Fast Refresh: a fresh module evaluation against the SAME live console.
    loadFresh().collector.installLogReportCollector();
    const uninstallSecond = loadFresh().collector.installLogReportCollector();
    console.log('KALSA_CTX_FLOOR {"nCtx":4096}');
    expect(storedLines()).toHaveLength(1);
    uninstallSecond();
    expect(console.log).toBe(savedConsole.log);
    expect(console.warn).toBe(savedConsole.warn);
    expect(handler).toBe(previous);
  });

  it("a fatal error with no previous handler reaches reportFatalError", () => {
    const { collector } = loadFresh();
    const reported: unknown[] = [];
    let handler!: (error: unknown, fatal?: boolean) => unknown;
    (globalThis as unknown as { ErrorUtils: unknown }).ErrorUtils = {
      getGlobalHandler: () => undefined,
      setGlobalHandler: (h: (error: unknown, fatal?: boolean) => unknown) => {
        handler = h;
      },
      reportFatalError: (error: unknown) => {
        reported.push(error);
      },
    };
    collector.installLogReportCollector();
    const error = new Error("fatal one");
    handler(error, true);
    expect(reported).toEqual([error]);
    handler(new Error("soft"), false);
    expect(reported).toHaveLength(1);
  });

  it("with a previous handler the fatal fallback does not fire", () => {
    const { collector } = loadFresh();
    const reported: unknown[] = [];
    const seen: unknown[] = [];
    let handler!: (error: unknown, fatal?: boolean) => unknown;
    const previous = (error: unknown, fatal?: boolean) => {
      seen.push([error, fatal]);
    };
    (globalThis as unknown as { ErrorUtils: unknown }).ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (h: (error: unknown, fatal?: boolean) => unknown) => {
        handler = h;
      },
      reportFatalError: (error: unknown) => {
        reported.push(error);
      },
    };
    collector.installLogReportCollector();
    handler(new Error("fatal two"), true);
    expect(seen).toHaveLength(1);
    expect(reported).toEqual([]);
  });
});

describe("ordering of sequentially scheduled console calls", () => {
  it("writes every accepted line in the order the calls were scheduled", () => {
    const { collector } = loadFresh();
    collector.installLogReportCollector();
    const writes: Array<Promise<void>> = [];
    for (let i = 0; i < 200; i++) {
      writes.push(
        Promise.resolve().then(() => {
          console.log(`KALSA_STALL {"gapMs":${i},"tokens":1,"turnId":"${i}","reason":"gap","tokPerSec":1}`);
        }),
      );
    }
    return Promise.all(writes).then(() => {
      const lines = storedLines();
      expect(lines).toHaveLength(200);
      lines.forEach((line, index) => {
        expect(line).toContain(`"gapMs":${index}`);
      });
    });
  });
});
