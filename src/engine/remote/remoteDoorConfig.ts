import { getPairingCredential } from "../../pairing/pairingCredentialStore";
import { getRemoteBrainToken } from "./remoteSecret";
import { getRemoteBrainUrl } from "./remoteSettings";

export type RemoteDoorConfig = {
  url: string;
  pairedCredential: string | null;
  source: "pairing" | "manual";
};

/** A completed pairing owns its door and credential as one indivisible choice. */
export async function getRemoteDoorConfig(): Promise<RemoteDoorConfig> {
  const paired = await getPairingCredential();
  if (paired) {
    return {
      url: paired.doorUrl,
      pairedCredential: paired.credential,
      source: "pairing",
    };
  }
  return {
    url: getRemoteBrainUrl(),
    pairedCredential: null,
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
