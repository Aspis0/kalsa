import { redactForLog } from "./redactForLog";

describe("redactForLog", () => {
  test("a token in a URL query never reaches the log", () => {
    const shown = redactForLog(
      "server said: see https://mac.example.ts.net/v1/?token=SECRET for details",
    );
    expect(shown).not.toContain("SECRET");
    expect(shown).toContain("https://mac.example.ts.net/v1");
    expect(shown).toContain("for details");
  });

  test("userinfo in a URL never reaches the log", () => {
    const shown = redactForLog("failed against https://user:pa55word@host/v1");
    expect(shown).not.toContain("pa55word");
    expect(shown).toContain("https://host/v1");
  });

  test("labelled credentials are replaced, the label kept", () => {
    expect(redactForLog("api_key=sk-live-1234567890abcdef")).not.toContain("1234567890");
    const shown = redactForLog("Authorization: Bearer abcdef123456");
    expect(shown).toContain("Bearer");
    expect(shown).not.toContain("abcdef123456");
    expect(redactForLog("token: xyzzy")).not.toContain("xyzzy");
  });

  test("unlabelled vendor keys are replaced", () => {
    expect(redactForLog("key sk-abcdefghijklmnopqrstuvwxyz is invalid")).not.toContain(
      "abcdefghijklmnop",
    );
  });

  test("the diagnostic part survives, including trailing punctuation", () => {
    expect(redactForLog("the model does not exist.")).toBe(
      "the model does not exist.",
    );
    expect(redactForLog("see https://host/x?token=SECRET.")).toBe(
      "see https://host/x.",
    );
  });
});
