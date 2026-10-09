/**
 * Route tests for GET /admin/reports and the shared bearer guard on the other
 * maintainer routes. Exit 1 on fail.
 */
import assert from "node:assert/strict";
import {
  BASE,
  TelemetryBuffer,
  entry,
  getReports,
  makeEnv,
  seeded,
  storageWith,
  worker,
} from "./test-support.mjs";

const READ_TOKEN = "read-token-fixture";
const ADMIN_TOKEN = "admin-token-fixture";
const FLUSH_TOKEN = "flush-token-fixture";
const ENTRY_KEYS = ["count", "lastSeenAt", "logRefs", "receivedAt", "report", "reviewAck", "sig"];
const bearer = `Bearer ${READ_TOKEN}`;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  OK  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
    failed += 1;
  }
}

const sigsOf = (r) => r.body.entries.map((e) => e.sig);
const iso = (i) => new Date(BASE + i * 60_000).toISOString();

console.log("\n[admin reports guard]");
await test("no Authorization header → 401, no entries", async () => {
  const r = await getReports(makeEnv(seeded(3), { READ_TOKEN }));
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "unauthorized");
  assert.equal("entries" in r.body, false);
});
await test("wrong token → 401", async () => {
  const env = makeEnv(seeded(3), { READ_TOKEN });
  for (const auth of [
    "Bearer wrong-token",
    `Bearer ${READ_TOKEN}x`,
    `Bearer ${READ_TOKEN.slice(0, -1)}`,
    READ_TOKEN,
    `Basic ${READ_TOKEN}`,
  ]) {
    const r = await getReports(env, "", auth);
    assert.equal(r.status, 401, auth.slice(0, 12));
    assert.equal("entries" in r.body, false, "entries leaked on 401");
  }
});
await test("other maintainer tokens do not open the read route → 401", async () => {
  const env = makeEnv(seeded(3), { READ_TOKEN, ADMIN_TOKEN, FLUSH_TOKEN });
  for (const token of [ADMIN_TOKEN, FLUSH_TOKEN]) {
    assert.equal((await getReports(env, "", `Bearer ${token}`)).status, 401, token);
  }
});
await test("READ_TOKEN unset → 503 even with a bearer", async () => {
  const r = await getReports(makeEnv(seeded(3)), "", bearer);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, "read_token_unset");
});
await test("READ_TOKEN empty → 503", async () => {
  const r = await getReports(makeEnv(seeded(3), { READ_TOKEN: "" }), "", "Bearer ");
  assert.equal(r.status, 503);
});

console.log("\n[admin reports body]");
await test("correct token → newest first, exact entry fields", async () => {
  const r = await getReports(makeEnv(seeded(3), { READ_TOKEN }), "", bearer);
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 3);
  assert.equal(r.body.count, 3);
  assert.equal(r.body.skipped, 0);
  assert.deepEqual(sigsOf(r), ["sig-2", "sig-1", "sig-0"]);
  const first = r.body.entries[0];
  assert.deepEqual(Object.keys(first).sort(), ENTRY_KEYS);
  assert.equal(first.receivedAt, iso(2));
  assert.equal(first.lastSeenAt, iso(2), "entry stored before counting: lastSeenAt falls back to createdAt");
  assert.equal(first.count, 1, "entry stored before counting: one occurrence");
  assert.equal(first.reviewAck, false);
  assert.equal(first.report.error.code, "engine.init");
});
await test("responses carry Cache-Control: no-store on every status", async () => {
  const env = makeEnv(seeded(3), { READ_TOKEN });
  for (const [query, auth] of [
    ["", bearer],
    ["", null],
    ["?limit=0", bearer],
  ]) {
    const r = await getReports(env, query, auth);
    assert.equal(r.headers.get("cache-control"), "no-store", `${query} ${auth ? "auth" : "anon"}`);
  }
  const unset = await getReports(makeEnv(seeded(1)), "", bearer);
  assert.equal(unset.headers.get("cache-control"), "no-store", "503");
});
await test("since keeps entries received at or after the instant", async () => {
  const r = await getReports(makeEnv(seeded(3), { READ_TOKEN }), `?since=${encodeURIComponent(iso(1))}`, bearer);
  assert.equal(r.body.total, 2);
  assert.deepEqual(sigsOf(r), ["sig-2", "sig-1"]);
});
await test("before is exclusive and pages without gaps", async () => {
  const env = makeEnv(seeded(5), { READ_TOKEN });
  const r = await getReports(env, `?before=${encodeURIComponent(iso(3))}`, bearer);
  assert.deepEqual(sigsOf(r), ["sig-2", "sig-1", "sig-0"]);
  assert.equal(r.body.nextBefore, iso(0));
  const pages = [];
  let before = null;
  for (let guard = 0; guard < 10; guard++) {
    const q = before === null ? "?limit=2" : `?limit=2&before=${encodeURIComponent(before)}`;
    const page = await getReports(env, q, bearer);
    if (page.body.count === 0) break;
    pages.push(...sigsOf(page));
    before = page.body.nextBefore;
  }
  assert.deepEqual(pages, ["sig-4", "sig-3", "sig-2", "sig-1", "sig-0"]);
});
await test("a page never splits one receive-time millisecond", async () => {
  const shared = (i) => BASE + Math.floor(i / 3) * 60_000;
  const env = makeEnv(storageWith(Array.from({ length: 7 }, (_, i) => entry(i, shared(i)))), { READ_TOKEN });
  const seen = [];
  let before = null;
  for (let guard = 0; guard < 10; guard++) {
    const q = before === null ? "?limit=2" : `?limit=2&before=${encodeURIComponent(before)}`;
    const page = await getReports(env, q, bearer);
    if (page.body.count === 0) break;
    seen.push(...sigsOf(page));
    before = page.body.nextBefore;
  }
  assert.equal(new Set(seen).size, 7, `collected ${seen.length}`);
  const oneMs = makeEnv(storageWith(Array.from({ length: 4 }, (_, i) => entry(i, BASE))), { READ_TOKEN });
  const whole = await getReports(oneMs, "?limit=2", bearer);
  assert.equal(whole.body.count, 4, "a millisecond larger than the limit is returned whole");
});
await test("invalid since, before or limit → 400 invalid_query", async () => {
  const env = makeEnv(seeded(3), { READ_TOKEN });
  for (const query of ["?since=not-a-date", "?since=", "?before=nope", "?limit=0", "?limit=-1", "?limit=abc", "?limit=", "?limit=1.5"]) {
    const r = await getReports(env, query, bearer);
    assert.equal(r.status, 400, query);
    assert.equal(r.body.error, "invalid_query", query);
  }
});
await test("limit is capped at 500; default is 100", async () => {
  const env = makeEnv(seeded(505), { READ_TOKEN });
  const capped = await getReports(env, "?limit=99999", bearer);
  assert.equal(capped.body.count, 500);
  assert.equal(capped.body.total, 505);
  assert.equal((await getReports(env, "?limit=7", bearer)).body.count, 7);
  const dflt = await getReports(env, "", bearer);
  assert.equal(dflt.body.count, 100);
  assert.equal(dflt.body.total, 505);
});
await test("malformed stored entries are skipped and counted, never a 500", async () => {
  const good = [entry(0), entry(1)];
  const bad = [
    { ...entry(2), createdAt: undefined },
    { ...entry(3), createdAt: "2026-10-01T00:00:00Z" },
    { ...entry(4), createdAt: 9e15 },
    { ...entry(5), report: null },
    { ...entry(6), sig: 7 },
    { ...entry(8), lastSeenAt: 9e15 },
  ];
  const env = makeEnv(storageWith([...good, ...bad]), { READ_TOKEN });
  const r = await getReports(env, "", bearer);
  assert.equal(r.status, 200);
  assert.equal(r.body.skipped, 6);
  assert.equal(r.body.count, 2);
  assert.deepEqual(sigsOf(r), ["sig-1", "sig-0"]);
});

