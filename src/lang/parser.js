/* ==========================================================================
   OpenSharp · parser.js — tokens → AST
   ========================================================================== */

import { tokenize, OshError } from './lexer.js';

const ASSIGN_OPS = ['=', '+=', '-=', '*=', '/=', '%='];

export class Parser {
  constructor(tokens) {
    this.toks = tokens.filter(t => t.type !== 'nl');
    this.i = 0;
  }

  /* ---------- token helpers ---------- */
  peek(k = 0) { return this.toks[Math.min(this.i + k, this.toks.length - 1)]; }
  get cur() { return this.peek(); }
  next() { return this.toks[this.i++]; }
  at(type, value) {
    const t = this.cur;
    return t.type === type && (value === undefined || t.value === value);
  }
  atAny(type, values) { return this.cur.type === type && values.includes(this.cur.value); }
  eat(type, value) { if (this.at(type, value)) { return this.next(); } return null; }
  expect(type, value) {
    if (this.at(type, value)) return this.next();
    const t = this.cur;
    throw new OshError(`'${value ?? type}' bekleniyordu, '${t.value ?? t.type}' bulundu`, t.line, t.col);
  }
  skipSemis() { while (this.eat('punc', ';')) {} }

  /* ---------- program ---------- */
  parseProgram() {
    const prog = { type: 'Program', app: null, view: null, body: [], styles: {} };
    while (!this.at('eof')) {
      this.skipSemis();
      if (this.at('eof')) break;
      if (this.at('kw', 'app'))       { this.next(); prog.app = this.parseObject(); continue; }
      if (this.at('kw', 'view'))      { this.next(); prog.view = this.parseChildBlock(); continue; }
      if (this.at('kw', 'style'))     { this.next(); prog.styles = this.parseObject(); continue; }
      prog.body.push(this.parseDeclaration());
    }
    return prog;
  }

  parseDeclaration() {
    const t = this.cur;
    if (t.type === 'kw') {
      if (t.value === 'state' || t.value === 'let' || t.value === 'const') {
        this.next();
        /* `let {a, b} = o` ve `let [x, y] = l` — yıkarak bağlama. */
        if (this.at('punc', '{') || this.at('punc', '[')) {
          const pattern = this.parseBindingPattern();
          this.expect('punc', '=');
          const init = this.parseExpr();
          return { type: 'VarDecl', kind: t.value, pattern, init, line: t.line };
        }
        const name = this.expect('id').value;
        let init = null;
        if (this.eat('punc', '=')) init = this.parseExpr();
        return { type: 'VarDecl', kind: t.value, name, init, line: t.line };
      }
      if (t.value === 'fn' && this.peek(1).type === 'id') {
        this.next();
        const name = this.next().value;
        const params = this.parseParams();
        const body = this.parseBlock();
        return { type: 'FnDecl', name, params, body, line: t.line };
      }
      if (t.value === 'use') return this.parseUse();
      if (t.value === 'type') return this.parseType();
      if (t.value === 'enum') return this.parseEnum();
      if (t.value === 'export') { this.next(); const d = this.parseDeclaration(); d.exported = true; return d; }
    }
    return this.parseStatement();
  }

  /** `{a, b: yeni}` ya da `[ilk, ikinci]` bağlama örüntüsü. */
  parseBindingPattern() {
    if (this.eat('punc', '[')) {
      const ogeler = [];
      while (!this.at('punc', ']') && !this.at('eof')) {
        if (this.eat('punc', '...')) ogeler.push({ rest: true, name: this.expect('id').value });
        else ogeler.push({ name: this.expect('id').value });
        if (!this.eat('punc', ',')) break;
      }
      this.expect('punc', ']');
      return { kind: 'list', ogeler };
    }
    this.expect('punc', '{');
    const ogeler = [];
    while (!this.at('punc', '}') && !this.at('eof')) {
      if (this.eat('punc', '...')) { ogeler.push({ rest: true, name: this.expect('id').value }); }
      else {
        const anahtar = this.expect_ident();
        const ad = this.eat('punc', ':') ? this.expect('id').value : anahtar;
        let varsayilan = null;
        if (this.eat('punc', '=')) varsayilan = this.parseExpr();
        ogeler.push({ anahtar, name: ad, varsayilan });
      }
      if (!this.eat('punc', ',')) break;
    }
    this.expect('punc', '}');
    return { kind: 'obj', ogeler };
  }

