/**
 * Tiny arithmetic parser: integers/floats + + - * / ( ).
 * No eval, no identifiers, no exponents.
 */

export const CALC_INPUT_CAP = 200;

export type CalcOk = { ok: true; value: number };
export type CalcErr = { ok: false; error: "invalid" | "divzero" };
export type CalcResult = CalcOk | CalcErr;

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

class Parser {
  private readonly s: string;
  private i = 0;
  divZero = false;

  constructor(input: string) {
    this.s = input;
  }

  peek(): string {
    return this.s[this.i] ?? "";
  }

  skipWs(): void {
    while (this.peek() === " " || this.peek() === "\t" || this.peek() === "\n") {
      this.i += 1;
    }
  }

  number(): number | null {
    const start = this.i;
    if (!isDigit(this.peek()) && this.peek() !== ".") return null;
    while (isDigit(this.peek())) this.i += 1;
    if (this.peek() === ".") {
      this.i += 1;
      if (!isDigit(this.peek())) {
        this.i = start;
        return null;
      }
      while (isDigit(this.peek())) this.i += 1;
    }
    const raw = this.s.slice(start, this.i);
    if (!raw || raw === ".") {
      this.i = start;
      return null;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      this.i = start;
      return null;
    }
    return n;
  }

  primary(): number | null {
    this.skipWs();
    if (this.peek() === "(") {
      this.i += 1;
      const inner = this.expr();
      this.skipWs();
      if (this.peek() !== ")") return null;
      this.i += 1;
      return inner;
    }
    return this.number();
  }

  unary(): number | null {
    this.skipWs();
    if (this.peek() === "+") {
      this.i += 1;
      return this.unary();
    }
    if (this.peek() === "-") {
      this.i += 1;
      const v = this.unary();
      return v == null ? null : -v;
    }
    return this.primary();
  }

  term(): number | null {
    let left = this.unary();
    if (left == null) return null;
    for (;;) {
      this.skipWs();
      const op = this.peek();
      if (op !== "*" && op !== "/") break;
      this.i += 1;
      const right = this.unary();
      if (right == null) return null;
      if (op === "/") {
        if (right === 0) {
          this.divZero = true;
          return null;
        }
        left = left / right;
      } else {
        left = left * right;
      }
      if (!Number.isFinite(left)) return null;
    }
    return left;
  }

  expr(): number | null {
    let left = this.term();
    if (left == null) return null;
    for (;;) {
      this.skipWs();
      const op = this.peek();
      if (op !== "+" && op !== "-") break;
      this.i += 1;
      const right = this.term();
      if (right == null) return null;
      left = op === "+" ? left + right : left - right;
      if (!Number.isFinite(left)) return null;
    }
    return left;
  }
}

export function evaluateCalc(input: string): CalcResult {
  if (typeof input !== "string") return { ok: false, error: "invalid" };
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > CALC_INPUT_CAP) {
    return { ok: false, error: "invalid" };
  }
  if (/[A-Za-z_]/.test(trimmed) || /[=;{}[\]`,\\]/.test(trimmed)) {
    return { ok: false, error: "invalid" };
  }
  const parser = new Parser(trimmed);
  const value = parser.expr();
  parser.skipWs();
  if (parser.divZero) return { ok: false, error: "divzero" };
  if (value == null || parser.peek() !== "") return { ok: false, error: "invalid" };
  if (!Number.isFinite(value)) return { ok: false, error: "invalid" };
  return { ok: true, value };
}
