/**
 * The Stage 0 observation file writer (governorObservationLog.ts), with the
 * FS mocked: chained write order, the 4 MB rotation, the 32-row queue cap
 * with dropped:<n>, and a failed write that the next append survives.
 */
import type { GovernorObservationRow } from "../governorObservation";

const row = (t: string): GovernorObservationRow =>
  ({
    v: 1,
    t,
    round: 1,
    attempt: 1,
    gap: 0,
    fp: { model: "m", soc: "s", pin: "p" },
    first_row: 1,
    state: "FAST",
    src: "battery",
    status: -1,
    batt: 300,
    level: 50,
    plugged: 0,
    prompt_n: null,
    pred_n: null,
    pred_ms: null,
    pps: null,
    engine_prefill: null,
    prefill_ms: null,
    prefill_dev: null,
    wall: [0, 0],
    first: Array(13).fill(null),
    bsys: [0, null, 0, null],
    hl: null,
    duty: 1,
    paced: [0, 0],
    tok: [0, 0, 0],
    us: [0, 0, 0],
    hops: 0,
    rule: null,
    trips: Array(6).fill(null),
    win: [],
    win_ovf: 0,
  }) as GovernorObservationRow;

// The mock's state, shared with the jest.mock factory below and re-created
// per test in beforeEach.
const mockFs = {
  writes: [] as Array<{ uri: string; content: string }>,
  moves: [] as Array<{ from: string; to: string }>,
  fileSize: 0,
  failNextWrites: 0,
  // When set, the next makeDirectoryAsync awaits this promise first: a slow
  // FS under an in-flight batch.
  mkdirBlock: null as Promise<void> | null,
};

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/documents/",
  makeDirectoryAsync: async () => {
    if (mockFs.mkdirBlock) {
      const block = mockFs.mkdirBlock;
      mockFs.mkdirBlock = null;
      await block;
    }
  },
  getInfoAsync: async () => ({
    exists: mockFs.fileSize > 0,
    isDirectory: false,
    size: mockFs.fileSize,
  }),
  moveAsync: async (arg: { from: string; to: string }) => {
    mockFs.moves.push(arg);
    mockFs.fileSize = 0;
  },
  writeAsStringAsync: async (uri: string, content: string) => {
    if (mockFs.failNextWrites > 0) {
      mockFs.failNextWrites -= 1;
      throw new Error("disk full");
    }
    mockFs.writes.push({ uri, content });
    mockFs.fileSize += content.length;
  },
}));

type LogModule = {
  appendObservation: (row: GovernorObservationRow) => void;
  flushObservationWrites: () => Promise<void>;
  OBSERVATION_LOG_PATH: string;
};

const load = (): LogModule => {
  let mod: LogModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("../governorObservationLog") as LogModule;
  });
  return mod as LogModule;
};

let log: LogModule;

beforeEach(() => {
  mockFs.writes = [];
  mockFs.moves = [];
  mockFs.fileSize = 0;
  mockFs.failNextWrites = 0;
  mockFs.mkdirBlock = null;
  log = load();
});

test("append writes one JSON line to the live file", async () => {
  log.appendObservation(row("7"));
  await log.flushObservationWrites();
  expect(mockFs.writes).toHaveLength(1);
  expect(mockFs.writes[0].uri).toBe("/documents/governor/observations.jsonl");
  const lines = mockFs.writes[0].content.trimEnd().split("\n");
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]).t).toBe("7");
});

test("writes chain in append order and one drain writes every pending row", async () => {
  log.appendObservation(row("a"));
  log.appendObservation(row("b"));
  log.appendObservation(row("c"));
  await log.flushObservationWrites();
  const lines = mockFs.writes[0].content.trimEnd().split("\n");
  expect(lines.map((line) => JSON.parse(line).t)).toEqual(["a", "b", "c"]);
  expect(mockFs.writes).toHaveLength(1);
});

test("a file already over 4 MB rotates to observations.1.jsonl", async () => {
  mockFs.fileSize = 4 * 1024 * 1024 + 1;
  log.appendObservation(row("r"));
  await log.flushObservationWrites();
  expect(mockFs.moves).toEqual([
    {
      from: "/documents/governor/observations.jsonl",
      to: "/documents/governor/observations.1.jsonl",
    },
  ]);
  expect(mockFs.writes[0].uri).toBe("/documents/governor/observations.jsonl");
});

