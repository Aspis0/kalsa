import { env } from "cloudflare:test";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { ORIGIN, get, jar, network, postJson, signIn, useWorker } from "./helpers";

useWorker();

/** D1 cannot be broken through SELF, so the real handler is invoked with a DB that refuses to prepare. */
function brokenDb(): Env {
  const failing = new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare") return () => { throw new Error("D1 unavailable"); };
      return Reflect.get(target, property);
    },
  });
  return { ...env, DB: failing as unknown as D1Database };
}

function fetchWith(bound: Env, path: string): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`), bound);
}

async function removeFrink(): Promise<void> {
  const { response } = await signIn("github");
  network.use(
    http.get("https://api.github.com/repos/antonellof/frink", () =>
      HttpResponse.json({ owner: { id: 4242, login: "antonellof", type: "User" } }),
    ),
  );
  expect((await postJson("/api/remove", { kind: "engine", id: "frink" }, jar(response))).status).toBe(200);
}

describe("a D1 outage does not serve a removed page, and does not take the site down", () => {
  it("keeps serving the last known removals when D1 fails", async () => {
    await removeFrink();
    // A successful read publishes the snapshot the outage path falls back to.
    expect((await get("/engines/")).status).toBe(200);

    const bound = brokenDb();
    const list = await fetchWith(bound, "/engines/");
    expect(list.status).toBe(200);
    const body = await list.text();
    expect(body).not.toContain('data-engine="frink"');
    expect(body).toContain('data-engine="llama-cpp"');

    expect((await fetchWith(bound, "/engines/frink/")).status).toBe(410);
    expect((await fetchWith(bound, "/badge/frink.svg")).status).toBe(410);
    const rows = (await (await fetchWith(bound, "/engines/engines.json")).json()) as { id: string }[];
    expect(rows.some((row) => row.id === "frink")).toBe(false);
  });

  it("keeps serving the ordinary pages when the last known list is empty", async () => {
    expect((await get("/engines/")).status).toBe(200);
    const bound = brokenDb();
    const list = await fetchWith(bound, "/engines/");
    expect(list.status).toBe(200);
    expect(await list.text()).toContain('data-engine="frink"');
    expect((await fetchWith(bound, "/engines/frink/")).status).toBe(200);
  });
});
