/* ==========================================================================
   OpenOS · ui/dock.js — the dock, with real magnification
   ========================================================================== */

import { h, clear, on, clamp, fmtBytes, debounce } from '../core/util.js';
import { icon, hasIcon } from '../core/icons.js';
import { appIcon } from './appicon.js';
import { menu } from './menu.js';
import settings from '../core/settings.js';
import registry from '../core/registry.js';
import vfs from '../core/vfs.js';
import notify from '../core/notify.js';

export class Dock {
  constructor(os) {
    this.os = os;
    this.items = [];
  }

  mount(parent) {
    this.wrap = h('div.dock-wrap', { dataset: { pos: settings.get('dock.position') } });
    this.el = h('div.dock');
    this.wrap.appendChild(this.el);
    parent.appendChild(this.wrap);

    on(this.el, 'pointermove', e => this.magnify(e));
    on(this.el, 'pointerleave', () => this.magnify(null));
    on(this.wrap, 'contextmenu', e => {
      if (e.target.closest('.dock-item')) return;
      e.preventDefault();
      menu(this.dockMenu(), { x: e.clientX, y: e.clientY });
    });

    settings.bus.on('change', p => {
      if (p.startsWith('dock') || p === 'pinned') { this.wrap.dataset.pos = settings.get('dock.position'); this.render(); }
    });
    this.os.wm.bus.on('open', win => {
      const it = this.el.querySelector(`.dock-item[data-app="${win.app.id}"]`);
      setTimeout(() => it?.classList.remove('bouncing'), 420);
      this.syncRunning();
    });
    this.os.wm.bus.on('closed', () => this.syncRunning());
    this.os.wm.bus.on('focus', () => this.syncRunning());

    /* Çöp kutusunun dolu/boş görünümü dosya sistemiyle birlikte değişmeli.
       Her dosya olayında Dock'u baştan çizmek israf; yalnızca çöpteki öğe
       sayısı değiştiğinde çizilir. */
    let sonCop = -1;
    const copIzle = () => {
      const { adet } = vfs.trashUsage();
      if (adet !== sonCop) { sonCop = adet; this.render(); }
    };
    vfs.bus.on('change', debounce(copIzle, 250));
    copIzle();

    this.setupAutohide();
    this.render();
    return this.wrap;
  }

  setupAutohide() {
    on(window, 'pointermove', e => {
      if (!settings.get('dock.autohide')) { this.wrap.classList.remove('hidden-auto'); return; }
      const near = e.clientY > window.innerHeight - 60;
      this.wrap.classList.toggle('hidden-auto', !near && !this.wrap.matches(':hover'));
    });
  }

  render() {
    clear(this.el);
    this.items = [];
    const size = settings.get('dock.size');
    const pinned = settings.get('pinned') || [];
    const running = new Set(this.os.wm.list().map(w => w.app.id));
    const ids = [...pinned, ...[...running].filter(id => !pinned.includes(id))];

    for (const id of ids) {
      const app = registry.get(id);
      if (!app) continue;
      this.el.appendChild(this.makeItem(app, size));
    }

    this.el.appendChild(h('div.dock-sep'));
    /* Çöp kutusu doluysa bunu göstermeli: Dock'ta duran simge, içinde bir
       şey olup olmadığını söylemediği sürece yalnızca bir düğme. */
    const { adet } = vfs.trashUsage();
    const trash = {
      id: 'trash',
      name: adet ? `Çöp Kutusu — ${adet} öğe` : 'Çöp Kutusu',
      glyph: adet ? 'trashFull' : 'trash',
      tint: adet ? ['#b7a06a', '#8a6d3b'] : ['#9aa0aa', '#6b7078'],
      onOpen: () => this.os.openApp('finder', { path: vfs.trashDir }),
    };
    const oge = this.makeItem(trash, size, true);
    if (adet) oge.classList.add('dolu');
    this.el.appendChild(oge);
  }

  makeItem(app, size, isTrash) {
    const iconEl = appIcon(app, size);
    const item = h('div.dock-item', {
      dataset: { app: app.id }, style: { width: size + 'px', height: size + 'px' },
      onclick: () => this.activate(app, isTrash),
      oncontextmenu: e => { e.preventDefault(); e.stopPropagation(); this.itemMenu(app, e); },
    }, iconEl, h('div.dock-tip', { text: app.name }), h('div.dot'));
    this.items.push(item);
    return item;
  }

  activate(app, isTrash) {
    const it = this.el.querySelector(`.dock-item[data-app="${app.id}"]`);
    if (it) {
      it.classList.remove('pressed');
      void it.offsetWidth;
      it.classList.add('pressed');
      setTimeout(() => it.classList.remove('pressed'), 260);
    }
    if (isTrash) { app.onOpen(); return; }
    const wins = this.os.wm.byApp(app.id);
    if (!wins.length) {
      it?.classList.add('bouncing');
      setTimeout(() => it?.classList.remove('bouncing'), 2600);
      this.os.openApp(app.id);
    } else if (wins.every(w => w.state === 'min')) wins.forEach(w => w.restore());
    else if (wins.includes(this.os.wm.focused)) wins.forEach(w => w.minimize());
    else this.os.wm.focus(wins[0]);
  }

