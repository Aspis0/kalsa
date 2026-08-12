/**
 * Opt-in crash/error telemetry for Kalsa (TELEMETRY_OPTIN.md v14 FINAL).
 *
 * Default OFF. Fire-and-forget. Never throws to callers.
 * Allowlist-only reports — no chat, docs, keys, stacks, URLs, paths.
 */

import {
  BODY_SOFT_LIMIT_BYTES,
  FETCH_TIMEOUT_MS,
  GITHUB_ISSUE_CHOOSE_URL,
  LOCAL_FINGERPRINT_CACHE,
  OPTED_OUT_KEY,
  SENDING_LEASE_MS,
  STATE_KEY_A,
  STATE_KEY_B,
  STATE_POINTER_KEY,
  TELEMETRY_URL_OVERRIDE_KEY,
  TELEMETRY_WORKER_URL,
  type ReasonCode,
} from "./config";
import {
  classifyChatFailure,
  classifyEmbedFailure,
  classifyEngineInitFailure,
  classifyHttpDetail,
  classifyHttpStatus,
  classifyNetworkFailure,
  dateBucketUtc,
  deviceBucketFromRamTier,
  dropStaleEpochItems,
  emptyEnvelope,
  enqueueCapped,
  expungeDead,
  extractSignal,
  finalizeItemOutcome,
  formatManualReportPreview,
  isReadyToSend,
  localFingerprint,
  makeQueueItem,
  makeTombstone,
  markSending,
  memoryClassFromBytes,
  modelCategoryFromId,
  osMajorFromVersion,
  parseEnvelopeJson,
  recoverExpiredLeases,
  sanitizeReport,
  selectJournalSlot,
  verifyTombstone,
  withIntegrity,
  type QueueItem,
  type RamTierLike,
  type SanitizeInput,
  type TelemetryEnvelope,
  type TelemetryReport,
  type Tombstone,
} from "./pure";
import type { Phase } from "./config";

export {
  sanitizeReport,
  formatManualReportPreview,
  localFingerprint,
  deviceBucketFromRamTier,
  memoryClassFromBytes,
  modelCategoryFromId,
  extractSignal,
  classifyNetworkFailure,
  classifyEngineInitFailure,
  classifyChatFailure,
  classifyEmbedFailure,
  classifyHttpDetail,
  GITHUB_ISSUE_CHOOSE_URL,
};
export type { TelemetryReport, SanitizeInput, ReasonCode, Phase };

// ── Injected deps (defaults use RN; harness injects mocks) ──────────────────

export type StorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiGet?(keys: string[]): Promise<readonly [string, string | null][]>;
  multiRemove?(keys: string[]): Promise<void>;
};

export type TelemetryDeps = {
  storage: StorageLike;
  fetchImpl: typeof fetch;
  now: () => number;
  /** "active" | "background" | "inactive" | … */
  getAppState: () => string;
  getAppVersion: () => string;
  getDeviceContext: () => {
    ramTier: RamTierLike | null;
    totalMemoryBytes: number | null;
    osVersion: string | null;
    modelId: string | null;
    hadWebTools: boolean;
  };
  /** Optional: listen for AppState changes; return unsubscribe. */
  subscribeAppState?: (cb: (state: string) => void) => () => void;
  log?: (msg: string) => void;
};

let deps: TelemetryDeps | null = null;

// ── In-process state ────────────────────────────────────────────────────────

let mutex: Promise<void> = Promise.resolve();
let envelope: TelemetryEnvelope = emptyEnvelope();
let loaded = false;
/** Gate: true while ON transition incomplete (tombstone not yet cleared). */
let tombstoneGate = false;
/** True when a durable valid tombstone is present (or uncertain → fail-closed). */
let optedOut = true; // fail-closed until load proves otherwise
let drainRunning = false;
const abortRegistry = new Set<AbortController>();
const recentFingerprints: string[] = [];
let idSeq = 0;
let unsubAppState: (() => void) | null = null;

function log(msg: string): void {
  // Never log payload contents — status only.
  try {
    deps?.log?.(msg);
  } catch {
    /* ignore */
  }
}

