/**
 * The one pairing map: every pairing this phone holds, as one SecureStore
 * blob. Records sit in pairing order — the last entry is the newest
 * pairing and the `active` pointer names it — and `roomId` is a VALUE
 * compared by identity, never an object key, so any string a computer
 * mints ("__proto__" included) compares as itself.
 *
 * Discipline: every read-modify-write runs behind one in-process lock
 * and leaves with at most one SecureStore write; a blob that will not
 * parse is backed up once under its own key and never overwritten —
 * writes refuse and the read surfaces the damage instead of pretending
 * the map was empty.
 */
import * as SecureStore from "expo-secure-store";
import { decodeDoorFacts, decodePairingRecord, type PairingRecord, type SavedPairingCredential } from "./pairingRecord";

const MAP_KEY = "kalsa.pairing.rooms.v2";
const DAMAGED_KEY = "kalsa.pairing.rooms.v2.damaged";
/** The pre-map store: read once as the migration source, never written again. */
const LEGACY_KEY = "kalsa.pairing.credential.v3";

export type PairingMapState = {
  active: string | null;
  /** Oldest first; save appends, so the last entry is the newest pairing. */
  records: PairingRecord[];
};

/** The one sentence a damaged map surfaces; it quotes nothing from the blob. */
const DAMAGED_MESSAGE = "pairing map damaged";

let lock: Promise<void> = Promise.resolve();

/** One map operation at a time. Tasks must not read or mutate the map
 *  again: they already hold it, and a nested call would wait on itself. */
function withLock<T>(task: () => Promise<T>): Promise<T> {
  const result = lock.then(task);
  // A failed task fails its caller, never the queue behind it.
  lock = result.then(() => undefined, () => undefined);
  return result;
}

/** Parse the envelope; a blob that is not our map reads as damaged, and a
 *  record inside it that will not decode is excluded while the rest stand. */
function parseEnvelope(raw: string): PairingMapState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const envelope = parsed as Record<string, unknown>;
  if (envelope.active !== null && typeof envelope.active !== "string") return null;
  if (!Array.isArray(envelope.records)) return null;
  const records: PairingRecord[] = [];
  for (const value of envelope.records) {
    const record = decodePairingRecord(value);
    if (record !== null) records.push(record);
  }
  return { active: envelope.active as string | null, records };
}

async function loadUnlocked(): Promise<PairingMapState> {
  const raw = await SecureStore.getItemAsync(MAP_KEY);
  if (raw !== null) {
    const state = parseEnvelope(raw);
    if (state !== null) return state;
    // The damaged blob keeps its bytes once, under its own key, and every
    // write refuses from here: overwriting it would destroy the only copy.
    const kept = await SecureStore.getItemAsync(DAMAGED_KEY);
    if (kept === null) await SecureStore.setItemAsync(DAMAGED_KEY, raw);
    throw new Error(DAMAGED_MESSAGE);
  }
  // One-time migration: no map yet means the v3 record still speaks.
  const legacy = await SecureStore.getItemAsync(LEGACY_KEY);
  if (legacy === null) return { active: null, records: [] };
  let facts: SavedPairingCredential | null;
  try {
    facts = decodeDoorFacts(JSON.parse(legacy));
  } catch {
    facts = null;
  }
  // An unreadable legacy record is no pairing to migrate; nothing is written.
  if (facts === null) return { active: null, records: [] };
  const state: PairingMapState = { active: null, records: [] };
  state.records.push({ ...facts, localId: mintLocalId(state), roomId: null });
  state.active = state.records[0].localId;
  await SecureStore.setItemAsync(MAP_KEY, JSON.stringify(state));
  return state;
}

/** A fresh local id: not a secret, only a name inside this map — checked
 *  against the records already holding one, so no mint can collide. */
export function mintLocalId(state: PairingMapState): string {
  for (;;) {
    const candidate = `p${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
    if (!state.records.some((record) => record.localId === candidate)) return candidate;
  }
}

/** The map as stored, migrated once on first sight. Rejects on a keystore
 *  read failure and on damage — never a quiet empty object. */
export function readPairingMap(): Promise<PairingMapState> {
  return withLock(loadUnlocked);
}

/** One mutation: one lock hold, one SecureStore write — skipped entirely
 *  when the change reports it changed nothing. */
export async function mutatePairingMap(
  change: (state: PairingMapState) => Promise<boolean> | boolean,
): Promise<void> {
  await withLock(async () => {
    const state = await loadUnlocked();
    if (!(await change(state))) return;
    await SecureStore.setItemAsync(MAP_KEY, JSON.stringify(state));
  });
}
