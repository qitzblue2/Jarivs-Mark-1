import type { Tool } from "./types";

/**
 * Arithmetic without `eval`.
 *
 * A shunting-yard parser over a fixed token set: no identifiers, no property
 * access, no function calls the grammar doesn't name. That's the point —
 * the argument comes from a model, and `eval` on model output is how you hand
 * an attacker the server.
 */
const FUNCTIONS: Record<string, (n: number) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor,
  ceil: Math.ceil, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  log: Math.log, log10: Math.log10, exp: Math.exp,
};
const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const PRECEDENCE: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 3 };

type Token = { kind: "num"; value: number } | { kind: "op" | "fn" | "paren"; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch)) { i++; continue; }

    if (/[0-9.]/.test(ch)) {
      const match = /^[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/.exec(input.slice(i));
      if (!match) throw new Error(`Bad number at position ${i}`);
      tokens.push({ kind: "num", value: Number(match[0]) });
      i += match[0].length;
      continue;
    }

    if (/[a-z]/i.test(ch)) {
      const match = /^[a-z]+/i.exec(input.slice(i))!;
      const word = match[0].toLowerCase();
      if (word in FUNCTIONS) tokens.push({ kind: "fn", value: word });
      else if (word in CONSTANTS) tokens.push({ kind: "num", value: CONSTANTS[word] });
      else throw new Error(`Unknown name "${word}"`);
      i += match[0].length;
      continue;
    }

    if (ch in PRECEDENCE) {
      // A leading -/+ is a sign, not a binary operator.
      const prev = tokens[tokens.length - 1];
      const unary = (ch === "-" || ch === "+") &&
        (!prev || prev.kind === "op" || (prev.kind === "paren" && prev.value === "("));
      if (unary) {
        tokens.push({ kind: "num", value: 0 });
      }
      tokens.push({ kind: "op", value: ch });
      i++;
      continue;
    }

    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", value: ch });
      i++;
      continue;
    }

    throw new Error(`Unexpected character "${ch}"`);
  }

  return tokens;
}

function apply(op: string, a: number, b: number): number {
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return a / b;
    case "%": return a % b;
    case "^": return a ** b;
    default: throw new Error(`Unknown operator "${op}"`);
  }
}

export function evaluate(expression: string): number {
  if (expression.length > 500) throw new Error("Expression too long.");

  const tokens = tokenize(expression);
  const values: number[] = [];
  const ops: string[] = [];

  const reduce = () => {
    const op = ops.pop()!;
    if (op in FUNCTIONS) {
      const x = values.pop();
      if (x === undefined) throw new Error(`${op}() is missing its argument`);
      values.push(FUNCTIONS[op](x));
      return;
    }
    const b = values.pop();
    const a = values.pop();
    if (a === undefined || b === undefined) throw new Error(`Operator "${op}" is missing an operand`);
    values.push(apply(op, a, b));
  };

  for (const token of tokens) {
    if (token.kind === "num") {
      values.push(token.value);
    } else if (token.kind === "fn") {
      ops.push(token.value);
    } else if (token.kind === "paren") {
      if (token.value === "(") {
        ops.push("(");
      } else {
        while (ops.length && ops[ops.length - 1] !== "(") reduce();
        if (!ops.length) throw new Error("Unbalanced parentheses");
        ops.pop();
        // A function immediately before the group applies to its result.
        if (ops.length && ops[ops.length - 1] in FUNCTIONS) reduce();
      }
    } else {
      // "^" is right-associative, so an equal-precedence "^" does not reduce.
      while (
        ops.length &&
        ops[ops.length - 1] !== "(" &&
        !(ops[ops.length - 1] in FUNCTIONS) &&
        (PRECEDENCE[ops[ops.length - 1]] > PRECEDENCE[token.value] ||
          (PRECEDENCE[ops[ops.length - 1]] === PRECEDENCE[token.value] && token.value !== "^"))
      ) {
        reduce();
      }
      ops.push(token.value);
    }
  }

  while (ops.length) {
    if (ops[ops.length - 1] === "(") throw new Error("Unbalanced parentheses");
    reduce();
  }

  if (values.length !== 1) throw new Error("Malformed expression");
  const result = values[0];
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number");
  return result;
}

export const calculateTool: Tool = {
  name: "calculate",
  description:
    "Evaluate arithmetic instead of doing it yourself. Supports + - * / % ^, " +
    "parentheses, pi, e, sqrt, abs, round, floor, ceil, sin, cos, tan, log, log10, exp.",
  parameters: {
    type: "object",
    properties: {
      expression: { type: "string", description: 'e.g. "(2 + 3) * sqrt(16)"' },
    },
    required: ["expression"],
  },
  async handler(args) {
    const expression = String(args.expression ?? "").trim();
    if (!expression) throw new Error("No expression given.");
    return `${expression} = ${evaluate(expression)}`;
  },
};