function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutex.then(fn, fn);
  mutex = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function defaultStorage(): StorageLike {
  // Lazy require so pure tests never pull RN.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AsyncStorage = require("@react-native-async-storage/async-storage")
    .default as StorageLike;
  return AsyncStorage;
}

function defaultDeps(): TelemetryDeps {
  let appState = "active";
  let subscribe: TelemetryDeps["subscribeAppState"];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require("react-native") as {
      AppState: {
        currentState: string;
        addEventListener: (
          type: string,
          cb: (s: string) => void,
        ) => { remove: () => void };
      };
    };
    appState = AppState.currentState ?? "active";
    subscribe = (cb) => {
      const sub = AppState.addEventListener("change", cb);
      return () => sub.remove();
    };
  } catch {
    subscribe = undefined;
  }

  return {
    storage: defaultStorage(),
    fetchImpl: globalThis.fetch.bind(globalThis),
    now: () => Date.now(),
    getAppState: () => appState,
    getAppVersion: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Constants = require("expo-constants").default as {
          expoConfig?: { version?: string };
          nativeAppVersion?: string;
        };
        return (
          Constants.expoConfig?.version ??
          Constants.nativeAppVersion ??
          "0.1.0"
        );
      } catch {
        return "0.1.0";
      }
    },
    getDeviceContext: () => ({
      ramTier: "low",
      totalMemoryBytes: null,
      osVersion: null,
      modelId: null,
      hadWebTools: false,
    }),
    subscribeAppState: subscribe
      ? (cb) => {
          // Keep getAppState in sync if caller uses default.
          return subscribe!((s) => {
            appState = s;
            cb(s);
          });
        }
      : undefined,
  };
}

// ── Journal I/O ─────────────────────────────────────────────────────────────

async function readTombstone(storage: StorageLike): Promise<
  | { kind: "valid"; tombstone: Tombstone }
  | { kind: "absent" }
  | { kind: "torn" }
> {
  try {
    const raw = await storage.getItem(OPTED_OUT_KEY);
    if (raw == null || raw === "") return { kind: "absent" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: "torn" };
    }
    const t = verifyTombstone(parsed);
    if (!t) return { kind: "torn" };
    return { kind: "valid", tombstone: t };
  } catch {
    return { kind: "torn" };
  }
}

async function writeTombstone(storage: StorageLike, nowMs: number): Promise<boolean> {
  try {
    const t = makeTombstone(nowMs);
    await storage.setItem(OPTED_OUT_KEY, JSON.stringify(t));
    // Verify round-trip
    const check = await readTombstone(storage);
    return check.kind === "valid";
  } catch {
    return false;
  }
}

async function clearTombstone(storage: StorageLike): Promise<boolean> {
  try {
    await storage.removeItem(OPTED_OUT_KEY);
    const check = await readTombstone(storage);
    return check.kind === "absent";
  } catch {
    return false;
  }
}

async function readJournal(
  storage: StorageLike,
): Promise<TelemetryEnvelope> {
  let rawA: string | null = null;
  let rawB: string | null = null;
  let pointer: string | null = null;
  try {
    if (storage.multiGet) {
      const rows = await storage.multiGet([
        STATE_KEY_A,
        STATE_KEY_B,
        STATE_POINTER_KEY,
      ]);
      const map = new Map(rows);
      rawA = map.get(STATE_KEY_A) ?? null;
      rawB = map.get(STATE_KEY_B) ?? null;
      pointer = map.get(STATE_POINTER_KEY) ?? null;
    } else {
      rawA = await storage.getItem(STATE_KEY_A);
      rawB = await storage.getItem(STATE_KEY_B);
      pointer = await storage.getItem(STATE_POINTER_KEY);
    }
  } catch {
    return emptyEnvelope();
  }

  const slotA = parseEnvelopeJson(rawA);
  const slotB = parseEnvelopeJson(rawB);
  const hint =
    pointer === "A" || pointer === "B" ? (pointer as "A" | "B") : null;
  const selected = selectJournalSlot(slotA, slotB, hint);
  if (!selected) {
    // Both corrupt → fail-closed reset
    return emptyEnvelope({ enabled: false, generation: 1, transitionEpoch: 0, seq: 0 });
  }
  return selected.envelope;
}

