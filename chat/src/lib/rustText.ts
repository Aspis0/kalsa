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

/** One sentence per code, keyed as the code spells it:
    `rust.startup.disk_full`. */
export function codeSentence(
  rust: English["rust"],
  code: string,
  params: Record<string, unknown>,
  tag: string,
): string | null {
  let node: unknown = rust;
  for (const part of code.split(".")) {
    if (node === null || typeof node !== "object") return null;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node === "function") return node(params, tag);
  return typeof node === "string" ? node : null;
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
