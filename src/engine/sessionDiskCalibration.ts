/**
 * How many bytes on disk a saved session costs, learned from real writes.
 *
 * A session file is NOT proportional to its token count. Measured on the S23
 * (2026-09-17) by reading a real `.kvs` header — magic `ggsn`, version 9,
 * token count 6484 — against its 43,622,476 bytes on disk:
 *
 *     43,622,476  =  6484 x 6672  +  361,228
 *                    per token        fixed
 *
 * Exact to the byte. The per-token term is 6656 bytes of quantized KV rows
 * (K q8_0, V q4_0, 8 attention layers of 30 — `llama_kv_cache.cpp:2159`
 * writes `lm_ggml_row_size(k->type, n_embd_k_gqa)`, it does not dequantize),
 * plus 12 bytes of per-cell metadata (`pos` + `n_seq_id` + one `seq_id`,
 * `llama-kv-cache.cpp:2129-2141`) and the 4-byte entry each token takes in
 * the file's token list. The fixed term is the recurrent state — the device
 * reports `llama_memory_recurrent: size = 0.34 MiB (1 cells, 30 layers)`,
 * i.e. 356,516 bytes that do NOT grow with the conversation — plus ~4.7 KB
 * of per-layer headers.
 *
 * That fixed term is why a naive `fileBytes / usedTokens` is not a rate. On a
 * long session it vanishes; on a short one it IS the file. Solving the
 * measured 29,910 B/token this code had learned gives n ~= 19 tokens: one
 * tiny write taught it a rate 4.5x the truth, and the old monotone maximum
 * meant it could never be unlearned. Every real session was then gated at
 * 4.5x its size and refused when the disk was merely tight — losing the KV
 * we would then have to re-prefill.
 */

export type SessionDiskCalibration = Record<string, number>;

/**
 * Per-cell bookkeeping the KV writer emits beside the quantized rows: `pos`
 * (4) + `n_seq_id` (4) + one `seq_id` (4), plus the 4-byte entry this token
 * takes in the file's token list. `llama-kv-cache.cpp:2129-2141`.
 */
export const SESSION_PER_TOKEN_META_BYTES = 16;

/**
 * Fixed bytes a session file costs regardless of length: 361,228, measured on
 * LFM2.5-2.6B and used verbatim rather than rounded.
 *
 * The precision is the point. Subtracting MORE than
 * the real fixed term biases every learned rate DOWNWARD by
 * `(constant - real) / tokens`, which is how a 1 MiB value made the honest
 * 6,672 B/token sample read as 6,566 and get rejected by its own sanity
 * floor. Safety margin belongs in SESSION_DISK_MARGIN, where it is one number
 * that can be reasoned about, not smuggled in here where it distorts a
 * measurement.
 *
 * A model whose real fixed term exceeds this (a wide recurrent state over
 * many layers) would be under-estimated by the difference — a constant, not a
 * per-token error, and bounded by SESSION_DISK_FLOOR_BYTES at small n.
 */
export const SESSION_FIXED_BYTES = 361_228;

/**
 * Shortest write we will learn a rate from.
 *
 * What this bounds is the AFFINE EXTRAPOLATION error, not the tiny-sample case
 * (a sample so short that its file is mostly the fixed term already dies on
 * the non-positive check below). Learning at n0 and estimating at n gives an
 * error of `(SESSION_FIXED_BYTES - real fixed) x (1 - n/n0)`: with the
 * measured 439 KB real term and a 1 MiB constant, the estimate stays above the
 * true file size at n_ctx = 8192 for any n0 down to ~264 tokens.
 *
 * 512 is that break-even with room to spare. It is deliberately NOT higher:
 * every conversation shorter than this never teaches anything, and a device
 * whose chats are all short would be stuck on the fallback forever.
 */
export const SESSION_CALIBRATION_MIN_TOKENS = 512;

/**
 * How far below the catalog's measured cost a learned rate may sit before it
 * is treated as an anomaly rather than a measurement. Wide on purpose: the
 * fixed-term subtraction already biases learned rates a little low, so this
 * catches an order-of-magnitude outlier, not a few percent.
 */
export const LOW_OUTLIER_BAND = 0.5;

function positiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * `knownBytesPerToken` is what the catalog measured for this model — see
 * registrySessionBytesPerToken in sessionDiskFallback.ts. It is a required
 * argument, not an optional one, so that a new call site cannot silently fall
 * back to the 64 KiB dense ceiling by forgetting it.
 */
