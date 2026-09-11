/* ==========================================================================
   OpenOS · ui/desktop.js — wallpaper, icons, widgets and the shell overlays
   ========================================================================== */

import { h, clear, add, on, clamp, drag, fmtTime, fmtDate, debounce, sleep, throttle } from '../core/util.js';
import { icon, hasIcon } from '../core/icons.js';
import { menu, contextMenu } from './menu.js';
import { Dock } from './dock.js';
import { appIcon, appIconHtml } from './appicon.js';
import { MenuBar } from './menubar.js';
import settings from '../core/settings.js';
import registry from '../core/registry.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';
import { render as paintWallpaper, byId as wallpaperById, WALLPAPERS, thumb } from '../wallpapers/generator.js';

const FILE_GLYPHS = {
  dir: '📁', osh: '💠', txt: '📄', md: '📝', json: '🧾', js: '📜',
  png: '🖼️', jpg: '🖼️', svg: '🖼️', mp3: '🎵', pdf: '📕', csv: '📊', html: '🌐', app: '📦',
};
export const glyphFor = (s) =>
  s.type === 'dir' ? FILE_GLYPHS.dir : (FILE_GLYPHS[s.ext] || '📄');

export class Desktop {
  constructor(os) {
    this.os = os;
    this.overlays = {};
    this.selection = new Set();
  }

  mount(stage) {
    this.stage = stage;
    this.el = h('div.desktop');

    this.wallLayer = h('div.wallpaper');
    this.wallCanvas = h('canvas');
    this.wallLayer.appendChild(this.wallCanvas);
    this.iconLayer = h('div.desk-icons');
    this.widgetLayer = h('div.widgets');
    this.winLayer = h('div.win-layer');
    this.notifLayer = h('div.notif-layer');

    this.el.append(this.wallLayer, this.iconLayer, this.widgetLayer, this.winLayer, this.notifLayer);
    stage.appendChild(this.el);

    this.os.wm.mount(this.winLayer);
    this.os.wm.dockTarget = id => this.dock?.target(id);
    notify.mount(this.notifLayer);

    this.menubar = new MenuBar(this.os);
    this.menubar.mount(this.el);
    this.dock = new Dock(this.os);
    this.dock.mount(this.el);

    this.startWallpaper();
    this.renderIcons();
    this.renderWidgets();
    this.bindDesktopEvents();

    settings.bus.on('change', p => {
      if (p === 'wallpaper' || p === 'wallpaperMotion') this.startWallpaper();
      if (p.startsWith('desktop')) { this.renderIcons(); this.renderWidgets(); }
    });
    vfs.bus.on('change', debounce(() => this.renderIcons(), 120));

    return this.el;
  }

  /* ================= wallpaper ================= */
  startWallpaper() {
    cancelAnimationFrame(this._wallRaf);
    const id = settings.get('wallpaper');
    const wp = wallpaperById(id);
    this.wallLayer.classList.toggle('tinted', true);
    const resize = () => {
      this.wallCanvas.style.width = this.el.clientWidth + 'px';
      this.wallCanvas.style.height = this.el.clientHeight + 'px';
    };
    resize();
    this._wallResize ||= on(window, 'resize', throttle(() => { resize(); paintWallpaper(this.wallCanvas, settings.get('wallpaper'), this._t || 0); }, 180));

    const animated = wp.animated && settings.get('wallpaperMotion') && !settings.get('system.reduceMotion');
    if (!animated) { paintWallpaper(this.wallCanvas, id, 0); return; }

    let t = 0, last = 0;
    const loop = (ts) => {
      this._wallRaf = requestAnimationFrame(loop);
      if (ts - last < 66) return;      /* ~15fps is plenty for a wallpaper */
      last = ts; t += 0.5; this._t = t;
      paintWallpaper(this.wallCanvas, id, t);
    };
    this._wallRaf = requestAnimationFrame(loop);
  }

  /* ================= desktop icons ================= */
  get desktopPath() { return VFS.join(vfs.home, 'Masaüstü'); }

