import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readObservations } from "../rows.mjs";

const FIXTURE = new URL("./fixture.jsonl", import.meta.url).pathname;
const fixtureLines = readFileSync(FIXTURE, "utf8").trim().split("\n");

const writeTemp = (name, lines) => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "replay-")), name);
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
};

test("the fixture parses and the gap row is dropped, not measured across", () => {
  const { rows, droppedGap, lines } = readObservations(FIXTURE);
  assert.equal(lines, 9);
  assert.equal(rows.length, 8);
  assert.deepEqual(
    rows.map((row) => `${row.t}${row.round}`),
    ["a0", "c0", "d0", "e1", "f0", "g0", "g1", "h0"],
  );
  assert.equal(droppedGap.length, 1);
  assert.equal(droppedGap[0].t, "b");
});

test("rows with and without the M4 prefill fields both parse", () => {
  const { rows } = readObservations(FIXTURE);
  assert.deepEqual(
    rows.filter((row) => "prefill_ms" in row).map((row) => row.t),
    ["e", "f", "g"],
  );
  assert.deepEqual(rows.find((row) => row.t === "f").prefill_dev, ["GPUOpenCL", "GPUOpenCL"]);
});

test("a DESIGN 3.2 11-cell ring is refused rather than read as 13", () => {
  const row = JSON.parse(fixtureLines[0]);
  row.win = row.win.map((sample) => sample.slice(0, 11));
  const file = writeTemp("eleven.jsonl", [JSON.stringify(row)]);
  assert.throws(() => readObservations(file), /win\[0\] has 11 cells, this replay reads 13/);
});

test("a `first` sample of the wrong width is refused too", () => {
  const row = JSON.parse(fixtureLines[0]);
  row.first = row.first.slice(0, 11);
  assert.throws(
    () => readObservations(writeTemp("first.jsonl", [JSON.stringify(row)])),
    /first has 11 cells/,
  );
});

test("a malformed line names the file and the line", () => {
  const file = writeTemp("bad.jsonl", [fixtureLines[0], "{not json"]);
  assert.throws(() => readObservations(file), /bad\.jsonl:2:/);
});