import { createHash } from "node:crypto";

import { MAC, WIN, entryFor, envWith, manifestJson, send, standardObjects } from "./fakes";
import { CSP_HEADER, STYLE, STYLE_HASH, downloadPageHtml } from "./page";

async function page(objects = standardObjects()) {
  const res = await send(envWith(objects), "/download");
  return { res, html: await res.text() };
}

describe("page content", () => {
  test("both buttons carry the installer link, size and sha256 from the manifest", async () => {
    const winSha = entryFor(WIN).sha256;
    const macSha = entryFor(MAC).sha256;
    const objects = standardObjects({
      "current.json": manifestJson({
        windows: { ...entryFor(WIN), size: 2_300_000_000 },
        mac: { ...entryFor(MAC), size: 45_200_000 },
      }),
    });
    const { res, html } = await page(objects);
    expect(res.status).toBe(200);
    expect(html).toContain(`href="/download/windows?v=${winSha}">Download for Windows</a>`);
    expect(html).toContain(`href="/download/mac?v=${macSha}">Download for Mac (Apple silicon)</a>`);
    expect(html).toContain("2.30 GB");
    expect(html).toContain("45.2 MB");
    expect(html).toContain(`<code class="sha">sha256 ${winSha}</code>`);
    expect(html).toContain(`<code class="sha">sha256 ${macSha}</code>`);
  });

  test("the title and the scoped one-line description", async () => {
    const { html } = await page();
    expect(html).toContain("<title>Kalsa alpha</title>");
    expect(html).toContain(
      "An AI that runs on your own computer: your messages are answered there, not in the cloud.",
    );
    expect(html).not.toContain("A private AI");
  });

  test("a missing manifest renders coming soon instead of buttons", async () => {
    const { res, html } = await page({ [WIN.key]: WIN.bytes });
    expect(res.status).toBe(200);
    expect(html).toContain("Download for Windows: coming soon");
    expect(html).toContain("Download for Mac (Apple silicon): coming soon");
    expect(html).not.toContain("/download/windows?v=");
    expect(html).not.toContain("/download/mac?v=");
  });

  test("one invalid platform entry hides only that button", async () => {
    const objects = standardObjects({
      "current.json": manifestJson({ windows: { ...entryFor(WIN), sha256: "not-a-hash" } }),
    });
    const { html } = await page(objects);
    expect(html).toContain("Download for Windows: coming soon");
    expect(html).toContain(`/download/mac?v=${entryFor(MAC).sha256}`);
  });

  test("the Read this first line links the install sections of the guide", async () => {
    const { html } = await page();
    expect(html).toContain('<p class="first">Read this first: <a href="#windows">Windows</a>');
    expect(html).toContain('<a href="#mac">Mac (Apple silicon)</a>');
    expect(html).toContain('<h2 id="windows">3. Install on Windows</h2>');
    expect(html).toContain('<h2 id="mac">2. Install on Mac</h2>');
    expect(html).not.toContain("[Guide text pending]");
  });
});

describe("page works without script and leaks nothing", () => {
  test("no script, no external URL, no form, no image", async () => {
    const { html } = await page();
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toMatch(/<form/i);
    expect(html).not.toMatch(/<img/i);
  });

  test("the page sets no cookies", async () => {
    const { res } = await page();
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("strict headers", () => {
  test("the page carries the full header set", async () => {
    const { res } = await page();
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toBe(CSP_HEADER);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]{64}"$/);
  });

  test("If-None-Match with the page's etag answers 304", async () => {
    const env = envWith(standardObjects());
    const first = await send(env, "/download");
    const etag = first.headers.get("etag")!;
    const second = await send(env, "/download", { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
  });

  test("the etag follows the content: a new manifest changes it", async () => {
    const before = (await send(envWith(standardObjects()), "/download")).headers.get("etag");
    const objects = standardObjects({ "current.json": manifestJson({ mac: null }) });
    const after = (await send(envWith(objects), "/download")).headers.get("etag");
    expect(after).not.toBe(before);
  });

  test("the CSP allows nothing but the one pinned inline style", () => {
    expect(CSP_HEADER).toContain("default-src 'none'");
    expect(CSP_HEADER).toContain(`style-src 'sha256-${STYLE_HASH}'`);
    expect(CSP_HEADER).not.toContain("unsafe-inline");
    expect(CSP_HEADER).not.toContain("script-src");
  });

  test("the pinned style hash is the hash of the inline style text", () => {
    const hash = createHash("sha256").update(STYLE, "utf8").digest("base64");
    expect(STYLE_HASH).toBe(hash);
  });

  test("the inline style in the page is exactly STYLE", () => {
    expect(downloadPageHtml({ windows: null, mac: null })).toContain(`<style>${STYLE}</style>`);
  });
});

describe("HEAD on the page", () => {
  test("same status and headers, empty body", async () => {
    const res = await send(envWith(standardObjects()), "/download", { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(CSP_HEADER);
    expect(await res.text()).toBe("");
  });
});
