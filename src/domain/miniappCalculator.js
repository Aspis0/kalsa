// ── Safe calculator formula evaluator (no eval / Function) ──────────────────
// Tokenizer + recursive-descent parser for: numbers, pre-resolved identifiers,
// + - * / and parentheses. Identifiers MUST be substituted to numbers BEFORE
// parsing (no object / property access). Limits reject oversized input.

const CALC_MAX_FORMULA_LEN = 200;
const CALC_MAX_DEPTH = 20;
const CALC_MAX_TOKENS = 100;

/** @typedef {{ kind: "number"; value: number } | { kind: "op"; value: "+" | "-" | "*" | "/" } | { kind: "lparen" } | { kind: "rparen" }} CalcToken */

/** @typedef {{ ok: true; value: number } | { ok: false; reason: "unsupported" | "divzero" }} CalcEvalResult */

/**
 * Tokenize an arithmetic expression into numbers, operators and parentheses.
 * Rejects any non-numeric character (e.g. leftover identifiers) and empty numbers.
 * @param {string} expr
 * @returns {CalcToken[] | null}
 */
function tokenizeCalculatorExpr(expr) {
  const tokens = [];
  let i = 0;
  const s = expr;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "op", value: ch });
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i += 1;
      continue;
    }
    // Number: optional digits . digits (scientific notation rejected intentionally).
    if (ch >= "0" && ch <= "9" || ch === ".") {
      let j = i;
      let sawDot = false;
      while (j < s.length) {
        const c = s[j];
        if (c >= "0" && c <= "9") {
          j += 1;
          continue;
        }
        if (c === "." && !sawDot) {
          sawDot = true;
          j += 1;
          continue;
        }
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
    // Any other character (leftover identifiers, etc.) → reject.
    return null;
  }
  if (tokens.length === 0 || tokens.length > CALC_MAX_TOKENS) return null;
  return tokens;
}

/**
 * Recursive-descent parse:
 *   expr := term ((+|-) term)*
 *   term := unary ((*|/) unary)*
 *   unary := (+|-) unary | primary
 *   primary := number | '(' expr ')'
 * @param {CalcToken[]} tokens
 * @returns {CalcEvalResult}
 */
function parseCalculatorTokens(tokens) {
  let pos = 0;
  let depth = 0;

  const peek = () => tokens[pos];
  const consume = () => {
    const t = tokens[pos];
    pos += 1;
    return t;
  };

  function parseExpr() {
    let left = parseTerm();
    while (peek() && peek().kind === "op") {
      const op = peek().value;
      if (op !== "+" && op !== "-") break;
      consume();
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm() {
    let left = parseUnary();
    while (
      peek() &&
      peek().kind === "op" &&
      (peek().value === "*" || peek().value === "/")
    ) {
      const op = consume().value;
      const right = parseUnary();
      if (op === "/") {
        if (right === 0) {
          const err = new Error("divzero");
          err.code = "divzero";
          throw err;
        }
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  function parseUnary() {
    if (peek() && peek().kind === "op") {
      const op = peek().value;
      if (op === "+" || op === "-") {
        consume();
        const v = parseUnary();
        return op === "-" ? -v : v;
      }
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error("unexpected end");
    if (t.kind === "number") {
      consume();
      return t.value;
    }
    if (t.kind === "lparen") {
      consume();
      depth += 1;
      if (depth > CALC_MAX_DEPTH) throw new Error("depth");
      const value = parseExpr();
      if (peek().kind !== "rparen") throw new Error("missing )");
      consume();
      depth -= 1;
      return value;
    }
    throw new Error("unexpected token");
  }

  try {
    const value = parseExpr();
    if (pos !== tokens.length) return { ok: false, reason: "unsupported" };
    if (!Number.isFinite(value)) return { ok: false, reason: "unsupported" };
    return { ok: true, value };
  } catch (err) {
    if (err instanceof Error && err.code === "divzero") {
      return { ok: false, reason: "divzero" };
    }
    return { ok: false, reason: "unsupported" };
  }
}

/**
 * Evaluate a calculator formula safely.
 *   1) Length / charset gate
 *   2) Substitute known field ids with their numeric values (longest-first)
 *   3) Reject any leftover identifier characters
 *   4) Tokenize + recursive-descent parse (no eval / Function)
 * @param {string} formula
 * @param {Record<string, number>} vars
 * @returns {CalcEvalResult}
 */
function evaluateCalculatorFormula(formula, vars) {
  const trimmed = String(formula || "").trim();
  if (!trimmed || trimmed.length > CALC_MAX_FORMULA_LEN) {
    return { ok: false, reason: "unsupported" };
  }
  // Allow only numbers, whitespace, arithmetic ops, parens, and identifier chars
  // before substitution. No quotes, brackets, or dots inside identifiers.
  if (!/^[\d\s+\-*/().a-zA-Z_]+$/.test(trimmed)) {
    return { ok: false, reason: "unsupported" };
  }
  const ids = Object.keys(vars || {})
    .filter((id) => id && /^[A-Za-z_][A-Za-z0-9_]*$/.test(id))
    .sort((a, b) => b.length - a.length);
  let expr = trimmed;
  for (const id of ids) {
    const re = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    // Wrap negatives in parentheses so "a-b" with a=-1 stays valid as "(-1)-...".
    const n = vars[id];
    const replacement = n < 0 ? `(${n})` : String(n);
    expr = expr.replace(re, replacement);
  }
  // After substitution only digits, ops, parens, whitespace, and decimal points remain.
  if (!/^[\d\s+\-*/().]+$/.test(expr)) {
    return { ok: false, reason: "unsupported" };
  }
  const tokens = tokenizeCalculatorExpr(expr);
  if (!tokens) return { ok: false, reason: "unsupported" };
  return parseCalculatorTokens(tokens);
}

module.exports = {
  CALC_MAX_FORMULA_LEN,
  evaluateCalculatorFormula,
  parseCalculatorTokens,
  tokenizeCalculatorExpr,
};