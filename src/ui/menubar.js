/* ==========================================================================
   OpenOS · ui/menubar.js — the top bar, its menus and status items
   ========================================================================== */

import { h, clear, on, fmtTime, fmtDate } from '../core/util.js';
import { icon } from '../core/icons.js';
import { menu, popover, closeAllMenus } from './menu.js';
import settings from '../core/settings.js';

export class MenuBar {
  constructor(os) { this.os = os; this.openMenu = null; }

  mount(parent) {
    this.el = h('div.menubar');
    this.left = h('div.row', { style: { gap: '1px' } });
    this.right = h('div.right');
    this.el.append(this.left, this.right);
    parent.appendChild(this.el);

    this.os.wm.bus.on('focus', () => this.renderLeft());
    this.os.wm.bus.on('open', () => this.renderLeft());
    this.os.wm.bus.on('closed', () => this.renderLeft());
    settings.bus.on('applied', () => this.renderRight());

    this.renderLeft();
    this.renderRight();
    this.tick = setInterval(() => this.updateClock(), 1000);
    return this.el;
  }

  /* ---------------- left: brand + app menus ---------------- */
  renderLeft() {
    clear(this.left);
    const brand = h('div.mb.brand', { html: icon('logo', 15, 1.9) });
    brand.addEventListener('click', () => this.drop(brand, this.brandMenu()));
    this.left.appendChild(brand);

    const win = this.os.wm.focused;
    const appName = win ? win.app.name : 'Finder';
    const nameBtn = h('div.mb.appname', { text: appName });
    nameBtn.addEventListener('click', () => this.drop(nameBtn, this.appMenu(win)));
    this.left.appendChild(nameBtn);

    const extra = win?.menus || [
      { title: 'Dosya', items: [
        { label: 'Yeni Pencere', key: '⌘N', run: () => this.os.openApp('finder', {}, true) },
        { label: 'Yeni Klasör', key: '⇧⌘N', run: () => this.os.openApp('finder') },
      ] },
      { title: 'Görünüm', items: this.viewMenu() },
      { title: 'Pencere', items: this.windowMenu() },
      { title: 'Yardım', items: [
        { label: 'OpenOS Kılavuzu', glyph: 'question', run: () => this.os.openApp('help') },
        { label: 'OpenSharp Belgeleri', glyph: 'code', run: () => this.os.openApp('studio', { doc: true }) },
      ] },
    ];
    for (const m of extra) {
      const b = h('div.mb', { text: m.title });
      b.addEventListener('click', () => this.drop(b, typeof m.items === 'function' ? m.items() : m.items));
      this.left.appendChild(b);
    }
  }

  drop(anchor, items) {
    if (this.openMenu === anchor) { closeAllMenus(); this.openMenu = null; anchor.classList.remove('open'); return; }
    this.left.querySelectorAll('.mb.open').forEach(e => e.classList.remove('open'));
    anchor.classList.add('open');
    this.openMenu = anchor;
    menu(items, { anchor, onClose: () => { anchor.classList.remove('open'); this.openMenu = null; } });
  }

  brandMenu() {
    return [
      { label: 'Bu OpenOS Hakkında', glyph: 'info', run: () => this.os.openApp('about') },
      '-',
      { label: 'Sistem Ayarları…', glyph: 'settings', key: '⌘,', run: () => this.os.openApp('settings') },
      { label: 'App Store…', glyph: 'package', run: () => this.os.openApp('appstore') },
      '-',
      { label: 'Son Kullanılanlar', glyph: 'clock', submenu: this.os.recentApps().length
          ? this.os.recentApps().map(a => ({ label: a.name, glyph: a.glyph, run: () => this.os.openApp(a.id) }))
          : [{ label: 'Yok', disabled: true }] },
      '-',
      { label: 'Tüm Pencereleri Kapat', glyph: 'x', run: () => this.os.wm.list().forEach(w => w.close()) },
      '-',
      { label: 'Kilitle', glyph: 'lock', key: '⌃⌘Q', run: () => this.os.lock() },
      { label: 'Yeniden Başlat…', glyph: 'refresh', run: () => this.os.restart() },
      { label: 'Kapat…', glyph: 'power', danger: true, run: () => this.os.shutdown() },
    ];
  }

