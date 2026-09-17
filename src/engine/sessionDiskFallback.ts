/**
 * The per-token session cost the model catalog already knows, for a device
 * that has never completed a write.
 *
 * This lives apart from sessionDiskCalibration.ts on purpose. That module is
 * pure arithmetic over numbers and is compiled standalone by the session
 * harnesses (`scripts/sessionMetaHarness.mjs` and friends) with `--ignoreConfig`;
 * importing MODEL_REGISTRY from it drags the whole catalog graph —
 * contextProfile, the i18n barrel, the dev catalog — into that compile, and a
 * `require()` three modules away then fails the build. Keeping the lookup here
 * means the arithmetic stays a leaf and the callers do the wiring.
 */

import { MODEL_REGISTRY } from "./ModelRegistry";
import { SESSION_PER_TOKEN_META_BYTES } from "./sessionDiskCalibration";

/**
 * The catalog's measured KV cost plus the per-cell bookkeeping the file adds
 * on top. A session file CONTAINS the quantized KV rows, so it can never cost
 * less per token than the cache does — which makes this both the right
 * starting point before any write has been observed and a physical floor on
 * what a sample is allowed to teach.
 *
 * Without it the unmeasured fallback is SESSION_BYTES_PER_TOKEN (64 KiB, a
 * dense-4B ceiling): ~10x the truth for a hybrid, which demands 639 MB free
 * for a session whose file is 43.6 MB. Since a rate is only ever learned from
 * a write that SUCCEEDED, a device that cannot pass the gate never calibrates
 * — so an over-large fallback is not merely cautious, it is permanent.
 */
export function registrySessionBytesPerToken(modelId: string): number | null {
  if (!modelId) return null;
  const kv = MODEL_REGISTRY.find((m) => m.id === modelId)?.kvBytesPerToken;
  if (typeof kv !== "number" || !Number.isFinite(kv) || kv <= 0) return null;
  return kv + SESSION_PER_TOKEN_META_BYTES;
}
