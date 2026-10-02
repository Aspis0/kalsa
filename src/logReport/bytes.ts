/**
 * UTF-8 byte arithmetic for the 4 MiB report cap: byte length of a JS string
 * and a newest-lines trim that always cuts at a line boundary. No TextEncoder
 * — the Hermes runtime must not be assumed to ship one. Lone surrogates count
 * 3 bytes, what an actual UTF-8 encoder emits for the U+FFFD replacement.
 */

export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < text.length &&
      text.charCodeAt(i + 1) >= 0xdc00 &&
      text.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4;
      i++; // the low surrogate is consumed with the high one
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Keep the newest lines that fit `capBytes` counting the separating newline
 * per kept line, cutting at a line boundary. A single line longer than the
 * whole cap is dropped with the rest, so the result is never a partial line.
 */
export function trimNewestLinesToByteCap(text: string, capBytes: number): string {
  if (capBytes <= 0) return "";
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  let start = lines.length;
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = utf8ByteLength(lines[i]) + 1;
    if (bytes + cost > capBytes) break;
    bytes += cost;
    start = i;
  }
  return start < lines.length ? `${lines.slice(start).join("\n")}\n` : "";
}
