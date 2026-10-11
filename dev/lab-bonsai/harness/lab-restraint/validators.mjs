// The app's miniapp validators, ported (one responsibility: would
// `runCreateMiniapp` have built this?). Mirrors chat/src/lib/miniapp:
// slots.ts coercion, checklist.ts, compareData.ts, readingQuiz.ts,
// quickCalculator.ts field rules, calculator.ts evaluator. Returns
// { ok, refusal } — refusal is the precise quick_calculator sentence the
// model would have read, else null; ok:false is the generic slots refusal.
// normalize.ts's second guard is not ported: it only clips or degrades
// blocks a builder already accepted, and never rejects a small build.

const TEMPLATES = ["compare_data", "quick_calculator", "reading_quiz", "checklist"];

// slots.ts:11,44
const MAX_SLOT_CHARS = 4000;
const MAX_ID_CHARS = 64;

export function isPlainObject(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}
function asString(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function asStringCapped(v) {
  const raw = asString(v);
  return raw === null || raw.length > MAX_SLOT_CHARS ? null : raw;
}
function asStringArrayCapped(v) {
  if (!Array.isArray(v)) return null;
  const out = [];
  for (const e of v) {
    const c = asStringCapped(e);
    if (c === null) return null;
    out.push(c);
  }
  return out;
}
function isUnsafeId(id) {
  return id === "__proto__" || id === "constructor" || id === "prototype";
}
function safeAnswerIndex(raw, optionCount) {
  const asInt = (n) => (Number.isInteger(n) && n >= 0 && n < optionCount ? n : undefined);
  if (typeof raw === "number") return asInt(raw);
  if (typeof raw === "string" && /^\s*-?\d+\s*$/.test(raw)) return asInt(Number(raw));
  return undefined;
}

// checklist.ts:11
const MAX_STEPS = 12;
function buildChecklist(s) {
  const raw = Array.isArray(s.steps) ? s.steps
    : Array.isArray(s.items) ? s.items : undefined;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_STEPS) return false;
  for (const entry of raw) {
    let title = null;
    if (typeof entry === "string") title = asStringCapped(entry);
    else if (isPlainObject(entry)) title = asStringCapped(entry.title) ?? asStringCapped(entry.body);
    if (!title) return false;
  }
  return true;
}

// compareData.ts
function buildCompareData(s) {
  const columns = asStringArrayCapped(s.columns);
  if (!columns || columns.length === 0) return false;
  if (s.rows !== undefined) {
    if (!Array.isArray(s.rows)) return false;
    for (const row of s.rows) if (!isPlainObject(row)) return false;
  }
  return true;
}

// readingQuiz.ts:10
const MAX_QUIZ_QUESTIONS = 8;
function buildReadingQuiz(s) {
  const q = s.questions;
  if (!Array.isArray(q) || q.length < 1 || q.length > MAX_QUIZ_QUESTIONS) return false;
  for (const item of q) {
    if (!isPlainObject(item)) return false;
    if (!asStringCapped(item.question)) return false;
    const options = asStringArrayCapped(item.options);
    if (!options || options.length < 2 || options.length > 4) return false;
    if (safeAnswerIndex(item.answerIndex, options.length) === undefined && item.answerIndex !== undefined) {
      // A wrong answerIndex does not refuse the build (readingQuiz.ts:36-37
      // drops it); only the shapes above refuse.
    }
  }
  return true;
}

// calculator.ts — the evaluator the quick_calculator rules run on.
const CALC_MAX_FORMULA_LEN = 200;
const CALC_MAX_DEPTH = 20;
const CALC_MAX_TOKENS = 100;

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  const s = expr;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i += 1; continue; }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") { tokens.push({ kind: "op", value: ch }); i += 1; continue; }
    if (ch === "(") { tokens.push({ kind: "lparen" }); i += 1; continue; }
    if (ch === ")") { tokens.push({ kind: "rparen" }); i += 1; continue; }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      let j = i, sawDot = false;
      while (j < s.length) {
        const c = s[j];
        if (c >= "0" && c <= "9") { j += 1; continue; }
        if (c === "." && !sawDot) { sawDot = true; j += 1; continue; }
        break;
      }
      const raw = s.slice(i, j);
      if (raw === "." || raw === "") return null;
      const value = Number(raw);
      if (!Number.isFinite(value)) return null;
      tokens.push({ kind: "number", value });
      i = j;
      continue;
    }
    return null;
  }
  if (tokens.length === 0 || tokens.length > CALC_MAX_TOKENS) return null;
  return tokens;
}

