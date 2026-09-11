/* ==========================================================================
   OpenOS · vfs.js — the virtual filesystem (persisted to localStorage)
   POSIX-ish paths, directories and files, events on every mutation.
   ========================================================================== */

import { Bus, debounce } from './util.js';

const KEY = 'openos.fs.v1';

const now = () => Date.now();
const dirNode  = (name) => ({ t: 'd', n: name, c: {}, ct: now(), mt: now(), meta: {} });
const fileNode = (name, content = '', meta = {}) =>
  ({ t: 'f', n: name, b: content, ct: now(), mt: now(), meta });

export class VFS {
  constructor() {
    this.bus = new Bus();
    this.root = dirNode('');
    this._save = debounce(() => this.persist(), 220);
  }

  /* ---------------- persistence ---------------- */
  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { this.root = JSON.parse(raw); return true; }
    } catch (e) { console.warn('[vfs] load failed', e); }
    return false;
  }
  persist() {
    try { localStorage.setItem(KEY, JSON.stringify(this.root)); }
    catch (e) { console.warn('[vfs] persist failed (quota?)', e); }
  }
  reset() { this.root = dirNode(''); this.persist(); }

  /* ---------------- path helpers ---------------- */
  static norm(p) {
    if (!p) return '/';
    const abs = p.startsWith('/');
    const out = [];
    for (const seg of p.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { out.pop(); continue; }
      out.push(seg);
    }
    return (abs ? '/' : '') + out.join('/') || '/';
  }
  static join(...parts) { return VFS.norm(parts.filter(Boolean).join('/')); }
  static dirname(p) { const n = VFS.norm(p); const i = n.lastIndexOf('/'); return i <= 0 ? '/' : n.slice(0, i); }
  static basename(p) { const n = VFS.norm(p); return n.slice(n.lastIndexOf('/') + 1) || '/'; }
  static ext(p) { const b = VFS.basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; }
  /** Resolve `p` against `cwd` (handles ~, relative and absolute). */
  resolve(cwd, p) {
    if (!p) return VFS.norm(cwd);
    if (p === '~' || p.startsWith('~/')) return VFS.join(this.home, p.slice(1));
    return p.startsWith('/') ? VFS.norm(p) : VFS.join(cwd, p);
  }

  get home() { return this._home || '/Users/user'; }
  set home(v) { this._home = v; }

  /* ---------------- lookup ---------------- */
  _node(path) {
    const n = VFS.norm(path);
    if (n === '/') return this.root;
    let cur = this.root;
    for (const seg of n.slice(1).split('/')) {
      if (!cur || cur.t !== 'd') return null;
      cur = cur.c[seg];
    }
    return cur || null;
  }
  exists(path) { return !!this._node(path); }
  isDir(path)  { const n = this._node(path); return !!n && n.t === 'd'; }
  isFile(path) { const n = this._node(path); return !!n && n.t === 'f'; }

  stat(path) {
    const n = this._node(path);
    if (!n) return null;
    return {
      path: VFS.norm(path), name: n.n || VFS.basename(path), type: n.t === 'd' ? 'dir' : 'file',
      size: n.t === 'f' ? (n.b || '').length : Object.keys(n.c || {}).length,
      created: n.ct, modified: n.mt, meta: n.meta || {}, ext: VFS.ext(path),
    };
  }

  list(path = '/') {
    const n = this._node(path);
    if (!n) throw new Error(`No such directory: ${path}`);
    if (n.t !== 'd') throw new Error(`Not a directory: ${path}`);
    return Object.values(n.c)
      .map(c => this.stat(VFS.join(path, c.n)))
      .sort((a, b) => (a.type === b.type)
        ? a.name.localeCompare(b.name, undefined, { numeric: true })
        : (a.type === 'dir' ? -1 : 1));
  }

  read(path) {
    const n = this._node(path);
    if (!n) throw new Error(`No such file: ${path}`);
    if (n.t !== 'f') throw new Error(`Is a directory: ${path}`);
    return n.b;
  }
  readJSON(path, fallback = null) {
    try { return JSON.parse(this.read(path)); } catch { return fallback; }
  }

  /* ---------------- mutation ---------------- */
  mkdir(path, { recursive = true } = {}) {
    const n = VFS.norm(path);
    if (n === '/') return this.root;
    const segs = n.slice(1).split('/');
    let cur = this.root;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (!cur.c[s]) {
        if (!recursive && i < segs.length - 1) throw new Error(`Missing parent for ${path}`);
        cur.c[s] = dirNode(s);
      } else if (cur.c[s].t !== 'd') throw new Error(`Not a directory: ${s}`);
      cur = cur.c[s];
    }
    cur.mt = now(); this._touch(n, 'mkdir');
    return cur;
  }

  write(path, content = '', meta) {
    const n = VFS.norm(path);
    const parent = this.mkdir(VFS.dirname(n));
    const base = VFS.basename(n);
    const ex = parent.c[base];
    if (ex && ex.t === 'd') throw new Error(`Is a directory: ${path}`);
    if (ex) { ex.b = content; ex.mt = now(); if (meta) ex.meta = { ...ex.meta, ...meta }; }
    else parent.c[base] = fileNode(base, content, meta || {});
    parent.mt = now();
    this._touch(n, 'write');
    return this.stat(n);
  }
  writeJSON(path, obj, meta) { return this.write(path, JSON.stringify(obj, null, 2), meta); }

  append(path, content) {
    const cur = this.exists(path) ? this.read(path) : '';
    return this.write(path, cur + content);
  }

  remove(path, { recursive = true } = {}) {
    const n = VFS.norm(path);
    if (n === '/') throw new Error('Refusing to remove /');
    const parent = this._node(VFS.dirname(n));
    const base = VFS.basename(n);
    if (!parent || !parent.c[base]) throw new Error(`No such file or directory: ${path}`);
    const node = parent.c[base];
    if (node.t === 'd' && !recursive && Object.keys(node.c).length) throw new Error(`Directory not empty: ${path}`);
    delete parent.c[base];
    parent.mt = now();
    this._touch(n, 'remove');
    return true;
  }

  move(from, to) {
    const f = VFS.norm(from);
    let t = VFS.norm(to);
    const node = this._node(f);
    if (!node) throw new Error(`No such file or directory: ${from}`);
    if (t.startsWith(f + '/')) throw new Error('Cannot move a directory into itself');
    if (this.isDir(t)) t = VFS.join(t, VFS.basename(f));
    const tp = this.mkdir(VFS.dirname(t));
    const srcParent = this._node(VFS.dirname(f));
    delete srcParent.c[VFS.basename(f)];
    node.n = VFS.basename(t); node.mt = now();
    tp.c[node.n] = node;
    this._touch(f, 'move'); this._touch(t, 'move');
    return this.stat(t);
  }

  copy(from, to) {
    const node = this._node(from);
    if (!node) throw new Error(`No such file or directory: ${from}`);
    let t = VFS.norm(to);
    if (this.isDir(t)) t = VFS.join(t, VFS.basename(from));
    const cp = JSON.parse(JSON.stringify(node));
    const rename = (nd, name) => { nd.n = name; nd.ct = nd.mt = now(); };
    rename(cp, VFS.basename(t));
    const tp = this.mkdir(VFS.dirname(t));
    tp.c[cp.n] = cp;
    this._touch(t, 'copy');
    return this.stat(t);
  }

  /** Unique path helper: /a/b.txt → /a/b 2.txt when taken. */
  unique(path) {
    if (!this.exists(path)) return path;
    const dir = VFS.dirname(path), base = VFS.basename(path);
    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    for (let i = 2; i < 999; i++) {
      const p = VFS.join(dir, `${stem} ${i}${ext}`);
      if (!this.exists(p)) return p;
    }
    return VFS.join(dir, `${stem} ${Date.now()}${ext}`);
  }

  /** Recursive walk. cb(stat) — return false to skip descending. */
  walk(path = '/', cb) {
    for (const s of this.list(path)) {
      const go = cb(s);
      if (s.type === 'dir' && go !== false) this.walk(s.path, cb);
    }
  }

  search(query, { root = '/', limit = 60 } = {}) {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    const out = [];
    const visit = (p) => {
      let items; try { items = this.list(p); } catch { return; }
      for (const s of items) {
        if (out.length >= limit) return;
        if (s.name.toLowerCase().includes(q)) out.push(s);
        if (s.type === 'dir') visit(s.path);
      }
    };
    visit(root);
    return out;
  }

  usage() {
    let files = 0, dirs = 0, bytes = 0;
    this.walk('/', s => { if (s.type === 'file') { files++; bytes += s.size; } else dirs++; });
    return { files, dirs, bytes };
  }

  _touch(path, op) {
    this._save();
    this.bus.emit('change', { path, op });
    this.bus.emit(op, { path });
  }
}

export const vfs = new VFS();
export default vfs;
