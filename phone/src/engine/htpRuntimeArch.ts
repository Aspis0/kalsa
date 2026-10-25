import { getBackendDevicesInfo } from "llama.rn";

/** The Hexagon arch of the runtime's registered HTP device: the binding
 *  registers "HTP0" with a "Hexagon v<NN>" description only when a skel for
 *  that arch shipped, so this — not the SoC name — is what the NPU lane's
 *  auto gate reads. Null when no HTP device is registered or the trailing
 *  v<NN> token is absent or malformed. */
export function htpArchFromDevices(
  devices: ReadonlyArray<{ deviceName: string; description?: string }>,
): number | null {
  const htp = devices.find((device) => device.deviceName === "HTP0");
  const match = /v(\d+)\s*$/.exec(htp?.description ?? "");
  return match ? Number(match[1]) : null;
}

let cachedArch: number | null = null;

/** The HTP registration is fixed at engine init, so a read arch is kept for
 *  the process. A null is not kept: a transient native failure must not hold
 *  the lane off until the app restarts, and a re-read is one cheap JSI call.
 *  Any failure — missing native module, rejected call, malformed payload —
 *  resolves null. */
export async function readHtpRuntimeArch(): Promise<number | null> {
  if (cachedArch !== null) return cachedArch;
  try {
    cachedArch = htpArchFromDevices(await getBackendDevicesInfo());
  } catch {
    return null;
  }
  return cachedArch;
}
