/* ==========================================================================
   OpenOS · apps/photos.js — wallpaper gallery + image viewer
   ========================================================================== */

import { h, clear, on } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import settings from '../core/settings.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';
import { WALLPAPERS, thumb, render as paintWallpaper } from '../wallpapers/generator.js';

export default {
  id: 'photos', name: 'Görseller', glyph: 'image', tint: ['#ff7ab6', '#c4408a'],
  category: 'media', width: 860, height: 580, minWidth: 460, minHeight: 320,
  keywords: ['resim', 'fotoğraf', 'duvar kağıdı', 'galeri'],
  about: 'Üretilen duvar kâğıtlarını ve dosyalarınızdaki görselleri görüntüleyin.',
  mount(ctx) { return new Photos(ctx).el; },
};

class Photos {
  constructor(ctx) {
    this.ctx = ctx;
    this.tab = 'wallpapers';
    this.grid = h('div.ph-grid.k-scroll');
    this.viewer = h('div.ph-viewer');
    this.viewer.style.display = 'none';
    const tb = h('div.toolbar',
      h('div.k-seg',
        h('button', { text: 'Duvar Kâğıtları', 'aria-selected': 'true', onclick: e => this.setTab('wallpapers', e.target) }),
        h('button', { text: 'Resimlerim', 'aria-selected': 'false', onclick: e => this.setTab('files', e.target) })),
      h('div.k-spacer'),
      h('button.k-btn.s-sm', { html: icon('download', 13), text: ' PNG olarak kaydet',
        onclick: () => this.saveCurrent() }));
    this.status = h('div.statusbar');
    this.el = h('div.app-shell', h('div.content', tb, h('div.grow', { style: { position: 'relative', display: 'flex' } },
      this.grid, this.viewer), this.status));
    this.render();
  }

  setTab(t, btn) {
    this.tab = t;
    this.el.querySelectorAll('.k-seg button').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
    this.closeViewer(); this.render();
  }

  render() {
    clear(this.grid);
    if (this.tab === 'wallpapers') {
      WALLPAPERS.forEach(w => {
        const tile = h('div.ph-tile', { style: { backgroundImage: `url(${thumb(w.id, 420, 264)})` },
          onclick: () => this.openWallpaper(w) },
          h('div.cap', h('span', { text: w.name }),
            settings.get('wallpaper') === w.id ? h('span.k-badge', { text: 'AKTİF' }) : null));
        contextMenu(tile, () => [
          { label: 'Duvar kâğıdı yap', glyph: 'wallpaper', run: () => this.apply(w.id) },
          { label: 'Büyük görüntüle', glyph: 'eye', run: () => this.openWallpaper(w) },
          { label: 'Resimlerim’e kaydet', glyph: 'save', run: () => this.saveToDisk(w) },
        ]);
        this.grid.appendChild(tile);
      });
      this.status.textContent = `${WALLPAPERS.length} yordamsal duvar kâğıdı · hepsi kodla çizilir`;
    } else {
      const dir = VFS.join(vfs.home, 'Resimler');
      let files = [];
      try { files = vfs.list(dir).filter(s => ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].includes(s.ext)); } catch {}
      if (!files.length) {
        this.grid.appendChild(h('div.k-empty', { style: { gridColumn: '1/-1' } },
          h('div.glyph', { text: '🖼️' }),
          h('div.k-text.t-callout', { text: 'Resimler klasörü boş. Duvar kâğıtlarından birini kaydedin.' })));
      }
      files.forEach(f => {
        const data = vfs.read(f.path);
        const tile = h('div.ph-tile', { style: { backgroundImage: `url(${data})` },
          onclick: () => this.openImage(f, data) }, h('div.cap', h('span', { text: f.name })));
        contextMenu(tile, () => [
          { label: 'Aç', run: () => this.openImage(f, data) },
          { label: 'Sil', danger: true, run: () => { vfs.remove(f.path); this.render(); } },
        ]);
        this.grid.appendChild(tile);
      });
      this.status.textContent = `${files.length} görsel · ${dir}`;
    }
  }

  openWallpaper(w) {
    clear(this.viewer);
    const canvas = h('canvas', { style: { width: '100%', height: '100%', objectFit: 'contain' } });
    const bar = h('div.ph-bar',
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('chevronL', 15), onclick: () => this.closeViewer() }),
      h('div.k-text', { text: w.name, style: { fontWeight: 600 } }),
      h('div.k-spacer'),
      h('button.k-btn.v-primary.s-sm', { text: 'Duvar kâğıdı yap', onclick: () => this.apply(w.id) }),
      h('button.k-btn.s-sm', { text: 'Kaydet', onclick: () => this.saveToDisk(w) }));
    this.viewer.append(bar, h('div.ph-stage', canvas));
    this.viewer.style.display = 'flex';
    this.grid.style.display = 'none';
    this.current = w;
    requestAnimationFrame(() => {
      let t = 0;
      const loop = () => {
        if (!this.viewer.isConnected || this.viewer.style.display === 'none') return;
        this._raf = requestAnimationFrame(loop);
        t += w.animated ? 0.5 : 0;
        paintWallpaper(canvas, w.id, t);
        if (!w.animated) cancelAnimationFrame(this._raf);
      };
      loop();
    });
  }

  openImage(f, data) {
    clear(this.viewer);
    this.viewer.append(
      h('div.ph-bar',
        h('button.k-btn.v-ghost.icon.s-sm', { html: icon('chevronL', 15), onclick: () => this.closeViewer() }),
        h('div.k-text', { text: f.name, style: { fontWeight: 600 } })),
      h('div.ph-stage', h('img', { src: data, style: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' } })));
    this.viewer.style.display = 'flex';
    this.grid.style.display = 'none';
    this.current = null;
  }

  closeViewer() {
    cancelAnimationFrame(this._raf);
    this.viewer.style.display = 'none';
    this.grid.style.display = '';
  }

  apply(id) { settings.set('wallpaper', id); notify.toast('Duvar kâğıdı değişti', { glyph: '🖼️' }); this.render(); }

  saveToDisk(w) {
    const dir = VFS.join(vfs.home, 'Resimler');
    vfs.mkdir(dir);
    const p = vfs.unique(VFS.join(dir, w.name + '.png'));
    const c = document.createElement('canvas');
    c.width = 1600; c.height = 1000;
    w.draw(c.getContext('2d'), 1600, 1000, 0);
    vfs.write(p, c.toDataURL('image/png'));
    notify.toast('Resimler klasörüne kaydedildi', { glyph: '💾' });
  }

  saveCurrent() {
    if (this.current) return this.saveToDisk(this.current);
    const w = WALLPAPERS.find(x => x.id === settings.get('wallpaper'));
    if (w) this.saveToDisk(w);
  }
}
