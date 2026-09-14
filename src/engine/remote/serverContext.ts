/**
 * The window the server will actually answer within.
 *
 * The client sends no context length, so the server's own setting decides — and
 * if we size prompts to a number the server cannot take, the request fails with
 * something the user cannot act on. `llama-server` (our embedded runtime) says
 * what it uses in `/props`; anything else simply does not answer, and the
 * caller keeps its own conservative default.
 */
export function parseServerContext(body: unknown): number | null {
  if (typeof body !== "object" || body === null) return null;
  const props = body as Record<string, unknown>;
  // The generation settings are what the server will actually use, so they win
  // when both are present; the top-level field is the fallback.
  return (
    positiveInteger(
      (props.default_generation_settings as Record<string, unknown> | undefined)
        ?.n_ctx,
    ) ?? positiveInteger(props.n_ctx)
  );
}

function positiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}
