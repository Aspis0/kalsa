/** The js_error record: safe name, first frame reduced to basename:line:col, never the message. */
import { formatJsErrorLine } from "../jsErrorLine";

function errorWith(name: string | undefined, stack: string | undefined): unknown {
  return { name, stack, message: "SECRET user text in message" };
}

describe("name reduction", () => {
  it.each([
    ["TypeError", "TypeError"],
    ["RangeError", "RangeError"],
    ["SyntaxError", "SyntaxError"],
    ["a", "a"],
  ])("keeps %s", (name, expected) => {
    expect(formatJsErrorLine(errorWith(name, undefined))).toBe(
      `js_error name=${expected} frame=unknown`,
    );
  });

  it.each([
    ["very-long-name-with-digits-42", "Error"],
    ["", "Error"],
    [undefined, "Error"],
    ["ERR!", "Error"],
  ])("reduces %s to Error", (name, expected) => {
    expect(formatJsErrorLine(errorWith(name, undefined))).toBe(
      `js_error name=${expected} frame=unknown`,
    );
  });
});

describe("first frame reduction", () => {
  it("takes the basename of a bundler frame with a query string", () => {
    const stack =
      "TypeError: x\n" +
      "    at doThing (file:///data/user/0/com.kalsa/index.bundle?platform=android:42:7)\n" +
      "    at other (bundle.js:9:1)";
    const out = formatJsErrorLine(errorWith("TypeError", stack));
    expect(out).toBe("js_error name=TypeError frame=index.bundle:42:7");
  });

  it("takes a bare url frame without a function name", () => {
    const stack = "Error: x\n    at file:///assets/App.tsx:12:3";
    expect(formatJsErrorLine(errorWith("Error", stack))).toBe(
      "js_error name=Error frame=App.tsx:12:3",
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
    ).toBe("js_error name=TypeError frame=unknown");
  });
});