function evaluateTokens(tokens) {
  let pos = 0, depth = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];
  function parseExpr() {
    let left = parseTerm();
    for (;;) {
      const t = peek();
      if (!t || t.kind !== "op" || (t.value !== "+" && t.value !== "-")) break;
      consume();
      const right = parseTerm();
      left = t.value === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseTerm() {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (!t || t.kind !== "op" || (t.value !== "*" && t.value !== "/")) break;
      consume();
      const right = parseUnary();
      if (t.value === "/") {
        if (right === 0) throw new Error("divzero");
        left = left / right;
      } else left = left * right;
    }
    return left;
  }
  function parseUnary() {
    const t = peek();
    if (t && t.kind === "op" && (t.value === "+" || t.value === "-")) {
      consume();
      const v = parseUnary();
      return t.value === "-" ? -v : v;
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error("unexpected end");
    if (t.kind === "number") { consume(); return t.value; }
    if (t.kind === "lparen") {
      consume();
      depth += 1;
      if (depth > CALC_MAX_DEPTH) throw new Error("depth");
      const value = parseExpr();
      const close = peek();
      if (!close || close.kind !== "rparen") throw new Error("missing )");
      consume();
      depth -= 1;
      return value;
    }
    throw new Error("unexpected token");
  }
  try {
    const value = parseExpr();
    if (pos !== tokens.length) return false;
    if (!Number.isFinite(value)) return false;
    return true;
  } catch {
    return false;
  }
}

function evaluateCalculatorFormula(formula, vars) {
  const trimmed = String(formula || "").trim();
  if (!trimmed || trimmed.length > CALC_MAX_FORMULA_LEN) return false;
  if (!/^[\d\s+\-*/().a-zA-Z_]+$/.test(trimmed)) return false;
  const ids = Object.keys(vars || {})
    .filter((id) => id && /^[A-Za-z_][A-Za-z0-9_]*$/.test(id))
    .sort((a, b) => b.length - a.length);
  let expr = trimmed;
  for (const id of ids) {
    const re = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const n = vars[id];
    expr = expr.replace(re, n < 0 ? `(${n})` : String(n));
  }
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return false;
  const tokens = tokenize(expr);
  if (!tokens) return false;
  return evaluateTokens(tokens);
}

// quickCalculator.ts field rules, condensed to the build/refuse decision.
const MAX_CALCULATOR_FIELDS = 24;

function toNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && /^-?\d+([.,]\d+)?$/.test(v.trim())) {
    const n = Number(v.trim().replace(",", "."));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function buildCalculatorFields(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const out = [];
  const seen = new Set();
  for (const field of value) {
    if (!isPlainObject(field)) return null;
    const id = asString(field.id);
    if (!id || id.length > MAX_ID_CHARS || isUnsafeId(id)) return null;
    if (seen.has(id)) return null;
    seen.add(id);
    out.push({ id, value: field.value });
  }
  return out;
}

function fieldsToVars(fields) {
  const vars = {};
  for (const f of fields) {
    const n = toNumber(f.value);
    if (typeof n === "number") vars[f.id] = n;
  }
  return vars;
}

function formulaIdentifiers(formula) {
  const out = new Set();
  for (const m of formula.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) out.add(m[0]);
  return out;
}

function formulaLiterals(formula) {
  const out = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (/[A-Za-z_]/.test(ch)) {
      i += 1;
      while (i < formula.length && /[A-Za-z0-9_]/.test(formula[i])) i += 1;
      continue;
    }
    const startsNumber = /[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(formula[i + 1] ?? ""));
    const prev = i > 0 ? formula[i - 1] : "";
    if (startsNumber && !/[A-Za-z0-9_.]/.test(prev)) {
      let j = i, sawDot = false;
      while (j < formula.length && (/[0-9]/.test(formula[j]) || (formula[j] === "." && !sawDot))) {
        if (formula[j] === ".") sawDot = true;
        j += 1;
      }
      const value = Number(formula.slice(i, j));
      if (Number.isFinite(value)) out.push({ start: i, end: j, value });
      i = j;
      continue;
    }
    i += 1;
  }
  return out;
}

