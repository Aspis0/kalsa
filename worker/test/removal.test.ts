import { SELF } from "cloudflare:test";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ORIGIN, get, jar, mockIdentity, mockToken, network, postJson, rows, signIn, startSignIn, callbackUrl, useWorker } from "./helpers";

useWorker();

const FRINK = { kind: "engine", id: "frink" };
const ANTONELLOF = { kind: "developer", id: "antonellof" };

interface Owner {
  id: number;
  login: string;
  type: "User" | "Organization";
}

function mockRepo(repo: string, owner: Owner): void {
  network.use(http.get(`https://api.github.com/repos/${repo}`, () => HttpResponse.json({ owner })));
}

function mockAccount(login: string, account: Owner): void {
  network.use(http.get(`https://api.github.com/users/${login}`, () => HttpResponse.json(account)));
}

/** The sign-in the removal flow always goes through: GitHub, id 4242, login octocat. */
async function githubSession(): Promise<string> {
  const { response } = await signIn("github");
  return jar(response);
}

/** A second, different GitHub account, through the same real sign-in flow. */
async function sessionAs(id: number, login: string): Promise<string> {
  mockToken("github", `provider-token-${id}`);
  mockIdentity("github", 200, { id, login, avatar_url: "https://avatars.example/other.png" });
  const started = await startSignIn("github");
  const response = await get(callbackUrl("github", started.state), started.cookie);
  return jar(response);
}

describe("an owner removes a page and it goes at once", () => {
  it("answers 410 for the page and strips it from every list", async () => {
    const cookie = await githubSession();
    mockRepo("antonellof/frink", { id: 4242, login: "antonellof", type: "User" });
    const removed = await postJson("/api/remove", FRINK, cookie);
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });

    const page = await get("/engines/frink/");
    expect(page.status).toBe(410);
    expect(await page.text()).toContain("This page was removed at its owner's request.");

    for (const path of ["/engines/", "/", "/hardware/apple-m1/"]) {
      const body = await (await get(path)).text();
      expect(body, path).not.toContain('data-engine="frink"');
      expect(body, path).toContain('data-engine="llama-cpp"');
    }
    const dev = await (await get("/dev/antonellof/")).text();
    expect(dev).not.toContain('data-engine="frink"');
    const rowsJson = (await (await get("/engines/engines.json")).json()) as { id: string }[];
    expect(rowsJson.some((row) => row.id === "frink")).toBe(false);
    const sitemap = await (await get("/sitemap.xml")).text();
    expect(sitemap).not.toContain(`<loc>${ORIGIN}/engines/frink</loc>`);
    expect(sitemap).toContain(`<loc>${ORIGIN}/engines/llama-cpp</loc>`);
  });

  it("keeps only the page id, the GitHub id and the time", async () => {
    const cookie = await githubSession();
    mockRepo("antonellof/frink", { id: 4242, login: "antonellof", type: "User" });
    await postJson("/api/remove", FRINK, cookie);
    const stored = (await rows("removals")) as Record<string, unknown>[];
    expect(stored).toHaveLength(1);
    expect(Object.keys(stored[0] ?? {}).sort()).toEqual(["created_at", "github_user_id", "id", "kind", "target"]);
    expect(stored[0]).toMatchObject({ kind: "engine", target: "frink", github_user_id: "4242" });
  });

  it("recounts the lists it stripped", async () => {
    const cookie = await githubSession();
    mockRepo("antonellof/frink", { id: 4242, login: "antonellof", type: "User" });
    const before = await (await get("/hardware/apple-m1/")).text();
    const count = Number(before.split('data-count="hw:apple-m1"')[1]?.split(">")[1]?.split(" ")[0]);
    expect(count).toBeGreaterThan(1);
    await postJson("/api/remove", FRINK, cookie);
    const after = await (await get("/hardware/apple-m1/")).text();
    expect(after).toContain(`${count - 1} engines run on Apple M1.`);
    const home = await (await get("/")).text();
    expect(home).toContain(`${count - 1} engines run on Apple M1.`);
  });
});

