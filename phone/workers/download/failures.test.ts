import { BASE, LINK_KEY, WIN, brokenBucket, entryFor, send } from "./fakes";

const winSha = entryFor(WIN).sha256;
const broken = { DOWNLOADS: brokenBucket(), LINK_KEY };

function expectUnavailable(res: Response) {
  expect(res.status).toBe(503);
  expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(res.headers.get("retry-after")).toBe("300");
  expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
  expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
}

describe("R2 or manifest failures answer 503, not a bare 500", () => {
  test("the page", async () => {
    const res = await send(broken, BASE);
    expectUnavailable(res);
    expect(await res.text()).toContain("temporarily unavailable");
  });

  test("an installer GET", async () => {
    expectUnavailable(await send(broken, `${BASE}/windows?v=${winSha}`));
  });

  test("an installer HEAD", async () => {
    expectUnavailable(await send(broken, `${BASE}/windows?v=${winSha}`, { method: "HEAD" }));
  });
});
