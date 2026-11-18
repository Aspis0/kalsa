import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/crypto";
import { type ProviderName, get, jar, post, rows, setCookies, signIn, useWorker } from "./helpers";

useWorker();

const NAMES: ProviderName[] = ["github", "huggingface", "gitlab"];

describe.each(NAMES)("the %s access token", (name) => {
  it("never reaches a response body, a cookie or a D1 row", async () => {
    const { token, started, response, authorization } = await signIn(name);
    const me = await get("/api/me", jar(response));
    const out = await post("/auth/signout", {
      Origin: "https://kalsa.io",
      "Content-Type": "application/json",
      Cookie: jar(response),
    });

    const responses = [started.response, response, me, out];
    for (const each of responses) {
      expect(await each.text()).not.toContain(token);
      for (const cookie of setCookies(each)) expect(cookie).not.toContain(token);
    }
    expect(started.response.headers.get("Location") ?? "").not.toContain(token);
    expect(response.headers.get("Location") ?? "").not.toContain(token);

    const stored = JSON.stringify([...(await rows("users")), ...(await rows("sessions"))]);
    expect(stored).not.toContain(token);

    // It was spent exactly once, on the identity read, and nowhere else.
    expect(authorization).toEqual([`Bearer ${token}`]);
  });

  it("keeps only the hash of the session cookie in D1", async () => {
    const { response } = await signIn(name);
    const cookie = setCookies(response)
      .find((value) => value.startsWith("__Host-kalsa_session="))
      ?.slice("__Host-kalsa_session=".length)
      .split(";")[0] ?? "";
    expect(cookie).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const sessions = (await rows("sessions")) as Record<string, unknown>[];
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.hash).toBe(await sha256Hex(cookie));
    expect(JSON.stringify(sessions)).not.toContain(cookie);
  });

  it("stores no email address and no scope list", async () => {
    await signIn(name);
    const users = (await rows("users")) as Record<string, unknown>[];
    expect(Object.keys(users[0] ?? {}).sort()).toEqual(
      ["avatar_url", "created_at", "id", "provider", "provider_user_id", "username"].sort(),
    );
  });
});
