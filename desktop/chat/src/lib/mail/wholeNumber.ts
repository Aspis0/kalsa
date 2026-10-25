/**
 * The backend reads ids and day counts as `u32`. The model writes them as strings
 * or numbers, so both are accepted here and anything that is not a whole number
 * in range is refused rather than sent.
 */

const UINT32_MAX = 0xffffffff;

export function unsignedInteger(value: unknown): number | null {
  const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 && number <= UINT32_MAX
    ? number
    : null;
}
