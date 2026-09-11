/* ==========================================================================
   OpenOS · apps/storage.js — Depolama Analizi
   Sanal dosya sistemini tarar, yeri neyin kapladığını ağaç haritasıyla
   gösterir ve büyük/eski dosyaları ayıklamayı kolaylaştırır.
   ========================================================================== */

import { h, clear, on, fmtBytes, relTime } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';

export default {
  id: 'storage', name: 'Depolama Analizi', glyph: 'database', tint: ['#40c8e0', '#0a7b96'],
  category: 'util', width: 880, height: 620, minWidth: 520, minHeight: 400,
  keywords: ['depolama', 'disk', 'analiz', 'yer', 'temizlik'],
  about: 'Yeri neyin kapladığını gösterir ve temizlemeyi kolaylaştırır.',
  mount(ctx) { return new Storage(ctx).el; },
};

const PALETTE = ['#0a84ff', '#bf5af2', '#30d158', '#ff9f0a', '#ff375f',
                 '#64d2ff', '#5e5ce6', '#ac8e68', '#40c8e0', '#8e8e93'];

class Storage {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = '/';
    this.sidebar = h('div.sidebar', { style: { width: '200px' } });
    this.body = h('div.content.k-scroll', { style: { padding: '18px 20px', gap: '14px' } });
    this.el = h('div.app-shell', this.sidebar, this.body);
    contextMenu(this.el, () => [
      { header: 'Depolama' },
      { label: 'Yeniden tara', glyph: 'refresh', run: () => this.render() },
      { label: 'Çöp kutusunu boşalt', glyph: 'trash', danger: true, run: () => this.emptyTrash() },
      { label: 'Finder’da aç', glyph: 'folder', run: () => this.ctx.openApp('finder', { path: this.root }) },
    ]);
    this.render();
  }

  /** Bir klasörün toplam boyutunu ve dosya sayısını özyinelemeli hesaplar. */
  measure(path) {
    let bytes = 0, files = 0, dirs = 0, newest = 0;
    let items;
    try { items = vfs.list(path); } catch { return { bytes, files, dirs, newest }; }
    for (const s of items) {
      if (s.type === 'dir') {
        dirs++;
        const sub = this.measure(s.path);
        bytes += sub.bytes; files += sub.files; dirs += sub.dirs;
        newest = Math.max(newest, sub.newest);
      } else {
        files++; bytes += s.size; newest = Math.max(newest, s.modified);
      }
    }
    return { bytes, files, dirs, newest };
  }

  render() {
    const total = this.measure('/');
    let top = [];
    try {
      top = vfs.list(this.root).map(s => ({
        ...s,
        total: s.type === 'dir' ? this.measure(s.path) : { bytes: s.size, files: 1, dirs: 0, newest: s.modified },
      })).sort((a, b) => b.total.bytes - a.total.bytes);
    } catch {}

    /* ---- kenar çubuğu ---- */
    clear(this.sidebar);
    this.sidebar.appendChild(h('div.sb-title', { text: 'Konum' }));
    [['/', 'Kök'], [vfs.home, 'Ana Klasör'], ['/Applications', 'Uygulamalar'],
     [VFS.join(vfs.home, 'Projeler'), 'Projeler'], [VFS.join(vfs.home, '.Trash'), 'Çöp Kutusu']]
      .forEach(([p, label]) => {
        if (!vfs.exists(p)) return;
        this.sidebar.appendChild(h('div.sb-item', { class: p === this.root ? 'on' : '',
          onclick: () => { this.root = p; this.render(); } },
          h('span.ic', { html: icon('folder', 13) }), h('span.ellipsis', { text: label })));
      });
    this.sidebar.append(h('div.k-spacer'),
      h('div.k-text.t-caption', { style: { padding: '10px 10px 14px', lineHeight: 1.6 },
        text: `Toplam\n${fmtBytes(total.bytes)}\n${total.files} dosya · ${total.dirs} klasör` }));

    /* ---- gövde ---- */
    clear(this.body);
    const maxB = top.length ? Math.max(...top.map(t => t.total.bytes), 1) : 1;

    /* ağaç haritası: alanlar boyutla orantılı */
    const map = h('div.stg-map');
    const sum = top.reduce((a, t) => a + t.total.bytes, 0) || 1;
    top.filter(t => t.total.bytes > 0).slice(0, 10).forEach((t, i) => {
      const pct = (t.total.bytes / sum) * 100;
      map.appendChild(h('div.stg-tile', {
        style: { flexGrow: String(Math.max(pct, 2)), background: PALETTE[i % PALETTE.length] },
        title: `${t.name} — ${fmtBytes(t.total.bytes)} (%${pct.toFixed(1)})`,
        onclick: () => { if (t.type === 'dir') { this.root = t.path; this.render(); } },
      }, pct > 7 ? h('span', { text: t.name }) : null));
    });

    this.body.append(
      h('div.k-hstack', { style: { gap: '10px' } },
        h('div.k-vstack', { style: { flex: 1, gap: '2px' } },
          h('div.k-text.t-title', { text: 'Depolama Analizi' }),
          h('div.k-text.t-callout', { text: this.root })),
        this.root !== '/' ? h('button.k-btn.s-sm', { text: 'Üst klasör',
          onclick: () => { this.root = VFS.dirname(this.root); this.render(); } }) : null,
        h('button.k-btn.s-sm', { html: icon('refresh', 13), text: ' Tara', onclick: () => this.render() })),
      map,
      h('div.k-sectitle', { text: 'Yeri kaplayanlar' }),
    );

    const list = h('div.k-group');
    if (!top.length) list.appendChild(h('div.k-row', h('div.k-text.t-caption', { text: 'Bu klasör boş' })));
    top.forEach((t, i) => {
      const pct = (t.total.bytes / maxB) * 100;
      const row = h('div.k-row',
        h('div.lead', { style: { background: PALETTE[i % PALETTE.length] },
          html: icon(t.type === 'dir' ? 'folder' : 'file', 15) }),
        h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '3px' } },
          h('div.k-hstack', { style: { gap: '8px' } },
            h('div.k-text.ellipsis', { text: t.name, style: { fontWeight: 520, flex: 1 } }),
            h('div.k-text.t-caption', { text: t.type === 'dir'
              ? `${t.total.files} dosya` : (t.ext || 'dosya') })),
          h('div.k-progress', { style: { height: '4px' } },
            h('i', { style: { width: Math.max(2, pct) + '%',
              background: PALETTE[i % PALETTE.length] } }))),
        h('div.k-vstack', { style: { alignItems: 'flex-end', gap: '1px' } },
          h('div.k-text', { text: fmtBytes(t.total.bytes), style: { fontWeight: 560 } }),
          h('div.k-text.t-caption', { text: t.total.newest ? relTime(t.total.newest, 'tr') : '' })));
      if (t.type === 'dir') { row.classList.add('tappable'); on(row, 'click', () => { this.root = t.path; this.render(); }); }
      contextMenu(row, () => [
        { label: 'Finder’da göster', glyph: 'folder',
          run: () => this.ctx.openApp('finder', { path: t.type === 'dir' ? t.path : VFS.dirname(t.path) }) },
        ...(t.type === 'file' ? [{ label: 'Aç', glyph: 'file', run: () => this.ctx.openPath(t.path) }] : []),
        '-',
        { label: 'Çöp kutusuna at', glyph: 'trash', danger: true, run: () => {
          this.ctx.os.trash(t.path); this.render(); } },
      ]);
      list.appendChild(row);
    });
    this.body.appendChild(list);

    /* ---- temizlik önerileri ---- */
    const big = [];
    vfs.walk('/', s => { if (s.type === 'file' && s.size > 2048) big.push(s); });
    big.sort((a, b) => b.size - a.size);
    const trashPath = VFS.join(vfs.home, '.Trash');
    const trash = vfs.exists(trashPath) ? this.measure(trashPath) : { bytes: 0, files: 0 };

    this.body.append(
      h('div.k-sectitle', { text: 'Temizlik' }),
      h('div.k-group',
        h('div.k-row',
          h('div.lead', { style: { background: 'var(--orange)' }, html: icon('trash', 15) }),
          h('div.k-vstack', { style: { flex: 1, gap: '1px' } },
            h('div.k-text', { text: 'Çöp kutusu', style: { fontWeight: 520 } }),
            h('div.k-text.t-caption', { text: `${trash.files} öğe · ${fmtBytes(trash.bytes)}` })),
          h('button.k-btn.s-sm', { text: 'Boşalt', disabled: !trash.files, onclick: () => this.emptyTrash() })),
        ...big.slice(0, 5).map(s => h('div.k-row',
          h('div.lead', { style: { background: 'var(--gray)' }, html: icon('file', 15) }),
          h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
            h('div.k-text.ellipsis', { text: s.name, style: { fontWeight: 520 } }),
            h('div.k-text.t-caption.ellipsis', { text: s.path })),
          h('div.k-text.t-secondary', { text: fmtBytes(s.size) }),
          h('button.k-btn.v-ghost.icon.s-sm', { html: icon('trash', 13),
            onclick: () => { this.ctx.os.trash(s.path); this.render(); } })))),
      h('div.k-text.t-caption', { style: { lineHeight: 1.7 },
        text: 'OpenOS’un tüm dosya sistemi tarayıcının yerel deposunda durur. Tarayıcı yer sıkıştığında ' +
              'geçici depolamayı uyarmadan silebilir — Grafik İşletici’den kalıcı depolama isteyin.' }),
      h('button.k-btn.s-sm', { text: 'Grafik İşletici → Bellek',
        onclick: () => this.ctx.openApp('graphics', { pane: 'memory' }) }));
  }

  async emptyTrash() {
    const p = VFS.join(vfs.home, '.Trash');
    if (!(await notify.confirm('Çöp kutusundaki her şey kalıcı olarak silinecek.',
      { title: 'Çöp Kutusunu Boşalt', danger: true, ok: 'Sil' }))) return;
    try { vfs.list(p).forEach(s => vfs.remove(s.path)); } catch {}
    notify.toast('Çöp kutusu boşaltıldı', { glyph: '🗑️' });
    this.render();
  }
}
