// What a Rust rejection or a structured state field becomes on screen: the
// code picks the sentence from the chosen language's `rust` table; the
// English text inside the message is the fallback a phone client or an
// unknown code still shows.

import type { English } from "../i18n/en/all";

/** The wire shape of a Rust-side message. */
export interface RustMessage {
  code?: string;
  params?: Record<string, unknown>;
  text?: string;
}

/** One sentence per code. A group names its codes either by the path under
    it (`startup.disk_full`, `road.open`) or by the whole dotted code
    (`invite.no_road` sits in `invite` under that full key). The tables are
    plain object literals and the code comes off the wire, so only own keys
    count ("constructor" is not a group, "__proto__" is not a row) and a row
    is accepted only once it has said a string. */
export function codeSentence(
  rust: English["rust"],
  code: string,
  params: Record<string, unknown>,
  tag: string,
): string | null {
  const [group, ...rest] = code.split(".");
  const groups = rust as Record<string, unknown>;
  if (!Object.hasOwn(groups, group)) return null;
  const rows = groups[group];
  if (rows === null || typeof rows !== "object") return null;
  const table = rows as Record<string, unknown>;
  const nested = rest.join(".");
  const row = Object.hasOwn(table, nested) ? table[nested] : Object.hasOwn(table, code) ? table[code] : undefined;
  if (typeof row === "function") {
    const said = row(params, tag);
    return typeof said === "string" ? said : null;
  }
  return typeof row === "string" ? row : null;
}

/** A rejection or message field as a sentence. A plain string is an
    unexpected IPC error from a helper this app never worded — shown as it
    came, never parsed. */
export function rustSentence(rust: English["rust"], value: unknown, tag = "en"): string {
  if (typeof value === "string") return value;
  const message = (value ?? {}) as RustMessage;
  if (typeof message.code !== "string") {
    return typeof message.text === "string" ? message.text : String(value);
  }
  // A code this table has no row for is a newer Rust than this build: the
  // plain sentence, never the raw code.
  return (
    codeSentence(rust, message.code, message.params ?? {}, tag) ??
    message.text ??
    rust.app.unexpected({}, tag)
  );
}