  renderIcons() {
    clear(this.iconLayer);
    if (!settings.get('desktop.showIcons')) return;
    let items = [];
    try { items = vfs.list(this.desktopPath); } catch { return; }
    const saved = settings.get('desktopIcons') || {};
    const colW = 96, rowH = 100;
    const perCol = Math.max(1, Math.floor((this.el.clientHeight - 120) / rowH));

    items.forEach((s, i) => {
      const pos = saved[s.path] || { x: 14 + Math.floor(i / perCol) * colW,
                                     y: 12 + (i % perCol) * rowH };
      const el = h('div.desk-icon', {
        dataset: { path: s.path },
        style: { left: pos.x + 'px', top: pos.y + 'px' },
      }, h('div.glyph', { text: glyphFor(s) }), h('div.nm', { text: s.name }));

      el.addEventListener('pointerdown', e => {
        e.stopPropagation();
        if (!e.shiftKey && !this.selection.has(s.path)) this.clearSelection();
        this.select(s.path, el);
        const start = { x: pos.x, y: pos.y };
        drag(e, {
          onMove: ({ dx, dy, moved }) => {
            if (!moved) return;
            el.classList.add('dragging');
            el.style.left = (start.x + dx) + 'px';
            el.style.top = clamp(start.y + dy, 0, this.el.clientHeight - 120) + 'px';
          },
          onEnd: ({ moved }) => {
            el.classList.remove('dragging');
            if (!moved) return;
            const map = { ...(settings.get('desktopIcons') || {}) };
            map[s.path] = { x: parseInt(el.style.left), y: parseInt(el.style.top) };
            settings.set('desktopIcons', map);
          },
        });
      });
      el.addEventListener('dblclick', () => this.os.openPath(s.path));
      contextMenu(el, () => this.fileMenu(s));
      this.iconLayer.appendChild(el);
    });
  }

  select(path, el) { this.selection.add(path); el.classList.add('sel'); }
  clearSelection() {
    this.selection.clear();
    this.iconLayer.querySelectorAll('.desk-icon.sel').forEach(e => e.classList.remove('sel'));
  }

  fileMenu(s) {
    return [
      { label: 'Aç', glyph: 'folderOpen', run: () => this.os.openPath(s.path) },
      { label: 'Finder’da Göster', glyph: 'folder', run: () => this.os.openApp('finder', { path: VFS.dirname(s.path) }) },
      '-',
      { label: 'Yeniden Adlandır', glyph: 'note', run: async () => {
        const n = await notify.prompt('Yeni ad:', { value: s.name, title: 'Yeniden Adlandır' });
        if (n && n !== s.name) vfs.move(s.path, VFS.join(VFS.dirname(s.path), n));
      } },
      { label: 'Kopyala', glyph: 'copy', run: () => vfs.copy(s.path, vfs.unique(s.path)) },
      '-',
      { label: 'Çöp Kutusuna At', glyph: 'trash', danger: true, run: () => this.os.trash(s.path) },
    ];
  }

  bindDesktopEvents() {
    on(this.iconLayer, 'pointerdown', e => {
      if (e.target !== this.iconLayer) return;
      this.clearSelection();
      const sx = e.clientX, sy = e.clientY;
      const box = h('div.marquee');
      this.iconLayer.appendChild(box);
      drag(e, {
        onMove: ({ x, y }) => {
          const l = Math.min(sx, x), t = Math.min(sy, y);
          Object.assign(box.style, { left: l + 'px', top: (t - 28) + 'px',
            width: Math.abs(x - sx) + 'px', height: Math.abs(y - sy) + 'px' });
          this.iconLayer.querySelectorAll('.desk-icon').forEach(ic => {
            const r = ic.getBoundingClientRect();
            const hit = r.right > l && r.left < Math.max(sx, x) && r.bottom > t && r.top < Math.max(sy, y);
            ic.classList.toggle('sel', hit);
            if (hit) this.selection.add(ic.dataset.path); else this.selection.delete(ic.dataset.path);
          });
        },
        onEnd: () => box.remove(),
      });
    });

    contextMenu(this.iconLayer, (e) => {
      if (e.target.closest('.desk-icon')) return null;
      return [
        { label: 'Yeni Klasör', glyph: 'folder', run: async () => {
          const n = await notify.prompt('Klasör adı:', { value: 'Yeni Klasör', title: 'Yeni Klasör' });
          if (n) vfs.mkdir(VFS.join(this.desktopPath, n));
        } },
        { label: 'Yeni Metin Dosyası', glyph: 'fileText', run: async () => {
          const n = await notify.prompt('Dosya adı:', { value: 'not.txt', title: 'Yeni Dosya' });
          if (n) { vfs.write(VFS.join(this.desktopPath, n), ''); }
        } },
        { label: 'Yeni OpenSharp Uygulaması', glyph: 'sparkles',
          run: () => this.os.openApp('studio', { create: true }) },
        '-',
        { label: 'Simgeleri Düzenle', glyph: 'grid', run: () => { settings.set('desktopIcons', {}); this.renderIcons(); } },
        { label: 'Duvar Kâğıdını Değiştir…', glyph: 'wallpaper', run: () => this.os.openApp('settings', { pane: 'wallpaper' }) },
        '-',
        { label: 'Widget’lar', checked: settings.get('desktop.showWidgets'),
          run: () => settings.set('desktop.showWidgets', !settings.get('desktop.showWidgets')) },
      ];
    });
  }