async function writeJournal(
  storage: StorageLike,
  env: TelemetryEnvelope,
  activeSlot: "A" | "B" | null,
): Promise<"A" | "B"> {
  const nextSeq = (env.seq ?? 0) + 1;
  const next = withIntegrity({
    v: 1,
    enabled: env.enabled,
    generation: env.generation,
    transitionEpoch: env.transitionEpoch,
    queue: env.queue,
    dead: env.dead,
    seq: nextSeq,
  });
  const writeSlot: "A" | "B" = activeSlot === "A" ? "B" : "A";
  const key = writeSlot === "A" ? STATE_KEY_A : STATE_KEY_B;
  await storage.setItem(key, JSON.stringify(next));
  await storage.setItem(STATE_POINTER_KEY, writeSlot);
  envelope = next;
  return writeSlot;
}

let activeSlot: "A" | "B" | null = null;

async function persist(env: TelemetryEnvelope): Promise<void> {
  if (!deps) return;
  // Expunge dead on every write
  const now = deps.now();
  const cleaned: TelemetryEnvelope = {
    ...env,
    dead: expungeDead(env.dead, now),
  };
  activeSlot = await writeJournal(deps.storage, cleaned, activeSlot);
}

// ── Load / enable / disable ─────────────────────────────────────────────────

export async function initTelemetry(overrides?: Partial<TelemetryDeps>): Promise<void> {
  try {
    deps = { ...defaultDeps(), ...overrides };
    if (overrides?.storage) deps.storage = overrides.storage;
    if (overrides?.fetchImpl) deps.fetchImpl = overrides.fetchImpl;
    if (overrides?.now) deps.now = overrides.now;
    if (overrides?.getAppState) deps.getAppState = overrides.getAppState;
    if (overrides?.getAppVersion) deps.getAppVersion = overrides.getAppVersion;
    if (overrides?.getDeviceContext) {
      deps.getDeviceContext = overrides.getDeviceContext;
    }
    if (overrides?.subscribeAppState) {
      deps.subscribeAppState = overrides.subscribeAppState;
    }
    if (overrides?.log) deps.log = overrides.log;

    await withMutex(async () => {
      const storage = deps!.storage;
      const tomb = await readTombstone(storage);
      if (tomb.kind === "torn") {
        // Fail-closed: treat as opted out
        optedOut = true;
        tombstoneGate = false;
        envelope = emptyEnvelope({ enabled: false, generation: 1 });
        activeSlot = await writeJournal(storage, envelope, null);
        loaded = true;
        log("telemetry: tombstone torn → fail-closed OFF");
        return;
      }
      if (tomb.kind === "valid") {
        optedOut = true;
        tombstoneGate = false;
        // Discard any residual envelope
        envelope = emptyEnvelope({ enabled: false, generation: 1 });
        activeSlot = await writeJournal(storage, envelope, null);
        loaded = true;
        log("telemetry: tombstone present → OFF");
        return;
      }

      // No tombstone
      optedOut = false;
      const env = await readJournal(storage);
      const now = deps!.now();
      let queue = recoverExpiredLeases(env.queue, now);
      const dropped = dropStaleEpochItems(
        queue,
        env.generation,
        env.transitionEpoch,
      );
      queue = dropped.kept;
      const dead = expungeDead(env.dead, now);
      envelope = withIntegrity({
        ...env,
        queue,
        dead,
        // If envelope claimed enabled but we had no tombstone, honour it
        // only when integrity-valid (already checked).
        enabled: env.enabled === true,
      });
      // Re-persist cleaned
      activeSlot = await writeJournal(storage, envelope, null);
      loaded = true;
      log(
        `telemetry: loaded enabled=${envelope.enabled} queue=${envelope.queue.length}`,
      );
    });

    if (unsubAppState) {
      try {
        unsubAppState();
      } catch {
        /* ignore */
      }
      unsubAppState = null;
    }
    if (deps.subscribeAppState) {
      unsubAppState = deps.subscribeAppState((state) => {
        if (state !== "active") {
          void onBackgroundTransition();
        } else {
          void maybeDrain();
        }
      });
    }

    if (envelope.enabled) {
      void maybeDrain();
    }
  } catch {
    loaded = true;
    optedOut = true;
    envelope = emptyEnvelope();
  }
}