export function sessionBytesPerTokenForModel(
  calibration: SessionDiskCalibration | null | undefined,
  modelId: string,
  knownBytesPerToken: number | null,
): number | null {
  const value = calibration && modelId ? calibration[modelId] : undefined;
  if (positiveFinite(value)) return value;
  // No observed write yet: the catalog's measured KV cost beats a generic
  // dense ceiling that no hybrid can ever grow into.
  return positiveFinite(knownBytesPerToken) ? knownBytesPerToken : null;
}

/**
 * Learn from one completed write.
 *
 * Only samples at or above SESSION_CALIBRATION_MIN_TOKENS teach anything, and
 * such a sample REPLACES the stored rate instead of only raising it. A long
 * write measures the asymptotic per-token cost directly; keeping a higher
 * number learned from a shorter one is not caution, it is a stale reading
 * that never expires. Conservatism lives in SESSION_FIXED_BYTES and the disk
 * margin, where it can be reasoned about.
 */
export function recordSessionDiskSample(
  calibration: SessionDiskCalibration,
  input: {
    ok: boolean;
    modelId: string;
    fileBytes: unknown;
    usedTokens: unknown;
    /** The catalog's measured cost; the low-outlier floor. Required, so a new
     * caller cannot drop the guard by omission. */
    knownBytesPerToken: number | null;
  },
): SessionDiskCalibration {
  if (
    input.ok !== true ||
    !input.modelId ||
    !positiveFinite(input.fileBytes) ||
    !positiveFinite(input.usedTokens)
  ) {
    return calibration;
  }
  if (input.usedTokens < SESSION_CALIBRATION_MIN_TOKENS) return calibration;
  // Charge the fixed term to the fixed term, not to the tokens.
  const perTokenBytes =
    (input.fileBytes - SESSION_FIXED_BYTES) / input.usedTokens;
  if (!positiveFinite(perTokenBytes)) return calibration;
  // Replacing instead of maximising removed the only guard against a LOW
  // outlier, so put back a floor that is physics rather than caution: the
  // file contains the quantized KV rows, so it cannot cost less per token
  // than the cache the catalog measured.
  const known = input.knownBytesPerToken;
  if (positiveFinite(known) && perTokenBytes < known * LOW_OUTLIER_BAND) {
    return calibration;
  }

  const previous = calibration[input.modelId];
  if (positiveFinite(previous) && previous === perTokenBytes) return calibration;
  return { ...calibration, [input.modelId]: perTokenBytes };
}

/**
 * Persist an update over what is already stored: keys present in `update`
 * win, keys only in `persisted` survive.
 *
 * This exists because the store used to write back through
 * mergeSessionDiskCalibrations, which takes a maximum — so a corrected,
 * LOWER rate could be learned in memory and then silently discarded by the
 * very call meant to save it. A store that cannot record a correction is not
 * a store.
 */
export function applySessionDiskCalibration(
  persisted: Partial<SessionDiskCalibration> | null | undefined,
  update: Partial<SessionDiskCalibration> | null | undefined,
): SessionDiskCalibration {
  const out: SessionDiskCalibration = {};
  for (const source of [persisted, update]) {
    if (source == null || typeof source !== "object") continue;
    for (const [modelId, value] of Object.entries(source)) {
      if (!modelId || !positiveFinite(value)) continue;
      out[modelId] = value;
    }
  }
  return out;
}

/**
 * Combine stores (e.g. a migrated legacy file and the current one).
 *
 * Still a maximum: merging is not a measurement, so with two rates and no way
 * to tell which write was longer, the larger one is the safe pick. Learning
 * is what recordSessionDiskSample does, and it overwrites.
 */
export function mergeSessionDiskCalibrations(
  ...calibrations: Array<Partial<SessionDiskCalibration> | null | undefined>
): SessionDiskCalibration {
  const merged: SessionDiskCalibration = {};
  for (const calibration of calibrations) {
    if (calibration == null || typeof calibration !== "object") continue;
    for (const [modelId, value] of Object.entries(calibration)) {
      if (!modelId || !positiveFinite(value)) continue;
      if (!positiveFinite(merged[modelId]) || value > merged[modelId]) {
        merged[modelId] = value;
      }
    }
  }
  return merged;
}
