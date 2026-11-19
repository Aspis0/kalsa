import { SELF } from "cloudflare:test";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ORIGIN, get, jar, network, postJson, signIn, useWorker } from "./helpers";

useWorker();

/**
 * A removal set unique to this file, so the version-keyed cache is cold for every path here and a
 * HEAD cannot be masked by an entry another test left behind.
 */
async function removeTwo(): Promise<void> {
  const { response } = await signIn("github");
  const cookie = jar(response);
  for (const [repo, id] of [["antonellof/frink", "frink"], ["antirez/ds4", "ds4"]] as const) {
    network.use(
      http.get(`https://api.github.com/repos/${repo}`, () =>
        HttpResponse.json({ owner: { id: 4242, login: repo.split("/")[0], type: "User" } }),
      ),
    );
    expect((await postJson("/api/remove", { kind: "engine", id }, cookie)).status, id).toBe(200);
  }
}

function head(path: string): Promise<Response> {
  return SELF.fetch(`${ORIGIN}${path}`, { method: "HEAD" });
}

describe("HEAD never writes a body-less answer into the GET cache", () => {
  it("leaves the stripped HTML body intact for the next GET", async () => {
    await removeTwo();
    const first = await head("/engines/");
    expect(first.status).toBe(200);
    expect(await first.text()).toBe("");

    const after = await get("/engines/");
    expect(after.status).toBe(200);
    const body = await after.text();
    expect(body.length).toBeGreaterThan(1000);
    expect(body).toContain('data-engine="llama-cpp"');
    expect(body).not.toContain('data-engine="frink"');
  });

  it("answers HEAD on the JSON and XML paths without a 500, and GET still gets the filtered body", async () => {
    await removeTwo();
    for (const path of ["/pages.json", "/engines/engines.json", "/sitemap.xml"]) {
      const first = await head(path);
      expect(first.status, path).toBe(200);
      expect(await first.text(), path).toBe("");

      const after = await get(path);
      expect(after.status, path).toBe(200);
      const body = await after.text();
      expect(body.length, path).toBeGreaterThan(100);
      expect(body, path).not.toContain("frink");
    }
    const rows = (await (await get("/engines/engines.json")).json()) as { id: string }[];
    expect(rows.length).toBeGreaterThan(30);
    const sitemap = await (await get("/sitemap.xml")).text();
    expect(sitemap).toContain("<urlset");
  });

  it("does not poison the home page or a hardware page either", async () => {
    await removeTwo();
    for (const path of ["/", "/hardware/apple-m1/", "/dev/antonellof/"]) {
      expect((await head(path)).status, path).toBe(200);
      const body = await (await get(path)).text();
      expect(body.length, path).toBeGreaterThan(1000);
      expect(body, path).not.toContain('data-engine="frink"');
    }
  });

  it("still answers 410 with no body for a removed page", async () => {
    await removeTwo();
    const response = await head("/engines/frink/");
    expect(response.status).toBe(410);
    expect(await response.text()).toBe("");
  });

  it("keeps a live page whole through HEAD then GET", async () => {
    expect((await head("/engines/")).status).toBe(200);
    const body = await (await get("/engines/")).text();
    expect(body).toContain('data-engine="frink"');
    expect(body.length).toBeGreaterThan(1000);
  });
});