/** Test-only: reset in-process state. */
export function __resetTelemetryForTests(): void {
  envelope = emptyEnvelope();
  loaded = false;
  tombstoneGate = false;
  optedOut = true;
  drainRunning = false;
  abortRegistry.clear();
  recentFingerprints.length = 0;
  idSeq = 0;
  activeSlot = null;
  deps = null;
  if (unsubAppState) {
    try {
      unsubAppState();
    } catch {
      /* ignore */
    }
    unsubAppState = null;
  }
}

export function __getTelemetrySnapshotForTests(): {
  enabled: boolean;
  generation: number;
  transitionEpoch: number;
  queueLen: number;
  deadLen: number;
  optedOut: boolean;
  tombstoneGate: boolean;
  envelope: TelemetryEnvelope;
} {
  return {
    enabled: envelope.enabled,
    generation: envelope.generation,
    transitionEpoch: envelope.transitionEpoch,
    queueLen: envelope.queue.length,
    deadLen: envelope.dead.length,
    optedOut,
    tombstoneGate,
    envelope: JSON.parse(JSON.stringify(envelope)) as TelemetryEnvelope,
  };
}

function isForeground(): boolean {
  const s = deps?.getAppState() ?? "active";
  return s === "active";
}

async function resolveWorkerUrl(): Promise<string | null> {
  if (!deps) return null;
  try {
    const override = await deps.storage.getItem(TELEMETRY_URL_OVERRIDE_KEY);
    if (typeof override === "string" && override.trim()) {
      return override.trim().replace(/\/$/, "");
    }
  } catch {
    /* ignore */
  }
  const base = (TELEMETRY_WORKER_URL || "").trim();
  if (!base) return null;
  return base.replace(/\/$/, "");
}

/**
 * Enable telemetry (opt-in). Ordering (v14):
 * (1) durable enabled envelope under mutex + tombstoneGate
 * (2) THEN clear tombstone
 * If (2) fails → roll envelope back to OFF (fail-closed).
 */
export async function setTelemetryEnabled(enabled: boolean): Promise<boolean> {
  try {
    if (!deps) await initTelemetry();
    if (!deps) return false;

    return await withMutex(async () => {
      const storage = deps!.storage;
      const now = deps!.now();

      if (!enabled) {
        // OFF: (1) write tombstone FIRST, (2) barrier epoch, (3) abort, (4) purge
        tombstoneGate = true;
        const tombOk = await writeTombstone(storage, now);
        if (!tombOk) {
          // Uncertain tombstone → still fail-closed OFF
          log("telemetry: tombstone write uncertain → fail-closed OFF");
        }
        optedOut = true;

        // transitionEpoch barrier BEFORE aborting fetches
        const nextEpoch = envelope.transitionEpoch + 1;
        const purged = withIntegrity({
          v: 1,
          enabled: false,
          generation: envelope.generation + 1,
          transitionEpoch: nextEpoch,
          queue: [],
          dead: [],
          seq: envelope.seq,
        });
        activeSlot = await writeJournal(storage, purged, activeSlot);
        envelope = purged;

        // Abort in-flight after barrier commit
        for (const c of abortRegistry) {
          try {
            c.abort();
          } catch {
            /* ignore */
          }
        }
        tombstoneGate = false;
        log("telemetry: disabled + purged");
        return true;
      }

      // ON: (1) write enabled envelope with gate held, (2) clear tombstone
      tombstoneGate = true;
      optedOut = false;
      const nextGen = envelope.generation + 1;
      const enabledEnv = withIntegrity({
        v: 1,
        enabled: true,
        generation: nextGen,
        transitionEpoch: envelope.transitionEpoch,
        queue: [],
        dead: [],
        seq: envelope.seq,
      });
      activeSlot = await writeJournal(storage, enabledEnv, activeSlot);
      envelope = enabledEnv;

      const cleared = await clearTombstone(storage);
      if (!cleared) {
        // Roll back to OFF — fail-closed; keep/write tombstone
        await writeTombstone(storage, now);
        optedOut = true;
        const rolled = withIntegrity({
          v: 1,
          enabled: false,
          generation: nextGen + 1,
          transitionEpoch: envelope.transitionEpoch,
          queue: [],
          dead: [],
          seq: envelope.seq,
        });
        activeSlot = await writeJournal(storage, rolled, activeSlot);
        envelope = rolled;
        tombstoneGate = false;
        log("telemetry: clear tombstone failed → rolled OFF");
        return false;
      }

      optedOut = false;
      tombstoneGate = false;
      log("telemetry: enabled");
      // Drain outside mutex
      queueMicrotask(() => {
        void maybeDrain();
      });
      return true;
    });
  } catch {
    return false;
  }
}

