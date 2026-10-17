/**
 * The phone's marketing model name for the desk to draw ("iPhone 15 Pro Max").
 *
 * What the desk keeps must be exactly what the phone signed, and the desk
 * cleans a name with the same rules it uses for an owner's name, so the phone
 * sends the cleaned form and nothing else: no control, format, private-use,
 * surrogate or unassigned characters, no edge whitespace, at most 40
 * characters. The desk's own set is the Unicode Other group, the same as `\p{C}`.
 *
 * Android reports `Build.MODEL` as its model name, and that is often a model
 * code ("SM-S911B", "2201123G") rather than a name. A value with no space in
 * it is treated as a code and not sent: the desk then shows the number it
 * always showed, instead of a code a person cannot recognise.
 */

const MODEL_NAME_LIMIT = 40;

export function cleanModelName(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const visible = raw.replace(/\p{C}/gu, "").trim();
  if (!/\s/.test(visible)) return undefined;
  const short = Array.from(visible).slice(0, MODEL_NAME_LIMIT).join("").trim();
  return short === "" ? undefined : short;
}