  /**
   * `use "./yardimcilar.osh"`            → tüm dışa açılanlar geçerli kapsama
   * `use "./m.osh" as m`                 → tek bir nesne olarak
   * `use { topla, cikar } from "./m.osh"` → seçerek
   */
  parseUse() {
    const line = this.cur.line;
    this.next();
    if (this.at('punc', '{')) {
      this.next();
      const adlar = [];
      while (!this.at('punc', '}') && !this.at('eof')) {
        const ad = this.expect_ident();
        adlar.push({ ad, takma: this.eat('kw', 'as') ? this.expect('id').value : ad });
        if (!this.eat('punc', ',')) break;
      }
      this.expect('punc', '}');
      this.expect('kw', 'from');
      const yol = this.expect('str').value;
      return { type: 'Use', yol, adlar, line };
    }
    const yol = this.expect('str').value;
    const takma = this.eat('kw', 'as') ? this.expect('id').value : null;
    return { type: 'Use', yol, takma, adlar: null, line };
  }

  /**
   * `type Nokta { x = 0, y = 0, fn uzaklik() { … } }`
   * Alanlar varsayılanlarıyla, yöntemler gövdeleriyle saklanır; `Nokta(x: 3)`
   * çağrısı örnek üretir.
   */
  parseType() {
    const line = this.cur.line;
    this.next();
    const ad = this.expect('id').value;
    this.expect('punc', '{');
    const alanlar = [], yontemler = [];
    while (!this.at('punc', '}') && !this.at('eof')) {
      this.skipSemis();
      if (this.at('punc', '}')) break;
      if (this.at('kw', 'fn')) {
        this.next();
        const yad = this.expect('id').value;
        const params = this.parseParams();
        const body = this.parseBlock();
        yontemler.push({ ad: yad, params, body });
      } else {
        const alanAd = this.expect_ident();
        let varsayilan = null;
        if (this.eat('punc', '=') || this.eat('punc', ':')) varsayilan = this.parseExpr();
        alanlar.push({ ad: alanAd, varsayilan });
      }
      if (!this.eat('punc', ',')) this.skipSemis();
    }
    this.expect('punc', '}');
    return { type: 'TypeDecl', ad, alanlar, yontemler, line };
  }

  /** `enum Durum { bekliyor, calisiyor, bitti }` — değerler kendi adlarıdır. */
  parseEnum() {
    const line = this.cur.line;
    this.next();
    const ad = this.expect('id').value;
    this.expect('punc', '{');
    const uyeler = [];
    while (!this.at('punc', '}') && !this.at('eof')) {
      this.skipSemis();
      if (this.at('punc', '}')) break;
      const uad = this.expect_ident();
      let deger = null;
      if (this.eat('punc', '=')) deger = this.parseExpr();
      uyeler.push({ ad: uad, deger });
      if (!this.eat('punc', ',')) this.skipSemis();
    }
    this.expect('punc', '}');
    return { type: 'EnumDecl', ad, uyeler, line };
  }

  parseParams() {
    this.expect('punc', '(');
    const params = [];
    while (!this.at('punc', ')')) {
      if (this.eat('punc', '...')) { params.push({ name: this.expect('id').value, rest: true }); break; }
      const name = this.expect('id').value;
      let def = null;
      if (this.eat('punc', '=')) def = this.parseExpr();
      params.push({ name, def });
      if (!this.eat('punc', ',')) break;
    }
    this.expect('punc', ')');
    return params;
  }

  parseBlock() {
    this.expect('punc', '{');
    const body = [];
    while (!this.at('punc', '}') && !this.at('eof')) {
      this.skipSemis();
      if (this.at('punc', '}')) break;
      body.push(this.parseDeclaration());
      this.skipSemis();
    }
    this.expect('punc', '}');
    return { type: 'Block', body };
  }

  /** A view/element body: same as a block but its expression statements become children. */
  parseChildBlock() {
    const b = this.parseBlock();
    return { type: 'ChildBlock', body: b.body };
  }

