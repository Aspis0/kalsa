/**
 * The pairing record's shape and its decoders. `SavedPairingCredential`
 * is the door view every consumer already shares; `PairingRecord` adds
 * what the one pairing map stores beside it — the locally minted id, the
 * room the record has been bound to (null until a room info names it),
 * and the mark a 401 leaves. Decoders are lenient on the optional fields
 * and strict on credential and door: damaged optionals read as absent,
 * a damaged credential or door rejects the whole record.
 */
import { isValidNodeHex, type Road } from "../remote/road";

export type SavedPairingCredential = {
  /** 64 lowercase hex: the bearer the door itself verifies. */
  credential: string;
  doorUrl: string;
  /** The paired desktop's iroh node id; null on records saved without one. */
  node: string | null;
  /** The road the pairing ceremony itself used; null when unknown. */
  pairedVia: Road | null;
};

export type PairingRecord = SavedPairingCredential & {
  /** Minted locally when the pairing is saved; never chosen by a room. */
  localId: string;
  /** The room this credential answered an info for; null until one does. */
  roomId: string | null;
  /** The room answered 401: this bearer must not be sent there again. */
  removed?: boolean;
};

/** The four door facts from any stored value, v3 blob or map entry. */
export function decodeDoorFacts(value: unknown): SavedPairingCredential | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Record<string, unknown>;
  if (typeof stored.credential !== "string" || !/^[0-9a-f]{64}$/.test(stored.credential)) {
    return null;
  }
  if (typeof stored.doorUrl !== "string") return null;
  return {
    credential: stored.credential,
    doorUrl: stored.doorUrl,
    // A record with a node but no pairedVia never earns an HTTPS fallback.
    node: isValidNodeHex(stored.node) ? stored.node : null,
    pairedVia:
      stored.pairedVia === "iroh" || stored.pairedVia === "https" ? stored.pairedVia : null,
  };
}

/** A map entry as a record, or null when its identity fields are damaged. */
export function decodePairingRecord(value: unknown): PairingRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Record<string, unknown>;
  const localId = stored.localId;
  if (typeof localId !== "string" || localId.length === 0) return null;
  const facts = decodeDoorFacts(stored);
  if (facts === null) return null;
  const record: PairingRecord = {
    localId,
    ...facts,
    roomId: typeof stored.roomId === "string" && stored.roomId.length > 0 ? stored.roomId : null,
  };
  if (stored.removed === true) record.removed = true;
  return record;
}
