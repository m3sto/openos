/* ==========================================================================
   OpenSharp · interpreter.js — a tree-walking evaluator with reactive state
   ========================================================================== */

import { OshError } from './lexer.js';
import { parse } from './parser.js';

/* ---------------- control-flow signals ---------------- */
const BREAK = Symbol('break');
const CONTINUE = Symbol('continue');
class ReturnSignal { constructor(v) { this.value = v; } }

/* ---------------- environment ---------------- */
export class Env {
  constructor(parent = null) { this.vars = new Map(); this.parent = parent; }
  has(name) { return this.vars.has(name) || (this.parent?.has(name) ?? false); }
  get(name, line) {
    if (this.vars.has(name)) return this.vars.get(name);
    if (this.parent) return this.parent.get(name, line);
    throw new OshError(`Tanımsız değişken: ${name}`, line);
  }
  define(name, value) { this.vars.set(name, value); return value; }
  set(name, value, line) {
    if (this.vars.has(name)) { this.vars.set(name, value); return value; }
    if (this.parent) return this.parent.set(name, value, line);
    this.vars.set(name, value); return value;   /* implicit global */
  }
  owner(name) {
    if (this.vars.has(name)) return this;
    return this.parent ? this.parent.owner(name) : null;
  }
}

/* ---------------- callable ---------------- */
export class OshFunction {
  constructor(decl, closure, interp, name = 'fn') {
    this.decl = decl; this.closure = closure; this.interp = interp; this.name = name;
  }
  get arity() { return this.decl.params.length; }
  call(args) {
    const env = new Env(this.closure);
    this.decl.params.forEach((p, i) => {
      let v = args[i];
      if (v === undefined && p.def) v = this.interp.eval(p.def, env);
      env.define(p.name, v === undefined ? null : v);
    });
    env.define('args', args);
    try {
      this.interp.execBlock(this.decl.body.body, env);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.value;
      throw e;
    }
    return null;
  }
  toString() { return `<fn ${this.name}>`; }
}

/* ---------------- element ---------------- */
export class OshElement {
  constructor(name, args, props, children) {
    this.__el = true;
    this.name = name; this.args = args; this.props = props; this.children = children || [];
  }
}

/* ---------------- interpreter ---------------- */
export class Interpreter {
  /**
   * host: {
   *   stdlib(interp) -> object of natives,
   *   onStateChange(name, value),
   *   onError(err),
   * }
   */
  constructor(host = {}) {
    this.host = host;
    this.globals = new Env();
    this.stateNames = new Set();
    this.collectors = [];
    this.steps = 0;
    this.maxSteps = 4_000_000;
    this.program = null;
    this.app = {};
    this.styles = {};
  }

  /* ---------- lifecycle ---------- */
  load(source) {
    this.source = source;
    this.program = parse(source);
    return this.program;
  }

  install(natives) {
    for (const k in natives) {
      const fn = natives[k];
      if (typeof fn === 'function') fn.__native = true;
      this.globals.define(k, fn);
    }
  }

  run() {
    if (!this.program) throw new OshError('Program yüklenmedi');
    this.app = this.program.app ? this.evalObject(this.program.app, this.globals) : {};
    this.styles = this.program.styles ? this.evalObject(this.program.styles, this.globals) : {};
    /* hoist function declarations so order does not matter */
    for (const st of this.program.body)
      if (st.type === 'FnDecl') this.globals.define(st.name, new OshFunction(st, this.globals, this, st.name));
    for (const st of this.program.body) {
      if (st.type === 'FnDecl') continue;
      this.exec(st, this.globals);
    }
    return this.app;
  }

  /** Build the element tree from the `view { }` block. */
  buildView() {
    if (!this.program?.view) return [];
    return this.collect(this.program.view.body, new Env(this.globals));
  }

  /** Call an OpenSharp function value from the host side. */
  invoke(fnValue, args = []) {
    if (fnValue instanceof OshFunction) return fnValue.call(args);
    if (typeof fnValue === 'function') return fnValue(...args);
    return null;
  }

  /* ---------- statements ---------- */
  execBlock(stmts, env) { for (const s of stmts) this.exec(s, env); }

