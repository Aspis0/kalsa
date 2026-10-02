/**
 * The projection engine for the report records: walk a parsed payload through
 * its tag's allow-list (tagSchemas.ts) field by field and serialize the
 * survivors as `TAG {json}`. Free-form strings are never copied — only
 * schema-validated values reach the output.
 */
import { TAG_SCHEMAS, type FieldRule } from "./tagSchemas";

/**
 * Allowed catalog model ids. Filled at startup from MODEL_REGISTRY
 * (src/engine/ModelRegistry.ts) — this module stays a pure leaf and must not
 * import the catalog graph (it pulls react-native in). Until then, no model
 * id passes (fail closed).
 */
const modelIds = new Set<string>();

export function setLogModelIds(ids: readonly string[]): void {
  modelIds.clear();
  for (const id of ids) modelIds.add(id);
}

function projectValue(rule: FieldRule, value: unknown): unknown {
  if (value === null) return "nullable" in rule && rule.nullable ? null : undefined;
  switch (rule.k) {
    case "num":
      return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    case "bool":
      return typeof value === "boolean" ? value : undefined;
    case "enum":
      return typeof value === "string" && rule.values.includes(value) ? value : undefined;
    case "counter":
      return typeof value === "string" && /^\d{1,12}$/.test(value) ? value : undefined;
    case "modelId":
      return typeof value === "string" && modelIds.has(value) ? value : undefined;
    case "numObj": {
      if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
      if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
      const out: Record<string, number> = {};
      for (const [key, item] of Object.entries(value)) {
        if (typeof item !== "number" || !Number.isFinite(item)) return undefined;
        out[key] = item;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    }
  }
}

/**
 * Build the record field by field and serialize it as `TAG {json}`; null for
 * an unknown tag or a payload that is not a JSON object. A field that is
 * absent or of the wrong kind is dropped, never the whole line.
 */
export function formatRecord(tag: string, payload: unknown): string | null {
  const schema = TAG_SCHEMAS[tag];
  if (!schema) return null;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return null;
  const input = payload as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [field, rule] of Object.entries(schema)) {
    if (!(field in input)) continue;
    const projected = projectValue(rule, input[field]);
    if (projected !== undefined) out[field] = projected;
  }
  return `${tag} ${JSON.stringify(out)}`;
}
