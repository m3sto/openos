/* ==========================================================================
   OpenOS · kernel.js — session lifecycle, app launching, the shell glue
   ========================================================================== */

import { h, clear, on, sleep, Bus, fmtTime } from './util.js';
import { icon } from './icons.js';
import vfs, { VFS } from './vfs.js';
import settings from './settings.js';
import registry from './registry.js';
import notify from './notify.js';
import wm from '../ui/window.js';
import { Desktop } from '../ui/desktop.js';
import { menu } from '../ui/menu.js';
import { upgradeScrollers } from '../ui/scroller.js';
import { installTextControls } from '../ui/textfield.js';
import { openFile, saveFile } from '../ui/filedialog.js';
import { boot as bootSplash, powerVeil } from '../boot/splash.js';
import { runSetup } from '../boot/setup.js';
import { seedFilesystem, ensureTree } from './seed.js';
import { thumb } from '../wallpapers/generator.js';
import { COMPONENT_NAMES } from '../lang/runtime.js';

export const VERSION = '1.0.0';
export const CODENAME = 'Meridian';

const EXT_APP = {
  osh: 'studio', txt: 'texteditor', md: 'texteditor', json: 'texteditor',
  js: 'texteditor', csv: 'texteditor', log: 'texteditor',
  png: 'photos', jpg: 'photos', jpeg: 'photos', svg: 'photos', gif: 'photos',
  mp3: 'music', wav: 'music', html: 'browser',
};

export class Kernel {
  constructor() {
    this.bus = new Bus();
    this.wm = wm;
    this.vfs = vfs;
    this.settings = settings;
    this.registry = registry;
    this.notify = notify;
    this.recent = [];
    this.locked = false;
    this.battery = { level: 0.87, charging: true };
    this.bootedAt = Date.now();
  }

  /* ==================== boot ==================== */
  async start(stage) {
    this.stage = stage;
    settings.load();
    const hadFs = vfs.load();
    settings.apply();

    const firstRun = settings.get('firstRun') || !hadFs;
    const user = settings.get('user.name') || 'user';
    vfs.home = VFS.join('/Users', slug(user));

    await bootSplash(stage, {
      platform: navigator.platform || 'web',
      cores: navigator.hardwareConcurrency || 4,
      mem: (navigator.deviceMemory ? navigator.deviceMemory + ' GB' : '4 GB'),
      screen: `${screen.width}×${screen.height}`,
      dpr: (devicePixelRatio || 1).toFixed(1),
      accent: settings.get('accent'),
      locale: settings.get('locale'),
      ssid: settings.get('network.ssid'),
      components: COMPONENT_NAMES.length,
      apps: registry.visible().slice(0, 10).map(a => a.id),
      firstRun,
      user: slug(user),
    });

    if (firstRun) {
      const cfg = await runSetup(stage);
      settings.patch({
        firstRun: false, locale: cfg.locale, region: cfg.region, h12: cfg.h12,
        theme: cfg.theme, accent: cfg.accent, wallpaper: cfg.wallpaper,
        user: { name: cfg.name, avatar: cfg.avatar, password: cfg.password },
        agent: { ...settings.get('agent'), enabled: cfg.agent },
      });
      settings.persist();
      seedFilesystem(slug(cfg.name));
    } else {
      ensureTree(slug(settings.get('user.name')));
    }

    this.mountDesktop();
    this.bindShortcuts();
    this.bindContextMenu();
    this.startClocks();
    this.loadUserApps();

    this.bus.emit('ready');
    setTimeout(() => {
      notify.post({
        title: `OpenOS ${VERSION} “${CODENAME}”`,
        body: firstRun ? 'Kurulum tamamlandı. İyi çalışmalar!' : `Tekrar hoş geldiniz, ${settings.get('user.name')}.`,
        glyph: 'logo', tint: ['#5ac8fa', '#0a84ff'], timeout: 6000,
      });
    }, 900);
    if (firstRun) setTimeout(() => this.openApp('welcome'), 1600);
  }

  mountDesktop() {
    this.desktop?.destroy();
    this.desktop = new Desktop(this);
    this.desktop.mount(this.stage);
    /* Sistemin kendi kaydırma çubukları: sahnedeki her kaydırılabilir alan
       yükseltilir, sonradan açılan pencereler de izlenerek yakalanır. */
    upgradeScrollers(this.stage);
    /* Sistemdeki her metin alanı — uygulamaların kendi yazdıkları dahil —
       düzenleme bağlam menüsünü kazanır. */
    installTextControls(document);
    this.playHomeEntrance();
  }

