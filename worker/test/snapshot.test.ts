import { env } from "cloudflare:test";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import worker from "../src/index";
import { ORIGIN, get, jar, network, postJson, signIn, useWorker } from "./helpers";

useWorker();

const SNAPSHOT = `${ORIGIN}/__kalsa/removals-snapshot`;
const snapshotKey = new Request(SNAPSHOT);

interface Snapshot {
  at: number;
  rows: { kind: string; target: string }[];
}

function brokenDb(): Env {
  const failing = new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare") return () => { throw new Error("D1 unavailable"); };
      return Reflect.get(target, property);
    },
  });
  return { ...env, DB: failing as unknown as D1Database };
}

function withDb(bound: Env, path: string): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`), bound);
}

async function session(): Promise<string> {
  const { response } = await signIn("github");
  return jar(response);
}

async function removeFrink(cookie: string): Promise<void> {
  network.use(
    http.get("https://api.github.com/repos/antonellof/frink", () =>
      HttpResponse.json({ owner: { id: 4242, login: "antonellof", type: "User" } }),
    ),
  );
  expect((await postJson("/api/remove", { kind: "engine", id: "frink" }, cookie)).status).toBe(200);
}

/** Writes a snapshot by hand, so a test can place an older or a newer one than the isolate has seen. */
async function forgeSnapshot(at: number, rows: { kind: string; target: string }[]): Promise<void> {
  await caches.default.put(
    snapshotKey,
    new Response(JSON.stringify({ at, rows }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
    }),
  );
}

async function readSnapshot(): Promise<Snapshot | null> {
  const hit = await caches.default.match(snapshotKey);
  return hit ? ((await hit.json()) as Snapshot) : null;
}

afterEach(async () => {
  await caches.default.delete(snapshotKey);
});

describe("the removals snapshot", () => {
  it("is JSON, nosniff, and carries no user id", async () => {
    const cookie = await session();
    await removeFrink(cookie);
    expect((await get("/engines/")).status).toBe(200);

    const stored = await caches.default.match(snapshotKey);
    expect(stored === undefined).toBe(false);
    expect(stored?.headers.get("Content-Type")).toContain("application/json");
    expect(stored?.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const text = await stored?.text();
    expect(text).not.toContain("4242");
    expect(text).not.toContain("github_user_id");
    const payload = JSON.parse(text ?? "{}") as Snapshot;
    expect(payload.rows).toEqual([{ kind: "engine", target: "frink" }]);
    for (const row of payload.rows) expect(Object.keys(row).sort()).toEqual(["kind", "target"]);
  });

  it("prefers a newer snapshot over an older in-isolate set during an outage", async () => {
    expect((await get("/engines/")).status).toBe(200);
    const seen = await readSnapshot();
    await forgeSnapshot((seen?.at ?? 0) + 60_000, [{ kind: "engine", target: "frink" }]);

    const bound = brokenDb();
    expect((await withDb(bound, "/engines/frink/")).status).toBe(410);
    expect(await (await withDb(bound, "/engines/")).text()).not.toContain('data-engine="frink"');
  });

  it("never replaces a newer in-isolate set with an older snapshot", async () => {
    const cookie = await session();
    await removeFrink(cookie);
    expect((await get("/engines/")).status).toBe(200);
    expect((await postJson("/api/undo", { kind: "engine", id: "frink" }, cookie)).status).toBe(200);
    expect((await get("/engines/")).status).toBe(200);
    // An isolate that has not seen the undo wrote this stale snapshot.
    await forgeSnapshot(1, [{ kind: "engine", target: "frink" }]);

    const bound = brokenDb();
    expect((await withDb(bound, "/engines/frink/")).status).toBe(200);
    expect(await (await withDb(bound, "/engines/")).text()).toContain('data-engine="frink"');
  });

  it("does not overwrite a newer snapshot with an older read", async () => {
    const cookie = await session();
    await removeFrink(cookie);
    expect((await get("/engines/")).status).toBe(200);
    const future = Date.now() + 60_000;
    await forgeSnapshot(future, [{ kind: "engine", target: "frink" }, { kind: "engine", target: "ds4" }]);

    // The set changes, so a write is attempted — and it must not clobber the newer snapshot.
    expect((await postJson("/api/undo", { kind: "engine", id: "frink" }, cookie)).status).toBe(200);
    expect((await get("/engines/")).status).toBe(200);
    const after = await readSnapshot();
    expect(after?.at).toBe(future);
    expect(after?.rows).toEqual([{ kind: "engine", target: "frink" }, { kind: "engine", target: "ds4" }]);
  });

  it("honours a removal made just before the outage, and is bounded by the snapshot's age", async () => {
    const cookie = await session();
    await removeFrink(cookie);
    expect((await get("/engines/")).status).toBe(200);
    const bound = brokenDb();
    expect((await withDb(bound, "/engines/frink/")).status).toBe(410);

    // An undo during the outage cannot be seen: the snapshot is the bound, and it is documented as such.
    expect((await postJson("/api/undo", { kind: "engine", id: "frink" }, cookie)).status).toBe(200);
    expect((await withDb(bound, "/engines/frink/")).status).toBe(410);
  });
});
