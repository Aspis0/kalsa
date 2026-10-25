/** Semantic versions as the desktop updater reads them: validation and "is newer". */

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isSemver(value: unknown): value is string {
  return typeof value === "string" && SEMVER.test(value);
}

/** Components are compared as BigInt: a Number would collapse neighbours above 2^53. */
function compareNumeric(a: string, b: string): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

function compareIdentifier(a: string, b: string): number {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return compareNumeric(a, b);
  if (numeric.test(a)) return -1;
  if (numeric.test(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePrerelease(a: string | undefined, b: string | undefined): number {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    const diff = compareIdentifier(left[i], right[i]);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Build metadata (after `+`) does not affect precedence and is ignored. */
export function isNewer(candidate: string, current: string): boolean {
  if (!isSemver(candidate) || !isSemver(current)) return false;
  const a = SEMVER.exec(candidate)!;
  const b = SEMVER.exec(current)!;
  for (let i = 1; i <= 3; i++) {
    const diff = compareNumeric(a[i], b[i]);
    if (diff !== 0) return diff > 0;
  }
  return comparePrerelease(a[4], b[4]) > 0;
}