  itemMenu(app, e) {
    if (app.id === 'trash') {
      const { adet, bayt } = vfs.trashUsage();
      return menu([
        { header: adet ? `${adet} öğe · ${fmtBytes(bayt)}` : 'Çöp Kutusu boş' },
        { label: 'Çöp Kutusunu Aç', glyph: 'folderOpen',
          run: () => this.os.openApp('finder', { path: vfs.trashDir }) },
        { label: 'Tümünü Geri Yükle', glyph: 'undo', disabled: !adet, run: () => {
          let n = 0;
          for (const k of vfs.trashList()) { try { vfs.restore(k.id); n++; } catch {} }
          notify.toast(`${n} öğe geri yüklendi`, { glyph: '↩️' });
          this.render();
        } },
        '-',
        { label: 'Çöp Kutusunu Boşalt', glyph: 'trash', danger: true, disabled: !adet,
          run: async () => { await this.os.emptyTrash(); this.render(); } },
      ], { x: e.clientX, y: e.clientY });
    }

    const wins = this.os.wm.byApp(app.id);
    const pinned = settings.get('pinned') || [];
    const isPinned = pinned.includes(app.id);
    menu([
      { header: app.name },
      ...(wins.length ? [
        { label: 'Tüm pencereleri göster', glyph: 'layers', run: () => wins.forEach(w => w.restore()) },
        { label: 'Gizle', glyph: 'eye', run: () => wins.forEach(w => w.minimize()) },
        '-',
      ] : []),
      { label: 'Yeni pencere', glyph: 'plus', run: () => this.os.openApp(app.id, {}, true) },
      { label: isPinned ? 'Dock’tan kaldır' : 'Dock’ta tut', glyph: isPinned ? 'minus' : 'plus',
        run: () => settings.set('pinned', isPinned ? pinned.filter(i => i !== app.id) : [...pinned, app.id]) },
      ...(wins.length ? ['-', { label: 'Çık', glyph: 'x', danger: true, run: () => this.os.wm.closeAll(app.id) }] : []),
    ], { x: e.clientX, y: e.clientY });
  }

  dockMenu() {
    const pos = settings.get('dock.position');
    return [
      { header: 'Dock' },
      { label: 'Büyütme', checked: settings.get('dock.magnify'),
        run: () => settings.set('dock.magnify', !settings.get('dock.magnify')) },
      { label: 'Otomatik gizle', checked: settings.get('dock.autohide'),
        run: () => settings.set('dock.autohide', !settings.get('dock.autohide')) },
      '-',
      { header: 'Konum' },
      ...['bottom', 'left', 'right'].map(p => ({
        label: { bottom: 'Altta', left: 'Solda', right: 'Sağda' }[p], checked: pos === p,
        run: () => settings.set('dock.position', p),
      })),
      '-',
      { label: 'Dock Ayarları…', glyph: 'settings', run: () => this.os.openApp('settings', { pane: 'dock' }) },
    ];
  }

  magnify(e) {
    const base = settings.get('dock.size');
    if (!settings.get('dock.magnify') || !e) {
      this.items.forEach(it => {
        it.style.transform = '';
        it.style.marginInline = '';
        it.style.zIndex = '';
        const tip = it.querySelector('.dock-tip');
        if (tip) tip.style.transform = '';
      });
      this.el.style.setProperty('--dock-lift', '0px');
      return;
    }
    const vertical = settings.get('dock.position') !== 'bottom';
    /* A wide reach with a sharp falloff is what makes the wave read as liquid. */
    const reach = base * 3.4;
    const peak = 1.05;              /* how much the hovered icon grows, on top of 1 */
    const spread = 1.35;            /* how far the neighbours ride along */
    let maxT = 0;

    this.items.forEach(it => {
      const r = it.getBoundingClientRect();
      const c = vertical ? r.top + r.height / 2 : r.left + r.width / 2;
      const p = vertical ? e.clientY : e.clientX;
      const d = Math.abs(p - c);
      /* cosine falloff: smooth at the crest, smooth at the tails */
      const x = clamp(d / reach, 0, 1);
      const t = Math.pow((Math.cos(x * Math.PI) + 1) / 2, spread);
      maxT = Math.max(maxT, t);

      const scale = 1 + peak * t;
      const lift = (scale - 1) * base * 0.52;
      /* push neighbours apart so the enlarged icons never overlap */
      const push = (scale - 1) * base * 0.30;
      it.style.zIndex = String(Math.round(t * 100));

      if (vertical) {
        it.style.transform = `translateX(${lift}px) scale(${scale})`;
        it.style.marginBlock = `${push}px`;
      } else {
        it.style.transform = `translateY(${-lift}px) scale(${scale})`;
        it.style.marginInline = `${push}px`;
      }
      const tip = it.querySelector('.dock-tip');
      if (tip) tip.style.transform = `translateX(-50%) translateY(${-lift * 0.55}px) scale(${1 / scale})`;
    });
    this.el.style.setProperty('--dock-lift', (maxT * 5).toFixed(2) + 'px');
  }

  syncRunning() {
    const running = new Set(this.os.wm.list().map(w => w.app.id));
    const pinned = settings.get('pinned') || [];
    const shown = new Set([...this.el.querySelectorAll('.dock-item')].map(i => i.dataset.app));
    for (const id of running) if (!shown.has(id)) { this.render(); break; }
    for (const id of shown) if (!running.has(id) && !pinned.includes(id) && id !== 'trash') { this.render(); break; }
    this.el.querySelectorAll('.dock-item').forEach(it =>
      it.classList.toggle('running', running.has(it.dataset.app)));
  }

  /** Screen position of an app's dock icon (for the minimise animation). */
  target(appId) {
    const it = this.el.querySelector(`.dock-item[data-app="${appId}"]`) || this.el.firstChild;
    if (!it) return null;
    const r = it.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
}