  /* ================= widgets ================= */
  renderWidgets() {
    clear(this.widgetLayer);
    if (!settings.get('desktop.showWidgets')) return;
    clearInterval(this._widgetTick);

    const clockW = h('div.widget', { style: { animationDelay: '.05s' } },
      h('div.wt', { text: 'Saat' }),
      h('div.big.clockv'),
      h('div.k-text.t-caption.datev'));

    const usage = vfs.usage();
    const diskW = h('div.widget', { style: { animationDelay: '.12s' } },
      h('div.wt', { text: 'Depolama' }),
      h('div.k-hstack', { style: { gap: '8px', marginTop: '4px' } },
        h('div', { html: icon('database', 22), style: { color: 'var(--accent)' } }),
        h('div.k-vstack', { style: { gap: '2px', flex: 1 } },
          h('div.k-text', { text: `${usage.files} dosya`, style: { fontWeight: 600 } }),
          h('div.k-text.t-caption', { text: `${usage.dirs} klasör · ${(usage.bytes / 1024).toFixed(1)} KB` }))),
      h('div.k-progress', { style: { marginTop: '8px' } },
        h('i', { style: { width: clamp(usage.bytes / 52428, 3, 100) + '%' } })));

    const apps = registry.visible().slice(0, 4);
    const appW = h('div.widget', { style: { animationDelay: '.2s' } },
      h('div.wt', { text: 'Hızlı Başlat' }),
      h('div.k-grid', { style: { gridTemplateColumns: 'repeat(4,1fr)', gap: '8px', marginTop: '8px' } },
        ...apps.map(a => h('div', {
          style: { cursor: 'default' },
          onclick: () => this.os.openApp(a.id),
          title: a.name,
        }, appIcon(a, 34)))));

    const tip = h('div.widget', { style: { animationDelay: '.28s' } },
      h('div.wt', { text: 'İpucu' }),
      h('div.k-text', { style: { marginTop: '4px', fontSize: '12px', lineHeight: 1.45 },
        text: this.randomTip() }));

    add(this.widgetLayer, [clockW, diskW, appW, tip]);

    const upd = () => {
      const d = new Date();
      const c = clockW.querySelector('.clockv'), dd = clockW.querySelector('.datev');
      if (c) c.textContent = fmtTime(d, { h12: settings.get('h12'), locale: settings.get('locale') });
      if (dd) dd.textContent = d.toLocaleDateString(settings.get('locale'),
        { weekday: 'long', day: 'numeric', month: 'long' });
    };
    upd();
    this._widgetTick = setInterval(upd, 1000);
  }

