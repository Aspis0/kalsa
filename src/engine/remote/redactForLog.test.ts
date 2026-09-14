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

  /// Every one of these got past the first version of the redactor. They are the
  /// reason the transport no longer logs arbitrary server text at all.
  test("the shapes that got past the first version", () => {
    // Labelled credentials: the value is replaced, the label survives.
    for (const input of [
      '{"outer":{"token":"SECRET"}}',
      '{"access_token":"SECRET"}',
      'Authorization: Basic "SECRET"',
    ]) {
      const shown = redactForLog(input);
      expect(shown).not.toContain("SECRET");
      expect(shown).toContain("[redacted]");
    }
    // URLs: the credential rides in the query or the fragment, which are dropped
    // whole — there is no value to mark.
    for (const input of [
      "https://host/path#access_token=SECRET",
      "HTTPS://host/?access_token=SECRET",
    ]) {
      const shown = redactForLog(input);
      expect(shown).not.toContain("SECRET");
      expect(shown).not.toContain("access_token");
    }
  });

  test("json keeps its shape while the value goes", () => {
    expect(redactForLog('{"access_token":"SECRET","model":"x"}')).toBe(
      '{"access_token":"[redacted]","model":"x"}',
    );
  });

  test("an uppercase scheme is still a URL", () => {
    expect(redactForLog("failed: HTTPS://host/x?token=SECRET")).toBe(
      "failed: https://host/x",
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
