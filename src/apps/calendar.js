/* ==========================================================================
   OpenOS · apps/calendar.js — month view with events stored in the VFS
   ========================================================================== */

import { h, clear, on } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';

const FILE = () => VFS.join(vfs.home, 'Belgeler/takvim.json');
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
                'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const DAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export default {
  id: 'calendar', name: 'Takvim', glyph: 'calendar', tint: ['#ff6b6b', '#d63a3a'],
  category: 'work', width: 780, height: 560, minWidth: 480, minHeight: 380,
  keywords: ['takvim', 'ajanda', 'etkinlik'],
  about: 'Etkinlikleriniz ~/Belgeler/takvim.json içinde saklanır.',
  mount(ctx) { return new Calendar(ctx).el; },
};

class Calendar {
  constructor(ctx) {
    this.ctx = ctx;
    this.cur = new Date();
    this.sel = new Date();
    this.events = vfs.readJSON(FILE(), {}) || {};
    this.grid = h('div.cal-grid');
    this.title = h('div.k-text.t-title2');
    this.side = h('div.sidebar', { style: { width: '230px' } });
    const tb = h('div.toolbar',
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('chevronL', 15), onclick: () => this.move(-1) }),
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('chevronR', 15), onclick: () => this.move(1) }),
      this.title, h('div.k-spacer'),
      h('button.k-btn.s-sm', { text: 'Bugün', onclick: () => { this.cur = new Date(); this.sel = new Date(); this.render(); } }),
      h('button.k-btn.v-primary.s-sm', { html: icon('plus', 13), text: ' Etkinlik', onclick: () => this.add() }));
    this.el = h('div.app-shell',
      h('div.content', tb, h('div.cal-head', ...DAYS.map(d => h('div', { text: d }))), this.grid),
      this.side);
    this.render();
  }

  key(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  move(n) { this.cur = new Date(this.cur.getFullYear(), this.cur.getMonth() + n, 1); this.render(); }
  save() { vfs.writeJSON(FILE(), this.events); }

  render() {
    this.title.textContent = `${MONTHS[this.cur.getMonth()]} ${this.cur.getFullYear()}`;
    this.ctx.setTitle('Takvim — ' + this.title.textContent);
    clear(this.grid);
    const first = new Date(this.cur.getFullYear(), this.cur.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first); start.setDate(1 - offset);
    const today = this.key(new Date());

    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const k = this.key(d);
      const evs = this.events[k] || [];
      const cell = h('div.cal-cell', {
        class: [d.getMonth() !== this.cur.getMonth() ? 'dim' : '',
                k === today ? 'today' : '', k === this.key(this.sel) ? 'sel' : ''].filter(Boolean).join(' '),
        onclick: () => { this.sel = d; this.render(); },
        ondblclick: () => this.add(d),
      }, h('div.n', { text: String(d.getDate()) }),
         h('div.evs', ...evs.slice(0, 3).map(e => h('div.ev', { style: { background: e.color || 'var(--accent)' }, title: e.title }))));
      contextMenu(cell, () => [
        { label: 'Etkinlik ekle', glyph: 'plus', run: () => this.add(d) },
        ...(evs.length ? [{ label: 'Günü temizle', danger: true, glyph: 'trash',
          run: () => { delete this.events[k]; this.save(); this.render(); } }] : []),
      ]);
      this.grid.appendChild(cell);
    }
    this.renderSide();
  }

  renderSide() {
    clear(this.side);
    const k = this.key(this.sel);
    const evs = this.events[k] || [];
    this.side.append(
      h('div.sb-title', { text: this.sel.toLocaleDateString('tr', { weekday: 'long', day: 'numeric', month: 'long' }) }),
      ...(evs.length ? evs.map((e, i) => h('div.cal-ev-row',
          h('i', { style: { background: e.color || 'var(--accent)' } }),
          h('div.k-vstack', { style: { flex: 1, gap: '1px' } },
            h('div.k-text', { text: e.title, style: { fontWeight: 530 } }),
            h('div.k-text.t-caption', { text: e.time || 'Tüm gün' })),
          h('button.k-btn.v-ghost.icon.s-sm', { html: icon('x', 13),
            onclick: () => { evs.splice(i, 1); if (!evs.length) delete this.events[k]; this.save(); this.render(); } })))
        : [h('div.k-empty', { style: { padding: '22px 10px' } },
            h('div.glyph', { text: '📅' }), h('div.k-text.t-caption', { text: 'Etkinlik yok' }))]),
      h('button.k-btn.v-tinted.s-sm', { text: 'Bu güne ekle', style: { margin: '10px 8px' },
        onclick: () => this.add(this.sel) }));
  }

  async add(d = this.sel) {
    const title = await notify.prompt('Etkinlik başlığı:', { title: 'Yeni Etkinlik', value: '' });
    if (!title) return;
    const time = await notify.prompt('Saat (isteğe bağlı):', { title: 'Saat', value: '09:00' });
    const k = this.key(d);
    const colors = ['#0a84ff', '#ff453a', '#30d158', '#bf5af2', '#ff9f0a'];
    (this.events[k] ||= []).push({ title, time, color: colors[(this.events[k]?.length || 0) % colors.length] });
    this.save(); this.sel = d; this.render();
  }
}