  /* ---------- statements ---------- */
  parseStatement() {
    const t = this.cur;
    if (t.type === 'kw') {
      switch (t.value) {
        case 'if': return this.parseIf();
        case 'while': {
          this.next();
          const test = this.parseExpr();
          const body = this.parseBlock();
          return { type: 'While', test, body, line: t.line };
        }
        case 'for': {
          this.next();
          const a = this.expect('id').value;
          let b = null;
          if (this.eat('punc', ',')) b = this.expect('id').value;
          this.expect('kw', 'in');
          const iter = this.parseExpr();
          const body = this.parseBlock();
          return { type: 'For', key: b ? a : null, value: b || a, iter, body, line: t.line };
        }
        case 'return': {
          this.next();
          const arg = (this.at('punc', '}') || this.at('punc', ';') || this.at('eof')) ? null : this.parseExpr();
          return { type: 'Return', arg, line: t.line };
        }
        case 'break': this.next(); return { type: 'Break', line: t.line };
        case 'continue': this.next(); return { type: 'Continue', line: t.line };
        case 'throw': {
          this.next();
          return { type: 'Throw', arg: this.parseExpr(), line: t.line };
        }
        case 'try': {
          this.next();
          const blok = this.parseBlock();
          let yakalaAd = null, yakala = null, sonunda = null;
          if (this.eat('kw', 'catch')) {
            /* `catch e { … }` — ad isteğe bağlı. */
            if (this.at('id')) yakalaAd = this.next().value;
            yakala = this.parseBlock();
          }
          if (this.eat('kw', 'finally')) sonunda = this.parseBlock();
          if (!yakala && !sonunda) {
            throw new OshError('try bloğu catch ya da finally ile sürmeli', t.line);
          }
          return { type: 'Try', blok, yakalaAd, yakala, sonunda, line: t.line };
        }
      }
    }
    if (this.at('punc', '{')) return this.parseBlock();
    const expr = this.parseExpr();
    return { type: 'ExprStmt', expr, line: t.line };
  }

  parseIf() {
    const line = this.cur.line;
    this.next();
    const test = this.parseExpr();
    const cons = this.parseBlock();
    let alt = null;
    if (this.at('kw', 'elif')) alt = this.parseIf();
    else if (this.eat('kw', 'else')) alt = this.at('kw', 'if') ? this.parseIf() : this.parseBlock();
    return { type: 'If', test, cons, alt, line };
  }

  /* ---------- expressions ---------- */
  parseExpr() { return this.parseAssign(); }

  parseAssign() {
    const left = this.parseTernary();
    if (this.cur.type === 'punc' && ASSIGN_OPS.includes(this.cur.value)) {
      const op = this.next().value;
      const right = this.parseAssign();
      if (!['Ident', 'Member', 'Index'].includes(left.type))
        throw new OshError('Geçersiz atama hedefi', this.cur.line);
      return { type: 'Assign', op, target: left, value: right, line: left.line };
    }
    return left;
  }

  /**
   * `match deger { 0 => "sıfır", n if n > 10 => "büyük", _ => "diğer" }`
   * İlk uyan dal değeri verir; bir ifadedir, deyim değil — atanabilir.
   */
  parseMatch() {
    const line = this.cur.line;
    this.next();
    const konu = this.parseExpr();
    this.expect('punc', '{');
    const dallar = [];
    while (!this.at('punc', '}') && !this.at('eof')) {
      this.skipSemis();
      if (this.at('punc', '}')) break;
      /* `_` her şeye uyar; başka her şey eşitlik ya da `is` tip sınaması. */
      let oruntu = null, tip = null;
      if (this.at('id', '_')) { this.next(); }
      else if (this.eat('kw', 'is')) { tip = this.expect_ident(); }
      else oruntu = this.parseBinary(0);
      /* koşullu dal: `n if n > 10 =>` */
      let kosul = null;
      if (this.eat('kw', 'if')) kosul = this.parseExpr();
      this.expect('punc', '=>');
      const govde = this.at('punc', '{') ? this.parseBlock() : this.parseExpr();
      dallar.push({ oruntu, tip, kosul, govde });
      if (!this.eat('punc', ',')) this.skipSemis();
    }
    this.expect('punc', '}');
    return { type: 'Match', konu, dallar, line };
  }

