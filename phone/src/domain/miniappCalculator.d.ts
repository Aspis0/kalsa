/** Token for the calculator expression tokenizer. */
export type CalcToken =
  | { kind: "number"; value: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" }
  | { kind: "lparen" }
  | { kind: "rparen" };

/** Result of a calculator formula evaluation. */
export type CalcEvalResult =
  | { ok: true; value: number }
  | { ok: false; reason: "unsupported" | "divzero" };

/** Tokenize an arithmetic expression; null on any invalid token. */
export function tokenizeCalculatorExpr(expr: string): CalcToken[] | null;

/** Recursive-descent parse of calculator tokens. */
export function parseCalculatorTokens(tokens: CalcToken[]): CalcEvalResult;

/**
 * Evaluate a calculator formula safely.
 * Length / charset gate, field-id substitution, then tokenize + recursive-descent parse.
 */
export function evaluateCalculatorFormula(
  formula: string,
  vars: Record<string, number>,
): CalcEvalResult;