export function isTelemetryEnabled(): boolean {
  return (
    loaded &&
    envelope.enabled &&
    !optedOut &&
    !tombstoneGate
  );
}

export async function getTelemetryEnabled(): Promise<boolean> {
  try {
    if (!loaded) await initTelemetry();
    return isTelemetryEnabled();
  } catch {
    return false;
  }
}

async function onBackgroundTransition(): Promise<void> {
  try {
    if (!deps || !envelope.enabled) return;
    await withMutex(async () => {
      // Barrier commit BEFORE abort
      const nextEpoch = envelope.transitionEpoch + 1;
      // Mark sending items dropped (terminal) under new epoch
      const queue = envelope.queue
        .filter((it) => {
          if (it.state === "sending") return false; // terminal drop
          if (it.transitionEpoch !== envelope.transitionEpoch) return false;
          return true;
        })
        .map((it) => ({ ...it, transitionEpoch: nextEpoch }));
      const next = withIntegrity({
        ...envelope,
        transitionEpoch: nextEpoch,
        queue,
        dead: expungeDead(envelope.dead, deps!.now()),
        seq: envelope.seq,
      });
      activeSlot = await writeJournal(deps!.storage, next, activeSlot);
      envelope = next;
      for (const c of abortRegistry) {
        try {
          c.abort();
        } catch {
          /* ignore */
        }
      }
    });
  } catch {
    /* never throw */
  }
}

// ── Report API ──────────────────────────────────────────────────────────────

export type ReportTelemetryInput = {
  code: ReasonCode;
  detail?: string;
  /** Raw message ONLY for extractSignal — never stored/sent as text. */
  rawMessage?: string;
  phase?: Phase;
  chunks?: number;
  manual?: boolean;
  /** Optional overrides (tests / manual dialog). */
  modelId?: string | null;
  hadWebTools?: boolean;
};

/**
 * Fire-and-forget. Never throws. No-ops when OFF, background, or tombstoneGate.
 */
export function reportTelemetry(input: ReportTelemetryInput): void {
  try {
    void reportTelemetryAsync(input);
  } catch {
    /* never throw */
  }
}

async function reportTelemetryAsync(input: ReportTelemetryInput): Promise<void> {
  try {
    if (!deps) await initTelemetry();
    if (!deps) return;
    if (!loaded) return;
    if (tombstoneGate || optedOut || !envelope.enabled) return;
    if (!isForeground()) return;

    const ctx = deps.getDeviceContext();
    const sanitized = sanitizeReport({
      code: input.code,
      detail: input.detail,
      rawMessage: input.rawMessage,
      appVersion: deps.getAppVersion(),
      deviceBucket: deviceBucketFromRamTier(ctx.ramTier),
      osMajor: osMajorFromVersion(ctx.osVersion),
      modelCategory: modelCategoryFromId(
        input.modelId ?? ctx.modelId,
      ),
      memoryClass: memoryClassFromBytes(ctx.totalMemoryBytes),
      hadWebTools:
        typeof input.hadWebTools === "boolean"
          ? input.hadWebTools
          : ctx.hadWebTools,
      phase: input.phase,
      chunks: input.chunks,
      dateBucket: dateBucketUtc(deps.now()),
      manual: input.manual === true,
    });
    if (!sanitized) return;

    const fp = localFingerprint(sanitized);
    if (recentFingerprints.includes(fp)) return;
    recentFingerprints.push(fp);
    if (recentFingerprints.length > LOCAL_FINGERPRINT_CACHE) {
      recentFingerprints.shift();
    }

    await withMutex(async () => {
      if (tombstoneGate || optedOut || !envelope.enabled) return;
      if (!isForeground()) return;
      // Capture generation/epoch under mutex
      const gen = envelope.generation;
      const epoch = envelope.transitionEpoch;
      idSeq += 1;
      const id = `t${deps!.now().toString(36)}_${idSeq}`;
      const item = makeQueueItem(sanitized, gen, epoch, id);
      const queue = enqueueCapped(envelope.queue, item);
      const next = withIntegrity({
        ...envelope,
        queue,
        dead: expungeDead(envelope.dead, deps!.now()),
        seq: envelope.seq,
      });
      activeSlot = await writeJournal(deps!.storage, next, activeSlot);
      envelope = next;
    });

    void maybeDrain();
  } catch {
    /* never throw */
  }
}