  parseTernary() {
    if (this.at('kw', 'match')) return this.parseMatch();
    const test = this.parseBinary(0);
    if (this.eat('punc', '?')) {
      const cons = this.parseExpr();
      this.expect('punc', ':');
      const alt = this.parseExpr();
      return { type: 'Ternary', test, cons, alt };
    }
    return test;
  }

  /* precedence climbing */
  binOp() {
    const t = this.cur;
    if (t.type === 'punc') {
      const p = {
        '??': 1, '||': 2, '&&': 3,
        '==': 4, '!=': 4, '<': 5, '>': 5, '<=': 5, '>=': 5,
        '+': 6, '-': 6, '*': 7, '/': 7, '%': 7,
      }[t.value];
      if (p) return { op: t.value, p };
    }
    if (t.type === 'kw') {
      if (t.value === 'or') return { op: '||', p: 2 };
      if (t.value === 'and') return { op: '&&', p: 3 };
      if (t.value === 'in') return { op: 'in', p: 5 };
      if (t.value === 'is') return { op: 'is', p: 5 };
    }
    return null;
  }

  parseBinary(minP) {
    let left = this.parseUnary();
    for (;;) {
      const info = this.binOp();
      if (!info || info.p < minP) break;
      this.next();
      const right = this.parseBinary(info.p + 1);
      const kind = (info.op === '&&' || info.op === '||' || info.op === '??') ? 'Logical' : 'Binary';
      left = { type: kind, op: info.op, left, right, line: left.line };
    }
    return left;
  }

