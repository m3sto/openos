/* ==========================================================================
   OpenSharp · stdlib.js — the standard library exposed to every .osh program
   ========================================================================== */

import { str, num, truthy, OshFunction } from './interpreter.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';
import settings from '../core/settings.js';
import registry from '../core/registry.js';
import clipboard from '../core/clipboard.js';
import { openFile, saveFile } from '../ui/filedialog.js';

const call = (interp, fn, args = []) => interp.invoke(fn, args);

/** Desen metnini RegExp'e çevirir; bozuk desen çökme yerine hiçbir şeye uymaz. */
function yeniRe(desen, bayrak) {
  try { return new RegExp(String(desen), String(bayrak || '')); }
  catch { return /(?!)/; }
}

/** Dosya kutusu seçeneklerini OpenSharp adlandırmasından karşılığına çevirir. */
function ayarSoz(o = {}) {
  return {
    title: o.baslik ?? o.title,
    path: o.klasor ?? o.path,
    name: o.ad ?? o.name,
    multiple: o.coklu ?? o.multiple,
    filters: o.uzantilar ?? o.filters,
  };
}

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
    http_post: (url, govde, cb) => {
      guard('net', 'ağ');
      const json = typeof govde === 'object' && govde !== null;
      fetch(str(url), {
        method: 'POST',
        headers: json ? { 'content-type': 'application/json' } : {},
        body: json ? JSON.stringify(govde) : str(govde),
      })
        .then(async r => [await r.text(), r.status])
        .then(([t, k]) => cb && call(interp, cb, [t, k]))
        .catch(e => cb && call(interp, cb, [null, str(e.message)]));
      return null;
    },
    net_online: () => navigator.onLine !== false,

    /* ---------- düzenli ifadeler ----------
       OpenSharp'ta desen bir metindir; bayraklar ayrı verilir. Böylece
       dilde `/…/g` gibi ayrı bir değişmez türü öğrenmek gerekmez. */
    re_test: (desen, metin, bayrak = '') => yeniRe(desen, bayrak).test(str(metin)),
    re_find: (desen, metin, bayrak = '') => {
      const m = yeniRe(desen, bayrak).exec(str(metin));
      return m ? { text: m[0], index: m.index, groups: m.slice(1) } : null;
    },
    re_all: (desen, metin, bayrak = 'g') => {
      const re = yeniRe(desen, bayrak.includes('g') ? bayrak : bayrak + 'g');
      return [...str(metin).matchAll(re)].map(m => ({ text: m[0], index: m.index, groups: m.slice(1) }));
    },
    re_replace: (desen, metin, yerine, bayrak = 'g') =>
      str(metin).replace(yeniRe(desen, bayrak), str(yerine)),
    re_split: (desen, metin, bayrak = '') => str(metin).split(yeniRe(desen, bayrak)),

    /* ---------- ek metin işlemleri ---------- */
    title_case: (s0) => str(s0).replace(/\p{L}+/gu, w => w[0].toLocaleUpperCase('tr') + w.slice(1).toLocaleLowerCase('tr')),
    trim_start: (s0) => str(s0).trimStart(),
    trim_end: (s0) => str(s0).trimEnd(),
    pad_end: (s0, n, c = ' ') => str(s0).padEnd(num(n), str(c)),
    lines: (s0) => str(s0).split(/\r?\n/),
    words: (s0) => str(s0).trim().split(/\s+/).filter(Boolean),
    count: (s0, q) => Array.isArray(s0)
      ? s0.filter(v => v === q).length
      : (str(s0).split(str(q)).length - 1),
    slug: (s0) => {
      const harita = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };
      return str(s0).toLowerCase().replace(/[çğıöşü]/g, c => harita[c] || c)
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    },

    /* ---------- kodlama ---------- */
    b64_encode: (s0) => { try { return btoa(unescape(encodeURIComponent(str(s0)))); } catch { return ''; } },
    b64_decode: (s0) => { try { return decodeURIComponent(escape(atob(str(s0)))); } catch { return ''; } },
    url_encode: (s0) => encodeURIComponent(str(s0)),
    url_decode: (s0) => { try { return decodeURIComponent(str(s0)); } catch { return str(s0); } },
    uuid: () => (crypto.randomUUID ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        })),
    hash: (s0) => {
      /* Kısa, kararlı bir özet — kimlik üretmek ve önbellek anahtarı için.
         Güvenlik amaçlı değildir; parola saklamak için kullanılmamalı. */
      let h = 2166136261;
      const t = str(s0);
      for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
      return (h >>> 0).toString(36);
    },

    /* ---------- tarih ve saat ---------- */
    date_parts: (ts) => {
      const d = new Date(ts === undefined ? Date.now() : num(ts));
      return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
               hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
               weekday: d.getDay(), ts: d.getTime() };
    },
    date_make: (y, ay = 1, gun = 1, sa = 0, dk = 0) =>
      new Date(num(y), num(ay) - 1, num(gun), num(sa), num(dk)).getTime(),
    date_add: (ts, gun = 0, sa = 0, dk = 0) =>
      num(ts) + num(gun) * 864e5 + num(sa) * 36e5 + num(dk) * 6e4,
    date_diff: (a, b, birim = 'gun') => {
      const fark = num(a) - num(b);
      const bolen = { ms: 1, sn: 1e3, dk: 6e4, sa: 36e5, gun: 864e5 }[str(birim)] || 864e5;
      return fark / bolen;
    },
    date_format: (ts, bicim = 'uzun') => {
      const d = new Date(ts === undefined ? Date.now() : num(ts));
      const yerel = settings.get('locale');
      if (bicim === 'kisa') return d.toLocaleDateString(yerel);
      if (bicim === 'saat') return d.toLocaleTimeString(yerel, { hour: '2-digit', minute: '2-digit' });
      if (bicim === 'tam') return d.toLocaleString(yerel);
      if (bicim === 'iso') return d.toISOString();
      return d.toLocaleDateString(yerel, { day: 'numeric', month: 'long', year: 'numeric' });
    },
    date_relative: (ts) => {
      const fark = Date.now() - num(ts);
      const sn = Math.round(fark / 1000);
      if (Math.abs(sn) < 60) return 'az önce';
      const rtf = new Intl.RelativeTimeFormat(settings.get('locale'), { numeric: 'auto' });
      for (const [birim, boy] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
        if (Math.abs(sn) >= boy) return rtf.format(-Math.round(sn / boy), birim);
      }
      return 'az önce';
    },

    /* ---------- sistemin panosu ----------
       Ana bilgisayarın panosuna erişilmez; OpenOS'un kendi panosu okunur. */
    clip_read: () => clipboard.read(),
    clip_write: (v) => clipboard.write(str(v), { kaynak: ctx.appId }),
    clip_history: () => clipboard.gecmis.map(o => ({ text: o.text, zaman: o.zaman, kaynak: o.kaynak })),
    clip_clear: () => { clipboard.clear(); return null; },

    /* ---------- dosya kutuları ---------- */
    dialog_open: (cb, o = {}) => {
      guard('fs', 'dosya');
      openFile({ ...ayarSoz(o), win: ctx.win }).then(y => cb && call(interp, cb, [y]));
      return null;
    },
    dialog_save: (cb, o = {}) => {
      guard('fs', 'dosya');
      saveFile({ ...ayarSoz(o), win: ctx.win }).then(y => cb && call(interp, cb, [y]));
      return null;
    },

    /* ---------- ek dosya işlemleri ---------- */
    fs_read_json: (p, d = null) => { guard('fs', 'dosya'); return vfs.readJSON(ctx.resolve(str(p)), d); },
    fs_write_json: (p, v) => { guard('fs', 'dosya'); vfs.writeJSON(ctx.resolve(str(p)), v); return true; },
    fs_copy: (a, b) => { guard('fs', 'dosya'); try { vfs.copy(ctx.resolve(str(a)), ctx.resolve(str(b))); return true; } catch { return false; } },
    fs_move: (a, b) => { guard('fs', 'dosya'); try { vfs.move(ctx.resolve(str(a)), ctx.resolve(str(b))); return true; } catch { return false; } },
    fs_stat: (p) => { guard('fs', 'dosya'); const st = vfs.stat(ctx.resolve(str(p))); return st ? { ...st } : null; },
    fs_search: (q, kok) => { guard('fs', 'dosya'); return vfs.search(str(q), { root: kok ? ctx.resolve(str(kok)) : '/' }); },
    path_join: (...p) => VFS.join(...p.map(str)),
    path_dir: (p) => VFS.dirname(str(p)),
    path_name: (p) => VFS.basename(str(p)),
    path_ext: (p) => VFS.ext(str(p)),

    /* ---------- süreçler ve pencereler ---------- */
    ps_list: () => (ctx.processes?.() || []),
    win_title: (t) => { ctx.setTitle?.(str(t)); return null; },
    win_close: () => { ctx.close?.(); return null; },
    win_size: (w, h) => { ctx.resize?.(num(w), num(h)); return null; },

    /* ---------- ses ---------- */
    beep: (frekans = 660, sure = 120) => {
      try {
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = num(frekans); o.type = 'sine';
        g.gain.value = 0.07;
        o.connect(g); g.connect(ac.destination);
        o.start(); o.stop(ac.currentTime + num(sure) / 1000);
        setTimeout(() => ac.close(), num(sure) + 200);
      } catch {}
      return null;
    },
  };

  return lib;
}

