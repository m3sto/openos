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
import { paketOku, paketMi } from '../lang/package.js';
import clipboard from './clipboard.js';
import vault from './vault.js';
import pkg from './pkgmanager.js';
import permissions from './permissions.js';
import { toggleShortcuts, closeShortcuts } from '../ui/shortcuts.js';
import { boot as bootSplash, powerVeil } from '../boot/splash.js';
import { runSetup } from '../boot/setup.js';
import { makineEkrani } from '../boot/machine.js';
import services from './services.js';
import sesler from './sounds.js';
import { alarmServisiniKur } from '../services/alarms.js';
import { seedFilesystem, ensureTree, seedGuide, KILAVUZ_YOLU } from './seed.js';
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

/* Gezilmek yerine indirilmesi gereken uzantılar. */
const INDIRILEBILIR = /\.(zip|7z|rar|tar|gz|tgz|bz2|xz|exe|msi|dmg|pkg|deb|rpm|apk|iso|img|bin|jar|pdf|docx?|xlsx?|pptx?|odt|ods|epub|mobi|mp3|wav|flac|ogg|m4a|mp4|mkv|avi|mov|webm|psd|ai|ttf|otf|woff2?|osapp)$/i;

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

    /* Sistem doğrudan açılmıyor: önce hangi diskle açılacağı soruluyor.
       Klasör izni kullanıcı hareketi gerektiriyor ve o hareketin yeri burası —
       açılış görüntüsü başladıktan sonra izin istemek mümkün değil. */
    const { depo } = await makineEkrani(stage);
    if (depo) {
      vfs.bagla(depo);
      this.disk = depo;
    }

    /* Disk şifreli; açılması anahtarın çözülmesini bekler. */
    const hadFs = await vfs.load();
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
    this.wirePackageManager();
    /* Dil kılavuzu dosya sistemine alınır: `cat` ile okunabilsin, metin
       düzenleyicide açılabilsin. Ağ olmadığında sessizce atlanır. */
    seedGuide();
    this.loadUserApps();

    this.bus.emit('ready');
    /* Disk şifresiz yazılmaya başladıysa kullanıcı bunu bilmeli. */
    /* Diske yazılamıyorsa bu, kullanıcının bilmesi gereken en önemli şey:
       o andan sonra yaptığı her şey uçucu. */
    vfs.bus.on('yazilamadi', h => notify.post({
      title: h.kota ? 'Disk dolu — değişiklikler kaydedilmiyor' : 'Diske yazılamıyor',
      body: h.kota
        ? 'Tarayıcının depolama alanı doldu. Çöp kutusunu boşaltın ya da büyük dosyaları silin; o zamana dek yaptığınız değişiklikler kalıcı olmayacak.'
        : `Değişiklikler kaydedilemiyor: ${h.ileti}`,
      glyph: 'alert', timeout: 0,
      actions: [{ label: 'Depolama’yı aç', run: () => this.openApp('storage') }],
    }));

    vfs.bus.on('sifresiz', durum => notify.post({
      title: 'Disk şifrelenemiyor',
      body: (durum?.ileti || 'Anahtar kasası açılamadı.') + ' Veriler şifresiz saklanıyor.',
      glyph: 'unlock', timeout: 0,
      actions: [{ label: 'Depolama’yı aç', run: () => this.openApp('storage') }],
    }));

    if (vfs.kasaHatasi === 'cozulemedi') {
      setTimeout(() => notify.post({
        title: 'Disk çözülemedi',
        body: 'Saklanan veri bu cihazın anahtarıyla açılamıyor — kurcalanmış ya da anahtar değişmiş olabilir. Sistem boş bir diskle açıldı; eski veri silinmedi.',
        glyph: 'alert', timeout: 0,
      }), 1400);
    }
    setTimeout(() => {
      notify.post({
        title: `OpenOS ${VERSION} “${CODENAME}”`,
        body: firstRun ? 'Kurulum tamamlandı. İyi çalışmalar!' : `Tekrar hoş geldiniz, ${settings.get('user.name')}.`,
        glyph: 'logo', tint: ['#5ac8fa', '#0a84ff'], timeout: 6000,
      });
    }, 900);
    if (firstRun) setTimeout(() => this.openApp('welcome'), 1600);
  }

  /** Paket yöneticisi kurulum için çekirdeğe ihtiyaç duyar. */
  wirePackageManager() { pkg.kernel = this; this.pkg = pkg; }

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
    /* Sistemin kendi panosu: kopyalanan şey OpenOS'ta kalır, ana
       bilgisayarın panosundan da içeri bir şey sızmaz. */
    clipboard.install(document);
    /* Hiçbir bağlantı OpenOS'un dışına çıkmaz. */
    this.baglantilariYakala();
    /* Sistem sesleri: bağlam kullanıcının ilk dokunuşunda kuruluyor. */
    sesler.install(document);
    this.seslariBagla();
    /* Arka plan servisleri: pencereler kapalıyken de çalışan işler. */
    this.servisleriKur();
    this.playHomeEntrance();
  }

  /**
   * Arka plan servislerini kurar ve çalıştırır.
   *
   * Servisler uygulamalardan bağımsız: Saat penceresi kapalıyken de alarm
   * çalmalı. Uygulama listeyi gösteriyor, servis saate bakıp bildirimi
   * düşürüyor.
   */
  servisleriKur() {
    alarmServisiniKur();
    services.start();
    this.services = services;
  }

  /** Sistem olaylarını seslere bağlar. */
  seslariBagla() {
    if (this._seslerBagli) return;
    this._seslerBagli = true;
    wm.bus.on('open',     () => sesler.cal('ac'));
    wm.bus.on('close',    () => sesler.cal('kapat'));
    wm.bus.on('minimize', () => sesler.cal('kucult'));
    wm.bus.on('state',    w => sesler.cal(w.state === 'normal' ? 'kucult' : 'buyult'));
    notify.bus?.on?.('post', n => sesler.cal(n?.glyph === 'alert' ? 'uyari' : 'bildirim'));
    vfs.bus?.on?.('trash', () => sesler.cal('cop'));
  }

  /**
   * Sistem içindeki her bağlantıyı yakalar ve OpenBrow'a yönlendirir.
   *
   * OpenOS'un kendisi bir web sayfası, dolayısıyla belgesinde duran sıradan
   * bir `<a href="https://…">` tıklandığında ana tarayıcı ya sayfadan çıkıyor
   * ya da yeni bir sekme açıyordu — kullanıcı OpenBrow'da gezindiğini sanırken
   * aslında sistemin dışına atılıyordu. İndirilebilir bir bağlantıda ise
   * indirme OpenOS'un sanal diskine değil ana bilgisayarın diskine gidiyordu.
   *
   * Bu, tek tek uygulamalarda düzeltilebilecek bir hata değil: Markdown
   * çizici, README görüntüleyici, yardım sayfaları ve sonradan yazılacak her
   * OpenSharp uygulaması aynı tuzağa düşebilir. Bu yüzden kural sistemin
   * kendisinde: köke yakalama aşamasında bağlanır, uygulamaların bir şey
   * yapmasına gerek kalmaz.
   *
   * Dokunulmayanlar: sayfa içi çapalar, `mailto:`/`tel:`, ve `download`
   * özniteliği taşıyan `blob:`/`data:` bağlantıları — sonuncusu sistemin
   * kendi dışa aktarma yolu (Depolama › Yedek al) ve çalışmaya devam etmeli.
   */
  baglantilariYakala() {
    if (this._baglantiYakalayici) return;
    this._baglantiYakalayici = (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = e.target?.closest?.('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('#')) return;
      if (/^(mailto:|tel:)/i.test(href)) return;
      /* Sistemin kendi dosya dışa aktarması: olduğu gibi bırakılır. */
      if (/^(blob:|data:)/i.test(href) && a.hasAttribute('download')) return;

      e.preventDefault();
      e.stopPropagation();

      let mutlak = href;
      try { mutlak = new URL(href, location.href).href; } catch {}

      /* İndirilebilir görünen bağlantı OpenBrow'un indiricisine gider ve
         dosya sanal diske iner; geri kalanı sekmede açılır. */
      const indirme = a.hasAttribute('download') || INDIRILEBILIR.test(mutlak.split('?')[0]);
      this.openApp('browser', indirme
        ? { indir: mutlak, ad: a.getAttribute('download') || '' }
        : { url: mutlak, newTab: true });
    };
    document.addEventListener('click', this._baglantiYakalayici, true);
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

  /**
   * Çöp kutusuna atar. Eski sürüm dosyayı taşıyor ama nereden geldiğini
   * kaydetmiyordu; çöpteki bir şeyi geri koymanın yolu yoktu. Artık kayıt
   * tutuluyor ve bildirimden tek tıkla geri alınabiliyor.
   */
  trash(path) {
    let kayit;
    try { kayit = vfs.trash(path); }
    catch (e) { notify.toast(e.message, { glyph: '⚠️' }); return null; }
    if (!kayit) { notify.toast('Kalıcı olarak silindi', { glyph: '🗑️' }); return null; }

    notify.post({
      title: 'Çöp kutusuna taşındı',
      body: kayit.ad,
      glyph: 'trash',
      timeout: 6000,
      actions: [{ label: 'Geri al', run: () => {
        try {
          const yer = vfs.restore(kayit.id);
          notify.toast(`Geri yüklendi: ${VFS.basename(yer)}`, { glyph: '↩️' });
          this.bus.emit('fs:restored', yer);
        } catch (e) { notify.toast(e.message, { glyph: '⚠️' }); }
      } }],
    });
    return kayit;
  }

  /** Çöpü boşaltır — onay ister, geri dönüşü yoktur. */
  async emptyTrash() {
    const { adet } = vfs.trashUsage();
    if (!adet) { notify.toast('Çöp kutusu zaten boş', { glyph: '🗑️' }); return false; }
    const ok = await notify.confirm(
      `${adet} öğe kalıcı olarak silinecek. Bu işlem geri alınamaz.`,
      { title: 'Çöp Kutusunu Boşalt', ok: 'Boşalt', danger: true });
    if (!ok) return false;
    const n = vfs.emptyTrash();
    notify.toast(`${n} öğe silindi`, { glyph: '🗑️' });
    this.bus.emit('fs:trash');
    return true;
  }

  /**
   * Bir uygulamanın açık pencerelerini kapatır. Ajan arayüzünde vardı ama
   * çekirdekte yoktu; iç kod bu yüzden `wm.closeAll` ile dolaşıyordu.
   * @param {boolean} [zorla] kapanış onayını atla (görev yöneticisi gibi)
   */
  closeApp(id, { zorla = false } = {}) {
    const pencereler = wm.byApp(id);
    for (const w of pencereler) {
      if (zorla) w.onBeforeClose = null;
      w.close();
    }
    return pencereler.length;
  }

  recentApps() { return this.recent.map(id => registry.get(id)).filter(Boolean); }

  /* ---------- OpenSharp app installation ---------- */
  loadUserApps() {
    const dir = '/Applications';
    let list = [];
    try { list = vfs.list(dir); } catch { return; }
    for (const f of list) {
      /* Tek dosyalık .osh de, simgesi ve manifesti olan .osapp paketi de
         kurulabilir; ikisi de burada aynı kapıdan geçer. */
      const paket = f.type === 'dir' && paketMi(f.path);
      if (!paket && f.ext !== 'osh') continue;
      try { this.installApp(f.path, { silent: true }); } catch (e) { console.warn('[apps]', e); }
    }
  }

  /** Register a .osh file in the VFS as a launchable application. */
  installApp(path, { silent = false } = {}) {
    /* Paket ise kimlik manifestten gelir — kaynağın başlığından tahmin
       etmekten çok daha güvenilir; simge de paketin içinden çıkar. */
    const paket = paketOku(path);
    const kaynakYolu = paket ? paket.girisYolu : path;
    const src = paket ? paket.kaynak : vfs.read(path);
    const meta = paket ? paket.manifest : parseAppHeader(src);
    const id = meta.id || 'osh_' + slug(meta.name || VFS.basename(path).replace(/\.osh$/, ''));
    const app = registry.register({
      id, name: meta.name || VFS.basename(path), glyph: meta.icon || 'sparkles',
      tint: meta.tint || ['#5e5ce6', '#bf5af2'],
      category: 'user', kind: 'opensharp', source: kaynakYolu,
      packagePath: paket ? path : null,
      iconUrl: paket?.simge || null,
      version: meta.version || null,
      width: meta.width || 480, height: meta.height || 420,
      about: meta.about || `OpenSharp uygulaması · ${path}`,
      permissions: Array.isArray(meta.permissions) ? meta.permissions : null,
      mount: (ctx) => this.mountOshApp(ctx, kaynakYolu),
    });
    /* Manifest izin bildiriyorsa ilk kurulumda kaydedilir; bildirmiyorsa
       varsayılanlar geçerli olur (ağ kapalı). */
    if (Array.isArray(meta.permissions) && !permissions.requested(id)) {
      permissions.grant(id, meta.permissions);
    }
    if (!silent) notify.post({ title: 'Uygulama kuruldu', body: app.name, glyph: 'package', tint: app.tint });
    this.bus.emit('app:install', app);
    return app;
  }

  mountOshApp(ctx, path) {
    const host = h('div', { style: { position: 'relative', flex: '1', minWidth: 0, display: 'flex' } });
    /* Esnek kap: kök bileşeni `grow: true` yazdığında pencereyi gerçekten
       doldurabilsin. Blok kap olduğunda `flex` çocukta hiçbir işe yaramıyor,
       görünüm içerik boyunda kalıyordu. */
    const inner = h('div', { style: {
      flex: '1', minWidth: 0, minHeight: 0, position: 'relative', overflow: 'auto',
      display: 'flex', flexDirection: 'column',
    } });
    host.appendChild(inner);
    import('../lang/oshapp.js').then(({ OshApp }) => {
      const runner = new OshApp({
        container: inner, appId: ctx.app.id, name: ctx.app.name, tint: ctx.app.tint,
        cwd: VFS.dirname(path), osVersion: VERSION,
        /* İzinler artık gerçekten uygulanıyor. Verilmediğinde standart
           kitaplık "hepsi açık" varsayıyordu; imzasız bir paket bütün
           dosyaları okuyup ağa gönderebiliyordu. */
        permissions: permissions.get(ctx.app.id),
        win: ctx.win,
        setTitle: t => ctx.setTitle(t),
        close: () => ctx.close(),
        openApp: (id, a) => this.openApp(id, a),
        onPrint: s => console.log(`[${ctx.app.id}]`, s),
      });
      /* Çalışan yorumlayıcıya pencereden ulaşılabilsin: ajan arayüzü ve
         tanılama bunu kullanıyor. */
      ctx.win.oshRunner = runner;
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
    permissions.forget(id);
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
      if (e.key === 'Escape') { if (closeShortcuts()) return; this.desktop?.closeAllOverlays(); return; }

      if (mod && e.code === 'Space') { e.preventDefault(); return this.toggleSpotlight(); }
      /* ⌘/ — kısayol paneli. Sistemde onlarca kısayol vardı ve hiçbiri
         görünmüyordu; bilmeyen hiç kullanmıyordu. */
      if (mod && (e.key === '/' || e.key === '?')) { e.preventDefault(); return toggleShortcuts(); }
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
