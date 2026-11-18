import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { callbackUrl, get, mockToken, network, rows, startSignIn, useWorker } from "./helpers";

// The redirect targets below are deliberately never reached, so the all-mocks-reached check is off.
useWorker({ requireAllMocks: false });

describe("a provider redirect is a provider error, never a follow", () => {
  it("refuses a 302 from the token endpoint", async () => {
    network.use(
      http.post(
        "https://github.com/login/oauth/access_token",
        () => new HttpResponse(null, { status: 302, headers: { location: "https://github.com/moved-token" } }),
      ),
      // Following the redirect would hand back a usable token and sign the visitor in.
      http.get("https://github.com/moved-token", () =>
        HttpResponse.json({ access_token: "provider-token-after-redirect", token_type: "bearer" }),
      ),
      http.get("https://api.github.com/user", () =>
        HttpResponse.json({ id: 4242, login: "octocat", avatar_url: "https://avatars.example/4242.png" }),
      ),
    );

    const started = await startSignIn("github");
    const response = await get(callbackUrl("github", started.state), started.cookie);
    expect(response.status).toBe(502);
    expect(await rows("users")).toHaveLength(0);
    expect(await rows("sessions")).toHaveLength(0);
  });

  it("refuses a 302 from the identity endpoint", async () => {
    mockToken("gitlab", "provider-token-identity-redirect");
    network.use(
      http.get(
        "https://gitlab.com/api/v4/user",
        () => new HttpResponse(null, { status: 302, headers: { location: "https://gitlab.com/moved-user" } }),
      ),
      http.get("https://gitlab.com/moved-user", () =>
        HttpResponse.json({ id: 4242, username: "octocat", avatar_url: "https://gitlab.example/4242.png" }),
      ),
    );

    const started = await startSignIn("gitlab");
    const response = await get(callbackUrl("gitlab", started.state), started.cookie);
    expect(response.status).toBe(502);
    expect(await rows("users")).toHaveLength(0);
    expect(await rows("sessions")).toHaveLength(0);
  });
});
