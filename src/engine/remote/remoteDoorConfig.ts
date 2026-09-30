import { getPairingCredential } from "../../pairing/pairingCredentialStore";
import type { PairingRecord } from "../../pairing/pairingRecord";
import { getRemoteBrainToken } from "./remoteSecret";
import { getRemoteBrainUrl } from "./remoteSettings";
import type { Road } from "../../remote/road";

export type RemoteDoorConfig = {
  url: string;
  pairedCredential: string | null;
  /** The paired desktop's iroh node id (64 hex); null = HTTPS road only. */
  node: string | null;
  /** Which road the pairing ceremony used; null when unknown (old records). */
  pairedVia: Road | null;
  source: "pairing" | "manual";
  /** The paired record behind this door: the local id a room client threads
   *  through ONE request (captured here, before any await could swap the
   *  active pairing), and whether this room has already refused the phone. */
  pairing: { localId: string; removed: boolean } | null;
};

/** A completed pairing owns its door, credential, node and pairing road as one indivisible choice. */
export async function getRemoteDoorConfig(): Promise<RemoteDoorConfig> {
  const paired = await getPairingCredential();
  if (paired) return doorConfigForPairing(paired);
  return {
    url: getRemoteBrainUrl(),
    pairedCredential: null,
    node: null,
    pairedVia: null,
    source: "manual",
    pairing: null,
  };
}

/** The same choice applied to ANY record, not just the active one — the
 *  room client's per-room calls and the event stream build their door
 *  from the record the request is for, captured in one read. */
export function doorConfigForPairing(paired: PairingRecord): RemoteDoorConfig {
  return {
    url: paired.doorUrl,
    pairedCredential: paired.credential,
    node: paired.node,
    pairedVia: paired.pairedVia,
    source: "pairing",
    pairing: { localId: paired.localId, removed: paired.removed === true },
  };
}

/** Fetch the typed token only after the selected door passed URL validation. */
export async function getRemoteDoorToken(
  config: RemoteDoorConfig,
): Promise<string | null> {
  return config.source === "pairing"
    ? config.pairedCredential
    : getRemoteBrainToken();
}
