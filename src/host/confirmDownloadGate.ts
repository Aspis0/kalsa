/**
 * The confirm sheet's pre-download verdict, as ONE probe: tier + disk + the
 * volatile RAM axis, priced exactly as the load after the download will price
 * it (bench ?? user ?? catalog context, chosen KV, resolved repack mode) and
 * against a FRESH MemAvailable — the profile cache's sample is
 * process-lifetime, which is precisely why a downloaded model could be
 * refused minutes later against a number the app took at boot.
 *
 * The verdict decides two different words (the hook applies both): a
 * non-RAM refusal (tier / disk) still refuses the download outright; a RAM
 * refusal never blocks the transfer — memory is volatile and the user may
 * free it — it becomes `confirmGateWarning`'s sentence in the same sheet.
 * Probe failure returns null: the sheet then proceeds exactly as before,
 * because a missing probe must never invent a verdict in either direction.
 *
 * Held apart from `useModelDownload.ts` for the same reason every host slice
 * is a file: the hook is over its ratchet, and the probe is a whole
 * responsibility — read the load path's inputs, run the shared gate once.
 */
import { getBenchNCtx, getBenchNoRepack, getEngineOverride } from "../bench/benchConfig";
import {
  getCachedDeviceProfile,
  getFreeDiskBytes,
  type DeviceProfile,
} from "../engine/deviceProfile";
import { readUserContextSize } from "../engine/contextSizePref";
import { readKvCacheChoice } from "../engine/kvCachePref";
import type { DeviceBandwidthCalibration } from "../engine/deviceThroughput";
import type { ModelInfo } from "../engine/ModelRegistry";
import { gateForModel, profileWithFreshMemory } from "./engineGateHelpers";

export type ConfirmDownloadGate = {
  gate: Awaited<ReturnType<typeof gateForModel>>;
  /** The profile the verdict was priced against (its volatile axis is fresh). */
  profile: DeviceProfile;
};

export async function confirmDownloadGate(
  model: ModelInfo,
  deviceBandwidth: DeviceBandwidthCalibration,
): Promise<ConfirmDownloadGate | null> {
  try {
    const [cachedProfile, free, kvCache, benchNCtx, userNCtx, benchNoRepack, engineOverride] =
      await Promise.all([
        getCachedDeviceProfile(),
        getFreeDiskBytes(),
        readKvCacheChoice(),
        getBenchNCtx(),
        readUserContextSize(model.contextLength),
        getBenchNoRepack(),
        getEngineOverride(),
      ]);
    const profile = await profileWithFreshMemory(cachedProfile);
    return {
      gate: gateForModel(
        model,
        profile,
        free,
        // Volatile RAM ON: this sheet must be able to say what the load
        // after the download will do, not just what the disk can hold.
        true,
        benchNoRepack,
        deviceBandwidth,
        kvCache,
        benchNCtx ?? userNCtx ?? undefined,
        engineOverride?.useMmap,
      ),
      profile,
    };
  } catch {
    return null;
  }
}
