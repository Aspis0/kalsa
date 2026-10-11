// Run with: node --test scripts/merge-manifest.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { mergeRelease, versionOfKey } from "./merge-manifest.mjs";

const artifact = (name, sha) => ({ key: `releases/0.0.1/${name}`, name, size: 10, sha256: sha.repeat(64) });
const withUpdate = (base, sig) => ({ ...base, update: { ...base.update, signature: sig } });

const winInstaller = artifact("Kalsa-alpha-0.0.1-windows.exe", "a");
const macInstaller = artifact("Kalsa-alpha-0.0.1-mac.dmg", "b");
const macUpdate = { ...artifact("Kalsa-alpha-0.0.1-mac.app.tar.gz", "c"), signature: "c2ln" };
const winRelease = { version: "0.0.1", installer: winInstaller, update: { ...winInstaller, signature: "d2lu" } };
const macRelease = { version: "0.0.1", installer: macInstaller, update: { ...macUpdate } };

test("the version of a release key is the segment after releases/", () => {
  assert.equal(versionOfKey("releases/0.0.1/Kalsa.exe"), "0.0.1");
  assert.equal(versionOfKey("secret"), null);
});

test("a fresh manifest holds only the platform being released", () => {
  const next = mergeRelease({}, "windows", winRelease);
  assert.deepEqual(next, { version: "0.0.1", windows: { ...winInstaller, update: winRelease.update }, mac: null });
});

test("the other platform on the same version keeps its installer and its update", () => {
  const current = { version: "0.0.1", windows: winInstaller, mac: withUpdate({ ...macInstaller, update: macUpdate }, "c2ln") };
  const next = mergeRelease(current, "windows", winRelease);
  assert.deepEqual(next.mac, current.mac);
  assert.equal(next.windows.update.signature, "d2lu");
});

test("a release replaces this platform's installer and update", () => {
  const old = { ...winInstaller, key: "releases/0.0.0/Kalsa-alpha-0.0.0-windows.exe", name: "Kalsa-alpha-0.0.0-windows.exe" };
  const next = mergeRelease({ windows: old }, "windows", winRelease);
  assert.equal(next.windows.key, winInstaller.key);
  assert.equal(next.windows.update.signature, "d2lu");
});

test("a platform on another version is refused, naming the flag", () => {
  const current = { mac: { ...macInstaller, key: "releases/0.0.0/Kalsa-alpha-0.0.0-mac.dmg" } };
  assert.throws(() => mergeRelease(current, "windows", winRelease), /--allow-mixed/);
});

test("with mixing allowed, the other platform keeps its installer but loses its update", () => {
  const otherOld = {
    ...macInstaller,
    key: "releases/0.0.0/Kalsa-alpha-0.0.0-mac.dmg",
    update: { ...macUpdate, key: "releases/0.0.0/Kalsa-alpha-0.0.0-mac.app.tar.gz" },
  };
  const next = mergeRelease({ mac: otherOld }, "windows", winRelease, { allowMixed: true });
  assert.equal(next.mac.key, otherOld.key);
  assert.equal("update" in next.mac, false);
  assert.equal(next.version, "0.0.1");
});

test("a manifest from before updates existed merges without error", () => {
  const legacy = { windows: winInstaller, mac: macInstaller };
  const next = mergeRelease(legacy, "mac", macRelease);
  assert.equal(next.windows.key, winInstaller.key);
  assert.equal("update" in next.windows, false);
  assert.equal(next.mac.update.signature, "c2ln");
  assert.equal("notes" in next, false);
});

test("notes survive a later platform release of the same version", () => {
  const current = { version: "0.0.1", notes: "Faster start.", windows: winInstaller, mac: { ...macInstaller, update: macUpdate } };
  assert.equal(mergeRelease(current, "windows", winRelease).notes, "Faster start.");
});

test("a new version without notes drops the old notes", () => {
  const current = { version: "0.0.0", notes: "Old notes.", windows: winInstaller };
  assert.equal("notes" in mergeRelease(current, "mac", macRelease), false);
});

test("notes given with a release replace the kept ones", () => {
  const current = { version: "0.0.1", notes: "Old notes.", windows: winInstaller };
  assert.equal(mergeRelease(current, "mac", { ...macRelease, notes: "New notes." }).notes, "New notes.");
});
