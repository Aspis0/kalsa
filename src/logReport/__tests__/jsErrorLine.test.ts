/** The js_error record: closed-set name, first frame on a known bundle basename, never the message. */
import { formatJsErrorLine } from "../jsErrorLine";

function errorWith(name: string | undefined, stack: string | undefined): unknown {
  return { name, stack, message: "SECRET user text in message" };
}

describe("name reduction", () => {
  it.each([
    ["TypeError", "TypeError"],
    ["RangeError", "RangeError"],
    ["AbortError", "AbortError"], // custom literal, src/research/deepResearch.ts:78
    ["MemoryWriteError", "MemoryWriteError"], // custom literal, src/memory/MemoryStore.ts:27
  ])("keeps %s", (name, expected) => {
    expect(formatJsErrorLine(errorWith(name, undefined))).toBe(
      `js_error name=${expected} frame=none`,
    );
  });

  it.each([
    ["a", "Error"], // old code kept any short word
    ["EvilName", "Error"],
    ["very-long-name-with-digits-42", "Error"],
    ["", "Error"],
    [undefined, "Error"],
    ["ERR!", "Error"],
  ])("reduces %s to Error", (name, expected) => {
    expect(formatJsErrorLine(errorWith(name, undefined))).toBe(
      `js_error name=${expected} frame=none`,
    );
  });
});

describe("first frame reduction", () => {
  it("takes the basename of a Metro dev frame with a query string", () => {
    const stack =
      "TypeError: x\n" +
      "    at doThing (file:///data/user/0/com.kalsa/index.bundle?platform=android:42:7)\n" +
      "    at other (bundle.js:9:1)";
    const out = formatJsErrorLine(errorWith("TypeError", stack));
    expect(out).toBe("js_error name=TypeError frame=index.bundle:42:7");
  });

  it("takes a V8 dev-server frame with a long query", () => {
    const stack =
      "Error: x\n    at foo (http://10.0.2.2:8081/index.bundle?platform=android&dev=true&hot=false:123:45)";
    expect(formatJsErrorLine(errorWith("Error", stack))).toBe(
      "js_error name=Error frame=index.bundle:123:45",
    );
  });

  it.each([
    [
      "Hermes release bundle frame",
      "Error: x\n    at fn (address at index.android.bundle:1:234567)",
      "js_error name=Error frame=index.android.bundle:1:234567",
    ],
    [
      "Hermes release anonymous frame",
      "Error: x\n    at fn (address at unknown:1:234567)",
      "js_error name=Error frame=unknown:1:234567",
    ],
  ])("reads the %s", (_label, stack, expected) => {
    expect(formatJsErrorLine(errorWith("Error", stack))).toBe(expected);
  });

  it("never reads the message line, even when it carries 'at <path>:1:2'", () => {
    const stack = "Error: connect ECONNREFUSED at /Users/marco/secrets/tokens.txt:1:2";
    expect(formatJsErrorLine(errorWith("Error", stack))).toBe(
      "js_error name=Error frame=none",
    );
  });

  it("skips stack lines that do not start with 'at '", () => {
    const stack =
      "TypeError: x\n" +
      "Referencing https://user:pass@host/p?token=secret at evil.js:1:2\n" +
      "    at realFn (index.android.bundle:77:1234)";
    expect(formatJsErrorLine(errorWith("TypeError", stack))).toBe(
      "js_error name=TypeError frame=index.android.bundle:77:1234",
    );
  });

  it("does not emit a faked frame from inside the message", () => {
    const stack = "Error: hi\nat fake (evil.bundle.js:1:2)";
    expect(formatJsErrorLine(errorWith("Error", stack))).toBe(
      "js_error name=Error frame=none",
    );
  });

  it("reduces a first frame off the bundle allow-list to none", () => {
    expect(
      formatJsErrorLine(errorWith("Error", "Error: x\n    at file:///assets/App.tsx:12:3")),
    ).toBe("js_error name=Error frame=none");
  });

  it("reduces a frame line without a resolvable location to none", () => {
    expect(formatJsErrorLine(errorWith("Error", "Error: x\n    at fn (native)"))).toBe(
      "js_error name=Error frame=none",
    );
  });

  it("never emits the message", () => {
    const out = formatJsErrorLine(errorWith("TypeError", "TypeError: SECRET user text"));
    expect(out).not.toContain("SECRET");
  });

  it("survives a throwing stack getter", () => {
    expect(
      formatJsErrorLine({
        get name(): string {
          return "TypeError";
        },
        get stack(): string {
          throw new Error("stack bomb");
        },
      }),
    ).toBe("js_error name=TypeError frame=none");
  });
});
