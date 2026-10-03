/**
 * The URL a door's request lines name: the saved address, or — for a
 * pairing that saved none (it rode iroh) — the iroh stand-in origin,
 * which only works while this phone still has the iroh road its pairing
 * dialed. The road check here is the same one `establishDoorRoad` makes,
 * so the base and the road a request actually rides cannot disagree.
 */

import { IROH_TUNNEL_URL } from "../../pairing/pairingUrls";
import { irohModulePresent } from "../../remote/irohBridge";
import { chooseRoad } from "../../remote/road";
import type { RemoteDoorConfig } from "./remoteDoorConfig";

export type DoorRequestBase =
  | { ok: true; base: string }
  | { ok: false; error: string };

export function doorRequestBase(door: RemoteDoorConfig): DoorRequestBase {
  if (door.url !== "") return { ok: true, base: door.url };
  if (
    door.source === "pairing" &&
    chooseRoad(door.node, irohModulePresent).road === "iroh"
  ) {
    return { ok: true, base: IROH_TUNNEL_URL };
  }
  // A manual door with no address names `remote_brain_url_missing` — the
  // user can type one. A paired record that saved none has no address to
  // type: its iroh road is gone (module absent or node damaged).
  return {
    ok: false,
    error:
      door.source === "pairing"
        ? "remote_brain_iroh_missing"
        : "remote_brain_url_missing",
  };
}
