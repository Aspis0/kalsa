/**
 * v2 diagnostics.logRef: strict format at /report, appended to the stored entry
 * on duplicates (not part of the signature), capped at LOG_REF_CAP. Exit 1 on fail.
 */
import assert from "node:assert/strict";
import { getReports, makeEnv, postReport as post, storageWith } from "./test-support.mjs";

const READ_TOKEN = "logref-read-token-fixture";
const ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const readAuth = `Bearer ${READ_TOKEN}`;

const v2 = (logRef, over = {}) => ({
  v: 2,
  app: "kalsa",
  appVersion: "0.8.0",
  platform: "macos",
  deviceBucket: "mid",
  osMajor: "15",
  error: { code: "engine.init", detail: "native_crash" },
  context: { phase: "turn", modelCategory: "unknown" },
  dateBucket: "2026-10-01",
  manual: false,
  diagnostics: logRef === undefined ? {} : { logRef },
  ...over,
});

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

console.log("\n[logRef format]");
await test("exact <YYYY-MM-DD>/<8 chars of the report alphabet> is accepted", async () => {
  const env = makeEnv(storageWith([]), { READ_TOKEN });
  const refs = ["2026-10-09/ABCD2345", "2026-12-31/HJKMNPQR", "2026-01-01/23456789"];
  for (const [i, ref] of refs.entries()) {
    const r = await post(env, v2(ref, { appVersion: `0.9.${i}` }));
    assert.equal(r.body.accepted, true, `${ref} → ${JSON.stringify(r.body)}`);
  }
});
await test("traversal, extra characters, wrong length or alphabet, bad day → 400 logRef invalid", async () => {
  const env = makeEnv(storageWith([]), { READ_TOKEN });
  const bad = [
    "../2026-10-09/ABCD2345",
    "2026-10-09/../ABCD2345",
    "2026-10-09/ABCD2345/x",
    "2026-10-09/ABCD2345.log",
    "2026-10-09/ABCD2345 ",
    "2026-10-09/ABCD2345\n",
    "2026-10-09/ABCD234",
    "2026-10-09/ABCD23456",
    "2026-10-09/ABCD234O",
    "2026-10-09/ABCD2340",
    "2026-10-09/abcd2345",
    "2026-10-09/ABCD2345é",
    "2026-10-09/",
    "/ABCD2345",
    "2026-10-09//ABCD2345",
    "2026-10-09 ABCD2345",
    "20261009/ABCD2345",
    "2026-1-09/ABCD2345",
    "26-10-09/ABCD2345",
    "2026-10-09/ABCD2345?x=1",
    123,
    ["2026-10-09/ABCD2345"],
  ];
  for (const ref of bad) {
    const r = await post(env, v2(ref));
    assert.equal(r.status, 400, JSON.stringify(ref));
    assert.equal(r.body.reason, "logRef invalid", JSON.stringify(ref));
  }
});
await test("logRef is not part of the signature: a copy with another logRef is a duplicate", async () => {
  const env = makeEnv(storageWith([]), { READ_TOKEN });
  assert.equal((await post(env, v2("2026-10-09/ABCD2345"))).body.accepted, true);
  assert.equal((await post(env, v2("2026-10-09/WXYZ2345"))).body.reason, "duplicate");
  const r = await getReports(env, "", readAuth);
  assert.equal(r.body.total, 1);
});

console.log("\n[logRefs on the stored entry]");
await test("duplicates append new logRefs; a repeat or a missing logRef changes nothing", async () => {
  const env = makeEnv(storageWith([]), { READ_TOKEN });
  await post(env, v2("2026-10-09/ABCD2345"));
  await post(env, v2("2026-10-09/WXYZ2345"));
  assert.equal((await post(env, v2(undefined))).body.reason, "duplicate");
  assert.equal((await post(env, v2("2026-10-09/ABCD2345"))).body.reason, "duplicate");
  const e = (await getReports(env, "", readAuth)).body.entries[0];
  assert.deepEqual(e.logRefs, ["2026-10-09/ABCD2345", "2026-10-09/WXYZ2345"]);
  assert.equal(e.count, 4);
  assert.equal(e.report.diagnostics.logRef, "2026-10-09/ABCD2345", "first accepted copy kept");
});
await test("the list keeps the newest LOG_REF_CAP (10) refs, newest last", async () => {
  const env = makeEnv(storageWith([]), { READ_TOKEN });
  const refs = Array.from({ length: 12 }, (_, i) => `2026-10-09/${ID_ALPHABET[i].repeat(8)}`);
  assert.equal((await post(env, v2(refs[0]))).body.accepted, true);
  for (const ref of refs.slice(1)) assert.equal((await post(env, v2(ref))).body.reason, "duplicate");
  const capped = (await getReports(env, "", readAuth)).body.entries[0];
  assert.equal(capped.count, 12, "every occurrence is counted even when its log ref falls off");
  assert.equal(capped.logRefs.length, 10);
  assert.deepEqual(capped.logRefs, refs.slice(2));
});
await test("entries stored before logRefs existed read as an empty list", async () => {
  const legacy = { reportId: "old", sig: "old-sig", report: v2(undefined), state: "pending", reviewAck: false, leaseUntil: 0, leaseToken: 0, createdAt: Date.UTC(2026, 9, 1) };
  const env = makeEnv(storageWith([legacy]), { READ_TOKEN });
  assert.deepEqual((await getReports(env, "", readAuth)).body.entries[0].logRefs, []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