  appMenu(win) {
    const app = win?.app;
    return [
      { label: `${app?.name || 'Finder'} Hakkında`, glyph: 'info',
        run: () => this.os.notify.alert(app?.about || 'OpenOS yerleşik uygulaması.', { title: app?.name || 'Finder', glyph: '📦' }) },
      '-',
      { label: 'Ayarlar…', glyph: 'settings', key: '⌘,', run: () => this.os.openApp('settings') },
      '-',
      { label: 'Gizle', key: '⌘H', disabled: !win, run: () => win?.minimize() },
      { label: 'Diğerlerini Gizle', key: '⌥⌘H', run: () => this.os.wm.list().filter(w => w !== win).forEach(w => w.minimize()) },
      '-',
      { label: `${app?.name || 'Finder'} Uygulamasından Çık`, key: '⌘Q', danger: true, disabled: !win,
        run: () => this.os.wm.closeAll(app.id) },
    ];
  }

  viewMenu() {
    return [
      { label: 'Launchpad’i Aç', glyph: 'grid', key: 'F4', run: () => this.os.toggleLaunchpad() },
      { label: 'Mission Control', glyph: 'layers', key: 'F3', run: () => this.os.toggleMission() },
      { label: 'Spotlight', glyph: 'search', key: '⌘Space', run: () => this.os.toggleSpotlight() },
      '-',
      { label: 'Masaüstü Simgeleri', checked: settings.get('desktop.showIcons'),
        run: () => settings.set('desktop.showIcons', !settings.get('desktop.showIcons')) },
      { label: 'Widget’lar', checked: settings.get('desktop.showWidgets'),
        run: () => settings.set('desktop.showWidgets', !settings.get('desktop.showWidgets')) },
      '-',
      { label: settings.isDark ? 'Açık Görünüme Geç' : 'Koyu Görünüme Geç', glyph: settings.isDark ? 'sun' : 'moon',
        run: () => settings.set('theme', settings.isDark ? 'light' : 'dark') },
    ];
  }

  windowMenu() {
    const wins = this.os.wm.list();
    return [
      { label: 'Küçült', key: '⌘M', disabled: !this.os.wm.focused, run: () => this.os.wm.focused?.minimize() },
      { label: 'Büyüt/Geri Al', disabled: !this.os.wm.focused, run: () => this.os.wm.focused?.toggleMax() },
      { label: 'Tam Ekran', key: '⌃⌘F', disabled: !this.os.wm.focused, run: () => this.os.wm.focused?.fullscreen() },
      '-',
      { label: 'Pencereleri Döşe', glyph: 'grid', run: () => this.os.wm.tile() },
      '-',
      ...(wins.length ? wins.map(w => ({
        label: w.title, checked: w === this.os.wm.focused,
        run: () => { w.state === 'min' ? w.restore() : this.os.wm.focus(w); },
      })) : [{ label: 'Açık pencere yok', disabled: true }]),
    ];
  }

  /* ---------------- right: status items ---------------- */
  renderRight() {
    clear(this.right);
    const mk = (html, title, onClick, cls = '') => {
      const b = h('div.status ' + cls, { title, html });
      if (onClick) b.addEventListener('click', () => onClick(b));
      this.right.appendChild(b);
      return b;
    };

    if (settings.get('focus.dnd')) mk(icon('moon', 14), 'Rahatsız Etmeyin', () => this.os.openControlCenter());

    /* Bluetooth donanımı yok — kapalı ve etkisiz görünür. */
    const bt = mk(icon('bluetooth', 13), 'Bluetooth — bu cihazda çalışmıyor', b => this.bluetoothMenu(b));
    bt.style.opacity = '.35';

    /* Ağ: kablolu bağlantı. */
    const online = navigator.onLine;
    mk(icon('ethernet', 14), online ? `Ethernet — bağlı (${settings.get('network.link')})` : 'Ethernet — bağlantı yok',
      b => this.networkMenu(b)).style.opacity = online ? '1' : '.4';

    this.battery = mk(this.batteryHtml(), this.batteryTitle(), () => this.os.openControlCenter());

    this.notifBtn = mk(icon('bell', 14), 'Bildirimler', b => this.os.desktop?.toggleNotificationCenter(b));
    this.syncNotifBadge();

    mk(icon('grid', 13), 'Kontrol Merkezi', () => this.os.openControlCenter());
    mk(icon('search', 14), 'Spotlight', () => this.os.toggleSpotlight());
    this.clock = h('div.status.clock');
    this.clock.addEventListener('click', () => this.os.openApp('calendar'));
    this.right.appendChild(this.clock);
    this.updateClock();
  }