  /** The iOS-style entrance: the shell drops in from above and springs into place. */
  playHomeEntrance() {
    const el = this.desktop?.el;
    if (!el || settings.get('system.reduceMotion')) return;
    el.classList.remove('home-in');
    void el.offsetWidth;
    el.classList.add('home-in');
    setTimeout(() => el.classList.remove('home-in'), 1600);
  }

  /**
   * Pil durumu. Cihazda gerçek bir batarya varsa Battery Status API'sinden
   * okunur ve olaylarla canlı kalır; yoksa makine prize takılı bir masaüstü
   * kabul edilir ve göstergede fiş simgesi çıkar.
   */
  async startClocks() {
    clearInterval(this._batt);
    this.battery = { level: 1, charging: true, present: false, source: 'ac' };

    if (navigator.getBattery) {
      try {
        const b = await navigator.getBattery();
        /* Bataryası olmayan masaüstlerinde tarayıcı %100 + şarjda bildirir ve
           kalan süreler sonsuzdur — gerçek bir pilden böyle ayrılır. */
        const looksLikeDesktop = b.charging && b.level === 1 &&
          b.chargingTime === 0 && b.dischargingTime === Infinity;
        const sync = () => {
          this.battery = {
            level: b.level, charging: b.charging, present: !looksLikeDesktop,
            source: looksLikeDesktop ? 'ac' : 'battery',
            dischargingTime: b.dischargingTime, chargingTime: b.chargingTime,
          };
          this.bus.emit('battery', this.battery);
          this.desktop?.menubar?.renderRight();
        };
        ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange']
          .forEach(ev => b.addEventListener(ev, sync));
        sync();
        return;
      } catch { /* izin verilmedi ya da desteklenmiyor */ }
    }
    this.bus.emit('battery', this.battery);
  }

  /* ==================== apps ==================== */
  openApp(id, args = {}, forceNew = false) {
    const app = registry.get(id);
    if (!app) { notify.toast(`Uygulama bulunamadı: ${id}`, { glyph: '⚠️' }); return null; }
    this.recent = [app.id, ...this.recent.filter(x => x !== app.id)].slice(0, 6);
    const win = wm.open(forceNew ? { ...app, singleton: false } : app, { args });
    if (!win.__mounted) {
      win.__mounted = true;
      try {
        const api = this.appContext(win, app);
        const res = app.mount?.(api);
        if (res instanceof Node) win.body.appendChild(res);
        if (res && res.el) win.body.appendChild(res.el);
        if (res && res.onClose) win.onClosed = res.onClose;
        if (res && res.menus) win.menus = res.menus;
      } catch (e) {
        console.error(`[app:${id}]`, e);
        win.body.appendChild(h('div', { style: { padding: '20px', color: 'var(--red)', fontFamily: 'var(--mono)' },
          text: `Uygulama açılamadı:\n${e.message}` }));
      }
    } else if (win.onArgs) win.onArgs(args);
    this.bus.emit('app:open', app, win);
    return win;
  }

  appContext(win, app) {
    return {
      win, app, os: this, args: win.args || {},
      vfs, settings, registry, notify, wm,
      body: win.body,
      setTitle: t => win.setTitle(t),
      close: () => win.close(),
      openApp: (id, a, n) => this.openApp(id, a, n),
      openPath: p => this.openPath(p),
      /* Sistem dosya kutuları. Pencere kendiliğinden bağlanır, böylece kutu
         hangi uygulamanın dosya istediğini gösteren bir sayfa olarak iner. */
      openFile: (o = {}) => openFile({ win, ...o }),
      saveFile: (o = {}) => saveFile({ win, ...o }),
      version: VERSION, codename: CODENAME,
    };
  }

  /** Open a filesystem path with whatever app handles it. */
  openPath(path) {
    const s = vfs.stat(path);
    if (!s) { notify.toast('Dosya bulunamadı', { glyph: '⚠️' }); return; }
    if (s.type === 'dir') return this.openApp('finder', { path });
    if (s.ext === 'osh') {
      const installed = registry.all().find(a => a.source === path);
      if (installed) return this.openApp(installed.id);
      return this.openApp('studio', { path, run: true });
    }
    return this.openApp(EXT_APP[s.ext] || 'texteditor', { path });
  }

  trash(path) {
    const trashDir = VFS.join(vfs.home, '.Trash');
    vfs.mkdir(trashDir);
    const dest = vfs.unique(VFS.join(trashDir, VFS.basename(path)));
    vfs.move(path, dest);
    notify.toast('Çöp kutusuna taşındı', { glyph: '🗑️' });
  }

