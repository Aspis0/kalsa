/**
 * The dev-build flag, read the way Metro sets it — no ambient `__DEV__` global
 * at compile time.
 *
 * Node harnesses (`tsc` of a single file, `node scripts/*Harness.mjs`) have no
 * React Native runtime, so bare `__DEV__` is a TS2304; Metro sets
 * `global.__DEV__` at runtime. An explicit `flag` keeps tests pure, and the
 * default is read at **call time** on purpose: a release-only branch nobody can
 * reach is how a previous guard in this app passed every test and broke on the
 * first real phone.
 */
export function isDevBuild(
  flag: unknown = (globalThis as { __DEV__?: unknown }).__DEV__,
): boolean {
  return flag === true;
}
