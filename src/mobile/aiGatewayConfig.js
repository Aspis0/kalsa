/**
 * Unified AI gateway — feature flag + endpoint.
 *
 * The app's chat can run on the new unified `/v1/ai/chat/stream` gateway
 * (protocol v1 SSE) instead of the legacy per-surface endpoints. This is
 * gated behind a flag that DEFAULTS OFF: until it is flipped, the chat
 * behaves exactly as today (free chat → `/ai/free/chat/stream` NDJSON;
 * run-scoped → rnaseq `/jobs/{id}/analysis/chat/stream` SSE).
 *
 * Toggle (build-time, Expo inlines EXPO_PUBLIC_* into the bundle):
 *   - set `EXPO_PUBLIC_UNIFIED_AI_CHAT=1` to turn the gateway path ON.
 *   - set `EXPO_PUBLIC_UNIFIED_AI_ENDPOINT=<url>` to override the endpoint.
 * No env → flag is false → gateway dormant.
 */

const DEFAULT_UNIFIED_AI_ENDPOINT = "https://api.aspis-bio.com/v1/ai/chat/stream";

function readBoolEnv(value) {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

// `process.env` is statically replaced by the Expo/Metro bundler for the
// EXPO_PUBLIC_* keys, so this read works in the RN runtime. We guard against
// `process` being undefined defensively (it is not, under Metro, but keeps the
// module safe in plain-node test contexts too).
const ENV = (typeof process !== "undefined" && process.env) ? process.env : {};

/**
 * Feature flag. DEFAULT FALSE — the gateway path is dormant unless explicitly
 * enabled. When false, the app's chat send sites use the existing code paths
 * UNCHANGED.
 */
const UNIFIED_AI_CHAT = readBoolEnv(ENV.EXPO_PUBLIC_UNIFIED_AI_CHAT);

/**
 * Canonical v1 gateway endpoint. Overridable via env; defaults to the
 * production gateway URL.
 */
const UNIFIED_AI_ENDPOINT =
  (typeof ENV.EXPO_PUBLIC_UNIFIED_AI_ENDPOINT === "string" && ENV.EXPO_PUBLIC_UNIFIED_AI_ENDPOINT.trim())
    ? ENV.EXPO_PUBLIC_UNIFIED_AI_ENDPOINT.trim()
    : DEFAULT_UNIFIED_AI_ENDPOINT;

module.exports = {
  DEFAULT_UNIFIED_AI_ENDPOINT,
  UNIFIED_AI_CHAT,
  UNIFIED_AI_ENDPOINT,
};