export const STDLIB_DOCS = [
  ['Çıktı', ['print(...)', 'alert(msg)', 'confirm(msg, fn(ok))', 'ask(msg, fn(v))', 'toast(msg)', 'notify(title, body)']],
  ['Tipler', ['len(v)', 'str(v)', 'num(v)', 'int(v)', 'bool(v)', 'type(v)', 'is_nil(v)']],
  ['Matematik', ['abs', 'floor', 'ceil', 'round(v,d)', 'min', 'max', 'sqrt', 'pow', 'random(a,b)', 'clamp(v,lo,hi)', 'PI']],
  ['Metin', ['upper', 'lower', 'trim', 'trim_start', 'trim_end', 'split(s,sep)', 'join(l,sep)', 'replace',
             'contains', 'starts', 'ends', 'slice', 'pad', 'pad_end', 'repeat', 'char_at', 'index_of',
             'format(n,d)', 'title_case', 'lines', 'words', 'count', 'slug']],
  ['Düzenli ifade', ['re_test(desen,metin)', 're_find(desen,metin)', 're_all(desen,metin)',
                     're_replace(desen,metin,yerine)', 're_split(desen,metin)']],
  ['Listeler', ['range(a,b)', 'push', 'pop', 'shift', 'unshift', 'remove_at', 'insert_at', 'map(l,fn)',
                'filter', 'find', 'each', 'reduce', 'sort', 'reverse', 'sum', 'avg', 'unique']],
  ['Nesneler', ['keys(o)', 'values(o)', 'entries(o)', 'has(o,k)', 'del(o,k)', 'merge(a,b)',
                'json_str(v)', 'json_parse(s)']],
  ['Zaman', ['now()', 'time_str()', 'date_str()', 'date_parts(ts)', 'date_make(y,ay,gun)', 'date_add(ts,gun)',
             'date_diff(a,b,birim)', 'date_format(ts,bicim)', 'date_relative(ts)',
             'after(ms,fn)', 'every(ms,fn)', 'cancel(t)']],
  ['Dosya', ['fs_read(p)', 'fs_write(p,c)', 'fs_append(p,c)', 'fs_list(p)', 'fs_exists(p)', 'fs_remove(p)',
             'fs_mkdir(p)', 'fs_read_json(p,d)', 'fs_write_json(p,v)', 'fs_copy(a,b)', 'fs_move(a,b)',
             'fs_stat(p)', 'fs_search(q)', 'fs_home()', 'fs_dir()']],
  ['Yol', ['path_join(...)', 'path_dir(p)', 'path_name(p)', 'path_ext(p)']],
  ['Dosya kutuları', ['dialog_open(fn(yol), {uzantilar})', 'dialog_save(fn(yol), {ad})']],
  ['Pano', ['clip_read()', 'clip_write(v)', 'clip_history()', 'clip_clear()']],
  ['Kalıcı depo', ['store_get(k,d)', 'store_set(k,v)', 'store_all()']],
  ['Kodlama', ['b64_encode(s)', 'b64_decode(s)', 'url_encode(s)', 'url_decode(s)', 'uuid()', 'hash(s)']],
  ['Sistem', ['os_open(id)', 'os_apps()', 'os_theme(t)', 'os_accent(c)', 'os_user()', 'os_info()',
              'ps_list()', 'refresh()', 'title(t)', 'close()', 'win_size(w,h)', 'beep(hz,ms)']],
  ['Ağ', ['http_get(url, fn)', 'http_json(url, fn)', 'http_post(url, govde, fn)', 'net_online()']],
];
