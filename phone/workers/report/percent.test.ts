/**
 * The percent decode is a second look at a line the scan already redacted, so
 * it must not change what a second screen would store: `%25` and the `<`/`>`
 * escapes stay encoded, and a stored report is a fixed point.
 */

import { VALID_APP, fakeEnv, post } from "./fakes";

const storedText = (puts: { value: Uint8Array }[]) => new TextDecoder().decode(puts[0].value);

describe("the percent decode leaves what a second screen would change", () => {
  test("a double-encoded address stays encoded, and a second pass changes nothing", async () => {
    const { env, puts } = fakeEnv();
    // The first token decodes to an address and redacts, which keeps the whole
    // decoded line; `%2540` in the second token then peels to `%40`, and the
    // next screen decodes that to an address too.
    await post(env, "marco%40example.com, marco%2540example.com\n", { "x-kalsa-app": VALID_APP });
    const once = storedText(puts);
    expect(once).toBe("<email>, marco%2540example.com\n");

    const { env: env2, puts: puts2 } = fakeEnv();
    await post(env2, once, { "x-kalsa-app": VALID_APP });
    expect(storedText(puts2)).toBe(once);
  });

  test("an encoded angle bracket is stored as it arrived, not as a marker", async () => {
    const { env, puts } = fakeEnv();
    // `%3Cip%3E` decoded would store `<ip>`, a marker no scan produced.
    await post(env, "x %3Cip%3E and marco%40example.com\n", { "x-kalsa-app": VALID_APP });
    expect(storedText(puts)).toBe("x %3Cip%3E and <email>\n");
    expect(storedText(puts)).not.toContain("<ip>");
  });
});
