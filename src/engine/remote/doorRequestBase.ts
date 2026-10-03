/**
 * The URL a door's request lines name: the saved address, or — for a
 * pairing that saved none — the iroh stand-in origin, named only by the
 * shared `pairedIrohRoad` verdict `establishDoorRoad` dials with. Such a
 * record rides iroh or fails, never the network, so the base and the
 * road a request rides cannot disagree. Any other pairing that saved no
 * address has no road the stand-in could ride: it fails closed instead
 * of naming the stand-in on a socket.
 */

import { IROH_TUNNEL_URL } from "../../pairing/pairingUrls";
import { pairedIrohRoad } from "../../remote/doorRoad";
import type { RemoteDoorConfig } from "./remoteDoorConfig";

export type DoorRequestBase =
  | { ok: true; base: string }
  | { ok: false; error: string };

export function doorRequestBase(
  door: Pick<RemoteDoorConfig, "url" | "node" | "pairedVia" | "source">,
): DoorRequestBase {
  if (door.url !== "") return { ok: true, base: door.url };
  if (door.source === "pairing" && pairedIrohRoad(door) !== null) {
    return { ok: true, base: IROH_TUNNEL_URL };
  }
  // A manual door with no address names `remote_brain_url_missing` — the
  // user can type one. A paired record that saved none has no address to
  // type: its iroh road is gone (module absent, node damaged, or the
  // pairing never rode iroh).
  return {
    ok: false,
    error:
      door.source === "pairing"
        ? "remote_brain_iroh_missing"
        : "remote_brain_url_missing",
  };
}