  /** Okunmamış bildirim varsa çan üzerinde nokta gösterir. */
  syncNotifBadge() {
    if (!this.notifBtn) return;
    const n = this.os.notify.history.filter(x => !x.seen).length;
    this.notifBtn.classList.toggle('has-badge', n > 0);
    this.notifBtn.dataset.count = n > 9 ? '9+' : String(n || '');
  }

  batteryTitle() {
    const b = this.os.battery || {};
    if (!b.present) return 'Prize takılı — bu cihazda batarya yok';
    const pct = Math.round((b.level ?? 1) * 100);
    if (b.charging) return `Pil %${pct} — şarj oluyor`;
    const t = b.dischargingTime;
    const left = (t && isFinite(t)) ? ` · ${Math.floor(t / 3600)}s ${Math.round((t % 3600) / 60)}dk kaldı` : '';
    return `Pil %${pct}${left}`;
  }

  networkMenu(anchor) {
    const online = navigator.onLine;
    menu([
      { header: 'Ağ' },
      { label: online ? `Ethernet — bağlı` : 'Ethernet — bağlantı yok', glyph: 'ethernet', checked: online, run: () => {} },
      { label: `Bağlantı hızı: ${settings.get('network.link')}`, disabled: true },
      { label: `Durum: ${online ? 'çevrimiçi' : 'çevrimdışı'}`, disabled: true },
      '-',
      { label: 'Wi-Fi — bu cihazda yok', glyph: 'wifi', disabled: true },
      '-',
      { label: 'Ağ Ayarları…', glyph: 'settings', run: () => this.os.openApp('settings', { pane: 'network' }) },
    ], { anchor });
  }

  bluetoothMenu(anchor) {
    menu([
      { header: 'Bluetooth' },
      { label: 'Bu cihazda çalışmıyor', glyph: 'bluetooth', disabled: true },
      { label: 'Adaptör bulunamadı', disabled: true },
      '-',
      { label: 'Ağ Ayarları…', glyph: 'settings', run: () => this.os.openApp('settings', { pane: 'network' }) },
    ], { anchor });
  }

  batteryHtml() {
    const b = this.os.battery || { level: 1, charging: true, present: false };
    if (!b.present) {
      /* Batarya yok: fiş simgesi, sabit dolu gösterge. */
      return `<span style="display:flex;align-items:center;gap:3px">${icon('plug', 13)}</span>`;
    }
    const lvl = b.level ?? 1;
    const w = Math.max(1, Math.round(15.6 * lvl));
    const col = lvl <= 0.1 ? '#ff453a' : lvl <= 0.2 ? '#ff9f0a' : 'currentColor';
    const bolt = b.charging
      ? '<path d="M11.6 2.6 8.2 7.2h2.4l-.6 3.6 3.4-4.6h-2.4z" fill="#000" stroke="#fff" stroke-width=".7"/>'
      : '';
    return `<svg width="26" height="13" viewBox="0 0 26 13" fill="none">
      <rect x=".6" y=".6" width="21" height="11.8" rx="3.4" stroke="currentColor" stroke-width="1.1" opacity=".5"/>
      <rect x="2.2" y="2.2" width="${w}" height="8.6" rx="2" fill="${col}"/>
      <path d="M23.4 4.4v3.6c1.1-.3 1.6-.9 1.6-1.8s-.5-1.5-1.6-1.8z" fill="currentColor" opacity=".5"/>
      <g transform="translate(5 1)">${bolt}</g>
    </svg>`;
  }

  updateClock() {
    if (!this.clock) return;
    const d = new Date();
    const h12 = settings.get('h12');
    /* Tarih ve saat ayrı düğümler: dar ekranda tarih CSS ile düşürülüp
       saat korunabilsin. Tek metin olduğunda ikisi birlikte kırpılıyordu. */
    if (!this.clockDate) {
      this.clock.textContent = '';
      this.clockDate = h('span.mb-date');
      this.clockTime = h('span.mb-time');
      this.clock.append(this.clockDate, this.clockTime);
    }
    this.clockDate.textContent = fmtDate(d, settings.get('locale')) + ' ';
    this.clockTime.textContent = fmtTime(d, { h12, locale: settings.get('locale') });
    if (this.battery && this.os.battery) {
      this.battery.innerHTML = this.batteryHtml();
      this.battery.title = this.batteryTitle();
    }
    this.syncNotifBadge();
  }
}
