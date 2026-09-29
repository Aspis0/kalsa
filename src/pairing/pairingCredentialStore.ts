/**
 * The pairing API: what chat's door reads, what the room client threads
 * through one request, and how the map changes. Every pairing is written
 * at save time — pairing a second computer appends beside the first, it
 * never replaces it — and the record whose credential made a room info
 * call is the record that learns the room, by its local id, captured
 * before any await could swap the active pairing underneath it.
 */
import { isValidNodeHex, type Road } from "../remote/road";
import { mintLocalId, mutatePairingMap, readPairingMap } from "./pairingMap";
import type { PairingRecord } from "./pairingRecord";

/**
 * Save a completed pairing: appended to the map and made the active one
 * (chat's door). The v3 key is only ever read as the migration source.
 */
export async function savePairingCredential(
  credential: Uint8Array,
  doorUrl: string,
  pairing?: { node?: string; pairedVia?: Road },
): Promise<void> {
  if (credential.length !== 32) throw new Error("invalid pairing credential");
  const credentialHex = Array.from(credential, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const node = isValidNodeHex(pairing?.node) ? pairing.node : null;
  const via = pairing?.pairedVia;
  // An unparseable node never fails a pairing that already succeeded; it
  // just leaves this credential on the HTTPS road, with no pairing road
  // ever recorded — the door then refuses to fall back anywhere.
  const pairedVia = node !== null && (via === "iroh" || via === "https") ? via : null;
  await mutatePairingMap((state) => {
    const localId = mintLocalId(state);
    state.records.push({ localId, credential: credentialHex, doorUrl, node, pairedVia, roomId: null });
    state.active = localId;
    return true;
  });
}

/** The active record for chat's door — null when this phone paired
 *  nothing. Rejects when the store cannot be read or is damaged: the
 *  readers on the other side distinguish unreadable from unpaired. */
export async function getPairingCredential(): Promise<PairingRecord | null> {
  const state = await readPairingMap();
  if (state.active === null) return null;
  return state.records.find((record) => record.localId === state.active) ?? null;
}

/** Every pairing, oldest first — the shelf a multi-computer list reads. */
export async function listPairings(): Promise<PairingRecord[]> {
  return (await readPairingMap()).records;
}

/**
 * File `roomId` under the record whose credential answered the info.
 * The local id comes from the request that made the call, never from a
 * fresh read of the active record. If the room already belongs to
 * another record, the NEWER pairing wins the room and the older record
 * is dropped (a re-pair of one computer); the dropped record is always
 * an older entry, so it is never the last one and never the active
 * pointer. A record already gone has nothing to bind; a bound room is a
 * no-op. Returns the local ids this call dropped, so the caller can
 * retire whatever belonged to them — the cached epoch, for one.
 */
export async function bindPairingRoom(localId: string, roomId: string): Promise<string[]> {
  if (roomId.length === 0) throw new Error("invalid room id");
  const dropped: string[] = [];
  await mutatePairingMap((state) => {
    const target = state.records.find((record) => record.localId === localId);
    if (target === undefined || target.roomId === roomId) return false;
    const owner = state.records.find(
      (record) => record !== target && record.roomId === roomId,
    );
    if (owner !== undefined) {
      if (state.records.indexOf(owner) > state.records.indexOf(target)) {
        state.records.splice(state.records.indexOf(target), 1);
        dropped.push(target.localId);
        return true;
      }
      state.records.splice(state.records.indexOf(owner), 1);
      dropped.push(owner.localId);
    }
    target.roomId = roomId;
    return true;
  });
  return dropped;
}

/** The room answered 401: the record stays (its credential, its room, its
 *  history with P5) but is marked, so no room call sends its bearer
 *  there again. A record already dropped or marked changes nothing. */
export async function markPairingRemoved(localId: string): Promise<void> {
  await mutatePairingMap((state) => {
    const record = state.records.find((candidate) => candidate.localId === localId);
    if (record === undefined || record.removed === true) return false;
    record.removed = true;
    return true;
  });
}
