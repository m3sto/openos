/* ==========================================================================
   OpenSharp · lexer.js
   Source text → token stream. Handles comments, numbers, strings with
   "${...}" interpolation, punctuation and multi-character operators.
   ========================================================================== */

export const KEYWORDS = new Set([
  'app', 'state', 'let', 'const', 'fn', 'view', 'style',
  'if', 'else', 'elif', 'while', 'for', 'in', 'return', 'break', 'continue',
  'true', 'false', 'nil', 'and', 'or', 'not', 'use', 'export',
  /* hata yönetimi */
  'try', 'catch', 'finally', 'throw',
  /* örüntü eşleme ve tipler */
  'match', 'type', 'enum', 'from', 'as', 'is',
]);

const PUNCT = [
  /* Üç karakterliler önce gelmeli: tarayıcı ilk eşleşeni alır. */
  '...', '?.', '??=', '||=', '&&=',
  '=>', '->', '==', '!=', '<=', '>=', '&&', '||', '??', '+=', '-=', '*=', '/=', '%=',
  '{', '}', '(', ')', '[', ']', ',', ':', ';', '.', '+', '-', '*', '/', '%',
  '<', '>', '=', '!', '?', '|', '&', '@', '#',
];

export class OshError extends Error {
  constructor(msg, line = 0, col = 0) {
    super(msg);
    this.name = 'OpenSharpError';
    this.line = line; this.col = col;
  }
  toString() { return `${this.name}: ${this.message} (satır ${this.line})`; }
}

export function tokenize(src) {
  const toks = [];
  let i = 0, line = 1, col = 1;
  const n = src.length;

  const push = (type, value, extra) =>
    toks.push({ type, value, line, col, ...(extra || {}) });

  const peek = (k = 0) => src[i + k];
  const adv = (k = 1) => {
    for (let j = 0; j < k; j++) {
      if (src[i] === '\n') { line++; col = 1; } else col++;
      i++;
    }
  };

  while (i < n) {
    const c = src[i];

    /* whitespace */
    if (c === ' ' || c === '\t' || c === '\r') { adv(); continue; }
    if (c === '\n') { push('nl', '\n'); adv(); continue; }

    /* comments */
    if (c === '#' || (c === '/' && peek(1) === '/')) {
      while (i < n && src[i] !== '\n') adv();
      continue;
    }
    if (c === '/' && peek(1) === '*') {
      adv(2);
      while (i < n && !(src[i] === '*' && peek(1) === '/')) adv();
      adv(2); continue;
    }

    /* numbers */
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(peek(1)))) {
      const start = i;
      while (i < n && /[0-9_]/.test(src[i])) adv();
      if (src[i] === '.' && /[0-9]/.test(peek(1))) { adv(); while (i < n && /[0-9_]/.test(src[i])) adv(); }
      if (/[eE]/.test(src[i] || '')) {
        adv(); if (/[+-]/.test(src[i])) adv();
        while (i < n && /[0-9]/.test(src[i])) adv();
      }
      push('num', parseFloat(src.slice(start, i).replace(/_/g, '')));
      continue;
    }

    /* identifiers & keywords */
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_$]/.test(src[i])) adv();
      const word = src.slice(start, i);
      push(KEYWORDS.has(word) ? 'kw' : 'id', word);
      continue;
    }

    /* strings (single, double) with ${} interpolation */
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      const startLine = line;
      adv();
      const parts = [];
      let buf = '';
      while (i < n && src[i] !== quote) {
        if (src[i] === '\\') {
          const e = peek(1);
          const map = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", '`': '`', '$': '$', '0': '\0' };
          buf += (e in map) ? map[e] : '\\' + e;
          adv(2); continue;
        }
        if (src[i] === '$' && peek(1) === '{') {
          if (buf) { parts.push({ k: 's', v: buf }); buf = ''; }
          adv(2);
          const from = i;
          let depth = 1;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') { depth--; if (!depth) break; }
            else if (src[i] === '"' || src[i] === "'") {
              const q = src[i]; adv();
              while (i < n && src[i] !== q) { if (src[i] === '\\') adv(); adv(); }
            }
            adv();
          }
          parts.push({ k: 'e', v: src.slice(from, i), line });
          adv(); /* closing } */
          continue;
        }
        buf += src[i]; adv();
      }
      if (i >= n) throw new OshError('Kapanmamış metin (string)', startLine);
      adv(); /* closing quote */
      if (buf || !parts.length) parts.push({ k: 's', v: buf });
      if (parts.length === 1 && parts[0].k === 's') push('str', parts[0].v);
      else push('tpl', parts);
      continue;
    }

    /* punctuation / operators */
    let matched = null;
    for (const p of PUNCT) {
      if (src.startsWith(p, i)) { matched = p; break; }
    }
    if (matched) { push('punc', matched); adv(matched.length); continue; }

    throw new OshError(`Beklenmeyen karakter: '${c}'`, line, col);
  }

  push('eof', null);
  return toks;
}