describe("only the owner may remove a page", () => {
  it("refuses an account that does not own the repository", async () => {
    const cookie = await githubSession();
    mockRepo("antonellof/frink", { id: 999, login: "someone-else", type: "User" });
    const refused = await postJson("/api/remove", FRINK, cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "not_owner" });
    expect((await get("/engines/frink/")).status).toBe(200);
    expect(await rows("removals")).toHaveLength(0);
  });

  it("matches the numeric id, not the login the session happens to carry", async () => {
    const cookie = await githubSession();
    // The session is "octocat"; the repository owner is a different login with the same numeric id.
    mockRepo("antonellof/frink", { id: 4242, login: "antonellof", type: "User" });
    expect((await postJson("/api/remove", FRINK, cookie)).status).toBe(200);
    expect((await get("/engines/frink/")).status).toBe(410);
  });

  it("refuses an organisation's repository: no self-removal, the mailbox instead", async () => {
    const cookie = await githubSession();
    mockRepo("ggml-org/llama.cpp", { id: 777, login: "ggml-org", type: "Organization" });
    const refused = await postJson("/api/remove", { kind: "engine", id: "llama-cpp" }, cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "organisation" });
    expect((await get("/engines/llama-cpp/")).status).toBe(200);
    expect(await rows("removals")).toHaveLength(0);
  });

  it("refuses an organisation's developer page the same way", async () => {
    const cookie = await githubSession();
    mockAccount("ggml-org", { id: 777, login: "ggml-org", type: "Organization" });
    const refused = await postJson("/api/remove", { kind: "developer", id: "ggml-org" }, cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "organisation" });
    expect((await get("/dev/ggml-org/")).status).toBe(200);
  });

  it("does not ask GitHub about organisation membership at all", async () => {
    const cookie = await githubSession();
    mockRepo("ggml-org/llama.cpp", { id: 777, login: "ggml-org", type: "Organization" });
    let membershipCalls = 0;
    network.use(
      http.get("https://api.github.com/orgs/:org/public_members/:user", () => {
        membershipCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await postJson("/api/remove", { kind: "engine", id: "llama-cpp" }, cookie);
    expect(membershipCalls).toBe(0);
  });

  it("follows GitHub's 301 for a renamed repository, one hop on api.github.com only", async () => {
    const cookie = await githubSession();
    network.use(
      http.get("https://api.github.com/repos/antonellof/frink", () =>
        new HttpResponse(null, { status: 301, headers: { Location: "https://api.github.com/repositories/9999" } }),
      ),
      http.get("https://api.github.com/repositories/9999", () =>
        HttpResponse.json({ owner: { id: 4242, login: "renamed-owner", type: "User" } }),
      ),
    );
    expect((await postJson("/api/remove", FRINK, cookie)).status).toBe(200);
    expect((await get("/engines/frink/")).status).toBe(410);
  });

  it("follows a relative Location header too", async () => {
    const cookie = await githubSession();
    network.use(
      http.get("https://api.github.com/repos/antonellof/frink", () =>
        new HttpResponse(null, { status: 301, headers: { Location: "/repositories/9999" } }),
      ),
      http.get("https://api.github.com/repositories/9999", () =>
        HttpResponse.json({ owner: { id: 4242, login: "renamed-owner", type: "User" } }),
      ),
    );
    expect((await postJson("/api/remove", FRINK, cookie)).status).toBe(200);
  });

  it("never follows a redirect off api.github.com", async () => {
    const cookie = await githubSession();
    let offHost = 0;
    network.use(
      http.get("https://api.github.com/repos/antonellof/frink", () =>
        new HttpResponse(null, { status: 301, headers: { Location: "https://attacker.example/repositories/9999" } }),
      ),
      http.get("https://attacker.example/repositories/9999", () => {
        offHost += 1;
        return HttpResponse.json({ owner: { id: 4242, login: "attacker", type: "User" } });
      }),
    );
    const refused = await postJson("/api/remove", FRINK, cookie);
    expect(refused.status).toBe(502);
    expect(offHost).toBe(0);
    expect(await rows("removals")).toHaveLength(0);
  });

  it("says plainly that no repository matches, when GitHub answers 404", async () => {
    const cookie = await githubSession();
    network.use(http.get("https://api.github.com/repos/antonellof/frink", () => new HttpResponse(null, { status: 404 })));
    const refused = await postJson("/api/remove", FRINK, cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "github_missing" });
    expect(await rows("removals")).toHaveLength(0);
  });

  it("says plainly that no account matches, when GitHub answers 404 for a login", async () => {
    const cookie = await githubSession();
    // GitHub documents 200/404 for GET /users/{login}: a renamed account's old login simply 404s.
    network.use(http.get("https://api.github.com/users/antonellof", () => new HttpResponse(null, { status: 404 })));
    const refused = await postJson("/api/remove", ANTONELLOF, cookie);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ error: "github_missing" });
  });

  it("treats a GitHub refusal or outage as unavailable, not as a stranger", async () => {
    const cookie = await githubSession();
    for (const status of [403, 429, 500, 503]) {
      network.use(http.get("https://api.github.com/repos/antonellof/frink", () => new HttpResponse(null, { status })));
      const refused = await postJson("/api/remove", FRINK, cookie);
      expect(refused.status, String(status)).toBe(502);
      expect(await refused.json()).toEqual({ error: "github_unavailable" });
    }
    expect(await rows("removals")).toHaveLength(0);
  });

  it("treats a network failure as unavailable too", async () => {
    const cookie = await githubSession();
    network.use(http.get("https://api.github.com/repos/antonellof/frink", () => HttpResponse.error()));
    const refused = await postJson("/api/remove", FRINK, cookie);
    expect(refused.status).toBe(502);
    expect(await refused.json()).toEqual({ error: "github_unavailable" });
  });

  it("removes a developer page by the GitHub id behind the login", async () => {
    const cookie = await githubSession();
    mockAccount("antonellof", { id: 4242, login: "antonellof", type: "User" });
    expect((await postJson("/api/remove", ANTONELLOF, cookie)).status).toBe(200);
    expect((await get("/dev/antonellof/")).status).toBe(410);
    const engine = await (await get("/engines/frink/")).text();
    expect(engine).not.toContain('data-dev="antonellof"');
    expect(engine).toContain('data-engine="frink"');
    expect((await get("/engines/frink/")).status).toBe(200);
  });

  it("refuses a developer page whose account is someone else", async () => {
    const cookie = await githubSession();
    mockAccount("antonellof", { id: 999, login: "antonellof", type: "User" });
    expect((await postJson("/api/remove", ANTONELLOF, cookie)).status).toBe(403);
  });

  it("refuses a session from another provider", async () => {
    const { response } = await signIn("gitlab");
    const refused = await postJson("/api/remove", FRINK, jar(response));
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: "github_required" });
  });

  it("refuses an anonymous visitor", async () => {
    const refused = await postJson("/api/remove", FRINK);
    expect(refused.status).toBe(401);
    expect(await rows("removals")).toHaveLength(0);
  });
});