test("rotation fires before the batch would push the file over 4 MB", async () => {
  // Existing size is 10 bytes under the cap: writing this batch would
  // overshoot, so the file rotates first and the batch starts the new one.
  mockFs.fileSize = 4 * 1024 * 1024 - 10;
  log.appendObservation(row("overshoot"));
  await log.flushObservationWrites();
  expect(mockFs.moves).toHaveLength(1);
  const lines = mockFs.writes[0].content.trimEnd().split("\n");
  expect(JSON.parse(lines[0]).t).toBe("overshoot");
});

test("queue cap 32: the oldest pending rows drop, the next written row carries dropped:<n>", async () => {
  // All 34 appends land before the first async drain runs, so the queue
  // overflows by 2.
  for (let i = 0; i < 34; i += 1) {
    log.appendObservation(row(`r${i}`));
  }
  await log.flushObservationWrites();
  const lines = mockFs.writes[0].content.trimEnd().split("\n");
  expect(lines).toHaveLength(32);
  const first = JSON.parse(lines[0]);
  expect(first.t).toBe("r2");
  expect(first.dropped).toBe(2);
  expect(JSON.parse(lines[1]).dropped).toBeUndefined();
});

test("a failed write is swallowed, its rows count into the next row's dropped:<n>", async () => {
  mockFs.failNextWrites = 1;
  log.appendObservation(row("lost1"));
  await log.flushObservationWrites();
  expect(mockFs.writes).toHaveLength(0);
  log.appendObservation(row("kept"));
  await log.flushObservationWrites();
  expect(mockFs.writes).toHaveLength(1);
  const lines = mockFs.writes[0].content.trimEnd().split("\n");
  expect(JSON.parse(lines[0])).toMatchObject({ t: "kept", dropped: 1 });
});

test("overflow during a slow mkdir rides the NEXT written row, not the in-flight batch", async () => {
  let release: () => void = () => undefined;
  mockFs.mkdirBlock = new Promise<void>((resolve) => {
    release = resolve;
  });
  log.appendObservation(row("inflight"));
  // Two microtask ticks: the drain loop forms the batch and parks in mkdir.
  await Promise.resolve();
  await Promise.resolve();
  for (let i = 0; i < 40; i += 1) {
    log.appendObservation(row(`q${i}`));
  }
  release();
  await log.flushObservationWrites();
  const first = mockFs.writes[0].content.trimEnd().split("\n");
  expect(JSON.parse(first[0]).t).toBe("inflight");
  expect(JSON.parse(first[0]).dropped).toBeUndefined();
  const second = mockFs.writes[1].content.trimEnd().split("\n");
  expect(second).toHaveLength(32);
  expect(JSON.parse(second[0])).toMatchObject({ t: "q8", dropped: 8 });
});

test("a failed batch's rows and the overflow both count into the next written row", async () => {
  mockFs.failNextWrites = 1;
  log.appendObservation(row("lost1"));
  log.appendObservation(row("lost2"));
  await log.flushObservationWrites();
  expect(mockFs.writes).toHaveLength(0);
  for (let i = 0; i < 34; i += 1) {
    log.appendObservation(row(`r${i}`));
  }
  await log.flushObservationWrites();
  const lines = mockFs.writes[0].content.trimEnd().split("\n");
  // 2 lost to the failed write + 2 dropped at the queue cap (34 appends
  // into an empty queue keep the last 32).
  expect(lines).toHaveLength(32);
  expect(JSON.parse(lines[0])).toMatchObject({ t: "r2", dropped: 4 });
});

test("rotation counts UTF-8 bytes, not UTF-16 code units", async () => {
  const rotateBytes = 4 * 1024 * 1024;
  const unicodeRow = { ...row("u"), fp: { model: "è-model", soc: "s", pin: "p" } };
  const utf16PayloadLength = JSON.stringify(unicodeRow).length + 1;
  // UTF-16 math would sit exactly AT the cap (no rotate); the byte count is
  // one higher, so the file must rotate.
  mockFs.fileSize = rotateBytes - utf16PayloadLength;
  log.appendObservation(unicodeRow);
  await log.flushObservationWrites();
  expect(mockFs.moves).toHaveLength(1);
  expect(JSON.parse(mockFs.writes[0].content.trimEnd()).fp.model).toBe("è-model");
});
