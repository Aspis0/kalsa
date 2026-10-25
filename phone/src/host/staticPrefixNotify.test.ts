import { createStaticPrefixNotifier } from "./staticPrefixNotify";

describe("static prefix notifier skips the mount run", () => {
  test("first call is skipped, every later call notifies (D2 row 21)", () => {
    const seen: string[] = [];
    const notify = createStaticPrefixNotifier<string, string>((locale) => {
      seen.push(locale);
    });
    notify("en", []);
    expect(seen).toEqual([]);
    notify("en", []);
    notify("it", []);
    expect(seen).toEqual(["en", "it"]);
  });
});
