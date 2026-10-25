/**
 * The answer a call that cannot run gives the model: the precise fix — which
 * fields, what the schema says about them, one minimal example each — so the
 * round after re-sends the call correctly instead of guessing at an apology.
 * Every problem the repairs found is named, so one round is enough however
 * much was wrong.
 *
 * These sentences travel only as the tool result the model reads; the record
 * stores the same text, so a later replay of the turn still carries the fix.
 * They are English and bounded (400 characters, CisWire's cap: enough for
 * the schema's own description and the examples).
 */
import type { ToolDefinition } from "./tools/definitions";
import type { CallProblem, ParameterSchema } from "./repairToolCall";

const MAX_CHARS = 400;

/** The model sent arguments that were not a JSON object (or were cut). */
export function guideNotValidJson(tool: ToolDefinition): string {
  const name = tool.function.name;
  const required = requiredFields(tool);
  const list = required.map((r) => `"${r.field}"${r.description ? ` (${r.description})` : ""}`).join(", ");
  const example = `{${required.map((r) => `"${r.field}": ${fieldExample(tool, r.field, r.type)}`).join(", ")}}`;
  return assemble(
    `The arguments to ${name} were not valid JSON, so the call did not run. ` +
      `Re-send the same ${name} call as one JSON object`,
    list ? ` with ${list}` : "",
    `, e.g. ${example}.`,
  );
}

/** The arguments were longer than the app reads and were cut. */
export function guideCut(tool: ToolDefinition): string {
  const name = tool.function.name;
  return cap(
    `The arguments to ${name} were longer than this app reads and were cut, so the call did not run. ` +
      `Re-send the same ${name} call with shorter arguments.`,
  );
}

/** The fields the repairs could not fix: missing, wrongly typed, or not one
    of the enum's values — all of them, in one answer. */
export function guideProblem(tool: ToolDefinition, problems: readonly CallProblem[]): string {
  const name = tool.function.name;
  const parts = problems.map((p) => {
    const description = describeField(tool, p.field);
    const head =
      p.kind === "missing"
        ? `missing required "${p.field}"`
        : `invalid "${p.field}" (expected ${p.expected ?? "a valid value"})`;
    return `${head}${description ? `: ${description}` : ""}`;
  });
  const fields = joinAnd(problems.map((p) => `"${p.field}"`));
  const examples = problems.map((p) => `${p.field}: ${fieldExample(tool, p.field, p.expected)}`);
  return assemble(
    `The ${name} call cannot run: `,
    parts.join("; "),
    `. Re-send the same call with ${fields} set, e.g. ${examples.join(", ")}.`,
  );
}

/**
 * A guide whose fix is cut off corrects nothing, so the cap eats the middle —
 * the quoted schema descriptions — and never the instruction at the end. The
 * examples go before any of the instruction is touched, and only a
 * degenerate instruction that cannot fit at all is sliced.
 */
function assemble(head: string, middle: string, tail: string): string {
  let end = tail;
  if (head.length + end.length > MAX_CHARS - 8) {
    end = end.replace(/, e\.g\. [\s\S]*\.$/, ".");
  }
  const room = MAX_CHARS - head.length - end.length;
  const body = middle.length > room ? `${middle.slice(0, Math.max(0, room - 1))}…` : middle;
  return cap(`${head}${body}${end}`);
}

function requiredFields(tool: ToolDefinition): { field: string; type: string | null; description: string | null }[] {
  const schema = tool.function.parameters as ParameterSchema;
  const props = schema.properties ?? {};
  return (schema.required ?? []).map((field) => ({
    field,
    type: schemaType(props[field]),
    description: trimmedDescription(props[field]),
  }));
}

function describeField(tool: ToolDefinition, field: string): string | null {
  const prop = (tool.function.parameters as ParameterSchema).properties?.[field];
  return trimmedDescription(prop);
}

function trimmedDescription(prop: ParameterSchema | undefined): string | null {
  const d = prop?.description;
  if (typeof d !== "string") return null;
  // The sentence adds its own punctuation; a schema description that ends in
  // a period must not turn it into two.
  const trimmed = d.trim().replace(/\.+$/, "");
  return trimmed.length > 0 ? trimmed : null;
}

/** The smallest example value for a field: a value the schema actually
    allows — the enum's first — never a placeholder the schema forbids. */
function fieldExample(tool: ToolDefinition, field: string, type: string | null): string {
  const prop = (tool.function.parameters as ParameterSchema).properties?.[field];
  if (prop !== undefined && Array.isArray(prop.enum)) {
    const first = prop.enum.find((v): v is string => typeof v === "string");
    if (first !== undefined) return `"${first}"`;
  }
  switch (type) {
    case "number":
    case "integer":
      return "0";
    case "boolean":
      return "true";
    case "object":
      return "{}";
    case "array":
      return "[]";
    default:
      return '"..."';
  }
}

function schemaType(schema: ParameterSchema | undefined): string | null {
  if (!schema) return null;
  const t = schema.type;
  if (typeof t === "string") return t;
  if (Array.isArray(t)) {
    const first = t.find((x) => x !== "null");
    return typeof first === "string" ? first : null;
  }
  if (schema.properties) return "object";
  if (schema.items) return "array";
  return null;
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;
}

function cap(text: string): string {
  return text.length <= MAX_CHARS ? text : `${text.slice(0, MAX_CHARS - 1)}…`;
}
