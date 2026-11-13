
export class GradeFormulaError extends Error {
  constructor(
    public readonly reason: 'syntax' | 'unknown_function' | 'cycle' | 'unknown_reference',
    message: string,
  ) {
    super(message);
    this.name = 'GradeFormulaError';
  }
}

export const FORMULA_FUNCTIONS = ['sum', 'average', 'min', 'max', 'power', 'round', 'mod', 'pi', 'if'] as const;
export type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number];

const FUNCTION_ARITY: Record<FormulaFunction, readonly [number, number]> = {
  sum: [1, Number.POSITIVE_INFINITY],
  average: [1, Number.POSITIVE_INFINITY],
  min: [1, Number.POSITIVE_INFINITY],
  max: [1, Number.POSITIVE_INFINITY],
  power: [2, 2],
  round: [1, 2],
  mod: [2, 2],
  pi: [0, 0],
  if: [3, 3],
};

export type ComparisonOp = '>' | '<' | '>=' | '<=' | '==' | '!=';
const COMPARISON_OPS: readonly string[] = ['>', '<', '>=', '<=', '==', '!='];

export type FormulaNode =
  | { kind: 'number'; value: number }
  | { kind: 'reference'; idNumber: string }
  | { kind: 'negate'; operand: FormulaNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode }
  | { kind: 'comparison'; op: ComparisonOp; left: FormulaNode; right: FormulaNode }
  | { kind: 'call'; fn: FormulaFunction; args: FormulaNode[] };

type Token =
  | { type: 'number'; value: number }
  | { type: 'reference'; idNumber: string }
  | { type: 'identifier'; name: string }
  | { type: 'op'; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i += 1; continue; }
    if (ch === '[' && input[i + 1] === '[') {
      const end = input.indexOf(']]', i + 2);
      if (end === -1) throw new GradeFormulaError('syntax', 'Unclosed [[...]] reference in grade calculation');
      const idNumber = input.slice(i + 2, end).trim();
      if (!idNumber) throw new GradeFormulaError('syntax', 'Empty [[...]] reference in grade calculation');
      tokens.push({ type: 'reference', idNumber });
      i = end + 2;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      const match = /^[0-9]*\.?[0-9]+/.exec(input.slice(i))!;
      tokens.push({ type: 'number', value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(i))!;
      tokens.push({ type: 'identifier', name: match[0].toLowerCase() });
      i += match[0].length;
      continue;
    }
    if (ch === '>' || ch === '<' || ch === '=' || ch === '!') {
      const two = input.slice(i, i + 2);
      if (two === '>=' || two === '<=' || two === '==' || two === '!=') {
        tokens.push({ type: 'op', value: two });
        i += 2;
        continue;
      }
      if (two === '<>') {
        tokens.push({ type: 'op', value: '!=' });
        i += 2;
        continue;
      }
      if (ch === '!') throw new GradeFormulaError('syntax', `Unexpected character '!' in grade calculation (did you mean '!='?)`);
      tokens.push({ type: 'op', value: ch === '=' ? '==' : ch });
      i += 1;
      continue;
    }
    if ('+-*/(),'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i += 1;
      continue;
    }
    throw new GradeFormulaError('syntax', `Unexpected character '${ch}' in grade calculation`);
  }
  return tokens;
}

export function parseGradeFormula(formula: string): FormulaNode {
  const body = formula.trim().startsWith('=') ? formula.trim().slice(1) : formula;
  const tokens = tokenize(body);
  if (!tokens.length) throw new GradeFormulaError('syntax', 'Grade calculation is empty');
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const isOp = (t: Token | undefined, ...values: string[]): boolean => !!t && t.type === 'op' && values.includes(t.value);
  const next = (): Token | undefined => tokens[pos++];
  const expectOp = (value: string): void => {
    const t = next();
    if (!t || t.type !== 'op' || t.value !== value) {
      throw new GradeFormulaError('syntax', `Expected '${value}' in grade calculation`);
    }
  };

  function parseExpression(): FormulaNode {
    const left = parseAdditive();
    const t = peek();
    if (t?.type === 'op' && COMPARISON_OPS.includes(t.value)) {
      next();
      return { kind: 'comparison', op: t.value as ComparisonOp, left, right: parseAdditive() };
    }
    return left;
  }
  function parseAdditive(): FormulaNode {
    let left = parseTerm();
    while (isOp(peek(), '+', '-')) {
      const op = (next() as { type: 'op'; value: '+' | '-' }).value;
      left = { kind: 'binary', op, left, right: parseTerm() };
    }
    return left;
  }
  function parseTerm(): FormulaNode {
    let left = parseFactor();
    while (isOp(peek(), '*', '/')) {
      const op = (next() as { type: 'op'; value: '*' | '/' }).value;
      left = { kind: 'binary', op, left, right: parseFactor() };
    }
    return left;
  }
  function parseFactor(): FormulaNode {
    const t = peek();
    if (t?.type === 'op' && t.value === '-') { next(); return { kind: 'negate', operand: parseFactor() }; }
    if (t?.type === 'op' && t.value === '+') { next(); return parseFactor(); }
    return parsePrimary();
  }
  function parsePrimary(): FormulaNode {
    const t = next();
    if (!t) throw new GradeFormulaError('syntax', 'Unexpected end of grade calculation');
    if (t.type === 'number') return { kind: 'number', value: t.value };
    if (t.type === 'reference') return { kind: 'reference', idNumber: t.idNumber };
    if (t.type === 'op' && t.value === '(') {
      const inner = parseExpression();
      expectOp(')');
      return inner;
    }
    if (t.type === 'identifier') {
      if (!(FORMULA_FUNCTIONS as readonly string[]).includes(t.name)) {
        throw new GradeFormulaError('unknown_function', `Unsupported function '${t.name}' in grade calculation`);
      }
      const fn = t.name as FormulaFunction;
      if (fn === 'pi' && !isOp(peek(), '(')) return { kind: 'number', value: Math.PI };
      expectOp('(');
      const args: FormulaNode[] = [];
      const closing = peek();
      if (!(closing?.type === 'op' && closing.value === ')')) {
        args.push(parseExpression());
        while (isOp(peek(), ',')) {
          next();
          args.push(parseExpression());
        }
      }
      expectOp(')');
      const [minArgs, maxArgs] = FUNCTION_ARITY[fn];
      if (args.length < minArgs || args.length > maxArgs) {
        const want = minArgs === maxArgs ? `exactly ${minArgs}` : maxArgs === Number.POSITIVE_INFINITY ? `at least ${minArgs}` : `between ${minArgs} and ${maxArgs}`;
        throw new GradeFormulaError('syntax', `Function '${fn}' takes ${want} argument(s), got ${args.length}`);
      }
      return { kind: 'call', fn, args };
    }
    throw new GradeFormulaError('syntax', 'Unexpected token in grade calculation');
  }

  const ast = parseExpression();
  if (pos !== tokens.length) throw new GradeFormulaError('syntax', 'Trailing tokens in grade calculation');
  return ast;
}

