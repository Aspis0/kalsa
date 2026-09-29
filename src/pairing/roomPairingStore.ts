/**
 * Pairings keyed by room id — one entry per Kalsa computer this phone has
 * paired with. Pairing a computer whose room id is already here replaces
 * its entry and touches no other; a computer never seen here is added.
 *
 * The ACTIVE record (pairingCredentialStore) is still what chat rides, and
 * it enters this map only through adoptActivePairing, which the first
 * successful room info triggers: before that the room id is unknown, so
 * the active record behaves exactly as it did when it was the only one.
 */
import * as SecureStore from "expo-secure-store";
import {
  decodePairingRecord,
  encodePairingRecord,
  type SavedPairingCredential,
} from "./pairingRecord";
import { getPairingCredential, setPairingRoomId } from "./pairingCredentialStore";

const STORAGE_KEY = "kalsa.pairing.rooms.v1";

/** Add this record under roomId, replacing any record the room already had. */
export async function putRoomPairing(roomId: string, record: SavedPairingCredential): Promise<void> {
  if (roomId.length === 0) throw new Error("invalid room id");
  const { credential, doorUrl, node, pairedVia } = record;
  // The map key is the room: the stored record never repeats it.
  const room = await readRoomMap();
  room[roomId] = encodePairingRecord({ credential, doorUrl, node, pairedVia });
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(room));
}

/** The record paired for roomId, or null when absent or damaged. */
export async function getRoomPairing(roomId: string): Promise<SavedPairingCredential | null> {
  const room = await readRoomMap();
  return decodePairingRecord(room[roomId]);
}

/** Every paired computer as room id → record; damaged entries are not listed. */
export async function listRoomPairings(): Promise<Record<string, SavedPairingCredential>> {
  const room = await readRoomMap();
  const listed: Record<string, SavedPairingCredential> = {};
  for (const [roomId, value] of Object.entries(room)) {
    const record = decodePairingRecord(value);
    if (record !== null) listed[roomId] = record;
  }
  return listed;
}

/** Drop one computer's pairing; other rooms are untouched. */
export async function removeRoomPairing(roomId: string): Promise<void> {
  const room = await readRoomMap();
  if (!Object.prototype.hasOwnProperty.call(room, roomId)) return;
  delete room[roomId];
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(room));
}

/**
 * Copy the active record into the map under roomId and stamp it there —
 * the migration the first successful room info performs (a repeat for the
 * room it already knows is a no-op). The map is written BEFORE the stamp:
 * a stamp without its copy would make the next adoption see a bound record
 * and skip, and the record would never enter the map at all.
 */
export async function adoptActivePairing(roomId: string): Promise<void> {
  const active = await getPairingCredential();
  if (active === null || active.roomId === roomId) return;
  await putRoomPairing(roomId, active);
  await setPairingRoomId(roomId);
}

/**
 * The map as stored. A damaged map reads as empty — its records were
 * unreadable anyway — and an individual damaged value is skipped by
 * decode, never dropped by a neighbour's write.
 */
async function readRoomMap(): Promise<Record<string, unknown>> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (raw == null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}
