/**
 * Duplicate reports are counted on the stored entry, not dropped. Covers the
 * /report path end to end: counting, read-back, quota and IP rate rules.
 * Exit 1 on fail.
 */
import assert from "node:assert/strict";
import { BASE, getReports, makeEnv, postReport as post, storageWith } from "./test-support.mjs";

const READ_TOKEN = "dup-read-token-fixture";
const HOUR_MS = 60 * 60 * 1000;
const GLOBAL_QUOTA = 50;

let clock = BASE;
const realNow = Date.now;
Date.now = () => clock;
process.on("exit", () => {
  Date.now = realNow;
});

const report = (over = {}) => ({
  v: 1,
  app: "kalsa",
  appVersion: "0.1.0",
  platform: "android",
  deviceBucket: "mid",
  osMajor: "13",
  error: { code: "chat.generation", detail: "native_crash" },
  context: { phase: "turn", modelCategory: "unknown" },
  dateBucket: "2026-10-01",
  manual: false,
  ...over,
});

const readOpts = { READ_TOKEN };
let passed = 0;
let failed = 0;

async function test(name, fn) {
  clock = BASE;
  try {
    await fn();
    console.log(`  OK  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err instanceof Error ? err.message : err}`);
    failed += 1;
  }
}

console.log("\n[duplicate counting]");
await test("a duplicate increments count on the one stored entry; response stays duplicate", async () => {
  const storage = storageWith([]);
  const env = makeEnv(storage, readOpts);
  const body = report();
  assert.deepEqual(await post(env, body), { status: 200, body: { accepted: true } });
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(await post(env, body), { status: 200, body: { accepted: false, reason: "duplicate" } });
  }
  const r = await getReports(env, "", `Bearer ${READ_TOKEN}`);
  assert.equal(r.body.total, 1, "stored once");
  assert.equal(r.body.entries[0].count, 3);
  assert.deepEqual(r.body.entries[0].report, body, "first report kept as accepted");
});
await test("lastSeenAt advances on duplicates; receivedAt stays the first arrival", async () => {
  const env = makeEnv(storageWith([]), readOpts);
  const body = report();
  await post(env, body);
  clock = BASE + 5 * 60_000;
  await post(env, body);
  const e = (await getReports(env, "", `Bearer ${READ_TOKEN}`)).body.entries[0];
  assert.equal(e.receivedAt, new Date(BASE).toISOString());
  assert.equal(e.lastSeenAt, new Date(BASE + 5 * 60_000).toISOString());
  assert.equal(e.count, 2);
});
await test("a KV cache claiming every key is a duplicate cannot skip the increment", async () => {
  const env = makeEnv(storageWith([]), {
    READ_TOKEN,
    DEDUPE_KV: { get: async () => "1", put: async () => {} },
  });
  const body = report({ appVersion: "0.3.0" });
  assert.equal((await post(env, body)).body.accepted, true, "first report reaches the DO");
  assert.equal((await post(env, body)).body.reason, "duplicate");
  assert.equal((await getReports(env, "", `Bearer ${READ_TOKEN}`)).body.entries[0].count, 2);
});
await test("v1 duplicates from android and ios behave the same", async () => {
  const env = makeEnv(storageWith([]), readOpts);
  for (const [i, platform] of ["android", "ios"].entries()) {
    const body = report({ platform, appVersion: `0.4.${i}` });
    assert.equal((await post(env, body)).body.accepted, true, platform);
    assert.equal((await post(env, body)).body.reason, "duplicate", platform);
  }
  const r = await getReports(env, "", `Bearer ${READ_TOKEN}`);
  assert.deepEqual(r.body.entries.map((e) => e.count), [2, 2]);
});

await test("platform is in the signature: android and ios never merge (v1)", async () => {
  const env = makeEnv(storageWith([]), readOpts);
  const common = { appVersion: "0.7.0" };
  assert.equal((await post(env, report({ ...common, platform: "android" }))).body.accepted, true, "android");
  assert.equal((await post(env, report({ ...common, platform: "ios" }))).body.accepted, true, "ios merged into android");
  const r = await getReports(env, "", `Bearer ${READ_TOKEN}`);
  assert.equal(r.body.total, 2);
  assert.deepEqual(r.body.entries.map((e) => e.count), [1, 1]);
});
await test("platform is in the signature: v2 reports differing only in platform stay separate", async () => {
  const env = makeEnv(storageWith([]), readOpts);
  const v2 = (platform) => report({ v: 2, platform, appVersion: "0.7.1", diagnostics: {} });
  assert.equal((await post(env, v2("macos"))).body.accepted, true, "macos");
  assert.equal((await post(env, v2("linux"))).body.accepted, true, "linux merged into macos");
  assert.equal((await post(env, v2("linux"))).body.reason, "duplicate", "same platform still dedupes");
  const r = await getReports(env, "", `Bearer ${READ_TOKEN}`);
  assert.equal(r.body.total, 2);
  assert.deepEqual(r.body.entries.map((e) => e.count).sort(), [1, 2]);
});

console.log("\n[rate and quota rules unchanged]");
await test("quota still rejects new reports; duplicates still count and consume no quota", async () => {
  const storage = storageWith([]);
  const env = makeEnv(storage, readOpts);
  const kept = report({ appVersion: "0.5.0" });
  await post(env, kept);
  storage.data.get("state").hourCount = GLOBAL_QUOTA;
  const fresh = await post(env, report({ appVersion: "0.5.1" }));
  assert.equal(fresh.status, 429);
  assert.equal(fresh.body.reason, "quota");
  assert.equal((await post(env, kept)).body.reason, "duplicate");
  assert.equal(storage.data.get("state").hourCount, GLOBAL_QUOTA, "duplicate consumed quota");
  assert.equal(storage.data.get("state").entries[0].count, 2);
  clock = BASE + HOUR_MS;
  assert.equal((await post(env, report({ appVersion: "0.5.2" }))).body.accepted, true, "new hour");
});
await test("IP rate limit still applies to duplicates", async () => {
  const storage = storageWith([]);
  const env = makeEnv(storage, readOpts);
  const ip = "dup-ip-rate";
  const body = report({ appVersion: "0.6.0" });
  for (let i = 0; i < 10; i++) await post(env, body, ip);
  const limited = await post(env, body, ip);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "ip_rate");
  assert.equal(storage.data.get("state").entries[0].count, 10, "rate-limited request was counted");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