  randomTip() {
    const tips = [
      'Pencereyi ekranın kenarına sürükleyerek yan yana yerleştirin.',
      '⌘/Ctrl + Boşluk ile Spotlight’ı açın; uygulama, dosya ve komut arayın.',
      'OpenSharp Studio’da kendi uygulamanızı yazıp Dock’a ekleyebilirsiniz.',
      'Terminal’de "help" yazarak tüm komutları görün.',
      'Ajan Merkezi, window.OpenOS API’sinin canlı belgelerini gösterir.',
      'Masaüstüne sağ tıklayıp duvar kâğıdını değiştirin — hepsi kod ile çizilir.',
      'F3 Mission Control, F4 Launchpad açar.',
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }

  /* ================= launchpad ================= */
  toggleLaunchpad() {
    if (this.overlays.launchpad) return this.closeOverlay('launchpad');
    const pad = h('div.launchpad');
    const input = h('input', { placeholder: 'Uygulama ara' });
    const grid = h('div.lp-grid');
    pad.append(h('div.lp-search', h('span', { html: icon('search', 14) }), input), grid);

    const paint = (q = '') => {
      clear(grid);
      const apps = registry.visible()
        .filter(a => !q || a.name.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name));
      apps.forEach((a, i) => {
        const t = h('div.lp-app', { style: { animationDelay: (i * 14) + 'ms' },
          onclick: () => { this.closeOverlay('launchpad'); this.os.openApp(a.id); } },
          appIcon(a, 66),
          h('div.nm', { text: a.name }));
        contextMenu(t, () => [
          { label: 'Aç', run: () => { this.closeOverlay('launchpad'); this.os.openApp(a.id); } },
          { label: 'Dock’a Ekle', run: () => {
            const p = settings.get('pinned');
            if (!p.includes(a.id)) settings.set('pinned', [...p, a.id]);
          } },
          ...(a.kind === 'opensharp' ? ['-', { label: 'Kaynağı Düzenle', glyph: 'code',
            run: () => { this.closeOverlay('launchpad'); this.os.openApp('studio', { path: a.source }); } },
            { label: 'Kaldır', danger: true, glyph: 'trash', run: () => this.os.uninstallApp(a.id) }] : []),
        ]);
        grid.appendChild(t);
      });
      if (!apps.length) grid.appendChild(h('div.k-text', { text: 'Sonuç yok', style: { color: '#fff', opacity: .7 } }));
    };
    paint();
    input.addEventListener('input', () => paint(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.closeOverlay('launchpad');
      if (e.key === 'Enter') grid.querySelector('.lp-app')?.click();
    });
    pad.addEventListener('pointerdown', e => { if (e.target === pad || e.target === grid) this.closeOverlay('launchpad'); });
    this.el.appendChild(pad);
    this.overlays.launchpad = pad;
    setTimeout(() => input.focus(), 60);
  }

