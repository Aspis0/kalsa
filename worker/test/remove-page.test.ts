import { describe, expect, it } from "vitest";
import { ORIGIN, get, signIn, useWorker } from "./helpers";

useWorker();

const NEXT = "/remove/?kind=engine&id=frink";

describe("the confirmation page is served with its query intact", () => {
  it("answers the link every engine page carries", async () => {
    const response = await get("/remove/index.html?kind=engine&id=frink");
    // Either the page itself or a redirect to its pretty form: the query must survive either way.
    if (response.status >= 300 && response.status < 400) {
      const location = new URL(response.headers.get("Location") ?? "", ORIGIN);
      expect(location.search).toBe("?kind=engine&id=frink");
      const followed = await get(`${location.pathname}${location.search}`);
      expect(followed.status).toBe(200);
      expect(await followed.text()).toContain("static/remove.js");
    } else {
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("static/remove.js");
    }
  });

  it("is a page the sign-in flow may return to", async () => {
    const { response, started } = await signIn("github", NEXT);
    expect(started.next).toBe(NEXT);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${ORIGIN}${NEXT}`);
  });

  it("still refuses a next path outside the site's own sections", async () => {
    const { started } = await signIn("github", "https://attacker.example/remove/");
    expect(started.next).toBe("/");
  });
});
