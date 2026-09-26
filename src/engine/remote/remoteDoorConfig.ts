import { getPairingCredential } from "../../pairing/pairingCredentialStore";
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
};

/** A completed pairing owns its door, credential, node and pairing road as one indivisible choice. */
export async function getRemoteDoorConfig(): Promise<RemoteDoorConfig> {
  const paired = await getPairingCredential();
  if (paired) {
    return {
      url: paired.doorUrl,
      pairedCredential: paired.credential,
      node: paired.node,
      pairedVia: paired.pairedVia,
      source: "pairing",
    };
  }
  return {
    url: getRemoteBrainUrl(),
    pairedCredential: null,
    node: null,
    pairedVia: null,
    source: "manual",
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