  parseUnary() {
    const t = this.cur;
    if ((t.type === 'punc' && (t.value === '!' || t.value === '-' || t.value === '+')) ||
        (t.type === 'kw' && t.value === 'not')) {
      this.next();
      const op = t.value === 'not' ? '!' : t.value;
      return { type: 'Unary', op, arg: this.parseUnary(), line: t.line };
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let node = this.parsePrimary();
    for (;;) {
      if (this.at('punc', '(')) {
        const { args, named } = this.parseArgs();
        node = { type: 'Call', callee: node, args, named, line: node.line };
        /* Capitalised call + trailing block ⇒ a UI element with children */
        if (this.at('punc', '{') && node.callee.type === 'Ident' && /^[A-Z]/.test(node.callee.name)) {
          node = { type: 'Element', name: node.callee.name, args: node.args, named: node.named,
                   children: this.parseChildBlock(), line: node.line };
        }
      } else if (this.at('punc', '?.')) {
        /* `a?.b`, `a?.[i]`, `a?.(x)` — sol taraf nil ise tüm zincir nil olur. */
        this.next();
        if (this.at('punc', '(')) {
          const { args, named } = this.parseArgs();
          node = { type: 'Call', callee: node, args, named, optional: true, line: node.line };
        } else if (this.eat('punc', '[')) {
          const idx = this.parseExpr();
          this.expect('punc', ']');
          node = { type: 'Index', obj: node, index: idx, optional: true, line: node.line };
        } else {
          const name = this.expect_ident();
          node = { type: 'Member', obj: node, name, optional: true, line: node.line };
        }
      } else if (this.at('punc', '.')) {
        this.next();
        const name = (this.at('id') || this.at('kw')) ? this.next().value : this.expect('id').value;
        node = { type: 'Member', obj: node, name, line: node.line };
      } else if (this.at('punc', '[')) {
        this.next();
        const idx = this.parseExpr();
        this.expect('punc', ']');
        node = { type: 'Index', obj: node, index: idx, line: node.line };
      } else break;
    }
    /* Bare capitalised identifier followed by a block: `Card { ... }` */
    if (node.type === 'Ident' && /^[A-Z]/.test(node.name) && this.at('punc', '{')) {
      node = { type: 'Element', name: node.name, args: [], named: {},
               children: this.parseChildBlock(), line: node.line };
    }
    return node;
  }

  parseArgs() {
    this.expect('punc', '(');
    const args = [], named = {};
    while (!this.at('punc', ')') && !this.at('eof')) {
      if (this.at('punc', '...')) {
        this.next();
        args.push({ type: 'Spread', arg: this.parseExpr() });
      } else if ((this.at('id') || this.at('kw')) && this.peek(1).type === 'punc' && this.peek(1).value === ':') {
        const key = this.next().value;
        this.next();
        named[key] = this.parseExpr();
      } else {
        args.push(this.parseExpr());
      }
      if (!this.eat('punc', ',')) break;
    }
    this.expect('punc', ')');
    return { args, named };
  }

  parseObject() {
    this.expect('punc', '{');
    const props = {};
    const yayilanlar = [];
    while (!this.at('punc', '}') && !this.at('eof')) {
      this.skipSemis();
      if (this.at('punc', '}')) break;
      if (this.eat('punc', '...')) {
        yayilanlar.push({ sira: Object.keys(props).length, expr: this.parseExpr() });
        if (!this.eat('punc', ',')) this.skipSemis();
        continue;
      }
      let key;
      if (this.at('str')) key = this.next().value;
      else if (this.at('num')) key = String(this.next().value);
      else key = this.expect_ident();
      this.expect('punc', ':');
      props[key] = this.parseExpr();
      if (!this.eat('punc', ',')) this.skipSemis();
    }
    this.expect('punc', '}');
    return { type: 'ObjectLit', props, yayilanlar };
  }

  expect_ident() {
    if (this.at('id') || this.at('kw')) return this.next().value;
    const t = this.cur;
    throw new OshError(`Anahtar adı bekleniyordu, '${t.value ?? t.type}' bulundu`, t.line);
  }

  parsePrimary() {
    const t = this.cur;
    switch (t.type) {
      case 'num': this.next(); return { type: 'Num', value: t.value, line: t.line };
      case 'str': this.next(); return { type: 'Str', value: t.value, line: t.line };
      case 'tpl': {
        this.next();
        const parts = t.value.map(p => p.k === 's'
          ? { type: 'Str', value: p.v, line: t.line }
          : parseExpression(p.v, p.line));
        return { type: 'Template', parts, line: t.line };
      }
      case 'id': this.next(); return { type: 'Ident', name: t.value, line: t.line };
      case 'kw':
        if (t.value === 'true')  { this.next(); return { type: 'Bool', value: true, line: t.line }; }
        if (t.value === 'false') { this.next(); return { type: 'Bool', value: false, line: t.line }; }
        if (t.value === 'nil')   { this.next(); return { type: 'Nil', line: t.line }; }
        if (t.value === 'fn') {
          this.next();
          const params = this.parseParams();
          /* `fn(x) => x * 2` — tek ifadelik gövde, `return` yazmaya gerek yok. */
          if (this.eat('punc', '=>')) {
            const expr = this.parseExpr();
            return { type: 'Lambda', params, body: { type: 'Block', body: [{ type: 'Return', arg: expr, line: t.line }] }, line: t.line };
          }
          const body = this.parseBlock();
          return { type: 'Lambda', params, body, line: t.line };
        }
        if (t.value === 'match') return this.parseMatch();
        break;
      case 'punc':
        if (t.value === '(') {
          this.next();
          const e = this.parseExpr();
          this.expect('punc', ')');
          return e;
        }
        if (t.value === '[') {
          this.next();
          const items = [];
          while (!this.at('punc', ']') && !this.at('eof')) {
            if (this.eat('punc', '...')) items.push({ type: 'Spread', arg: this.parseExpr() });
            else items.push(this.parseExpr());
            if (!this.eat('punc', ',')) break;
          }
          this.expect('punc', ']');
          return { type: 'ArrayLit', items, line: t.line };
        }
        if (t.value === '{') return this.parseObject();
        break;
    }
    throw new OshError(`Beklenmeyen simge: '${t.value ?? t.type}'`, t.line, t.col);
  }
}

export function parse(src) {
  return new Parser(tokenize(src)).parseProgram();
}

export function parseExpression(src, line = 1) {
  const p = new Parser(tokenize(src));
  const e = p.parseExpr();
  e.line = e.line || line;
  return e;
}
