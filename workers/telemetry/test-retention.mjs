/**
 * Retention: the DO alarm is what deletes accepted reports older than 90 days,
 * with nobody running a command. Covers the arm on store, the sweep, its
 * boundary, the re-arm while anything remains, and the empty-buffer cases.
 * Exit 1 on fail.
 */
import assert from "node:assert/strict";
import {
  BASE,
  FakeStorage,
  entry,
  getReports,
  makeBuffer,
  makeEnv,
  postReport as post,
  storageWith,
} from "./test-support.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * DAY_MS;
const READ_TOKEN = "retention-read-token-fixture";
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
  error: { code: "engine.init", detail: "native_crash" },
  context: { phase: "load", modelCategory: "unknown" },
  dateBucket: "2026-10-01",
  manual: false,
  ...over,
});

const reportIds = (storage) => storage.data.get("state").entries.map((e) => e.reportId);

/** Construct the DO over this storage and let its constructor finish booting. */
async function open(storage) {
  const { buffer, ready } = makeBuffer(storage);
  await ready;
  return buffer;
}

/**
 * One sweep, the way Cloudflare runs it: a construction, the pending alarm
 * firing (which consumes it), then the handler. The fake storage does not model
 * that consumption itself, so this does — otherwise a wake armed by the
 * constructor would look like an alarm the sweep left behind.
 */
async function sweep(storage) {
  const buffer = await open(storage);
  storage.alarm = null;
  await buffer.alarm();
}

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

console.log("\n[arming]");
await test("storing a report arms the alarm at that entry's 90-day mark", async () => {
  const storage = storageWith([]);
  const env = makeEnv(storage);
  assert.deepEqual((await post(env, report())).body, { accepted: true });
  assert.equal(storage.alarm, BASE + RETENTION_MS + 1, "armed just past the mark");
});
await test("a duplicate re-arms without moving the mark: retention runs from createdAt", async () => {
  const storage = storageWith([]);
  const env = makeEnv(storage);
  const body = report();
  await post(env, body);
  clock = BASE + 30 * DAY_MS;
  assert.equal((await post(env, body)).body.reason, "duplicate");
  assert.equal(storage.alarm, BASE + RETENTION_MS + 1, "lastSeenAt must not extend retention");
});
await test("a fresh DO with nothing stored sets no alarm", async () => {
  const storage = new FakeStorage();
  await open(storage);
  assert.equal(storage.alarm, null);
  assert.equal(await storage.getAlarm(), null);
});
await test("an empty buffer stored nothing, so an alarm sweep arms nothing", async () => {
  const storage = storageWith([]);
  await sweep(storage);
  assert.equal(storage.alarm, null);
});
await test("a DO holding entries and no alarm re-arms when it is constructed", async () => {
  // The deploy case: entries stored before this Worker shipped have no alarm,
  // and silence must not keep them forever.
  const storage = storageWith([entry(1, BASE), entry(2, BASE + DAY_MS)]);
  assert.equal(storage.alarm, null);
  await open(storage);
  assert.equal(storage.alarm, BASE + RETENTION_MS + 1, "armed for the oldest entry");
});
await test("an armed alarm is left alone when the DO is constructed", async () => {
  const storage = storageWith([entry(1, BASE)]);
  const later = BASE + RETENTION_MS + 7;
  storage.alarm = later;
  await open(storage);
  assert.equal(storage.alarm, later, "the constructor must not shorten a live wake");
});
await test("a quota reject re-arms too: any traffic re-establishes the wake", async () => {
  const storage = storageWith([]);
  const env = makeEnv(storage);
  await post(env, report());
  storage.alarm = null; // an alarm whose retries ran out
  storage.data.get("state").hourCount = GLOBAL_QUOTA; // same hour bucket, so no reset
  assert.equal((await post(env, report({ appVersion: "0.9.0" }))).body.reason, "quota");
  assert.notEqual(storage.alarm, null, "the rejected write re-armed the sweep");
});

console.log("\n[the sweep]");
await test("the alarm deletes only reports older than 90 days", async () => {
  const now = BASE + 200 * DAY_MS;
  clock = now;
  const storage = storageWith([
    entry(1, now - 89 * DAY_MS),
    entry(2, now - RETENTION_MS), // exactly at the mark is not older than it
    entry(3, now - RETENTION_MS - 1),
  ]);
  await sweep(storage);
  assert.deepEqual(reportIds(storage), ["rid-1", "rid-2"]);
});
await test("the alarm re-arms for the oldest report still stored", async () => {
  const now = BASE + 200 * DAY_MS;
  clock = now;
  const storage = storageWith([entry(3, now - RETENTION_MS - 1), entry(1, now - 10 * DAY_MS)]);
  await sweep(storage);
  assert.deepEqual(reportIds(storage), ["rid-1"]);
  assert.equal(storage.alarm, now - 10 * DAY_MS + RETENTION_MS + 1, "next wake is the survivor's mark");
});
await test("nothing left to expire leaves no alarm armed", async () => {
  const now = BASE + 200 * DAY_MS;
  clock = now;
  const storage = storageWith([entry(3, now - RETENTION_MS - 1)]);
  await sweep(storage);
  assert.deepEqual(reportIds(storage), []);
  assert.equal(storage.alarm, null);
});
await test("a purge empties the buffer and leaves the wake to fire on nothing", async () => {
  // Deliberately not deleting the alarm: doing so races an append that armed
  // one, and a wake against an empty buffer is one no-op that arms nothing.
  const storage = storageWith([entry(1, BASE)]);
  storage.alarm = BASE + RETENTION_MS + 1;
  const res = await (await open(storage)).fetch(new Request("https://do/purge", { method: "POST" }));
  assert.deepEqual(await res.json(), { purged: 1 });
  await sweep(storage);
  assert.deepEqual(reportIds(storage), []);
  assert.equal(storage.alarm, null, "the wake fired on nothing and armed nothing");
});
await test("an entry whose createdAt is unreadable is dropped, not kept forever", async () => {
  const now = BASE + 200 * DAY_MS;
  clock = now;
  const broken = entry(9, undefined);
  const storage = storageWith([broken, entry(1, now - 10 * DAY_MS)]);
  await sweep(storage);
  assert.deepEqual(reportIds(storage), ["rid-1"], "the fresh entry survives");
});
await test("a wake at exactly the mark drops nothing and arms the next instant", async () => {
  const storage = storageWith([entry(1, BASE)]);
  clock = BASE + RETENTION_MS; // the mark itself, which is not "older than" it
  await sweep(storage);
  assert.deepEqual(reportIds(storage), ["rid-1"]);
  assert.equal(storage.alarm, clock + 1, "one millisecond past the mark, not the same instant");
});

console.log("\n[end to end through the route]");
await test("a stored report is unreadable after its mark without anyone asking", async () => {
  const storage = storageWith([]);
  const env = makeEnv(storage, { READ_TOKEN });
  const older = report({ appVersion: "0.1.0" });
  const newer = report({ appVersion: "0.1.1" });
  await post(env, older);
  clock = BASE + 100 * DAY_MS;
  await post(env, newer);
  assert.equal(storage.data.get("state").entries.length, 2);

  clock = BASE + RETENTION_MS + 1; // only `older` is past its mark by now
  await sweep(storage);
  const read = await getReports(env, "", `Bearer ${READ_TOKEN}`);
  assert.equal(read.body.total, 1);
  assert.deepEqual(read.body.entries[0].report, newer);
  assert.equal(storage.alarm, BASE + 100 * DAY_MS + RETENTION_MS + 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);