console.log("\n[durable object body tolerance]");
await test("DO /reports: null, non-JSON and bad-typed bodies get the default query", async () => {
  const buffer = new TelemetryBuffer({ storage: seeded(3) });
  for (const body of ["null", "not json", '{"limit":"x","since":"y"}', "[]"]) {
    const res = await buffer.fetch(new Request("https://do/reports", { method: "POST", body }));
    assert.equal(res.status, 200, body);
    const parsed = await res.json();
    assert.equal(parsed.count, 3, body);
    assert.equal(parsed.total, 3, body);
  }
});

console.log("\n[admin reports is read-only]");
await test("reads leave the raw stored state deep-equal and perform no writes", async () => {
  const storage = seeded(3);
  const env = makeEnv(storage, { READ_TOKEN });
  const before = structuredClone(storage.data.get("state"));
  const writesBefore = storage.writes;
  const ok = [
    await getReports(env, "", bearer),
    await getReports(env, "?limit=1", bearer),
    await getReports(env, `?since=${encodeURIComponent(iso(0))}`, bearer),
    await getReports(env, `?before=${encodeURIComponent(iso(2))}`, bearer),
  ];
  await getReports(env, "", "Bearer wrong-token");
  await getReports(env, "?limit=abc", bearer);
  assert.ok(ok.every((r) => r.status === 200), "authorized reads ran");
  assert.equal(storage.writes, writesBefore, "writes");
  assert.deepStrictEqual(storage.data.get("state"), before);
  assert.ok(ok[0].body.entries.every((e) => e.reviewAck === false), "reviewAck changed");
});

console.log("\n[shared bearer guard on existing routes]");
await test("/admin/flush-and-purge: unset 503, missing/wrong 401, ADMIN_TOKEN purges", async () => {
  const call = async (env, authorization) => {
    const headers = authorization === null ? {} : { authorization };
    const res = await worker.fetch(
      new Request("https://telemetry.kalsa.io/admin/flush-and-purge", { method: "POST", headers }),
      env,
    );
    return { status: res.status, body: await res.json() };
  };
  const storage = seeded(3);
  assert.equal((await call(makeEnv(storage), `Bearer ${ADMIN_TOKEN}`)).status, 503, "unset");
  assert.equal((await call(makeEnv(storage, { ADMIN_TOKEN }), null)).status, 401, "missing");
  assert.equal((await call(makeEnv(storage, { ADMIN_TOKEN }), `Bearer ${READ_TOKEN}`)).status, 401, "read token");
  const purged = await call(makeEnv(storage, { ADMIN_TOKEN }), `Bearer ${ADMIN_TOKEN}`);
  assert.equal(purged.status, 200);
  assert.equal(purged.body.purged, 3);
});
await test("/flush: unset 503, wrong 401, FLUSH_TOKEN reviews pending entries", async () => {
  const storage = seeded(3);
  const flush = (env, authorization) =>
    worker.fetch(new Request("https://telemetry.kalsa.io/flush", { headers: { authorization } }), env);
  assert.equal((await flush(makeEnv(storage), `Bearer ${FLUSH_TOKEN}`)).status, 503, "unset");
  assert.equal((await flush(makeEnv(storage, { FLUSH_TOKEN }), `Bearer ${READ_TOKEN}`)).status, 401, "wrong");
  const res = await flush(makeEnv(storage, { FLUSH_TOKEN }), `Bearer ${FLUSH_TOKEN}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).reviewed, 3);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
