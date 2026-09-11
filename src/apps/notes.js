/* ==========================================================================
   OpenOS · apps/notes.js — notes, stored as files under ~/Belgeler/Notlar
   ========================================================================== */

import { h, clear, on, debounce, relTime } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';

export default {
  id: 'notes', name: 'Notlar', glyph: 'note', tint: ['#ffd60a', '#e0a000'],
  category: 'work', width: 780, height: 520, minWidth: 460, minHeight: 300,
  keywords: ['not', 'yazı', 'hatırlat'],
  about: 'Hızlı notlar; her not dosya sisteminde bir dosyadır.',
  mount(ctx) { return new Notes(ctx).el; },
};

class Notes {
  constructor(ctx) {
    this.ctx = ctx;
    this.dir = VFS.join(vfs.home, 'Belgeler/Notlar');
    if (!vfs.exists(this.dir)) {
      vfs.mkdir(this.dir);
      vfs.write(VFS.join(this.dir, 'İlk not.txt'),
        'OpenOS Notlar\n\nBu not dosya sisteminde gerçek bir dosya:\n' + this.dir + '\n\nFinder’dan da açabilirsiniz.');
    }
    this.list = h('div.sidebar', { style: { width: '220px' } });
    this.area = h('textarea.note-area', { placeholder: 'Notunuzu yazın…', spellcheck: false });
    this.meta = h('div.statusbar');
    const tb = h('div.toolbar',
      h('button.k-btn.v-primary.s-sm', { html: icon('plus', 13), text: ' Yeni not', onclick: () => this.create() }),
      h('div.k-spacer'),
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('trash', 14), title: 'Sil', onclick: () => this.remove() }));
    this.el = h('div.app-shell', this.list, h('div.content', tb, this.area, this.meta));
    on(this.area, 'input', this.autosave);
    this.refresh();
    const first = this.notes[0];
    if (first) this.open(first.path);
    this.off = vfs.bus.on('change', debounce(() => this.refresh(), 200));
    ctx.win.onClosed = () => { this.flush(); this.off?.(); };
  }

  refresh() {
    this.notes = (() => { try { return vfs.list(this.dir); } catch { return []; } })()
      .filter(s => s.type === 'file')
      .sort((a, b) => b.modified - a.modified);
    clear(this.list);
    this.list.appendChild(h('div.sb-title', { text: `Notlar · ${this.notes.length}` }));
    for (const n of this.notes) {
      const body = (vfs.read(n.path) || '').split('\n');
      const item = h('div.note-item', { class: n.path === this.path ? 'on' : '', dataset: { path: n.path },
        onclick: () => this.open(n.path) },
        h('div.t.ellipsis', { text: body[0] || n.name }),
        h('div.s.ellipsis', { text: (body.slice(1).join(' ').trim() || 'Boş not') }),
        h('div.d', { text: relTime(n.modified, 'tr') }));
      contextMenu(item, () => [
        { label: 'Aç', run: () => this.open(n.path) },
        { label: 'Finder’da göster', run: () => this.ctx.openApp('finder', { path: this.dir }) },
        '-',
        { label: 'Sil', danger: true, run: () => { vfs.remove(n.path); this.path = null; this.area.value = ''; this.refresh(); } },
      ]);
      this.list.appendChild(item);
    }
  }

  open(p) {
    this.flush();
    this.path = p;
    this.area.value = vfs.read(p);
    this.list.querySelectorAll('.note-item').forEach(i => i.classList.toggle('on', i.dataset.path === p));
    const s = vfs.stat(p);
    this.meta.textContent = `${VFS.basename(p)} · ${new Date(s.modified).toLocaleString()}`;
    this.ctx.setTitle('Notlar — ' + VFS.basename(p));
  }

  autosave = debounce(() => this.flush(), 700);
  flush() {
    if (!this.path || !vfs.exists(this.path)) return;
    if (vfs.read(this.path) === this.area.value) return;
    vfs.write(this.path, this.area.value);
    this.refresh();
  }

  async create() {
    const name = await notify.prompt('Not başlığı:', { value: 'Yeni not', title: 'Yeni Not' });
    if (!name) return;
    const p = vfs.unique(VFS.join(this.dir, name + '.txt'));
    vfs.write(p, name + '\n\n');
    this.refresh(); this.open(p);
    this.area.focus();
  }

  async remove() {
    if (!this.path) return;
    if (!(await notify.confirm('Bu not silinsin mi?', { title: VFS.basename(this.path), danger: true, ok: 'Sil' }))) return;
    vfs.remove(this.path);
    this.path = null; this.area.value = '';
    this.refresh();
  }
}
