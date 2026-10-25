/**
 * Bearer-token guard shared by every maintainer route. Fail-closed: 503 when
 * the secret is unset, 401 on any mismatch.
 */

/** No early exit on the first differing byte. */
function constantTimeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

export function validBearer(secret: string | undefined, authHeader: string | null):
  | { ok: true }
  | { ok: false; status: 503 | 401 } {
  if (!secret) return { ok: false, status: 503 };
  if (authHeader === null || !constantTimeEqual(authHeader, `Bearer ${secret}`)) {
    return { ok: false, status: 401 };
  }
  return { ok: true };
}