describe("the removal endpoint is guarded", () => {
  it("refuses a cross-site POST and a non-JSON body", async () => {
    const cookie = await githubSession();
    const send = (headers: Record<string, string>, body: string) =>
      SELF.fetch(`${ORIGIN}/api/remove`, { method: "POST", redirect: "manual", headers: { Cookie: cookie, ...headers }, body });
    const payload = JSON.stringify(FRINK);

    const noOrigin = await send({ "Content-Type": "application/json" }, payload);
    expect(noOrigin.status).toBe(403);
    const foreign = await send({ Origin: "https://attacker.example", "Content-Type": "application/json" }, payload);
    expect(foreign.status).toBe(403);
    const form = await send({ Origin: ORIGIN, "Content-Type": "application/x-www-form-urlencoded" }, "kind=engine&id=frink");
    expect(form.status).toBe(415);
    expect(await rows("removals")).toHaveLength(0);
  });

  it("refuses an id the generated site does not list", async () => {
    const cookie = await githubSession();
    for (const body of [{ kind: "engine", id: "not-in-the-catalog" }, { kind: "developer", id: "nobody" }]) {
      const refused = await postJson("/api/remove", body, cookie);
      expect(refused.status, JSON.stringify(body)).toBe(404);
      expect(await refused.json()).toEqual({ error: "unknown_page" });
    }
    for (const body of [{ kind: "hardware", id: "apple-m1" }, { kind: "engine", id: "" }, { kind: "engine" }]) {
      expect((await postJson("/api/remove", body, cookie)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await rows("removals")).toHaveLength(0);
  });

  it("answers 405 with Allow for a GET", async () => {
    const response = await get("/api/remove");
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });

  it("stops one account flooding the endpoint", async () => {
    const cookie = await githubSession();
    mockRepo("antonellof/frink", { id: 4242, login: "antonellof", type: "User" });
    let last = 0;
    for (let attempt = 0; attempt < 31; attempt += 1) {
      last = (await postJson("/api/remove", FRINK, cookie)).status;
    }
    expect(last).toBe(429);
  });
});

describe("the owner can undo, from a fresh load", () => {
  it("puts the page back and deletes the record", async () => {
    const cookie = await githubSession();
    mockRepo("antonellof/frink", { id: 4242, login: "antonellof", type: "User" });
    await postJson("/api/remove", FRINK, cookie);
    expect((await get("/engines/frink/")).status).toBe(410);

    const undone = await postJson("/api/undo", FRINK, cookie);
    expect(undone.status).toBe(200);
    expect((await get("/engines/frink/")).status).toBe(200);
    expect(await (await get("/engines/")).text()).toContain('data-engine="frink"');
    expect(await rows("removals")).toHaveLength(0);
  });

  it("serves the removed entry to the account that removed it, so a reload can offer Undo", async () => {
    const cookie = await githubSession();
    mockRepo("antonellof/frink", { id: 4242, login: "antonellof", type: "User" });
    await postJson("/api/remove", FRINK, cookie);

    // This is the call remove.js makes on a fresh load of /remove/?kind=engine&id=frink.
    const page = await get("/api/page?kind=engine&id=frink", cookie);
    expect(page.status).toBe(200);
    expect(await page.json()).toEqual({ kind: "engine", id: "frink", name: "frink", removed: true });
  });

  it("will not serve a removed entry to anyone else", async () => {
    const cookie = await githubSession();
    mockRepo("antonellof/frink", { id: 4242, login: "antonellof", type: "User" });
    await postJson("/api/remove", FRINK, cookie);

    expect((await get("/api/page?kind=engine&id=frink")).status).toBe(401);
    const other = await sessionAs(999, "someone-else");
    expect((await get("/api/page?kind=engine&id=frink", other)).status).toBe(403);
    expect((await postJson("/api/undo", FRINK, other)).status).toBe(403);
    expect((await get("/engines/frink/")).status).toBe(410);
  });

  it("serves a live entry to anyone, without a session", async () => {
    const page = await get("/api/page?kind=engine&id=frink");
    expect(page.status).toBe(200);
    expect(await page.json()).toEqual({ kind: "engine", id: "frink", name: "frink", removed: false });
    const dev = await get("/api/page?kind=developer&id=antonellof");
    expect(dev.status).toBe(200);
    expect(((await dev.json()) as { removed: boolean }).removed).toBe(false);
  });

  it("refuses an unknown id and a wrong method on the page endpoint", async () => {
    expect((await get("/api/page?kind=engine&id=nope")).status).toBe(404);
    expect((await get("/api/page?kind=hardware&id=apple-m1")).status).toBe(400);
    const posted = await postJson("/api/page", FRINK);
    expect(posted.status).toBe(405);
    expect(posted.headers.get("Allow")).toBe("GET, HEAD");
  });

  it("folds case on the page endpoint the same way the serving path does", async () => {
    const response = await get("/api/page?kind=engine&id=FRINK");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { id: string }).id).toBe("frink");
  });

  it("refuses an undo of a page that is not removed", async () => {
    const cookie = await githubSession();
    const refused = await postJson("/api/undo", FRINK, cookie);
    expect(refused.status).toBe(404);
    expect(await refused.json()).toEqual({ error: "not_removed" });
  });

  it("refuses an anonymous undo", async () => {
    expect((await postJson("/api/undo", FRINK)).status).toBe(401);
  });
});
