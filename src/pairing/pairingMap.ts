/**
 * The one pairing map: every pairing this phone holds, as one SecureStore
 * blob. Records sit in pairing order — the last entry is the newest
 * pairing and the `active` pointer names it — and `roomId` is a VALUE
 * compared by identity, never an object key, so any string a computer
 * mints ("__proto__" included) compares as itself.
 *
 * Discipline: every read-modify-write runs behind one in-process lock
 * and leaves with at most one SecureStore write. Damage of ANY kind —
 * the JSON, the envelope, one record that will not decode, an `active`
 * pointer with nothing behind it — damns the whole map: the raw bytes
 * are backed up once under their own key, every write refuses and every
 * read REJECTS; no record is ever dropped and written back. The backup
 * holds the same bytes the map did, credentials included, inside the
 * same keystore that already holds them — it is copied, never logged,
 * never echoed.
 *
 * Reads never write: a v3 record found on a map-less store is migrated
 * IN MEMORY (memoized so its localId is stable until it lands), and the
 * first mutation publishes that state in its single write, retiring the
 * legacy key in the same breath — so a crash before that write leaves v3
 * intact and usable, and a lost map can never resurrect the first
 * computer's credential under a fresh localId.
 */
import { decodeDoorFacts, decodePairingRecord, type PairingRecord, type SavedPairingCredential } from "./pairingRecord";

/** Required on first use: importing this module — its damage predicate,
 *  which is pure — must never load the keystore; only an operation that
 *  actually touches bytes does (the pairingInstallId precedent). */
function keystore(): typeof import("expo-secure-store") {
  return require("expo-secure-store") as typeof import("expo-secure-store");
}

const MAP_KEY = "kalsa.pairing.rooms.v2";
const DAMAGED_KEY = "kalsa.pairing.rooms.v2.damaged";
/** The pre-map store: read as the migration source, deleted on the first map write. */
const LEGACY_KEY = "kalsa.pairing.credential.v3";

export type PairingMapState = {
  active: string | null;
  /** Oldest first; save appends, so the last entry is the newest pairing. */
  records: PairingRecord[];
};

/** The one sentence a damaged map surfaces; it quotes nothing from the blob. */
const DAMAGED_MESSAGE = "pairing map damaged";
const REENTRY_MESSAGE = "reentrant pairing store call";

function damagedStoreError(): Error {
  const error = new Error(DAMAGED_MESSAGE) as Error & { code: string };
  error.code = "pairing_store_damaged";
  return error;
}

/** Whether an error from any store operation is the damaged-store verdict. */
export function isPairingStoreDamaged(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === "pairing_store_damaged";
}

let lock: Promise<void> = Promise.resolve();
let changeRunning = false;
/** The not-yet-written migration, keyed by the exact v3 bytes it came
 *  from — the same legacy record gives the same localId across reads; a
 *  changed or cleared legacy key means a fresh verdict, never a stale memo. */
let unmigrated: { raw: string; state: PairingMapState } | null = null;

/** One map operation at a time. A nested store call from inside a change
 *  callback throws at once instead of queueing behind the lock its own
 *  mutation holds. */
function withLock<T>(task: () => Promise<T>): Promise<T> {
  if (changeRunning) throw new Error(REENTRY_MESSAGE);
  const result = lock.then(task);
  // A failed task fails its caller, never the queue behind it.
  lock = result.then(() => undefined, () => undefined);
  return result;
}

/** The envelope, or null when ANY of it is damaged: the JSON, the shape,
 *  a record that will not decode, an active pointer with no record. */
function parseEnvelope(raw: string): PairingMapState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const envelope = parsed as Record<string, unknown>;
  if (typeof envelope.active !== "string") return null;
  if (!Array.isArray(envelope.records)) return null;
  const records: PairingRecord[] = [];
  for (const value of envelope.records) {
    const record = decodePairingRecord(value);
    if (record === null) return null;
    records.push(record);
  }
  if (!records.some((record) => record.localId === envelope.active)) return null;
  return { active: envelope.active, records };
}

type LoadedMap = { state: PairingMapState; retireLegacy: boolean };

async function loadUnlocked(): Promise<LoadedMap> {
  const raw = await keystore().getItemAsync(MAP_KEY);
  if (raw !== null) {
    unmigrated = null;
    const state = parseEnvelope(raw);
    if (state !== null) return { state, retireLegacy: false };
    // The damaged blob keeps its bytes once, under its own key, and every
    // write refuses from here: overwriting it would destroy the only copy.
    const kept = await keystore().getItemAsync(DAMAGED_KEY);
    if (kept === null) await keystore().setItemAsync(DAMAGED_KEY, raw);
    throw damagedStoreError();
  }
  // No map yet: the v3 record still speaks — in memory only, and only
  // while its bytes are the ones the memo was minted from.
  const legacy = await keystore().getItemAsync(LEGACY_KEY);
  if (unmigrated !== null && legacy === unmigrated.raw) {
    return { state: unmigrated.state, retireLegacy: true };
  }
  if (legacy === null) {
    unmigrated = null;
    return { state: { active: null, records: [] }, retireLegacy: false };
  }
  let facts: SavedPairingCredential | null;
  try {
    facts = decodeDoorFacts(JSON.parse(legacy));
  } catch {
    facts = null;
  }
  // An unreadable legacy record is no pairing to migrate; nothing is kept.
  if (facts === null) {
    unmigrated = null;
    return { state: { active: null, records: [] }, retireLegacy: false };
  }
  const state: PairingMapState = { active: null, records: [] };
  state.records.push({ ...facts, localId: mintLocalId(state), roomId: null });
  state.active = state.records[0].localId;
  unmigrated = { raw: legacy, state };
  return { state, retireLegacy: true };
}

/** A fresh local id: not a secret, only a name inside this map — checked
 *  against the records already holding one, so no mint can collide. */
export function mintLocalId(state: PairingMapState): string {
  for (;;) {
    const candidate = `p${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
    if (!state.records.some((record) => record.localId === candidate)) return candidate;
  }
}

/** The map as stored, the legacy record migrated in memory when there is
 *  no map yet. Rejects on a keystore read failure and on damage — never
 *  a quiet empty object, and never a write. */
export async function readPairingMap(): Promise<PairingMapState> {
  const loaded = await withLock(loadUnlocked);
  return loaded.state;
}

/** One mutation: one lock hold, one SecureStore write — skipped entirely
 *  when the change reports it changed nothing. The change runs
 *  synchronously under the reentry guard. */
export async function mutatePairingMap(change: (state: PairingMapState) => boolean): Promise<void> {
  await withLock(async () => {
    const { state, retireLegacy } = await loadUnlocked();
    let changed: boolean;
    changeRunning = true;
    try {
      changed = change(state);
    } finally {
      changeRunning = false;
    }
    if (!changed) return;
    await keystore().setItemAsync(MAP_KEY, JSON.stringify(state));
    unmigrated = null;
    if (retireLegacy) {
      // The map is written first and stands alone from here. A legacy key
      // this best-effort delete cannot reach re-migrates only if the map
      // itself is gone — the pairing is never lost by trying.
      try {
        await keystore().deleteItemAsync(LEGACY_KEY);
      } catch {
        // The successful map write already stands; nothing retries here.
      }
    }
  });
}
