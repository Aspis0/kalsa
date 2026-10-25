// The servers a verify run cannot live without, probed before any test
// burns its thirty seconds. A missing server does not fail fast on its own:
// it surfaces as twenty selector timeouts that look exactly like harness
// rot — b0ae9e6 records the same trap in shots.mjs.
//
// The distinction this module exists to make: a connection REFUSED is a
// server that is not there (say so at once), while a timeout may only be a
// busy one (a dev server compiling under load is reachable, not absent),
// so the slow case gets one long second chance before any verdict.

/** One probe. `refused` means nothing answered the connection; `slow` means
 *  the socket opened but the answer did not arrive inside the budget;
 *  `up` means it answered. */
export async function probe(url, budgetMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    await fetch(url, { signal: controller.signal });
    return "up";
  } catch (error) {
    return error?.name === "AbortError" ? "slow" : "refused";
  } finally {
    clearTimeout(timer);
  }
}

/** Reachable within a short probe, or a long one, or not at all. */
export async function reachable(url, { quickMs = 2000, patientMs = 15000 } = {}) {
  const first = await probe(url, quickMs);
  if (first === "up") return { ok: true, how: "quick" };
  if (first === "slow") {
    const second = await probe(url, patientMs);
    return second === "up"
      ? { ok: true, how: "patient" }
      : { ok: false, how: "silent", waitedMs: quickMs + patientMs };
  }
  return { ok: false, how: "refused" };
}

/** The verdict as one plain line, or null when the server is fine. */
export function complaint(url, howToStart, verdict) {
  if (verdict.ok) return null;
  if (verdict.how === "refused") {
    return `THIS SUITE NEEDS ${url} REACHABLE — start it with: ${howToStart}`;
  }
  return `${url} opened a connection but answered nothing in ${Math.round(verdict.waitedMs / 1000)} s — a wedged server reads exactly like a missing one; restart it (${howToStart}).`;
}
