import {
  disposeEngine,
  disposeRemoteEngine,
  isEngineReady,
  isRemoteEngineBackend,
} from "../engine/engineBackend";
import { runNativeOpBounded } from "../engine/llamaContextGate";
import { MODEL_SWITCH_DISPOSE_TIMEOUT_MS } from "./engineGateHelpers";

/** Dispose the active local or remote engine before the host changes location. */
export async function disposeHostModelEngine(): Promise<boolean> {
  try {
    if (isRemoteEngineBackend()) {
      await disposeRemoteEngine();
      return true;
    }
    if (!isEngineReady()) return true;
    return (await runNativeOpBounded(
      () => disposeEngine(),
      MODEL_SWITCH_DISPOSE_TIMEOUT_MS,
    )).ok;
  } catch {
    return false;
  }
}