function unaryMinusStart(formula, start) {
  let at = start - 1;
  while (at >= 0 && /\s/.test(formula[at])) at -= 1;
  if (at < 0 || formula[at] !== "-") return -1;
  let before = at - 1;
  while (before >= 0 && /\s/.test(formula[before])) before -= 1;
  return before < 0 || /[+\-*/(]/.test(formula[before]) ? at : -1;
}

function planQuickCalculator(s) {
  const formula = asStringCapped(s.formula);
  if (!formula) return { ok: false, refusal: null };
  const fields = buildCalculatorFields(s.fields);
  if (fields === null) return { ok: false, refusal: null };

  if (!fields || fields.length === 0) {
    const taken = formulaIdentifiers(formula);
    const unknown = [...taken][0];
    if (unknown !== undefined) {
      return {
        ok: false,
        refusal: `create_miniapp: the formula references ${unknown}, which is not one of the fields. Write the formula from numbers, or give the fields.`,
      };
    }
    const literals = formulaLiterals(formula);
    const allFields = literals.map((l, i) => ({ id: `n${i + 1}`, value: l.value }));
    if (allFields.length > MAX_CALCULATOR_FIELDS) return { ok: false, refusal: null };
    const rewritten = rewrittenNoFields(formula);
    return {
      ok: evaluateCalculatorFormula(rewritten, fieldsToVars(allFields)),
      refusal: null,
    };
  }

  if (fields.length > MAX_CALCULATOR_FIELDS) return { ok: false, refusal: null };
  const known = new Set(fields.map((f) => f.id));
  for (const id of formulaIdentifiers(formula)) {
    if (!known.has(id)) {
      return {
        ok: false,
        refusal: `create_miniapp: the formula references ${id}, which is not one of the fields. Write the formula from the field ids you gave.`,
      };
    }
  }

  const referenced = formulaIdentifiers(formula);
  const literals = formulaLiterals(formula);
  for (const literal of literals) {
    const minus = unaryMinusStart(formula, literal.start);
    const target = minus >= 0 ? -literal.value : literal.value;
    const match = fields.find(
      (f) => !referenced.has(f.id) && toNumber(f.value) === target,
    );
    if (match) referenced.add(match.id);
  }
  const dead = fields.find((f) => !referenced.has(f.id));
  if (dead !== undefined) {
    return {
      ok: false,
      refusal: `create_miniapp: the field ${dead.id} is not used in the formula. Every field must appear in it; drop the ones that do not.`,
    };
  }
  return { ok: evaluateCalculatorFormula(formula, fieldsToVars(fields)), refusal: null };
}

// The no-fields lift rewrites literals to n1, n2… ids (quickCalculator.ts:186-188);
// for the build/refuse decision only the rewritten formula's evaluability matters.
function rewrittenNoFields(formula) {
  const replacements = [];
  let next = 1;
  const taken = formulaIdentifiers(formula);
  for (const span of formulaLiterals(formula)) {
    while (taken.has(`n${next}`)) next += 1;
    replacements.push({ ...span, id: `n${next}` });
    taken.add(`n${next}`);
    next += 1;
  }
  let out = "";
  let cursor = 0;
  for (const r of replacements) {
    out += formula.slice(cursor, r.start) + r.id;
    cursor = r.end;
  }
  return out + formula.slice(cursor);
}

/** runCreateMiniapp's decision (chat/src/lib/tools/createMiniapp.ts:29-47):
    the template id, then the build. { ok:false, refusal:null } is the
    generic INVALID_SLOTS refusal. */
export function validateMiniappCall(name, args) {
  if (name !== "create_miniapp") return { ok: false, refusal: null, unknownTool: true };
  const raw = isPlainObject(args) ? args : {};
  const template = typeof raw.template === "string" ? raw.template.trim() : "";
  if (!TEMPLATES.includes(template)) return { ok: false, refusal: null, badTemplate: true };
  const slots = isPlainObject(raw.slots) ? raw.slots : {};
  if (template === "compare_data") return { ok: buildCompareData(slots), refusal: null };
  if (template === "checklist") return { ok: buildChecklist(slots), refusal: null };
  if (template === "reading_quiz") return { ok: buildReadingQuiz(slots), refusal: null };
  return planQuickCalculator(slots);
}