  exec(node, env) {
    if (++this.steps > this.maxSteps) throw new OshError('Çalışma bütçesi aşıldı (sonsuz döngü?)', node.line);
    switch (node.type) {
      case 'VarDecl': {
        const v = node.init ? this.eval(node.init, env) : null;
        env.define(node.name, v);
        if (node.kind === 'state' && env === this.globals) this.stateNames.add(node.name);
        return;
      }
      case 'FnDecl':
        env.define(node.name, new OshFunction(node, env, this, node.name));
        return;
      case 'ExprStmt': {
        const v = this.eval(node.expr, env);
        const c = this.collectors[this.collectors.length - 1];
        if (c) {
          if (v instanceof OshElement) c.push(v);
          else if (Array.isArray(v) && v.every(x => x instanceof OshElement)) c.push(...v);
        }
        return;
      }
      case 'Block': this.execBlock(node.body, new Env(env)); return;
      case 'ChildBlock': this.execBlock(node.body, new Env(env)); return;
      case 'If':
        if (truthy(this.eval(node.test, env))) this.exec(node.cons, env);
        else if (node.alt) this.exec(node.alt, env);
        return;
      case 'While': {
        let guard = 0;
        while (truthy(this.eval(node.test, env))) {
          if (++guard > 200000) throw new OshError('While döngüsü çok uzun sürdü', node.line);
          try { this.exec(node.body, env); }
          catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; }
        }
        return;
      }
      case 'For': {
        const it = this.eval(node.iter, env);
        const entries = toEntries(it, node.line);
        for (const [k, v] of entries) {
          const inner = new Env(env);
          if (node.key) { inner.define(node.key, k); inner.define(node.value, v); }
          else inner.define(node.value, v);
          try { this.execBlock(node.body.body, inner); }
          catch (e) { if (e === BREAK) break; if (e === CONTINUE) continue; throw e; }
        }
        return;
      }
      case 'Return': throw new ReturnSignal(node.arg ? this.eval(node.arg, env) : null);
      case 'Break': throw BREAK;
      case 'Continue': throw CONTINUE;
      default: this.eval(node, env);
    }
  }

  /** Evaluate a list of statements collecting any elements they produce. */
  collect(stmts, env) {
    const bag = [];
    this.collectors.push(bag);
    try { this.execBlock(stmts, env); }
    finally { this.collectors.pop(); }
    return bag;
  }

  /* ---------- expressions ---------- */
  eval(node, env) {
    if (++this.steps > this.maxSteps) throw new OshError('Çalışma bütçesi aşıldı', node.line);
    switch (node.type) {
      case 'Num': case 'Str': case 'Bool': return node.value;
      case 'Nil': return null;
      case 'Template': return node.parts.map(p => str(this.eval(p, env))).join('');
      case 'Ident': return env.get(node.name, node.line);
      case 'ArrayLit': return node.items.map(i => this.eval(i, env));
      case 'ObjectLit': return this.evalObject(node, env);
      case 'Lambda': return new OshFunction(node, env, this, 'lambda');
      case 'Ternary': return truthy(this.eval(node.test, env)) ? this.eval(node.cons, env) : this.eval(node.alt, env);

      case 'Unary': {
        const v = this.eval(node.arg, env);
        if (node.op === '!') return !truthy(v);
        if (node.op === '-') return -num(v);
        return +num(v);
      }

      case 'Logical': {
        const l = this.eval(node.left, env);
        if (node.op === '&&') return truthy(l) ? this.eval(node.right, env) : l;
        if (node.op === '||') return truthy(l) ? l : this.eval(node.right, env);
        return (l === null || l === undefined) ? this.eval(node.right, env) : l;
      }

      case 'Binary': {
        const a = this.eval(node.left, env), b = this.eval(node.right, env);
        return binary(node.op, a, b, node.line);
      }

      case 'Assign': return this.assign(node, env);

      case 'Member': {
        const o = this.eval(node.obj, env);
        return member(o, node.name, node.line);
      }
      case 'Index': {
        const o = this.eval(node.obj, env);
        const k = this.eval(node.index, env);
        if (o === null || o === undefined) throw new OshError(`nil üzerinde [${str(k)}] okunamaz`, node.line);
        if (Array.isArray(o) && typeof k === 'number') {
          const i = k < 0 ? o.length + k : k;
          return i in o ? o[i] : null;
        }
        const v = o[k];
        return v === undefined ? null : v;
      }

      case 'Call': {
        const args = node.args.map(a => this.eval(a, env));
        const named = {};
        for (const k in node.named) named[k] = this.eval(node.named[k], env);
        if (Object.keys(named).length) args.named = named;

        /* Uppercase call without a block is still an element */
        if (node.callee.type === 'Ident' && /^[A-Z]/.test(node.callee.name) && !env.has(node.callee.name))
          return new OshElement(node.callee.name, args, named, []);

        let thisArg = null, fn;
        if (node.callee.type === 'Member') {
          thisArg = this.eval(node.callee.obj, env);
          fn = member(thisArg, node.callee.name, node.line);
        } else {
          fn = this.eval(node.callee, env);
        }
        return this.callValue(fn, args, named, node, thisArg);
      }

      case 'Element': {
        const args = node.args.map(a => this.eval(a, env));
        const props = {};
        for (const k in node.named) props[k] = this.eval(node.named[k], env);
        const children = this.collect(node.children.body, new Env(env));
        return new OshElement(node.name, args, props, children);
      }

      default:
        throw new OshError(`Bilinmeyen ifade: ${node.type}`, node.line);
    }
  }

  callValue(fn, args, named, node, thisArg) {
    if (fn instanceof OshFunction) {
      if (named && Object.keys(named).length) args = [...args, named];
      return fn.call(args);
    }
    if (typeof fn === 'function') {
      if (fn.__native) return fn(...args, ...(named && Object.keys(named).length ? [named] : []));
      return fn.apply(thisArg ?? null, args);
    }
    const nm = node.callee?.name || node.callee?.property || 'değer';
    throw new OshError(`Çağrılabilir değil: ${nm}`, node.line);
  }

  assign(node, env) {
    const t = node.target;
    const apply = (old) => {
      const v = this.eval(node.value, env);
      switch (node.op) {
        case '=': return v;
        case '+=': return binary('+', old, v, node.line);
        case '-=': return num(old) - num(v);
        case '*=': return num(old) * num(v);
        case '/=': return num(old) / num(v);
        case '%=': return num(old) % num(v);
      }
    };
    if (t.type === 'Ident') {
      const old = env.has(t.name) ? env.get(t.name, t.line) : null;
      const v = apply(old);
      env.set(t.name, v, t.line);
      if (this.stateNames.has(t.name) && this.globals.vars.has(t.name)) this.host.onStateChange?.(t.name, v);
      return v;
    }
    if (t.type === 'Member') {
      const o = this.eval(t.obj, env);
      if (o === null || typeof o !== 'object') throw new OshError('Nesne olmayan bir değere atama', t.line);
      o[t.name] = apply(o[t.name] ?? null);
      this.host.onStateChange?.('*', o);
      return o[t.name];
    }
    if (t.type === 'Index') {
      const o = this.eval(t.obj, env);
      let k = this.eval(t.index, env);
      if (o === null || typeof o !== 'object') throw new OshError('Dizin ataması yapılamaz', t.line);
      if (Array.isArray(o) && typeof k === 'number' && k < 0) k = o.length + k;
      o[k] = apply(o[k] ?? null);
      this.host.onStateChange?.('*', o);
      return o[k];
    }
    throw new OshError('Geçersiz atama', node.line);
  }

  evalObject(node, env) {
    const o = {};
    for (const k in node.props) o[k] = this.eval(node.props[k], env);
    return o;
  }

  /** Set a state variable from the host (used by two-way bound controls). */
  setState(name, value) {
    this.globals.define(name, value);
    this.host.onStateChange?.(name, value);
  }
  getState(name) { return this.globals.has(name) ? this.globals.get(name) : null; }
  snapshotState() {
    const o = {};
    for (const n of this.stateNames) o[n] = this.globals.vars.get(n);
    return o;
  }
}