  recentApps() { return this.recent.map(id => registry.get(id)).filter(Boolean); }

  /* ---------- OpenSharp app installation ---------- */
  loadUserApps() {
    const dir = '/Applications';
    let list = [];
    try { list = vfs.list(dir); } catch { return; }
    for (const f of list) {
      if (f.ext !== 'osh') continue;
      try { this.installApp(f.path, { silent: true }); } catch (e) { console.warn('[apps]', e); }
    }
  }

  /** Register a .osh file in the VFS as a launchable application. */
  installApp(path, { silent = false } = {}) {
    const src = vfs.read(path);
    const meta = parseAppHeader(src);
    const id = meta.id || 'osh_' + slug(meta.name || VFS.basename(path).replace(/\.osh$/, ''));
    const app = registry.register({
      id, name: meta.name || VFS.basename(path), glyph: meta.icon || 'sparkles',
      tint: meta.tint || ['#5e5ce6', '#bf5af2'],
      category: 'user', kind: 'opensharp', source: path,
      width: meta.width || 480, height: meta.height || 420,
      about: `OpenSharp uygulaması · ${path}`,
      mount: (ctx) => this.mountOshApp(ctx, path),
    });
    if (!silent) notify.post({ title: 'Uygulama kuruldu', body: app.name, glyph: 'package', tint: app.tint });
    this.bus.emit('app:install', app);
    return app;
  }

  mountOshApp(ctx, path) {
    const host = h('div', { style: { position: 'relative', flex: '1', minWidth: 0, display: 'flex' } });
    const inner = h('div', { style: { flex: '1', minWidth: 0, position: 'relative', overflow: 'auto' } });
    host.appendChild(inner);
    import('../lang/oshapp.js').then(({ OshApp }) => {
      const runner = new OshApp({
        container: inner, appId: ctx.app.id, name: ctx.app.name, tint: ctx.app.tint,
        cwd: VFS.dirname(path), osVersion: VERSION,
        setTitle: t => ctx.setTitle(t),
        close: () => ctx.close(),
        openApp: (id, a) => this.openApp(id, a),
        onPrint: s => console.log(`[${ctx.app.id}]`, s),
      });
      runner.start(vfs.read(path));
      ctx.win.onClosed = () => runner.destroy();
      ctx.win.onArgs = () => runner.start(vfs.read(path));
    });
    return host;
  }

  async uninstallApp(id) {
    const app = registry.get(id);
    if (!app || app.kind !== 'opensharp') return;
    const ok = await notify.confirm(`${app.name} kaldırılsın mı?`, { title: 'Uygulamayı Kaldır', danger: true, ok: 'Kaldır' });
    if (!ok) return;
    wm.closeAll(id);
    registry.unregister(id);
    if (app.source && vfs.exists(app.source)) vfs.remove(app.source);
    settings.set('pinned', (settings.get('pinned') || []).filter(p => p !== id));
    notify.toast('Uygulama kaldırıldı', { glyph: '🗑️' });
  }

  /* ==================== shell overlays ==================== */
  toggleLaunchpad() { this.desktop?.toggleLaunchpad(); }
  toggleSpotlight() { this.desktop?.toggleSpotlight(); }
  toggleMission() { this.desktop?.toggleMission(); }
  openControlCenter() { this.desktop?.openControlCenter(); }

  /* ==================== power ==================== */
  async lock() {
    if (this.locked) return;
    this.locked = true;
    const user = settings.get('user');
    const pass = user.password || '';
    const wall = thumb(settings.get('wallpaper'), 1280, 800);

    const input = h('input', { type: 'password', placeholder: pass ? 'Şifre' : 'Enter’a basın' });
    const field = h('div.lock-field', input, h('span', { html: icon('arrowR', 14), style: { opacity: .7 } }));
    const clock = h('div.lock-clock', h('div.t'), h('div.d'));
    const card = h('div.lock-card',
      h('div.k-avatar', { text: user.avatar || '🙂' }),
      h('div.lock-name', { text: user.name }),
      field,
      h('div.lock-hint', { text: pass ? 'Şifrenizi girin' : 'Kilidi açmak için Enter' }));
    const layer = h('div.lock', { style: { backgroundImage: `url(${wall})` } }, clock, card);
    this.stage.appendChild(layer);

    const upd = () => {
      const d = new Date();
      clock.querySelector('.t').textContent = fmtTime(d, { h12: settings.get('h12') });
      clock.querySelector('.d').textContent = d.toLocaleDateString(settings.get('locale'),
        { weekday: 'long', day: 'numeric', month: 'long' });
    };
    upd();
    const tick = setInterval(upd, 1000);

    const tryUnlock = () => {
      if (pass && input.value !== pass) {
        card.classList.add('shake');
        setTimeout(() => card.classList.remove('shake'), 520);
        input.value = '';
        return;
      }
      clearInterval(tick);
      layer.classList.add('unlocking');
      this.playHomeEntrance();
      setTimeout(() => { layer.remove(); this.locked = false; }, 640);
      this.bus.emit('unlock');
    };
    on(input, 'keydown', e => { if (e.key === 'Enter') tryUnlock(); });
    setTimeout(() => input.focus(), 100);
  }

