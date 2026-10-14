/**
 * The one place the sidecar's fence is taken apart again. `for_ui` carries no
 * body on purpose (view.rs): the full text travels only in the fenced lines,
 * and the Mail tab is the one surface that shows it to the person. The marker
 * goes as the text is read, so nothing a stranger wrote keeps the wrapper that
 * told the model to ignore it.
 *
 * `for_model` is one string per FIELD, not per line: `Fence::field` writes
 * `"body:\n<nonce> one\n<nonce> two"` and the block pushes each of those as
 * its own element. The lines are therefore flattened before they are read —
 * reading the elements as lines would stop at the very next field and return
 * nothing, which is exactly the kind of quiet empty that looks like a mail
 * with no body.
 */

const MARKER = /^kalsa-mail-[0-9a-f]{16} ?/;

/** The value of one fenced field, or "" when the field is absent or empty. */
export function fencedField(lines: string[], label: string): string {
  const flat = lines.join("\n").split("\n");
  const start = flat.findIndex((line) => line.startsWith(`${label}:`));
  if (start < 0) return "";
  const out: string[] = [];
  for (const raw of flat.slice(start + 1)) {
    if (raw.startsWith("<<<")) break;
    if (raw === "") continue;
    const line = raw.replace(MARKER, "");
    if (line === "(empty)") return "";
    out.push(line);
  }
  return out.join("\n");
}

/** The mail's own words, as the panel shows them. */
export function fencedBody(lines: string[]): string {
  return fencedField(lines, "body");
}