/* ==========================================================================
   OpenOS · util.js — DOM helpers, tiny event bus, formatting
   ========================================================================== */

/** h('div.cls#id', {props}, ...children) → HTMLElement */
export function h(spec, props, ...children) {
  let tag = 'div', cls = [], id = null;
  const m = String(spec).match(/^([a-zA-Z0-9-]+)?((?:[.#][^.#]+)*)$/);
  if (m) {
    if (m[1]) tag = m[1];
    (m[2] || '').split(/(?=[.#])/).filter(Boolean).forEach(tok => {
      if (tok[0] === '.') cls.push(tok.slice(1)); else id = tok.slice(1);
    });
  } else tag = spec;

  const el = document.createElement(tag);
  if (cls.length) el.className = cls.join(' ');
  if (id) el.id = id;

  if (props && (props.nodeType || Array.isArray(props) || typeof props === 'string')) {
    children.unshift(props); props = null;
  }
  for (const k in (props || {})) {
    const v = props[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' || k === 'className') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') setStyle(el, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list' && typeof v !== 'object') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v);
  }
  add(el, children);
  return el;
}

/** Assigns styles, handling CSS custom properties correctly. */
export function setStyle(el, obj) {
  for (const k in obj) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    if (k.startsWith('--')) el.style.setProperty(k, String(v));
    else el.style[k] = v;
  }
  return el;
}

export function add(parent, kids) {
  for (const c of kids.flat(6)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    parent.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return parent;
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function frag(...kids) { const f = document.createDocumentFragment(); add(f, kids); return f; }

export function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  return () => target.removeEventListener(type, fn, opts);
}

/** Single-shot animation-end cleanup. */
export function once(el, type, fn) {
  const off = on(el, type, e => { off(); fn(e); });
  return off;
}

/* ---------------- event bus ---------------- */
export class Bus {
  constructor() { this._m = new Map(); }
  on(evt, fn) {
    if (!this._m.has(evt)) this._m.set(evt, new Set());
    this._m.get(evt).add(fn);
    return () => this.off(evt, fn);
  }
  once(evt, fn) { const off = this.on(evt, (...a) => { off(); fn(...a); }); return off; }
  off(evt, fn) { this._m.get(evt)?.delete(fn); }
  emit(evt, ...args) {
    this._m.get(evt)?.forEach(fn => { try { fn(...args); } catch (e) { console.error(`[bus:${evt}]`, e); } });
    this._m.get('*')?.forEach(fn => { try { fn(evt, ...args); } catch (e) { console.error(e); } });
  }
}

/* ---------------- misc ---------------- */
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const raf = () => new Promise(r => requestAnimationFrame(r));

export function debounce(fn, ms = 150) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
export function throttle(fn, ms = 60) {
  let last = 0, t;
  return (...a) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else { clearTimeout(t); t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last)); }
  };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB', 'TB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
}

export function fmtTime(d = new Date(), opts = {}) {
  return d.toLocaleTimeString(opts.locale || undefined,
    { hour: '2-digit', minute: '2-digit', hour12: !!opts.h12, ...opts });
}
export function fmtDate(d = new Date(), locale) {
  return d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}
export function relTime(ts, locale) {
  const s = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(s);
  const steps = [[60, 'second', 1], [3600, 'minute', 60], [86400, 'hour', 3600],
                 [604800, 'day', 86400], [2592000, 'week', 604800], [31536000, 'month', 2592000]];
  let unit = 'year', div = 31536000;
  for (const [lim, u, d] of steps) if (abs < lim) { unit = u; div = d; break; }
  try { return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(Math.round(s / div), unit); }
  catch { return new Date(ts).toLocaleString(); }
}

/** Drag helper: onMove receives {dx,dy,x,y,e}. Returns a disposer. */
export function drag(startEvent, { onStart, onMove, onEnd, cursor } = {}) {
  const sx = startEvent.clientX, sy = startEvent.clientY;
  let moved = false;
  const prevCursor = document.body.style.cursor;
  const veil = h('div', { style: {
    position: 'fixed', inset: '0', zIndex: 99999, cursor: cursor || 'inherit',
  }});
  document.body.appendChild(veil);
  if (cursor) document.body.style.cursor = cursor;
  onStart?.({ x: sx, y: sy, e: startEvent });

  const move = e => {
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.hypot(dx, dy) > 2) moved = true;
    onMove?.({ dx, dy, x: e.clientX, y: e.clientY, e, moved });
  };
  const up = e => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    veil.remove();
    document.body.style.cursor = prevCursor;
    onEnd?.({ dx: e.clientX - sx, dy: e.clientY - sy, x: e.clientX, y: e.clientY, e, moved });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  return up;
}

/** Deep clone via structuredClone with JSON fallback. */
export function clone(o) {
  try { return structuredClone(o); } catch { return JSON.parse(JSON.stringify(o)); }
}

export function hexToRgb(hex) {
  const s = hex.replace('#', '');
  const v = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const f = c => clamp(Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt)), 0, 255);
  return '#' + [f(r), f(g), f(b)].map(c => c.toString(16).padStart(2, '0')).join('');
}
