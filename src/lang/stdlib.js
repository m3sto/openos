/* ==========================================================================
   OpenSharp · stdlib.js — the standard library exposed to every .osh program
   ========================================================================== */

import { str, num, truthy, OshFunction } from './interpreter.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';
import settings from '../core/settings.js';
import registry from '../core/registry.js';

const call = (interp, fn, args = []) => interp.invoke(fn, args);

export function makeStdlib(interp, ctx = {}) {
  const perms = ctx.permissions || { fs: true, apps: true, net: true };
  const guard = (flag, name) => {
    if (!perms[flag]) throw new Error(`Bu uygulamanın '${name}' izni yok`);
  };

  const lib = {
    /* ---------- output ---------- */
    print: (...a) => { ctx.onPrint?.(a.map(str).join(' ')); return null; },
    log:   (...a) => { ctx.onPrint?.(a.map(str).join(' ')); return null; },
    alert: (msg, title) => { notify.alert(str(msg), { title: str(title || ctx.appName || 'OpenOS') }); return null; },
    confirm: (msg, cb) => {
      notify.confirm(str(msg), { title: ctx.appName || 'OpenOS' }).then(ok => cb && call(interp, cb, [ok]));
      return null;
    },
    ask: (msg, cb, initial) => {
      notify.prompt(str(msg), { title: ctx.appName || 'OpenOS', value: str(initial || '') })
        .then(v => cb && call(interp, cb, [v]));
      return null;
    },
    toast: (msg, glyph) => { notify.toast(str(msg), { glyph: str(glyph || '') }); return null; },
    notify: (title, body, glyph) => {
      notify.post({ title: str(title), body: str(body || ''), glyph: str(glyph || 'sparkles'),
                    app: ctx.appId || 'opensharp', tint: ctx.tint || ['#5e5ce6', '#bf5af2'] });
      return null;
    },

    /* ---------- types ---------- */
    len: (v) => (v === null || v === undefined) ? 0 : (v.length ?? Object.keys(v).length ?? 0),
    str: (v) => str(v),
    num: (v) => num(v),
    int: (v) => Math.trunc(num(v)),
    bool: (v) => truthy(v),
    type: (v) => Array.isArray(v) ? 'list' : v === null || v === undefined ? 'nil'
      : v instanceof OshFunction ? 'fn' : typeof v,
    is_nil: (v) => v === null || v === undefined,

    /* ---------- math ---------- */
    abs: v => Math.abs(num(v)), floor: v => Math.floor(num(v)), ceil: v => Math.ceil(num(v)),
    round: (v, d = 0) => { const m = 10 ** num(d); return Math.round(num(v) * m) / m; },
    min: (...a) => Math.min(...a.flat().map(num)), max: (...a) => Math.max(...a.flat().map(num)),
    sqrt: v => Math.sqrt(num(v)), pow: (a, b) => Math.pow(num(a), num(b)),
    sin: v => Math.sin(num(v)), cos: v => Math.cos(num(v)), tan: v => Math.tan(num(v)),
    atan2: (y, x) => Math.atan2(num(y), num(x)),
    random: (a, b) => {
      if (a === undefined) return Math.random();
      if (b === undefined) return Math.floor(Math.random() * num(a));
      return Math.floor(Math.random() * (num(b) - num(a) + 1)) + num(a);
    },
    clamp: (v, lo, hi) => Math.max(num(lo), Math.min(num(hi), num(v))),
    PI: Math.PI, E: Math.E,

    /* ---------- strings ---------- */
    upper: s => str(s).toUpperCase(), lower: s => str(s).toLowerCase(), trim: s => str(s).trim(),
    split: (s, sep = ' ') => str(s).split(str(sep)),
    join: (arr, sep = '') => (arr || []).map(str).join(str(sep)),
    replace: (s, a, b) => str(s).split(str(a)).join(str(b)),
    contains: (s, q) => Array.isArray(s) ? s.includes(q) : str(s).includes(str(q)),
    starts: (s, q) => str(s).startsWith(str(q)), ends: (s, q) => str(s).endsWith(str(q)),
    slice: (s, a, b) => (Array.isArray(s) ? s : str(s)).slice(num(a), b === undefined ? undefined : num(b)),
    pad: (s, n, c = '0') => str(s).padStart(num(n), str(c)),
    repeat: (s, n) => str(s).repeat(Math.max(0, num(n) | 0)),
    char_at: (s, i) => str(s)[num(i)] ?? '',
    index_of: (s, q) => (Array.isArray(s) ? s.indexOf(q) : str(s).indexOf(str(q))),
    format: (n, digits = 2) => num(n).toFixed(num(digits)),

    /* ---------- lists ---------- */
    list: (...a) => a.flat(),
    range: (a, b, step = 1) => {
      const from = b === undefined ? 0 : num(a), to = b === undefined ? num(a) : num(b);
      const st = num(step) || 1, out = [];
      if (st > 0) for (let i = from; i < to; i += st) out.push(i);
      else for (let i = from; i > to; i += st) out.push(i);
      return out;
    },
    push: (arr, ...v) => { arr.push(...v); return arr; },
    pop: (arr) => arr.pop() ?? null,
    shift: (arr) => arr.shift() ?? null,
    unshift: (arr, ...v) => { arr.unshift(...v); return arr; },
    remove_at: (arr, i) => { arr.splice(num(i), 1); return arr; },
    insert_at: (arr, i, v) => { arr.splice(num(i), 0, v); return arr; },
    map: (arr, fn) => (arr || []).map((v, i) => call(interp, fn, [v, i])),
    filter: (arr, fn) => (arr || []).filter((v, i) => truthy(call(interp, fn, [v, i]))),
    find: (arr, fn) => (arr || []).find((v, i) => truthy(call(interp, fn, [v, i]))) ?? null,
    each: (arr, fn) => { (arr || []).forEach((v, i) => call(interp, fn, [v, i])); return null; },
    reduce: (arr, fn, init) => (arr || []).reduce((acc, v, i) => call(interp, fn, [acc, v, i]), init),
    sort: (arr, fn) => [...(arr || [])].sort(fn
      ? (a, b) => num(call(interp, fn, [a, b]))
      : (a, b) => (typeof a === 'string' ? a.localeCompare(b) : num(a) - num(b))),
    reverse: (arr) => [...(arr || [])].reverse(),
    sum: (arr) => (arr || []).reduce((a, b) => a + num(b), 0),
    avg: (arr) => (arr || []).length ? (arr.reduce((a, b) => a + num(b), 0) / arr.length) : 0,
    unique: (arr) => [...new Set(arr || [])],
    keys: (o) => Object.keys(o || {}),
    values: (o) => Object.values(o || {}),
    entries: (o) => Object.entries(o || {}).map(([k, v]) => ({ key: k, value: v })),
    has: (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, str(k)),
    del: (o, k) => { delete o[str(k)]; return o; },
    merge: (a, b) => ({ ...(a || {}), ...(b || {}) }),
    obj: (pairsOrNamed) => ({ ...(pairsOrNamed || {}) }),

    /* ---------- json / time ---------- */
    json_str: (v, pretty) => JSON.stringify(v, null, truthy(pretty) ? 2 : 0),
    json_parse: (s) => { try { return JSON.parse(str(s)); } catch { return null; } },
    now: () => Date.now(),
    time_str: (ts) => new Date(ts === undefined ? Date.now() : num(ts))
      .toLocaleTimeString(settings.get('locale'), { hour: '2-digit', minute: '2-digit' }),
    date_str: (ts) => new Date(ts === undefined ? Date.now() : num(ts))
      .toLocaleDateString(settings.get('locale'), { day: 'numeric', month: 'long', year: 'numeric' }),
    year: (ts) => new Date(ts ?? Date.now()).getFullYear(),
    after: (ms, fn) => { const t = setTimeout(() => call(interp, fn, []), num(ms)); ctx.timers?.push(t); return t; },
    every: (ms, fn) => { const t = setInterval(() => call(interp, fn, []), Math.max(40, num(ms))); ctx.timers?.push(t); return t; },
    cancel: (t) => { clearTimeout(t); clearInterval(t); return null; },

    /* ---------- app / ui ---------- */
    refresh: () => { ctx.refresh?.(); return null; },
    title: (t) => { ctx.setTitle?.(str(t)); return null; },
    close: () => { ctx.close?.(); return null; },
    state_get: (n) => interp.getState(str(n)),
    state_set: (n, v) => { interp.setState(str(n), v); return v; },

    /* ---------- filesystem ---------- */
    fs_read: (p) => { guard('fs', 'dosya'); try { return vfs.read(ctx.resolve(str(p))); } catch { return null; } },
    fs_write: (p, c) => { guard('fs', 'dosya'); vfs.write(ctx.resolve(str(p)), str(c)); return true; },
    fs_append: (p, c) => { guard('fs', 'dosya'); vfs.append(ctx.resolve(str(p)), str(c)); return true; },
    fs_list: (p = '.') => { guard('fs', 'dosya'); try { return vfs.list(ctx.resolve(str(p))).map(s => ({ name: s.name, path: s.path, type: s.type, size: s.size, modified: s.modified })); } catch { return []; } },
    fs_exists: (p) => { guard('fs', 'dosya'); return vfs.exists(ctx.resolve(str(p))); },
    fs_remove: (p) => { guard('fs', 'dosya'); try { vfs.remove(ctx.resolve(str(p))); return true; } catch { return false; } },
    fs_mkdir: (p) => { guard('fs', 'dosya'); vfs.mkdir(ctx.resolve(str(p))); return true; },
    fs_home: () => vfs.home,
    fs_dir: () => ctx.cwd || vfs.home,

    /* ---------- persistent key/value for this app ---------- */
    store_get: (k, d = null) => {
      const box = vfs.readJSON(ctx.storePath, {}) || {};
      return box[str(k)] ?? d;
    },
    store_set: (k, v) => {
      const box = vfs.readJSON(ctx.storePath, {}) || {};
      box[str(k)] = v;
      vfs.writeJSON(ctx.storePath, box);
      return v;
    },
    store_all: () => vfs.readJSON(ctx.storePath, {}) || {},

    /* ---------- system ---------- */
    os_open: (appId, args) => { guard('apps', 'uygulama'); ctx.openApp?.(str(appId), args); return null; },
    os_apps: () => registry.visible().map(a => ({ id: a.id, name: a.name, category: a.category })),
    os_theme: (t) => t === undefined ? (settings.isDark ? 'dark' : 'light') : (settings.set('theme', str(t)), str(t)),
    os_accent: (c) => c === undefined ? settings.get('accent') : (settings.set('accent', str(c)), str(c)),
    os_user: () => settings.get('user.name'),
    os_info: () => ({ name: 'OpenOS', version: ctx.osVersion || '1.0', lang: 'OpenSharp',
                      theme: settings.isDark ? 'dark' : 'light', accent: settings.get('accent') }),

    /* ---------- network ---------- */
    http_get: (url, cb) => {
      guard('net', 'ağ');
      fetch(str(url)).then(r => r.text())
        .then(t => cb && call(interp, cb, [t, 200]))
        .catch(e => cb && call(interp, cb, [null, str(e.message)]));
      return null;
    },
    http_json: (url, cb) => {
      guard('net', 'ağ');
      fetch(str(url)).then(r => r.json())
        .then(j => cb && call(interp, cb, [j, 200]))
        .catch(e => cb && call(interp, cb, [null, str(e.message)]));
      return null;
    },
  };

  return lib;
}