  /* ================= spotlight ================= */
  toggleSpotlight() {
    if (this.overlays.spotlight) return this.closeOverlay('spotlight');
    const input = h('input', { placeholder: 'OpenOS’ta ara…' });
    const results = h('div.sp-results');
    const box = h('div.spotlight',
      h('div.sp-in', h('span', { html: icon('search', 20), style: { color: 'var(--text-3)' } }), input), results);
    let items = [], sel = 0;

    const run = (it) => { this.closeOverlay('spotlight'); it.run(); };
    const paint = (q) => {
      clear(results); items = []; sel = 0;
      const sections = [];
      const section = (title, list) => { if (list.length) sections.push({ title, list }); };

      if (!q.trim()) {
        section('Öneriler', registry.visible().slice(0, 6).map(a => ({
          appId: a.id, glyph: a.glyph, tint: a.tint, title: a.name, sub: 'Uygulama',
          run: () => this.os.openApp(a.id),
        })));
      } else {
        section('Uygulamalar', registry.search(q).map(a => ({
          appId: a.id, glyph: a.glyph, tint: a.tint, title: a.name, sub: 'Uygulama',
          run: () => this.os.openApp(a.id),
        })));

        if (/^[\d\s+\-*/().%]+$/.test(q) && q.trim().length > 1) {
          try {
            // eslint-disable-next-line no-new-func
            const val = Function(`"use strict";return (${q})`)();
            if (typeof val === 'number' && isFinite(val)) {
              section('Hesap Makinesi', [{
                emoji: '🧮', title: `${q} = ${val}`, sub: 'Kopyala',
                run: () => { navigator.clipboard?.writeText(String(val)); notify.toast('Kopyalandı', { glyph: '📋' }); },
              }]);
            }
          } catch {}
        }

        section('Dosyalar', vfs.search(q, { limit: 8 }).map(f => ({
          emoji: glyphFor(f), title: f.name, sub: VFS.dirname(f.path), run: () => this.os.openPath(f.path),
        })));

        section('Eylemler', [
          { glyph: 'terminal', tint: ['#3a3a3c', '#1c1c1e'], title: `Terminal’de çalıştır: ${q}`, sub: 'Komut',
            run: () => this.os.openApp('terminal', { cmd: q }) },
          { glyph: 'globe', tint: ['#0a84ff', '#0060df'], title: `Web’de ara: ${q}`, sub: 'Tarayıcı',
            run: () => this.os.openApp('browser', { query: q }) },
        ]);
      }

      for (const sec of sections) {
        results.appendChild(h('div.sp-cat', { text: sec.title }));
        for (const it of sec.list) {
          const i = items.length;
          items.push(it);
          results.appendChild(h('div.sp-item', { class: i === 0 ? 'on' : '', dataset: { i },
            onclick: () => run(it) },
            it.emoji
              ? h('div', { text: it.emoji, style: { fontSize: '20px', width: '28px', textAlign: 'center' } })
              : appIcon({ id: it.appId, glyph: it.glyph, tint: it.tint }, 28),
            h('div.k-text.ellipsis', { text: it.title, style: { flex: 1 } }),
            h('div.sub', { text: it.sub || '' })));
        }
      }
      if (!items.length) results.appendChild(h('div.k-empty', { style: { padding: '26px' } },
        h('div.glyph', { text: '🔍' }), h('div.k-text.t-callout', { text: 'Sonuç yok' })));
    };
    const move = d => {
      sel = clamp(sel + d, 0, items.length - 1);
      results.querySelectorAll('.sp-item').forEach((r, i) => r.classList.toggle('on', i === sel));
      results.querySelector('.sp-item.on')?.scrollIntoView({ block: 'nearest' });
    };
    input.addEventListener('input', () => paint(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { items[sel] && run(items[sel]); }
      else if (e.key === 'Escape') this.closeOverlay('spotlight');
    });
    paint('');
    this.el.appendChild(box);
    this.overlays.spotlight = box;
    this._spotDismiss = on(this.el, 'pointerdown', e => {
      if (!box.contains(e.target)) this.closeOverlay('spotlight');
    }, true);
    setTimeout(() => input.focus(), 40);
  }

  /** Preload the Spotlight field (used by the selection context menu). */
  fillSpotlight(text) {
    const input = this.overlays.spotlight?.querySelector('input');
    if (!input) return;
    input.value = String(text).slice(0, 120);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  }

