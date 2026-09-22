/** The panel's memory of one endpoint: its size, or the unknown it was told. */
export type ContextInfo = { endpoint: string; nctx: number | null };

/**
 * The window's two pure decisions: how a `/props` body becomes a number, and
 * what the app remembers between asks. No fetch, no state — the harness
 * `scripts/context-size.mjs` drives both without a network.
 */

/**
 * The ONE path that carries this fork's window: `/props` →
 * `default_generation_settings.n_ctx` (`server-context.cpp:4939`), already
 * divided per slot by the engine (`kv_unified` false, so `ctx-size /
 * parallel` — `llama-context.cpp:294`), which is exactly the budget the
 * panel meters.
 *
 * Four decoys live in the same fork and none of them is this contract. A
 * reader in a hurry grabs the first `n_ctx` JSON search returns, so all four
 * are named here with their source line:
 *
 * 1. `data[].meta.n_ctx` of `GET /models` (`server-context.cpp:4889`) —
 *    per-slot too, but it is the model catalogue's echo, not `/props`, and a
 *    catalogue answer is not a promise about the serving window;
 * 2. the slot JSON of `GET /slots` (`server-context.cpp:696`) — refused by
 *    the door before it reaches any client (`proxy.rs:161`), so reading it
 *    would mean going around the door, and it describes one slot's live
 *    state, not the configured size;
 * 3. the top-level `n_ctx` on an `EXCEED_CONTEXT_SIZE` reply
 *    (`server-task.cpp:1505`) — it exists only after a request already
 *    failed, and it is a fact about that one prompt;
 * 4. the router's `default_generation_settings.n_ctx: 0`
 *    (`server-models.cpp:1936`) — the right PATH with a placeholder value:
 *    `> 0` below is what refuses it. `n_ctx: 0` is not a window.
 *
 * Deliberately NOT read: `total_slots` (`server-context.cpp:4947`), which
 * sits in the same reply. How many slots exist is T6b's question with its
 * own source, and the engine's count is not the door's capacity —
 * `door_capacity` forces 1 when the engine does not consume the private
 * headers (`src-tauri/src/main.rs:178-186`). Any slot count must be decided
 * with that in view, not borrowed from this parse.
 *
 * Doctrine, unchanged from `fetchContextSize`: anything missing,
 * non-finite, non-numeric or not positive means UNKNOWN — never an invented
 * limit, never a decoy's number.
 */
export function parseContextSize(props: unknown): number | null {
  if (typeof props !== "object" || props === null) return null;
  const settings = (props as { default_generation_settings?: unknown }).default_generation_settings;
  if (typeof settings !== "object" || settings === null) return null;
  const nctx = (settings as { n_ctx?: unknown }).n_ctx;
  return typeof nctx === "number" && Number.isFinite(nctx) && nctx > 0 ? Math.floor(nctx) : null;
}

/**
 * The cache rule that lets the window HEAL, and its cost — the choice of
 * this round, declared: **an unknown is never stored**. `null` is not an
 * answer, so it gets no entry; only a number is remembered. The old rule
 * stored `null` too, which memoized ignorance per endpoint until the user
 * happened to save settings (`App.tsx` cleared the map then and only then),
 * and that stuck `null` is what silenced the meter and the budget check
 * after the engine was in fact answering.
 *
 * The cost, paid where it is cheap: while `/props` is unreachable or keeps
 * answering unknown, every call re-asks — one GET per panel refresh or per
 * attach while the size stays unknown, each bounded by `fetchContextSize`'s
 * 8 s abort (passes may overlap on a slow endpoint; the abort bounds them).
 * When the engine answers a number, that number is stored and the asking
 * stops on its own. No event, no settings save, no user gesture required:
 * ignorance is never durable, knowledge is.
 */
export async function ensureContextSize(
  cache: Map<string, number>,
  endpoint: string,
  ask: () => Promise<number | null>,
): Promise<number | null> {
  const cached = cache.get(endpoint);
  if (cached !== undefined) return cached;
  const nctx = await ask();
  rememberContextSize(cache, endpoint, nctx);
  return nctx;
}

/** Remembers one answer under the rule above: a number is stored, an
    unknown writes nothing (and erases nothing — a late `null` after a known
    number must not un-know it). */
export function rememberContextSize(
  cache: Map<string, number>,
  endpoint: string,
  nctx: number | null,
): void {
  if (nctx !== null) cache.set(endpoint, nctx);
}

/**
 * The panel refresh guard (`App.tsx`, the effect over pinned files): ask
 * again unless THIS endpoint has a NUMBER. An endpoint's stored unknown is
 * not settlement — it is precisely the state that must re-ask, which is the
 * other half of the healing rule above.
 */
export function hasContextSize(info: ContextInfo | null, endpoint: string): boolean {
  return info !== null && info.endpoint === endpoint && info.nctx !== null;
}
