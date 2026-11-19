import { describe, expect, it } from "vitest";
import { ORIGIN, useWorker } from "./helpers";

useWorker();

describe("runtime capabilities this design depends on", () => {
  it("exposes the Cache API", async () => {
    expect(typeof caches).toBe("object");
    expect(typeof caches.default.match).toBe("function");
    const key = new Request(`${ORIGIN}/__cache-probe`);
    await caches.default.put(key, new Response("probe", { headers: { "Cache-Control": "public, max-age=60" } }));
    const hit = await caches.default.match(key);
    expect(hit === undefined).toBe(false);
    expect(await hit?.text()).toBe("probe");
  });

  it("exposes HTMLRewriter setInnerContent", async () => {
    const html = new Response('<p><span data-x="1">name</span> rest</p>', { headers: { "Content-Type": "text/html" } });
    const out = new HTMLRewriter()
      .on("[data-x]", { element(el) { el.setInnerContent("neutral", { html: false }); el.removeAttribute("data-x"); } })
      .transform(html);
    expect(await out.text()).toBe("<p><span>neutral</span> rest</p>");
  });
});
