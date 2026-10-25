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

/** The marker on every value line: the call's nonce, then the space the sidecar
    always writes before the text (an empty value is the text "(empty)"). */
const MARKED = /^kalsa-mail-[0-9a-f]{16} /m;
/** The next field's own label line. Fields run one after another inside the
    fence, so a field that read to the end marker took the labels and the text
    of every field after it. */
const FIELD = /^[a-z_]+:$/;

/** The value of one fenced field, or "" when the field is absent or empty. */
export function fencedField(lines: string[], label: string): string {
  const flat = lines.join("\n").split("\n");
  const start = flat.findIndex((line) => line.startsWith(`${label}:`));
  if (start < 0) return "";
  const out: string[] = [];
  for (const raw of flat.slice(start + 1)) {
    if (raw.startsWith("<<<")) break;
    if (FIELD.test(raw)) break;
    if (raw === "") continue;
    const line = raw.replace(MARKED, "");
    if (line === "(empty)") return "";
    out.push(line);
  }
  return out.join("\n");
}

/** Whether a tool answer carries mail text: a value line is marked. An empty
    list has only the block's delimiters, and an error answer has no block at
    all, so neither counts. */
export function carriesMail(text: string): boolean {
  return MARKED.test(text);
}

/** The mail's own words, as the panel shows them. */
export function fencedBody(lines: string[]): string {
  return fencedField(lines, "body");
}