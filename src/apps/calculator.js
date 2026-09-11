/* ==========================================================================
   OpenOS · apps/calculator.js
   ========================================================================== */

import { h, on } from '../core/util.js';
import { contextMenu } from '../ui/menu.js';

export default {
  id: 'calculator', name: 'Hesap Makinesi', glyph: 'calc', tint: ['#ff9f0a', '#c96f00'],
  category: 'util', width: 286, height: 404, minWidth: 240, minHeight: 340, resizable: false,
  keywords: ['hesap', 'matematik', 'calc'],
  about: 'Klavye ile de kullanılabilen hesap makinesi.',
  mount(ctx) { return new Calc(ctx).el; },
};

const KEYS = [
  ['AC', 'fn'], ['±', 'fn'], ['%', 'fn'], ['÷', 'op'],
  ['7', ''], ['8', ''], ['9', ''], ['×', 'op'],
  ['4', ''], ['5', ''], ['6', ''], ['−', 'op'],
  ['1', ''], ['2', ''], ['3', ''], ['+', 'op'],
  ['0', 'wide'], [',', ''], ['=', 'op eq'],
];

class Calc {
  constructor(ctx) {
    this.ctx = ctx;
    this.cur = '0'; this.prev = null; this.op = null; this.fresh = true;
    this.display = h('div.calc-display', { text: '0' });
    this.tape = h('div.calc-tape');
    const pad = h('div.calc-pad');
    KEYS.forEach(([label, cls]) => {
      const b = h('button.calc-key', { class: cls, text: label, onclick: () => this.press(label) });
      pad.appendChild(b);
    });
    this.el = h('div.calc', this.tape, this.display, pad);
    contextMenu(this.el, () => [
      { header: 'Hesap Makinesi' },
      { label: 'Sonucu kopyala', glyph: 'copy',
        run: () => navigator.clipboard?.writeText(this.display.textContent) },
      { label: 'Panodan yapıştır', glyph: 'download', run: async () => {
        try {
          const t = (await navigator.clipboard.readText()).replace(/[^0-9.,-]/g, '');
          if (t) { this.cur = t.replace('.', ','); this.fresh = false; this.show(this.cur); }
        } catch {}
      } },
      '-',
      { label: 'Temizle', glyph: 'trash', run: () => this.press('AC') },
      { label: 'Son basamağı sil', glyph: 'arrowL', run: () => this.press('⌫') },
    ]);
    on(window, 'keydown', this.onKey = e => {
      if (!this.el.isConnected || !ctx.win.el.classList.contains('focused')) return;
      const map = { '/': '÷', '*': '×', '-': '−', Enter: '=', '=': '=', Escape: 'AC', Backspace: '⌫', '.': ',', ',': ',' };
      const k = map[e.key] || (/^[0-9+%]$/.test(e.key) ? e.key : null);
      if (k) { e.preventDefault(); this.press(k); }
    });
    ctx.win.onClosed = () => window.removeEventListener('keydown', this.onKey);
  }

  show(v) {
    const s = typeof v === 'number'
      ? (Math.abs(v) > 1e12 ? v.toExponential(6) : (+v.toFixed(10)).toLocaleString('tr-TR', { maximumFractionDigits: 10 }))
      : v;
    this.display.textContent = s;
    this.display.style.fontSize = String(s).length > 9 ? '30px' : '44px';
  }

  press(k) {
    if (/[0-9]/.test(k)) {
      this.cur = this.fresh ? k : (this.cur === '0' ? k : this.cur + k);
      this.fresh = false;
    } else if (k === ',') {
      if (this.fresh) { this.cur = '0,'; this.fresh = false; }
      else if (!this.cur.includes(',')) this.cur += ',';
    } else if (k === 'AC') { this.cur = '0'; this.prev = null; this.op = null; this.fresh = true; this.tape.textContent = ''; }
    else if (k === '⌫') { this.cur = this.cur.length > 1 ? this.cur.slice(0, -1) : '0'; }
    else if (k === '±') { this.cur = this.cur.startsWith('-') ? this.cur.slice(1) : '-' + this.cur; }
    else if (k === '%') { this.cur = String(this.val() / 100).replace('.', ','); }
    else if (['+', '−', '×', '÷'].includes(k)) {
      if (this.op && !this.fresh) this.equals(true);
      this.prev = this.val(); this.op = k; this.fresh = true;
      this.tape.textContent = `${fmt(this.prev)} ${k}`;
    } else if (k === '=') this.equals();
    this.show(this.fresh && this.op ? this.prev : this.cur.replace('.', ','));
  }

  val() { return parseFloat(this.cur.replace(',', '.')) || 0; }

  equals(chain) {
    if (this.op === null || this.prev === null) return;
    const b = this.val();
    const a = this.prev;
    let r = 0;
    switch (this.op) {
      case '+': r = a + b; break;
      case '−': r = a - b; break;
      case '×': r = a * b; break;
      case '÷': r = b === 0 ? NaN : a / b; break;
    }
    this.tape.textContent = `${fmt(a)} ${this.op} ${fmt(b)} =`;
    this.cur = Number.isFinite(r) ? String(r).replace('.', ',') : 'Hata';
    this.prev = Number.isFinite(r) ? r : null;
    this.fresh = true;
    if (!chain) this.op = null;
    this.show(this.cur);
  }
}
const fmt = n => (+n.toFixed(10)).toLocaleString('tr-TR', { maximumFractionDigits: 10 });