/** Build a sanitized manual report for the Settings dialog (does not enqueue). */
export function buildManualReportPreview(input?: {
  code?: ReasonCode;
  detail?: string;
}): TelemetryReport | null {
  try {
    const ctx = deps?.getDeviceContext() ?? {
      ramTier: "low" as const,
      totalMemoryBytes: null,
      osVersion: null,
      modelId: null,
      hadWebTools: false,
    };
    return sanitizeReport({
      code: input?.code ?? "unknown",
      detail: input?.detail,
      appVersion: deps?.getAppVersion() ?? "0.1.0",
      deviceBucket: deviceBucketFromRamTier(ctx.ramTier),
      osMajor: osMajorFromVersion(ctx.osVersion),
      modelCategory: modelCategoryFromId(ctx.modelId),
      memoryClass: memoryClassFromBytes(ctx.totalMemoryBytes),
      hadWebTools: ctx.hadWebTools,
      dateBucket: dateBucketUtc(deps?.now() ?? Date.now()),
      manual: true,
    });
  } catch {
    return null;
  }
}

// ── Drain ───────────────────────────────────────────────────────────────────

async function maybeDrain(): Promise<void> {
  try {
    if (!deps || !loaded) return;
    if (tombstoneGate || optedOut || !envelope.enabled) return;
    if (!isForeground()) return;
    if (drainRunning) return;
    drainRunning = true;
    try {
      await drainOnce();
    } finally {
      drainRunning = false;
    }
  } catch {
    drainRunning = false;
  }
}

