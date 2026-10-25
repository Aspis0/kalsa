/**
 * Deterministic shape repairs for one parsed tool call, measured against the
 * tool's own parameter schema: the wrongs a small model does to a call it
 * decided to make — a JSON string where an object belongs, a number where a
 * string does, arguments nested one level too deep.
 *
 * Repairs never invent content. A required field the model did not send, a
 * value no coercion can make right, or a value the schema's enum does not
 * list is reported as a problem for the guide (guideRetry.ts) to send back;
 * the call is not quietly filled in or corrected.
 *
 * The wire and the history replay what these repairs return (runToolCall.ts),
 * so llama-server's template re-parses the arguments the app actually ran.
 */

/** The schema subset these repairs read — the shape of
    `ToolDefinition.parameters`, which arrives untyped. */
export type ParameterSchema = {
  type?: string | string[];
  properties?: Record<string, ParameterSchema>;
  items?: ParameterSchema | ParameterSchema[];
  required?: string[];
  description?: string;
  enum?: unknown[];
};

/** What is still wrong with a call after the repairs: the guide's subject. */
export interface CallProblem {
  field: string;
  kind: "missing" | "type" | "enum";
  /** The type the schema asks for; for an enum, `one of "a", "b"`. */
  expected: string | null;
}

export interface RepairedArguments {
  /** Empty ⇒ nothing changed: `args` is the same reference that came in. */
  repairs: string[];
  args: Record<string, unknown>;
  problems: CallProblem[];
}

/** The offered name for `name`, whatever its casing; null when none matches.
    A name the server mangled in case alone is still the call the model meant. */
export function canonicalToolName(name: string, offered: readonly string[]): string | null {
  const lower = name.toLowerCase();
  for (const known of offered) {
    if (known.toLowerCase() === lower) return known;
  }
  return null;
}

/**
 * Repair one call's parsed arguments. Only declared top-level properties are
 * touched; `slots`-style free-form objects pass as they parsed, because the
 * schema does not describe their inside. Membership is own-property
 * everywhere: a model's key that shadows `constructor` or `__proto__` is
 * data, never a schema member or a prototype trap.
 */
export function repairToolCall(
  args: Record<string, unknown>,
  parameters: Record<string, unknown>,
): RepairedArguments {
  const schema = parameters as ParameterSchema;
  const props = schema.properties ?? {};
  const repairs: string[] = [];

  // Arguments nested one level too deep: the model wrapped everything under
  // one name. Only when the inner keys are the schema's and the wrapper is not.
  let out = args;
  const keys = Object.keys(out);
  if (keys.length === 1) {
    const wrapper = keys[0]!;
    const inner = out[wrapper];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      const innerHits = Object.keys(inner).filter((k) => Object.hasOwn(props, k)).length;
      if (innerHits >= 1 && !Object.hasOwn(props, wrapper)) {
        repairs.push(`unwrapped single-key nest "${wrapper}"`);
        out = { ...(inner as Record<string, unknown>) };
      }
    }
  }

  // Null prototype: repairs write the schema's own keys, but a key that
  // shadows a prototype setter must still land as data.
  const repaired: Record<string, unknown> = Object.assign(Object.create(null), out);
  for (const [key, prop] of Object.entries(props)) {
    if (!Object.hasOwn(repaired, key)) continue;
    const value = repairValue(repaired[key], prop, repairs, key);
    if (value !== repaired[key]) repaired[key] = value;
  }

  const problems = problemsOf(repaired, schema);
  if (repairs.length === 0) return { repairs: [], args, problems };
  return { repairs, args: repaired, problems };
}

function repairValue(
  value: unknown,
  schema: ParameterSchema,
  repairs: string[],
  path: string,
): unknown {
  const want = schemaType(schema);

  // A JSON-encoded string where an object or array belongs.
  if (typeof value === "string" && (want === "object" || want === "array")) {
    const parsed = tryParse(value);
    const shape =
      parsed !== null && typeof parsed === "object" &&
      (want === "array" ? Array.isArray(parsed) : !Array.isArray(parsed));
    if (shape) {
      repairs.push(`${path}: parsed JSON string`);
      value = parsed;
    }
  }

  // One object where an array of objects belongs, and the reverse.
  if (want === "array" && value !== null && typeof value === "object" && !Array.isArray(value)) {
    const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
    if (items !== undefined && schemaType(items) === "object") {
      repairs.push(`${path}: wrapped object as the only array item`);
      value = [value];
    }
  }
  if (
    want === "object" && Array.isArray(value) && value.length === 1 &&
    value[0] !== null && typeof value[0] === "object" && !Array.isArray(value[0])
  ) {
    repairs.push(`${path}: unwrapped the only array item`);
    value = value[0];
  }

  // Scalars: the value the schema's type asks for, from the one sent.
  if (want === "number" || want === "integer") {
    if (typeof value === "string" && value.trim() !== "") {
      const n = Number(value);
      if (Number.isFinite(n) && (want === "number" || Number.isInteger(n))) {
        repairs.push(`${path}: number from string`);
        return want === "integer" ? Math.trunc(n) : n;
      }
    }
  } else if (want === "boolean") {
    if (typeof value === "string") {
      const s = value.trim().toLowerCase();
      if (s === "true" || s === "false") {
        repairs.push(`${path}: boolean from string`);
        return s === "true";
      }
    } else if (typeof value === "number" && (value === 0 || value === 1)) {
      repairs.push(`${path}: boolean from number`);
      return value === 1;
    }
  } else if (want === "string") {
    if (typeof value === "number" || typeof value === "boolean") {
      repairs.push(`${path}: string from ${typeof value}`);
      return String(value);
    }
  }
  return value;
}

/** What the repairs could not fix: a required field still absent, a declared
    field still the wrong type, a string the enum does not list. These are the
    guide's subjects, all of them. */
function problemsOf(args: Record<string, unknown>, schema: ParameterSchema): CallProblem[] {
  const props = schema.properties ?? {};
  const problems: CallProblem[] = [];
  for (const field of schema.required ?? []) {
    if (!Object.hasOwn(args, field)) {
      problems.push({ field, kind: "missing", expected: schemaType(props[field]) });
    }
  }
  for (const [field, prop] of Object.entries(props)) {
    if (!Object.hasOwn(args, field)) continue;
    const want = schemaType(prop);
    if (want !== null && !matchesType(args[field], want)) {
      problems.push({ field, kind: "type", expected: want });
      continue;
    }
    const allowed = enumValues(prop);
    if (allowed !== null && typeof args[field] === "string" && !allowed.includes(args[field] as string)) {
      problems.push({
        field,
        kind: "enum",
        expected: `one of ${allowed.map((v) => `"${v}"`).join(", ")}`,
      });
    }
  }
  return problems;
}

function enumValues(schema: ParameterSchema): string[] | null {
  if (!Array.isArray(schema.enum)) return null;
  const values = schema.enum.filter((v): v is string => typeof v === "string");
  return values.length > 0 ? values : null;
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

function matchesType(value: unknown, want: string): boolean {
  switch (want) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    default:
      return true;
  }
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
