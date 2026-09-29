/**
 * The pairing record as every store reads and writes it: one 32-byte
 * credential in lowercase hex, the door address, the optional iroh node
 * with its pairing road, and — once a room info has named the room — the
 * room id. Validation lives here so the active store and the per-room map
 * accept and reject the same fields.
 */
import { isValidNodeHex, type Road } from "../remote/road";

export type SavedPairingCredential = {
  credential: string;
  doorUrl: string;
  /** The paired desktop's iroh node id; null on records saved without one. */
  node: string | null;
  /** The road the pairing ceremony itself used; null when unknown. */
  pairedVia: Road | null;
  /** The room id the first successful room info reported; absent until then. */
  roomId?: string;
};

/** The record's JSON object; fields the record leaves out stay out. */
export function encodePairingRecord(record: SavedPairingCredential): Record<string, string> {
  const stored: Record<string, string> = {
    credential: record.credential,
    doorUrl: record.doorUrl,
  };
  if (record.node !== null) stored.node = record.node;
  if (record.pairedVia !== null) stored.pairedVia = record.pairedVia;
  if (record.roomId !== undefined) stored.roomId = record.roomId;
  return stored;
}

/**
 * A stored value as a record, or null when credential or door is damaged.
 * Damaged optionals read as absent — records from before the iroh step keep
 * their HTTPS road, and a node without a pairedVia never earns a fallback —
 * but a damaged credential or door rejects the whole record.
 */
export function decodePairingRecord(value: unknown): SavedPairingCredential | null {
  if (typeof value !== "object" || value === null) return null;
  const stored = value as Record<string, unknown>;
  if (typeof stored.credential !== "string" || !/^[0-9a-f]{64}$/.test(stored.credential)) {
    return null;
  }
  if (typeof stored.doorUrl !== "string") return null;
  const record: SavedPairingCredential = {
    credential: stored.credential,
    doorUrl: stored.doorUrl,
    node: isValidNodeHex(stored.node) ? stored.node : null,
    pairedVia:
      stored.pairedVia === "iroh" || stored.pairedVia === "https" ? stored.pairedVia : null,
  };
  if (typeof stored.roomId === "string" && stored.roomId.length > 0) {
    record.roomId = stored.roomId;
  }
  return record;
}