  /* ================= control centre ================= */
  openControlCenter() {
    if (this.overlays.cc) return this.closeOverlay('cc');
    const cc = h('div.control-center');
    const tog = (glyph, title, sub, path) => {
      const on0 = !!settings.get(path);
      const t = h('div.cc-toggle', { dataset: { on: on0 ? '1' : '0' } },
        h('div.ic', { html: icon(glyph, 14) }),
        h('div.tx', h('b', { text: title }), h('span', { text: on0 ? sub : 'Kapalı' })));
      t.addEventListener('click', () => {
        const v = !settings.get(path);
        settings.set(path, v);
        t.dataset.on = v ? '1' : '0';
        t.querySelector('.tx span').textContent = v ? sub : 'Kapalı';
        this.menubar.renderRight();
      });
      return t;
    };
    const slider = (label, glyph, path, min = 0, max = 100) => {
      const val = settings.get(path) ?? 50;
      const fill = h('i.fill'), knob = h('i.knob');
      const s = h('div.k-slider', h('i.track'), fill, knob);
      const set = v => {
        const pct = ((v - min) / (max - min)) * 100;
        fill.style.width = knob.style.left = pct + '%';
      };
      set(val);
      const onMove = e => {
        const r = s.getBoundingClientRect();
        const v = clamp(min + ((e.clientX - r.left) / r.width) * (max - min), min, max);
        set(v); settings.set(path, Math.round(v));
      };
      s.addEventListener('pointerdown', e => {
        onMove(e);
        const mv = ev => onMove(ev);
        const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      });
      return h('div.cc-slider-row', h('div.lb', { html: icon(glyph, 12) + ' ' + label }), s);
    };

    cc.append(
      h('div.cc-tile',
        tog('wifi', 'Wi-Fi', settings.get('network.ssid'), 'network.wifi'),
        tog('bluetooth', 'Bluetooth', 'Açık', 'network.bluetooth')),
      h('div.cc-tile',
        tog('moon', 'Odak', 'Rahatsız etmeyin', 'focus.dnd'),
        tog('sparkles', 'Ajan API', 'Etkin', 'agent.enabled')),
      h('div.cc-tile.wide', slider('Parlaklık', 'brightness', 'system.brightness', 20, 100)),
      h('div.cc-tile.wide', slider('Ses', 'volume', 'system.volume')),
      h('div.cc-tile.wide',
        h('div.k-hstack', { style: { gap: '8px' } },
          h('button.k-btn.s-sm', { html: icon(settings.isDark ? 'sun' : 'moon', 13), text: ' Görünüm',
            onclick: () => { settings.set('theme', settings.isDark ? 'light' : 'dark'); this.closeOverlay('cc'); } }),
          h('button.k-btn.s-sm', { text: 'Duvar Kâğıdı',
            onclick: () => { this.closeOverlay('cc'); this.os.openApp('settings', { pane: 'wallpaper' }); } }),
          h('div.k-spacer'),
          h('button.k-btn.s-sm', { html: icon('lock', 13), title: 'Kilitle',
            onclick: () => { this.closeOverlay('cc'); this.os.lock(); } }))),
    );
    this.el.appendChild(cc);
    this.overlays.cc = cc;
    this._ccDismiss = on(this.el, 'pointerdown', e => {
      if (!cc.contains(e.target) && !e.target.closest('.menubar')) this.closeOverlay('cc');
    }, true);
  }

  /* ================= mission control ================= */
  toggleMission() {
    if (this.overlays.mission) return this.closeOverlay('mission');
    const wins = this.os.wm.list();
    const grid = h('div.mission-grid');
    const panel = h('div.mission',
      h('div.k-hstack', { style: { justifyContent: 'center', marginBottom: '22px', gap: '8px' } },
        h('button.k-btn.s-sm', { text: 'Pencereleri Döşe', onclick: () => { this.os.wm.tile(); this.closeOverlay('mission'); } }),
        h('button.k-btn.s-sm', { text: 'Tümünü Kapat', onclick: () => { wins.forEach(w => w.close()); this.closeOverlay('mission'); } })),
      grid);
    if (!wins.length) grid.appendChild(h('div.k-text', { text: 'Açık pencere yok',
      style: { color: '#fff', textAlign: 'center', gridColumn: '1/-1', opacity: .8 } }));
    wins.forEach((w, i) => {
      const card = h('div.mission-card', { style: { animationDelay: (i * 40) + 'ms' },
        onclick: () => { this.closeOverlay('mission'); w.state === 'min' ? w.restore() : this.os.wm.focus(w); } },
        h('div.mission-shot', appIcon(w.app, 56)),
        h('div.cap', { text: w.title }));
      grid.appendChild(card);
    });
    panel.addEventListener('pointerdown', e => { if (e.target === panel) this.closeOverlay('mission'); });
    this.el.appendChild(panel);
    this.overlays.mission = panel;
  }

  closeOverlay(k) {
    const el = this.overlays[k];
    if (!el) return;
    delete this.overlays[k];
    if (k === 'launchpad') { el.classList.add('out'); setTimeout(() => el.remove(), 240); }
    else el.remove();
    this._spotDismiss?.(); this._ccDismiss?.();
  }
  closeAllOverlays() { Object.keys(this.overlays).forEach(k => this.closeOverlay(k)); }

  destroy() {
    cancelAnimationFrame(this._wallRaf);
    clearInterval(this._widgetTick);
    clearInterval(this.menubar?.tick);
    this.el.remove();
  }
}
