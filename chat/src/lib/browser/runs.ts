/**
 * Which tool runs belong to the browser, by name.
 *
 * **`store.ts` asks this to decide what a reloaded chat keeps, and it asks it
 * about a name, not about a list.** The sidecar carries five browser tools and
 * three are offered today; a run recorded for `browser_type` is a run this
 * build refused, and its arguments are still the model's — a text it typed, a
 * password-looking string, an address. Matching a fixed list of three would
 * leave every refused run's arguments on disk, which is the one thing the stub
 * exists to prevent. So this is the prefix, and a tool added tomorrow is stubbed
 * the day it lands.
 *
 * `ToolActivity` asks it too, to choose the row it draws.
 */
export function isBrowserRun(name: string): boolean {
  return name.startsWith("browser_");
}
