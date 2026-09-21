/* ==========================================================================
   OpenOS · vfs.js — the virtual filesystem
   POSIX-ish paths, directories and files, events on every mutation.
   Disk `localStorage`'a **şifreli** yazılır; anahtar IndexedDB'de dışa
   aktarılamaz bir CryptoKey olarak durur (bkz. core/vault.js).
   ========================================================================== */

import { Bus, debounce } from './util.js';
import vault, { Vault } from './vault.js';

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

  /* ---------------- persistence ----------------
     Disk şifreli saklanır (bkz. core/vault.js). Şifreleme eşzamansızdır;
     bu yüzden `persist()` çağrıldığı anda dönen, arka planda yazan bir
     işlem. Son yazımı beklemek gerektiğinde `flush()` kullanılır. */

  /**
   * Diski bir klasör deposuna bağlar (bkz. core/disk.js). Bağlandıktan
   * sonra tarayıcı deposuna hiç yazılmaz — veri kullanıcının klasöründeki
   * şifreli disk dosyasında yaşar.
   */
  bagla(depo) {
    this.depo = depo;
    this.sifreli = true;
  }

  /** Disk nerede duruyor — durum çubukları ve Depolama uygulaması için. */
  get konum() {
    if (this.depo) return { tur: 'klasor', ad: this.depo.ad };
    return { tur: 'tarayici', ad: 'Tarayıcı deposu' };
  }

  /** @returns {Promise<boolean>} diskte okunabilir bir durum bulundu mu */
  async load() {
    /* Klasör diski bağlıysa kaynak odur; tarayıcı deposuna bakılmaz. */
    if (this.depo) {
      try {
        const metin = await this.depo.oku();
        if (metin == null) return false;
        this.root = JSON.parse(metin);
        this.sifreli = true;
        return true;
      } catch (e) {
        console.error('[vfs] klasör diski okunamadı', e);
        this.kasaHatasi = 'cozulemedi';
        return false;
      }
    }

    const raw = localStorage.getItem(KEY);
    if (!raw) return false;

    /* Şifreli paket: kasayı aç ve çöz. */
    if (Vault.paketMi(raw)) {
      if (!(await vault.ac())) {
        console.warn('[vfs] kasa açılamadı:', vault.sebep);
        this.kasaHatasi = 'anahtar-yok';
        return false;
      }
      try {
        this.root = JSON.parse(await vault.coz(raw));
        this.sifreli = true;
        return true;
      } catch (e) {
        /* GCM doğrulaması başarısız: ya kurcalanmış ya da anahtar değişmiş.
           Sessizce boş diskle açmak veri kaybını gizler — durum işaretlenir,
           çekirdek kullanıcıyı uyarır. */
        console.error('[vfs] disk çözülemedi', e);
        this.kasaHatasi = 'cozulemedi';
        return false;
      }
    }

    /* Eski düz JSON: oku ve ilk fırsatta şifreliye taşı. */
    try {
      this.root = JSON.parse(raw);
      this.persist();
      return true;
    } catch (e) { console.warn('[vfs] load failed', e); }
    return false;
  }

  persist() {
    this._bekleyen = JSON.stringify(this.root);
    if (this._yaziyor) { this._tekrar = true; return this._yaziyor; }
    this._yaziyor = this._yaz();
    return this._yaziyor;
  }

  async _yaz() {
    try {
      while (this._bekleyen !== null) {
        const metin = this._bekleyen;
        this._bekleyen = null;
        if (this.depo) {
          await this.depo.yaz(metin);
          this.sifreli = true;
          this.yazmaHatasi = null;
          continue;
        }
        if (await vault.ac()) {
          localStorage.setItem(KEY, await vault.sifrele(metin));
          this.sifreli = true;
          this.yazmaHatasi = null;
        } else {
          /* Kasa kurulamıyorsa veri kaybetmektense düz yazmak yeğdir — ama
             sessizce değil. Kullanıcı diskinin şifreli olduğunu sanırken
             şifresiz yazmak, koruma vaadini sessizce geri almak olur. */
          localStorage.setItem(KEY, metin);
          this.yazmaHatasi = null;
          const oncekiDurum = this.sifreli;
          this.sifreli = false;
          if (oncekiDurum !== false && !this._sifresizUyarildi) {
            this._sifresizUyarildi = true;
            this.bus.emit('sifresiz', vault.durum);
          }
        }
      }
    } catch (e) {
      /* Yazma başarısız oldu — neredeyse her zaman kota. Bunu bir konsol
         uyarısına gömmek, kullanıcının çalışmaya devam edip yeniden
         açılışta son başarılı kayıttan sonrasını kaybetmesi demek. Bir
         işletim sisteminde "diske yazamadım" sessiz kalabilecek bir olay
         değil. */
      const kota = /quota|exceeded|NS_ERROR_DOM_QUOTA/i.test(e.name + ' ' + e.message);
      this.yazmaHatasi = { kota, ileti: e.message, zaman: now() };
      console.error('[vfs] diske yazılamadı', e);
      /* Aynı hatayı her tuş vuruşunda bildirmemek için kısılır. */
      if (!this._hataBildirildi || now() - this._hataBildirildi > 60000) {
        this._hataBildirildi = now();
        this.bus.emit('yazilamadi', this.yazmaHatasi);
      }
    } finally {
      this._yaziyor = null;
      this._tekrar = false;
    }
  }

  /** Son yazma denemesi başarılı mıydı? Durum çubukları buna bakar. */
  get saglamMi() { return !this.yazmaHatasi; }

  /** Bekleyen yazımın bitmesini bekler (kapanış, fabrika ayarları vb.). */
  async flush() { if (this._yaziyor) await this._yaziyor; }

  reset() { this.root = dirNode(''); return this.persist(); }

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
  /* ---------------- yedekleme ----------------
     Disk şifreli saklanıyor ve anahtar bu tarayıcıya bağlı; dışarı çıkma
     yolu olmadan bu, veriyi tek bir tarayıcı profiline hapsetmek demek.
     Yedek taşınabilir olmalı: düz, okunabilir, sürüm damgalı JSON. */

  /**
   * Diskin tamamını taşınabilir bir pakete çevirir.
   * @param {{trashDahil?: boolean}} [o]
   */
  export(o = {}) {
    const kok = o.trashDahil ? this.root : this._copSuz(this.root);
    const kullanim = this.usage();
    return {
      bicim: 'openos-backup',
      surum: 1,
      olusturma: now(),
      ev: this.home,
      ozet: { dosya: kullanim.files, klasor: kullanim.dirs, bayt: kullanim.bytes },
      agac: kok,
    };
  }

  /** Çöp kutusunu ağaçtan ayıklar — yedeğe çöp taşımanın anlamı yok. */
  _copSuz(node) {
    const kopya = JSON.parse(JSON.stringify(node));
    const parcalar = this.trashDir.split('/').filter(Boolean);
    let n = kopya;
    for (let i = 0; i < parcalar.length - 1; i++) {
      n = n.c?.[parcalar[i]];
      if (!n) return kopya;
    }
    if (n.c) delete n.c[parcalar[parcalar.length - 1]];
    return kopya;
  }

  /**
   * Yedeği geri yükler.
   * @param {object} paket
   * @param {{kip?: 'birlestir'|'degistir'}} [o]
   *   birlestir — yedekteki dosyalar eklenir, var olanların üzerine yazılır
   *   degistir  — disk tamamen yedekteki hâle döner
   * @returns {{dosya:number, klasor:number}}
   */
  import(paket, o = {}) {
    if (!paket || paket.bicim !== 'openos-backup') throw new Error('Bu bir OpenOS yedeği değil');
    if (paket.surum !== 1) throw new Error(`Desteklenmeyen yedek sürümü: ${paket.surum}`);
    if (!paket.agac || paket.agac.t !== 'd') throw new Error('Yedek bozuk: ağaç yok');

    if (o.kip === 'degistir') {
      this.root = JSON.parse(JSON.stringify(paket.agac));
      this.persist();
      this._touch('/', 'import');
      const k = this.usage();
      return { dosya: k.files, klasor: k.dirs };
    }

    let dosya = 0, klasor = 0;
    const gez = (node, yol) => {
      for (const ad in (node.c || {})) {
        const c = node.c[ad];
        const p = VFS.join(yol, ad);
        if (c.t === 'd') { this.mkdir(p); klasor++; gez(c, p); }
        else { this.write(p, c.b || '', c.meta); dosya++; }
      }
    };
    gez(paket.agac, '/');
    this.persist();
    this._touch('/', 'import');
    return { dosya, klasor };
  }

  /* ---------------- çöp kutusu ----------------
     Silmek geri alınamazdı: `remove()` düğümü ağaçtan çıkarıyor, gidiyordu.
     Gerçek bir işletim sistemi gibi, kullanıcı eliyle yapılan silmeler önce
     çöp kutusuna taşınır; kalıcı silme ayrı ve açıkça istenen bir iştir. */

  get trashDir() { return VFS.join(this.home, '.Trash'); }
  get trashIndex() { return VFS.join(this.trashDir, '.index.json'); }

  /** Çöpteki kayıtlar: nereden geldiği, ne zaman atıldığı. */
  trashList() {
    const kayitlar = this.readJSON(this.trashIndex, []) || [];
    /* Dosyası elle silinmiş kayıtlar listede kalmasın. */
    return kayitlar.filter(k => this.exists(VFS.join(this.trashDir, k.saklanan)));
  }

  _trashWrite(kayitlar) {
    this.mkdir(this.trashDir);
    this.writeJSON(this.trashIndex, kayitlar);
  }

  /**
   * Bir yolu çöp kutusuna taşır.
   * @returns {{id:string, ad:string, eskiYol:string}} geri yükleme kaydı
   */
  trash(path) {
    const n = VFS.norm(path);
    if (n === '/') throw new Error('Kök silinemez');
    if (n === this.trashDir || n.startsWith(this.trashDir + '/')) {
      /* Çöpün içindekini çöpe atmak anlamsız: kalıcı sil. */
      return this.remove(n) && null;
    }
    const st = this.stat(n);
    if (!st) throw new Error(`Yok: ${path}`);

    this.mkdir(this.trashDir);
    const id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const saklanan = id + '-' + VFS.basename(n);
    this.move(n, VFS.join(this.trashDir, saklanan));

    const kayit = {
      id, saklanan, ad: st.name, eskiYol: n, tur: st.type,
      boyut: st.size || 0, atildi: now(),
    };
    const kayitlar = this.trashList();
    kayitlar.unshift(kayit);
    this._trashWrite(kayitlar);
    this._touch(n, 'trash');
    return kayit;
  }

  /**
   * Çöpten geri yükler. Eski yerinde aynı adla bir şey varsa yanına
   * benzersiz bir adla konur — sessizce üzerine yazmak veri kaybettirir.
   * @returns {string} geri yüklendiği yol
   */
  restore(id) {
    const kayitlar = this.trashList();
    const k = kayitlar.find(x => x.id === id);
    if (!k) throw new Error('Çöpte böyle bir öğe yok');
    const kaynak = VFS.join(this.trashDir, k.saklanan);
    if (!this.exists(kaynak)) throw new Error('Çöpteki dosya bulunamadı');

    this.mkdir(VFS.dirname(k.eskiYol));
    const hedef = this.unique(k.eskiYol);
    this.move(kaynak, hedef);
    this._trashWrite(kayitlar.filter(x => x.id !== id));
    this._touch(hedef, 'restore');
    return hedef;
  }

  /** Tek bir öğeyi kalıcı siler. */
  trashPurge(id) {
    const kayitlar = this.trashList();
    const k = kayitlar.find(x => x.id === id);
    if (!k) return false;
    try { this.remove(VFS.join(this.trashDir, k.saklanan)); } catch {}
    this._trashWrite(kayitlar.filter(x => x.id !== id));
    return true;
  }

  /** Çöpü boşaltır. @returns {number} silinen öğe sayısı */
  emptyTrash() {
    const kayitlar = this.trashList();
    for (const k of kayitlar) {
      try { this.remove(VFS.join(this.trashDir, k.saklanan)); } catch {}
    }
    this._trashWrite([]);
    this._touch(this.trashDir, 'trash-empty');
    return kayitlar.length;
  }

  /** Çöpteki toplam boyut — Dock ve Depolama bunu gösterir. */
  trashUsage() {
    let bayt = 0;
    for (const k of this.trashList()) {
      const y = VFS.join(this.trashDir, k.saklanan);
      try { this.walk(y, st => { if (st.type === 'file') bayt += st.size || 0; }); } catch {}
      if (k.tur === 'file') { const st = this.stat(y); if (st) bayt += st.size || 0; }
    }
    return { adet: this.trashList().length, bayt };
  }

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