  async shutdown() {
    const ok = await notify.confirm('Bilgisayarınızı şimdi kapatmak istediğinizden emin misiniz?',
      { title: 'Kapat', glyph: '⏻', ok: 'Kapat', danger: true });
    if (!ok) return;
    vfs.persist(); settings.persist();
    await powerVeil(this.stage, 'shutdown');
    clear(this.stage);
    document.documentElement.style.background = '#000';
    document.body.style.background = '#000';
    /* Nothing else. A powered-off machine shows a black screen. */
    this.stage.appendChild(h('div', {
      style: { position: 'absolute', inset: 0, background: '#000' },
    }));
    this.poweredOff = true;
  }

  async restart() {
    const ok = await notify.confirm('Sistem yeniden başlatılsın mı?',
      { title: 'Yeniden Başlat', glyph: '↻', ok: 'Yeniden Başlat' });
    if (!ok) return;
    vfs.persist(); settings.persist();
    await powerVeil(this.stage, 'restart');
    location.reload();
  }

  async factoryReset() {
    const ok = await notify.confirm('Tüm dosyalar, ayarlar ve uygulamalar silinecek. Bu geri alınamaz.',
      { title: 'Fabrika Ayarlarına Dön', glyph: '⚠️', ok: 'Her şeyi sil', danger: true });
    if (!ok) return;
    this.resetting = true;
    localStorage.removeItem('openos.fs.v1');
    localStorage.removeItem('openos.settings.v1');
    localStorage.removeItem('openos.term.history');
    location.reload();
  }

  /* ==================== context menus ====================
     The host browser's own menu never appears. Every surface either supplies
     its own menu (via ui/menu.js contextMenu) or falls through to these. */
  bindContextMenu() {
    on(window, 'contextmenu', e => {
      e.preventDefault();
      const t = e.target;
      const editable = t.matches?.('input, textarea, [contenteditable="true"]');
      const sel = String(window.getSelection() || '');

      if (editable) return menu(this.editMenu(t, sel), { x: e.clientX, y: e.clientY });
      if (sel.trim()) return menu(this.selectionMenu(sel), { x: e.clientX, y: e.clientY });
      menu(this.shellMenu(), { x: e.clientX, y: e.clientY });
    });

    /* Suppress drag-and-drop of page content and the selection cursor. */
    on(window, 'dragstart', e => {
      if (!e.target.closest?.('[draggable="true"]')) e.preventDefault();
    });
    on(window, 'selectstart', e => {
      if (!e.target.closest?.('.selectable, input, textarea, [contenteditable="true"]')) e.preventDefault();
    });
  }

  editMenu(field, sel) {
    const hasSel = field.selectionStart !== field.selectionEnd;
    const doc = (cmd) => { field.focus(); document.execCommand(cmd); };
    return [
      { label: 'Geri Al', key: '⌘Z', glyph: 'arrowL', run: () => doc('undo') },
      '-',
      { label: 'Kes', key: '⌘X', glyph: 'send', disabled: !hasSel, run: () => doc('cut') },
      { label: 'Kopyala', key: '⌘C', glyph: 'copy', disabled: !hasSel, run: () => doc('copy') },
      { label: 'Yapıştır', key: '⌘V', glyph: 'download', run: async () => {
        try {
          const text = await navigator.clipboard.readText();
          const s = field.selectionStart, e2 = field.selectionEnd;
          field.value = field.value.slice(0, s) + text + field.value.slice(e2);
          field.selectionStart = field.selectionEnd = s + text.length;
          field.dispatchEvent(new Event('input', { bubbles: true }));
        } catch { notify.toast('Pano erişimi reddedildi — ⌘V kullanın', { glyph: '📋' }); }
      } },
      { label: 'Tümünü Seç', key: '⌘A', glyph: 'list', run: () => { field.focus(); field.select(); } },
      ...(sel.trim() ? ['-', { label: `Spotlight’ta ara: “${clip(sel)}”`, glyph: 'search',
        run: () => { this.toggleSpotlight(); this.desktop?.fillSpotlight?.(sel); } }] : []),
    ];
  }

