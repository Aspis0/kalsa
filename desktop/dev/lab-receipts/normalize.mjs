// Condition D's normalizer (one responsibility: turn a free-text reply into
// the shape the validators can trust, without deciding anything). Lenient
// JSON extraction, Italian number coercion ("€ 1.234,56" → 1234.56), date
// normalization to ISO through the validators' own parser, whitespace-squeeze
// on checkable identifiers. It never rejects a value it cannot fix — it
// leaves it for the validators to name.
import { parseDate, recognizeTipo } from "./validators.mjs";

export function looseJson(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

export function coerceAmount(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return v;
  const s = v.replace(/[€\s]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : v;
}

export function normalize(doc) {
  if (doc === null || typeof doc !== "object") return doc;
  const out = { ...doc };
  // Printed tipo variants ("Bolletta di energia elettrica") → the enum value;
  // the validators' recognizer would fail them as-is.
  const tipo = recognizeTipo(out.tipo);
  if (tipo !== null) out.tipo = tipo;
  for (const key of ["totale", "iva"]) {
    if (out[key] !== undefined && out[key] !== null) out[key] = coerceAmount(out[key]);
  }
  if (Array.isArray(out.righe)) {
    out.righe = out.righe.map((r) =>
      r && typeof r === "object"
        ? { ...r, importo: coerceAmount(r.importo), qta: coerceAmount(r.qta) }
        : r,
    );
  }
  for (const key of ["data", "scadenza"]) {
    if (typeof out[key] === "string") {
      const iso = parseDate(out[key]);
      if (iso !== null) out[key] = iso;
    }
  }
  for (const key of ["iban", "piva", "pod", "pdr"]) {
    if (typeof out[key] === "string") {
      // Squeeze whitespace, then drop the field's own label when the model
      // transcribed it with one ("P.IVA 54185128417", "IBAN: IT60…") — the
      // same coercion "€ 62,21" gets. Only a clean shape replaces the value.
      let v = out[key].replace(/\s+/g, "");
      if (key === "piva") {
        const digits = v.replace(/\D/g, "");
        if (/^\d{11}$/.test(digits)) v = digits;
      } else if (key === "iban") {
        const bare = v.replace(/^IBAN:?/i, "");
        if (/^[A-Z]{2}\d{2}[A-Z0-9]+$/i.test(bare)) v = bare.toUpperCase();
      }
      out[key] = v;
    }
  }
  return out;
}
