// Safe arithmetic expression evaluator (no eval / no Function).
// Supports + - * / ^, parentheses, unary minus, numbers and named variables.
// Used to evaluate user-defined costing formulas.

type Tok =
  | { t: 'num'; v: number }
  | { t: 'var'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' };

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
      continue;
    }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i + 1;
      while (j < s.length && ((s[j] >= '0' && s[j] <= '9') || s[j] === '.')) j++;
      toks.push({ t: 'num', v: parseFloat(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      toks.push({ t: 'var', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(c)) {
      toks.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '(') {
      toks.push({ t: 'lp' });
      i++;
      continue;
    }
    if (c === ')') {
      toks.push({ t: 'rp' });
      i++;
      continue;
    }
    throw new Error(`Unexpected character '${c}' in formula`);
  }
  return toks;
}

const PREC: Record<string, number> = { 'u-': 5, '^': 4, '*': 3, '/': 3, '+': 2, '-': 2 };
const RIGHT = new Set(['^', 'u-']);

function toRPN(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  const ops: Tok[] = [];
  let prevValue = false; // was the previous token a value or ')'
  for (const tk of toks) {
    if (tk.t === 'num' || tk.t === 'var') {
      out.push(tk);
      prevValue = true;
    } else if (tk.t === 'op') {
      let op = tk.v;
      if ((op === '-' || op === '+') && !prevValue) op = op === '-' ? 'u-' : 'u+';
      if (op === 'u+') {
        prevValue = false;
        continue;
      }
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.t === 'op') {
          const topOp = top.v;
          const higher = RIGHT.has(op) ? PREC[topOp] > PREC[op] : PREC[topOp] >= PREC[op];
          if (higher) {
            out.push(ops.pop()!);
            continue;
          }
        }
        break;
      }
      ops.push({ t: 'op', v: op });
      prevValue = false;
    } else if (tk.t === 'lp') {
      ops.push(tk);
      prevValue = false;
    } else if (tk.t === 'rp') {
      while (ops.length && ops[ops.length - 1].t !== 'lp') out.push(ops.pop()!);
      if (!ops.length) throw new Error('Mismatched parentheses');
      ops.pop();
      prevValue = true;
    }
  }
  while (ops.length) {
    const o = ops.pop()!;
    if (o.t === 'lp' || o.t === 'rp') throw new Error('Mismatched parentheses');
    out.push(o);
  }
  return out;
}

function evalRPN(rpn: Tok[], vars: Record<string, number>): number {
  const st: number[] = [];
  for (const tk of rpn) {
    if (tk.t === 'num') st.push(tk.v);
    else if (tk.t === 'var') {
      const key = tk.v.toUpperCase();
      if (!(key in vars)) throw new Error(`Unknown variable '${tk.v}'`);
      st.push(vars[key]);
    } else if (tk.t === 'op') {
      if (tk.v === 'u-') {
        const a = st.pop() ?? 0;
        st.push(-a);
        continue;
      }
      const b = st.pop();
      const a = st.pop();
      if (a === undefined || b === undefined) throw new Error('Invalid formula');
      switch (tk.v) {
        case '+': st.push(a + b); break;
        case '-': st.push(a - b); break;
        case '*': st.push(a * b); break;
        case '/': st.push(b === 0 ? 0 : a / b); break;
        case '^': st.push(Math.pow(a, b)); break;
      }
    }
  }
  if (st.length !== 1) throw new Error('Invalid formula');
  return isFinite(st[0]) ? st[0] : 0;
}

/** Evaluate an expression; throws on parse/variable errors. */
export function evalExpr(expr: string, vars: Record<string, number>): number {
  return evalRPN(toRPN(tokenize(expr)), vars);
}

/** Evaluate, returning 0 on any error (for live/tolerant contexts). */
export function tryEvalExpr(expr: string, vars: Record<string, number>): number {
  try {
    return evalExpr(expr, vars);
  } catch {
    return 0;
  }
}

/** Validate a formula against a set of allowed variable names. Returns error message or null. */
export function validateExpr(expr: string, allowed: string[]): string | null {
  try {
    const vars: Record<string, number> = {};
    for (const a of allowed) vars[a.toUpperCase()] = 1;
    evalExpr(expr, vars);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid formula';
  }
}