export const STDLIB_DOCS = [
  ['Çıktı', ['print(...)', 'alert(msg)', 'confirm(msg, fn(ok))', 'ask(msg, fn(v))', 'toast(msg)', 'notify(title, body)']],
  ['Tipler', ['len(v)', 'str(v)', 'num(v)', 'int(v)', 'type(v)', 'is_nil(v)']],
  ['Matematik', ['abs', 'floor', 'ceil', 'round(v,d)', 'min', 'max', 'sqrt', 'pow', 'random(a,b)', 'clamp(v,lo,hi)', 'PI']],
  ['Metin', ['upper', 'lower', 'trim', 'split(s,sep)', 'join(l,sep)', 'replace', 'contains', 'slice', 'pad', 'format(n,d)']],
  ['Listeler', ['range(a,b)', 'push', 'pop', 'map(l,fn)', 'filter', 'find', 'each', 'reduce', 'sort', 'sum', 'avg', 'unique', 'keys', 'values']],
  ['Zaman', ['now()', 'time_str()', 'date_str()', 'after(ms,fn)', 'every(ms,fn)', 'cancel(t)']],
  ['Dosya', ['fs_read(p)', 'fs_write(p,c)', 'fs_list(p)', 'fs_exists(p)', 'fs_remove(p)', 'fs_mkdir(p)']],
  ['Kalıcı depo', ['store_get(k,d)', 'store_set(k,v)', 'store_all()']],
  ['Sistem', ['os_open(id)', 'os_apps()', 'os_theme(t)', 'os_accent(c)', 'os_info()', 'refresh()', 'title(t)', 'close()']],
  ['Ağ', ['http_get(url, fn)', 'http_json(url, fn)']],
];