async function drainOnce(): Promise<void> {
  if (!deps) return;
  const baseUrl = await resolveWorkerUrl();
  if (!baseUrl) {
    // Silently disabled — no endpoint configured
    return;
  }

  // Pick one ready item under mutex: create AbortController FIRST, then
  // gate + register + dequeue atomic.
  type DrainWork = {
    item: QueueItem;
    controller: AbortController;
    generation: number;
    transitionEpoch: number;
  };
  // Holder avoids TS control-flow narrowing to `never` after async closure assign.
  const workHold: { current: DrainWork | null } = { current: null };

  await withMutex(async () => {
    if (tombstoneGate || optedOut || !envelope.enabled) return;
    if (!isForeground()) return;

    const now = deps!.now();
    // Recover leases / expunge
    let queue = recoverExpiredLeases(envelope.queue, now);
    const stale = dropStaleEpochItems(
      queue,
      envelope.generation,
      envelope.transitionEpoch,
    );
    queue = stale.kept;
    const dead = expungeDead(envelope.dead, now);

    const idx = queue.findIndex((it) => isReadyToSend(it, now));
    if (idx < 0) {
      if (queue !== envelope.queue || dead !== envelope.dead) {
        const next = withIntegrity({
          ...envelope,
          queue,
          dead,
          seq: envelope.seq,
        });
        activeSlot = await writeJournal(deps!.storage, next, activeSlot);
        envelope = next;
      }
      return;
    }

    // (2) create AbortController FIRST
    const controller = new AbortController();
    // (3) gate + register + dequeue atomic
    if (tombstoneGate || optedOut || !envelope.enabled || !isForeground()) {
      return;
    }
    abortRegistry.add(controller);

    const original = queue[idx]!;
    const sending = markSending(original, now, SENDING_LEASE_MS);
    const nextQueue = [...queue];
    nextQueue[idx] = sending;

    const next = withIntegrity({
      ...envelope,
      queue: nextQueue,
      dead,
      seq: envelope.seq,
    });
    activeSlot = await writeJournal(deps!.storage, next, activeSlot);
    envelope = next;

    workHold.current = {
      item: sending,
      controller,
      generation: envelope.generation,
      transitionEpoch: envelope.transitionEpoch,
    };
  });

  const work = workHold.current;
  if (!work) return;

  // Mutex released — fetch outside
  const { item, controller, generation, transitionEpoch } = work;
  let responseClass: ReturnType<typeof classifyHttpStatus> | "requeue" =
    "requeue";
  let duplicate = false;
  let transitionAbort = false;

  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  }, FETCH_TIMEOUT_MS);

  try {
    if (controller.signal.aborted) {
      transitionAbort = true;
    } else {
      const body = JSON.stringify(item.report);
      if (body.length > BODY_SOFT_LIMIT_BYTES) {
        responseClass = "definitive_drop";
      } else {
        const res = await deps.fetchImpl(`${baseUrl}/report`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
          },
          body,
          signal: controller.signal,
        });
        if (res.status === 200) {
          try {
            const json = (await res.json()) as {
              accepted?: boolean;
              reason?: string;
            };
            if (json && json.accepted === false && json.reason === "duplicate") {
              duplicate = true;
              responseClass = "accepted";
            } else if (json && json.accepted === false && json.reason === "quota") {
              responseClass = "backoff";
            } else {
              responseClass = "accepted";
            }
          } catch {
            responseClass = "accepted";
          }
        } else {
          responseClass = classifyHttpStatus(res.status);
        }
      }
    }
  } catch {
    // abort or network
    if (controller.signal.aborted) {
      // If generation/epoch already advanced, treat as transition drop
      if (
        envelope.generation !== generation ||
        envelope.transitionEpoch !== transitionEpoch ||
        !envelope.enabled
      ) {
        transitionAbort = true;
      } else {
        responseClass = "requeue"; // timeout
      }
    } else {
      responseClass = "requeue";
    }
  } finally {
    clearTimeout(timer);
    abortRegistry.delete(controller);
  }

  // Finalizer under mutex
  await withMutex(async () => {
    const now = deps!.now();
    const liveGen = envelope.generation;
    const liveEpoch = envelope.transitionEpoch;
    const enabled = envelope.enabled && !optedOut && !tombstoneGate;

    // Remove the sending item from queue first
    const remaining = envelope.queue.filter((q) => q.id !== item.id);

    const outcome = finalizeItemOutcome({
      item,
      liveGeneration: liveGen,
      liveTransitionEpoch: liveEpoch,
      enabled,
      responseClass: transitionAbort ? "transition_drop" : responseClass,
      nowMs: now,
      duplicate,
    });

    let queue = remaining;
    let dead = expungeDead(envelope.dead, now);

    // generation captured at send must still match for requeue/dead
    if (
      item.generation !== liveGen ||
      item.transitionEpoch !== liveEpoch ||
      !enabled
    ) {
      // terminal drop every outcome
    } else if (outcome.action === "requeue" && outcome.item) {
      queue = enqueueCapped(queue, outcome.item);
    } else if (outcome.action === "dead" && outcome.item) {
      dead = expungeDead([...dead, outcome.item], now);
    }

    const next = withIntegrity({
      ...envelope,
      queue,
      dead,
      seq: envelope.seq,
    });
    activeSlot = await writeJournal(deps!.storage, next, activeSlot);
    envelope = next;
  });

  // Continue draining if more work
  if (envelope.enabled && envelope.queue.some((q) => q.state === "queued")) {
    queueMicrotask(() => {
      void maybeDrain();
    });
  }
}

/** Force a drain (tests / foreground resume). */
export function requestTelemetryDrain(): void {
  try {
    void maybeDrain();
  } catch {
    /* ignore */
  }
}

/** @deprecated use classifyEngineInitFailure from pure */
export function classifyEngineFailure(
  err: unknown,
): import("./config").EngineInitDetail {
  return classifyEngineInitFailure(err);
}