  selectionMenu(sel) {
    return [
      { label: 'Kopyala', key: '⌘C', glyph: 'copy',
        run: () => navigator.clipboard?.writeText(sel).then(() => notify.toast('Kopyalandı', { glyph: '📋' })) },
      '-',
      { label: `Spotlight’ta ara: “${clip(sel)}”`, glyph: 'search',
        run: () => { this.toggleSpotlight(); this.desktop?.fillSpotlight?.(sel); } },
      { label: 'Web’de ara', glyph: 'globe', run: () => this.openApp('browser', { query: sel.slice(0, 200) }) },
      { label: 'Yeni notta aç', glyph: 'note', run: () => {
        const p = vfs.unique(VFS.join(vfs.home, 'Belgeler/Notlar', 'Alıntı.txt'));
        vfs.write(p, sel);
        this.openApp('notes');
      } },
    ];
  }

  shellMenu() {
    return [
      { label: 'Spotlight', glyph: 'search', key: '⌘Space', run: () => this.toggleSpotlight() },
      { label: 'Launchpad', glyph: 'grid', key: 'F4', run: () => this.toggleLaunchpad() },
      { label: 'Mission Control', glyph: 'layers', key: 'F3', run: () => this.toggleMission() },
      '-',
      { label: 'Yeni Terminal', glyph: 'terminal', run: () => this.openApp('terminal', {}, true) },
      { label: 'Finder', glyph: 'folder', run: () => this.openApp('finder') },
      '-',
      { label: settings.isDark ? 'Açık Görünüm' : 'Koyu Görünüm', glyph: settings.isDark ? 'sun' : 'moon',
        run: () => settings.set('theme', settings.isDark ? 'light' : 'dark') },
      { label: 'Sistem Ayarları…', glyph: 'settings', key: '⌘,', run: () => this.openApp('settings') },
      '-',
      { label: 'Ekranı Kilitle', glyph: 'lock', run: () => this.lock() },
    ];
  }

  /* ==================== keyboard ==================== */
  bindShortcuts() {
    on(window, 'keydown', e => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();

      if (e.key === 'F4') { e.preventDefault(); return this.toggleLaunchpad(); }
      if (e.key === 'F3') { e.preventDefault(); return this.toggleMission(); }
      if (e.key === 'Escape') { this.desktop?.closeAllOverlays(); return; }

      if (mod && e.code === 'Space') { e.preventDefault(); return this.toggleSpotlight(); }
      if (!mod) return;

      const win = wm.focused;
      switch (k) {
        case 'w': if (win) { e.preventDefault(); win.close(); } break;
        case 'm': if (win) { e.preventDefault(); win.minimize(); } break;
        case ',': e.preventDefault(); this.openApp('settings'); break;
        case 'q': if (win && e.shiftKey) { e.preventDefault(); wm.closeAll(win.app.id); } break;
        case '`': e.preventDefault(); wm.cycle(e.shiftKey); break;
        case 'f': if (e.ctrlKey && win) { e.preventDefault(); win.fullscreen(); } break;
        case 'l': if (e.ctrlKey) { e.preventDefault(); this.lock(); } break;
        default: break;
      }
      if (mod && e.key === 'Tab') { e.preventDefault(); wm.cycle(e.shiftKey); }
    }, true);

    on(window, 'beforeunload', () => {
      if (this.resetting) return;
      vfs.persist(); settings.persist();
    });
  }
}

/* ---------------- helpers ---------------- */
const clip = (s, n = 22) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

export function slug(s) {
  return String(s || 'user').toLowerCase()
    .replace(/[ıİ]/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'user';
}

/** Reads the `app { ... }` header of a .osh file without running it. */
export function parseAppHeader(src) {
  const m = src.match(/app\s*\{([\s\S]*?)\}/);
  if (!m) return {};
  const out = {};
  const body = m[1];
  const re = /(\w+)\s*:\s*(".*?"|\[.*?\]|[-\d.]+|true|false)/g;
  let r;
  while ((r = re.exec(body))) {
    const key = r[1];
    let v = r[2];
    if (v.startsWith('"')) v = v.slice(1, -1);
    else if (v.startsWith('[')) { try { v = JSON.parse(v.replace(/'/g, '"')); } catch { v = undefined; } }
    else if (v === 'true') v = true;
    else if (v === 'false') v = false;
    else v = parseFloat(v);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export const kernel = new Kernel();
export default kernel;
