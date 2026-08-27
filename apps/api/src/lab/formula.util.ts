type Token =
  | { type: 'NUMBER'; value: number }
  | { type: 'CODE_REF'; code: string }
  | { type: 'OP'; value: '+' | '-' | '*' | '/' }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' };

function tokenize(formula: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '[') {
      const end = formula.indexOf(']', i + 1);
      if (end === -1) throw new Error(`Unclosed bracket at position ${i}`);
      tokens.push({ type: 'CODE_REF', code: formula.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'LPAREN' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN' });
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'OP', value: ch });
      i++;
      continue;
    }
    if (/\d/.test(ch) || ch === '.') {
      let num = '';
      while (i < formula.length && (/\d/.test(formula[i]) || formula[i] === '.')) {
        num += formula[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(num) });
      continue;
    }
    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }
  return tokens;
}

// Recursive-descent parser with standard precedence:
// expr = term (('+' | '-') term)*
// term = factor (('*' | '/') factor)*
// factor = '-' factor | '(' expr ')' | NUMBER | CODE_REF

type EvalFn = (values: Record<string, number | null | undefined>) => number | null;

function parse(tokens: Token[]): EvalFn {
  let pos = 0;

  function peek(): Token | undefined {
    return tokens[pos];
  }

  function consume(): Token {
    return tokens[pos++];
  }

  function parseExpr(): EvalFn {
    let left = parseTerm();
    while (peek()?.type === 'OP' && (peek() as Token & { type: 'OP' }).value in { '+': 1, '-': 1 }) {
      const op = (consume() as Token & { type: 'OP' }).value;
      const right = parseTerm();
      const prevLeft = left;
      if (op === '+') {
        left = (v) => {
          const l = prevLeft(v);
          const r = right(v);
          return l === null || r === null ? null : l + r;
        };
      } else {
        left = (v) => {
          const l = prevLeft(v);
          const r = right(v);
          return l === null || r === null ? null : l - r;
        };
      }
    }
    return left;
  }

  function parseTerm(): EvalFn {
    let left = parseFactor();
    while (peek()?.type === 'OP' && (peek() as Token & { type: 'OP' }).value in { '*': 1, '/': 1 }) {
      const op = (consume() as Token & { type: 'OP' }).value;
      const right = parseFactor();
      const prevLeft = left;
      if (op === '*') {
        left = (v) => {
          const l = prevLeft(v);
          const r = right(v);
          return l === null || r === null ? null : l * r;
        };
      } else {
        left = (v) => {
          const l = prevLeft(v);
          const r = right(v);
          if (l === null || r === null) return null;
          if (r === 0) return null;
          return l / r;
        };
      }
    }
    return left;
  }

  function parseFactor(): EvalFn {
    const tok = peek();
    if (!tok) throw new Error('Unexpected end of formula');

    if (tok.type === 'OP' && tok.value === '-') {
      consume();
      const inner = parseFactor();
      return (v) => {
        const val = inner(v);
        return val === null ? null : -val;
      };
    }

    if (tok.type === 'LPAREN') {
      consume();
      const inner = parseExpr();
      const close = consume();
      if (!close || close.type !== 'RPAREN') {
        throw new Error('Expected closing parenthesis');
      }
      return inner;
    }

    if (tok.type === 'NUMBER') {
      consume();
      return () => tok.value;
    }

    if (tok.type === 'CODE_REF') {
      consume();
      return (v) => {
        const val = v[tok.code];
        return val === null || val === undefined ? null : val;
      };
    }

    throw new Error(`Unexpected token: ${tok.type}`);
  }

  const result = parseExpr();
  if (pos < tokens.length) {
    throw new Error(`Unexpected token at position ${pos}`);
  }
  return result;
}

export function evaluateFormula(
  formula: string,
  values: Record<string, number | null | undefined>
): number | null {
  const trimmed = formula.trim();
  if (!trimmed) return null;
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;
  const evalFn = parse(tokens);
  const result = evalFn(values);
  if (result !== null && !isFinite(result)) return null;
  return result;
}

function extractCodeRefs(formula: string): string[] {
  const refs: string[] = [];
  const re = /\[([^\]]+)\]/g;
  let match;
  while ((match = re.exec(formula)) !== null) {
    refs.push(match[1]);
  }
  return refs;
}

export function evaluateAllFormulas(
  analytes: Array<{ code: string; formula: string | null; numericValue: number | null }>
): Record<string, number | null> {
  const formulaAnalytes = analytes.filter((a) => a.formula);
  const inputAnalytes = analytes.filter((a) => !a.formula);

  const values: Record<string, number | null> = {};
  for (const a of inputAnalytes) {
    values[a.code] = a.numericValue ?? null;
  }

  if (formulaAnalytes.length === 0) return values;

  // Build dependency graph and topological sort
  const deps = new Map<string, string[]>();
  for (const a of formulaAnalytes) {
    deps.set(a.code, extractCodeRefs(a.formula!));
  }

  const formulaCodes = new Set(formulaAnalytes.map((a) => a.code));
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(code: string) {
    if (visited.has(code)) return;
    if (visiting.has(code)) {
      throw new Error(`Circular formula dependency detected involving '${code}'`);
    }
    if (!formulaCodes.has(code)) return;

    visiting.add(code);
    for (const dep of deps.get(code) ?? []) {
      visit(dep);
    }
    visiting.delete(code);
    visited.add(code);
    sorted.push(code);
  }

  for (const a of formulaAnalytes) {
    visit(a.code);
  }

  // Evaluate in topological order
  const formulaByCode = new Map(formulaAnalytes.map((a) => [a.code, a.formula!]));
  for (const code of sorted) {
    const formula = formulaByCode.get(code)!;
    values[code] = evaluateFormula(formula, values);
  }

  return values;
}
