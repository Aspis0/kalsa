/**
 * Whether a load asks llama.cpp to PIN the mapped weights with `mlock`.
 *
 * Off iOS the answer is the historical one, `true`, and this rule is
 * deliberately byte-for-byte the old behaviour there: mlock cannot hold a
 * multi-GB model on Android — the retail S23 caps RLIMIT_MEMLOCK at 64 MB soft
 * and hard (measured 2026-08-23, `engineParams.ts:30-41`), the Jelly locks
 * ~211 MB of a 1.67 GB file (`engineLiveness.ts:1-20`) — llama.cpp only warns
 * when it falls short, and the kernel still evicts file-backed pages under
 * pressure either way.
 *
 * iOS flips it to false. Wired pages count against the app's footprint, which
 * is what jetsam measures, and pinning the weights removes the one property
 * mmap was chosen for there: the kernel can drop file-backed pages under
 * pressure and fault them back later. On a multi-GB vision bundle that trade
 * buys nothing a reload cannot rebuild.
 *
 * Pure and platform-injected (the same split as `kvCacheProfile.ts`) so the
 * rule is testable off device.
 */
export function resolveUseMlock(platform: string): boolean {
  return platform !== "ios";
}