/* ---------------- value helpers ---------------- */
export function truthy(v) {
  if (v === null || v === undefined || v === false) return false;
  if (v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}
export function num(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null || v === undefined) return 0;
  const n = parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}
export function str(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return (Number.isInteger(v) ? v : +v.toFixed(10)).toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(str).join(', ') + ']';
  if (v instanceof OshFunction) return v.toString();
  if (v instanceof OshElement) return `<${v.name}>`;
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return '{...}'; }
  }
  return String(v);
}

function binary(op, a, b, line) {
  switch (op) {
    case '+':
      if (typeof a === 'string' || typeof b === 'string') return str(a) + str(b);
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      return num(a) + num(b);
    case '-': return num(a) - num(b);
    case '*':
      if (typeof a === 'string' && typeof b === 'number') return a.repeat(Math.max(0, b | 0));
      return num(a) * num(b);
    case '/': {
      const d = num(b);
      if (d === 0) throw new OshError('Sıfıra bölme', line);
      return num(a) / d;
    }
    case '%': return num(a) % num(b);
    case '==': return eq(a, b);
    case '!=': return !eq(a, b);
    case '<': return cmp(a, b) < 0;
    case '>': return cmp(a, b) > 0;
    case '<=': return cmp(a, b) <= 0;
    case '>=': return cmp(a, b) >= 0;
    case 'in':
      if (Array.isArray(b)) return b.some(x => eq(x, a));
      if (typeof b === 'string') return b.includes(str(a));
      if (b && typeof b === 'object') return Object.prototype.hasOwnProperty.call(b, str(a));
      return false;
    default: throw new OshError(`Bilinmeyen işleç: ${op}`, line);
  }
}
function eq(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (typeof a === 'number' || typeof b === 'number') {
    if (typeof a === 'string' || typeof b === 'string') return str(a) === str(b);
    return num(a) === num(b);
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  return a === b;
}
function cmp(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return num(a) - num(b);
}

function member(o, name, line) {
  if (o === null || o === undefined) throw new OshError(`nil üzerinde '.${name}' okunamaz`, line);
  if (typeof o === 'string' || Array.isArray(o)) {
    if (name === 'length' || name === 'len') return o.length;
  }
  const v = o[name];
  if (v === undefined) return null;
  if (typeof v === 'function') return v.bind(o);
  return v;
}

function toEntries(it, line) {
  if (Array.isArray(it)) return it.map((v, i) => [i, v]);
  if (typeof it === 'string') return [...it].map((v, i) => [i, v]);
  if (typeof it === 'number') return Array.from({ length: Math.max(0, it | 0) }, (_, i) => [i, i]);
  if (it && typeof it === 'object') return Object.entries(it);
  if (it === null || it === undefined) return [];
  throw new OshError('Bu değer üzerinde döngü kurulamaz', line);
}

export { OshError };