export function formulaReferences(node: FormulaNode): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (n: FormulaNode): void => {
    if (n.kind === 'reference') {
      if (!seen.has(n.idNumber)) { seen.add(n.idNumber); out.push(n.idNumber); }
    } else if (n.kind === 'negate') walk(n.operand);
    else if (n.kind === 'binary' || n.kind === 'comparison') { walk(n.left); walk(n.right); }
    else if (n.kind === 'call') n.args.forEach(walk);
  };
  walk(node);
  return out;
}

function roundHalfAwayFromZero(value: number, digits: number): number {
  const factor = 10 ** digits;
  const scaled = Number((Math.abs(value) * factor).toPrecision(15));
  return (Math.sign(value) * Math.round(scaled)) / factor;
}

export function evaluateGradeFormula(node: FormulaNode, resolve: (idNumber: string) => number | null): number | null {
  switch (node.kind) {
    case 'number': return node.value;
    case 'reference': return resolve(node.idNumber);
    case 'negate': {
      const v = evaluateGradeFormula(node.operand, resolve);
      return v === null ? null : -v;
    }
    case 'binary': {
      const l = evaluateGradeFormula(node.left, resolve);
      const r = evaluateGradeFormula(node.right, resolve);
      if (l === null || r === null) return null;
      if (node.op === '+') return l + r;
      if (node.op === '-') return l - r;
      if (node.op === '*') return l * r;
      return r === 0 ? null : l / r;
    }
    case 'comparison': {
      const l = evaluateGradeFormula(node.left, resolve);
      const r = evaluateGradeFormula(node.right, resolve);
      if (l === null || r === null) return null;
      if (node.op === '>') return l > r ? 1 : 0;
      if (node.op === '<') return l < r ? 1 : 0;
      if (node.op === '>=') return l >= r ? 1 : 0;
      if (node.op === '<=') return l <= r ? 1 : 0;
      if (node.op === '==') return l === r ? 1 : 0;
      return l !== r ? 1 : 0;
    }
    case 'call': {
      if (node.fn === 'pi') return Math.PI;
      if (node.fn === 'if') {
        const cond = evaluateGradeFormula(node.args[0]!, resolve);
        if (cond === null) return null;
        return evaluateGradeFormula(cond !== 0 ? node.args[1]! : node.args[2]!, resolve);
      }
      const raw = node.args.map((a) => evaluateGradeFormula(a, resolve));
      if (node.fn === 'power' || node.fn === 'mod' || node.fn === 'round') {
        if (raw.some((v) => v === null)) return null;
        const [x, y] = raw as number[];
        if (node.fn === 'power') {
          const r = Math.pow(x!, y!);
          return Number.isNaN(r) ? null : r;
        }
        if (node.fn === 'mod') {
          if (y === 0) return null;
          return x! % y!;
        }
        return roundHalfAwayFromZero(x!, raw.length > 1 ? Math.trunc(y!) : 0);
      }
      const values = raw.filter((v): v is number => v !== null);
      if (!values.length) return null;
      if (node.fn === 'sum') return values.reduce((s, v) => s + v, 0);
      if (node.fn === 'average') return values.reduce((s, v) => s + v, 0) / values.length;
      if (node.fn === 'min') return Math.min(...values);
      return Math.max(...values);
    }
  }
}

export function calculateFromFormula(formula: string, resolve: (idNumber: string) => number | null): number | null {
  return evaluateGradeFormula(parseGradeFormula(formula), resolve);
}

export function findFormulaCycle(graph: Map<string, string[]>, start: string): string[] | null {
  const stack: string[] = [];
  const onStack = new Set<string>();
  const done = new Set<string>();
  const dfs = (node: string): string[] | null => {
    if (onStack.has(node)) return [...stack.slice(stack.indexOf(node)), node];
    if (done.has(node)) return null;
    stack.push(node);
    onStack.add(node);
    for (const ref of graph.get(node) ?? []) {
      const cycle = dfs(ref);
      if (cycle) return cycle;
    }
    stack.pop();
    onStack.delete(node);
    done.add(node);
    return null;
  };
  return dfs(start);
}
