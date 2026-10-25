export function stripThinkAndFences(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  let out = raw;
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<think>[\s\S]*$/gi, "");
  out = out.replace(/<\/?think>/gi, "");
  out = out.trim();
  const fenced = out.match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenced) out = fenced[1].trim();
  return out;
}

/**
 * Strip think tags / whole-output fences / known preambles from a translation.
 * Does NOT strip outer quotes (would corrupt legitimate quoted input).
 */
export function cleanTranslationOutput(raw: string): string {
  if (!raw || typeof raw !== "string") return "";
  let out = raw;
  // (a) closed <think>...</think> blocks, then unclosed <think> to end, then residual tags.
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<think>[\s\S]*$/gi, "");
  out = out.replace(/<\/?think>/gi, "");
  out = out.trim();

  // (b) strip markdown fence only when the entire output is fenced.
  const fenced = out.match(/^```(?:\w+)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenced) {
    out = fenced[1].trim();
  }

  // (c) intentionally do NOT strip wrapping quotes.

  // (d) explicit preambles only — drop first line when it is a known lead-in.
  const PREAMBLE =
    /^(here(?:'s| is)(?: the)? translation|ecco la traduzione|traduzione|translation)\s*:\s*/i;
  const lines = out.split("\n");
  if (lines.length > 0 && PREAMBLE.test(lines[0].trim())) {
    let i = 1;
    // Skip following blank lines after the preamble line.
    while (i < lines.length && lines[i].trim() === "") i += 1;
    out = lines.slice(i).join("\n").trim();
  } else if (PREAMBLE.test(out)) {
    out = out.replace(PREAMBLE, "").trim();
  }

  return out;
}
