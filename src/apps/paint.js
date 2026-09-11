/* ==========================================================================
   OpenOS · apps/paint.js — Çizim
   Basınca duyarlı fırça, şekiller, katmansız ama gerçek bir geri alma yığını
   ve dosya sistemine PNG kaydı.
   ========================================================================== */

import { h, clear, on, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';

export default {
  id: 'paint', name: 'Çizim', glyph: 'paint', tint: ['#ff9f0a', '#c05a00'],
  category: 'media', width: 900, height: 640, minWidth: 520, minHeight: 400,
  keywords: ['çizim', 'boya', 'resim', 'paint', 'karalama'],
  about: 'Fırça, şekil ve metinle çizin; PNG olarak kaydedin.',
  mount(ctx) { return new Paint(ctx).el; },
};

const COLORS = ['#17181c', '#ffffff', '#ff453a', '#ff9f0a', '#ffd60a', '#30d158',
                '#40c8e0', '#0a84ff', '#5e5ce6', '#bf5af2', '#ff375f', '#ac8e68'];

class Paint {
  constructor(ctx) {
    this.ctx = ctx;
    this.dir = VFS.join(vfs.home, 'Resimler');
    vfs.mkdir(this.dir);

    this.tool = 'brush';
    this.color = '#17181c';
    this.size = 6;
    this.undoStack = [];
    this.redoStack = [];
    this.path = ctx.args?.path || null;

    this.canvas = h('canvas.pnt-canvas');
    this.g = this.canvas.getContext('2d', { willReadFrequently: true });
    this.stage = h('div.pnt-stage', this.canvas);
    this.status = h('div.statusbar');

    this.el = h('div.app-shell', this.buildTools(),
      h('div.content', this.stage, this.status));

    contextMenu(this.canvas, () => [
      { header: 'Çizim' },
      { label: 'Geri al', glyph: 'arrowL', key: '⌘Z', run: () => this.undo() },
      { label: 'İleri al', glyph: 'arrowR', run: () => this.redo() },
      '-',
      { label: 'Kaydet', glyph: 'save', key: '⌘S', run: () => this.save() },
      { label: 'Tuvali temizle', glyph: 'trash', danger: true, run: () => this.clearCanvas() },
    ]);

    on(window, 'keydown', this.onKey = e => {
      if (!ctx.win.el.classList.contains('focused')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); this.save(); }
      if (!mod && /^[bepl]$/.test(e.key)) {
        this.setTool({ b: 'brush', e: 'eraser', p: 'picker', l: 'line' }[e.key]);
      }
    });
    ctx.win.onClosed = () => window.removeEventListener('keydown', this.onKey);

    requestAnimationFrame(() => this.init());
    this.ctx.win.wm.bus.on('resized', w => { if (w === this.ctx.win) this.resize(); });
  }

  /* ---------------- araç kutusu ---------------- */
  buildTools() {
    const toolBtn = (id, glyph, title) => {
      const b = h('button.pnt-tool', { html: icon(glyph, 17), title,
        'aria-pressed': String(this.tool === id), onclick: () => this.setTool(id) });
      b.dataset.tool = id;
      return b;
    };
    this.tools = h('div.pnt-tools',
      toolBtn('brush', 'paint', 'Fırça (B)'),
      toolBtn('eraser', 'x', 'Silgi (E)'),
      toolBtn('line', 'minus', 'Çizgi (L)'),
      toolBtn('rect', 'maximize', 'Dikdörtgen'),
      toolBtn('ellipse', 'logo', 'Elips'),
      toolBtn('fill', 'download', 'Doldur'),
      toolBtn('picker', 'eye', 'Renk seç (P)'));

    this.swatches = h('div.pnt-swatches',
      ...COLORS.map(c => h('button.pnt-swatch', { style: { background: c },
        'aria-pressed': String(c === this.color), dataset: { c },
        onclick: () => this.setColor(c) })));
    const custom = h('input', { type: 'color', value: this.color, class: 'pnt-custom' });
    on(custom, 'input', () => this.setColor(custom.value));

    const sizeIn = h('input', { type: 'range', min: '1', max: '60', value: String(this.size), class: 'pnt-size' });
    on(sizeIn, 'input', () => { this.size = +sizeIn.value; this.sizeLabel.textContent = this.size + ' px'; });
    this.sizeLabel = h('div.k-text.t-caption', { text: this.size + ' px' });

    return h('div.sidebar.pnt-side', { style: { width: '176px' } },
      h('div.sb-title', { text: 'Araçlar' }), this.tools,
      h('div.sb-title', { text: 'Renk' }), this.swatches, custom,
      h('div.sb-title', { text: 'Kalınlık' }), sizeIn, this.sizeLabel,
      h('div.k-spacer'),
      h('div.k-vstack', { style: { gap: '6px', padding: '8px' } },
        h('button.k-btn.s-sm', { html: icon('arrowL', 13), text: ' Geri al', onclick: () => this.undo() }),
        h('button.k-btn.s-sm', { html: icon('arrowR', 13), text: ' İleri al', onclick: () => this.redo() }),
        h('button.k-btn.v-primary.s-sm', { html: icon('save', 13), text: ' Kaydet', onclick: () => this.save() }),
        h('button.k-btn.v-danger.s-sm', { text: 'Temizle', onclick: () => this.clearCanvas() })));
  }

  setTool(t) {
    if (!t) return;
    this.tool = t;
    this.tools.querySelectorAll('.pnt-tool').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    this.updateStatus();
  }
  setColor(c) {
    this.color = c;
    this.swatches.querySelectorAll('.pnt-swatch').forEach(b =>
      b.setAttribute('aria-pressed', String(b.dataset.c === c)));
    this.updateStatus();
  }

  /* ---------------- tuval ---------------- */
  init() {
    this.resize(true);
    if (this.path && vfs.exists(this.path)) {
      const img = new Image();
      img.onload = () => {
        this.g.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
        this.snapshot();
      };
      img.src = vfs.read(this.path);
    } else {
      this.clearCanvas(true);
    }
    this.bindDrawing();
    this.updateStatus();
  }

  resize(first) {
    const r = this.stage.getBoundingClientRect();
    const w = Math.max(200, Math.floor(r.width - 24));
    const hh = Math.max(160, Math.floor(r.height - 24));
    if (this.canvas.width === w && this.canvas.height === hh) return;
    const old = (!first && this.canvas.width) ? this.g.getImageData(0, 0, this.canvas.width, this.canvas.height) : null;
    this.canvas.width = w; this.canvas.height = hh;
    this.g.fillStyle = '#ffffff';
    this.g.fillRect(0, 0, w, hh);
    if (old) this.g.putImageData(old, 0, 0);
    this.g.lineCap = 'round'; this.g.lineJoin = 'round';
  }

  clearCanvas(silent) {
    if (!silent) this.snapshot();
    this.g.fillStyle = '#ffffff';
    this.g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (silent) this.snapshot();
  }

  snapshot() {
    try {
      this.undoStack.push(this.g.getImageData(0, 0, this.canvas.width, this.canvas.height));
      if (this.undoStack.length > 25) this.undoStack.shift();
      this.redoStack.length = 0;
    } catch {}
  }
  undo() {
    if (this.undoStack.length < 2) return;
    this.redoStack.push(this.undoStack.pop());
    this.g.putImageData(this.undoStack[this.undoStack.length - 1], 0, 0);
    this.updateStatus();
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(s);
    this.g.putImageData(s, 0, 0);
    this.updateStatus();
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (this.canvas.width / r.width),
      y: (e.clientY - r.top) * (this.canvas.height / r.height),
      p: e.pressure && e.pressure > 0 ? e.pressure : 0.5,
    };
  }

  bindDrawing() {
    let drawing = false, start = null, before = null, last = null;

    on(this.canvas, 'pointerdown', e => {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      const p = this.pos(e);

      if (this.tool === 'picker') { this.pick(p); return; }
      this.snapshot();
      if (this.tool === 'fill') { this.flood(p); return; }

      drawing = true; start = p; last = p;
      before = this.g.getImageData(0, 0, this.canvas.width, this.canvas.height);
      if (this.tool === 'brush' || this.tool === 'eraser') this.stroke(p, p);
    });

    on(this.canvas, 'pointermove', e => {
      const p = this.pos(e);
      this.status.dataset.pos = `${Math.round(p.x)}, ${Math.round(p.y)}`;
      if (!drawing) return;
      if (this.tool === 'brush' || this.tool === 'eraser') { this.stroke(last, p); last = p; }
      else { this.g.putImageData(before, 0, 0); this.shape(start, p); }
    });

    const end = () => { drawing = false; before = null; this.updateStatus(); };
    on(this.canvas, 'pointerup', end);
    on(this.canvas, 'pointercancel', end);
    on(this.canvas, 'pointerleave', () => { if (drawing) end(); });
  }

  stroke(a, b) {
    const g = this.g;
    g.globalCompositeOperation = this.tool === 'eraser' ? 'destination-out' : 'source-over';
    g.strokeStyle = this.color;
    g.lineWidth = Math.max(1, this.size * (0.5 + b.p));
    g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    g.globalCompositeOperation = 'source-over';
  }

  shape(a, b) {
    const g = this.g;
    g.strokeStyle = this.color; g.fillStyle = this.color; g.lineWidth = this.size;
    g.beginPath();
    if (this.tool === 'line') { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    else if (this.tool === 'rect') { g.rect(a.x, a.y, b.x - a.x, b.y - a.y); g.stroke(); }
    else if (this.tool === 'ellipse') {
      g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }

  pick(p) {
    const d = this.g.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
    const hex = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    this.setColor(hex);
    this.setTool('brush');
    notify.toast('Renk alındı: ' + hex, { glyph: '🎨' });
  }

  /** Ölçekli taşma doldurma — kuyruklu, özyinelemesiz. */
  flood(p) {
    const { width: W, height: H } = this.canvas;
    const img = this.g.getImageData(0, 0, W, H);
    const d = img.data;
    const at = (x, y) => (y * W + x) * 4;
    const x0 = Math.round(p.x), y0 = Math.round(p.y);
    if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return;
    const i0 = at(x0, y0);
    const target = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
    const rgb = hexToRgb(this.color);
    if (target[0] === rgb.r && target[1] === rgb.g && target[2] === rgb.b && target[3] === 255) return;

    const stack = [[x0, y0]];
    const tol = 24;
    const match = i => Math.abs(d[i] - target[0]) <= tol && Math.abs(d[i + 1] - target[1]) <= tol
      && Math.abs(d[i + 2] - target[2]) <= tol && Math.abs(d[i + 3] - target[3]) <= tol;

    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const i = at(x, y);
      if (!match(i)) continue;
      d[i] = rgb.r; d[i + 1] = rgb.g; d[i + 2] = rgb.b; d[i + 3] = 255;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    this.g.putImageData(img, 0, 0);
  }

  async save() {
    let p = this.path;
    if (!p) {
      const n = await notify.prompt('Dosya adı:', { value: 'çizim.png', title: 'Kaydet' });
      if (!n) return;
      p = vfs.unique(VFS.join(this.dir, n.endsWith('.png') ? n : n + '.png'));
    }
    vfs.write(p, this.canvas.toDataURL('image/png'));
    this.path = p;
    this.ctx.setTitle('Çizim — ' + VFS.basename(p));
    notify.toast('Kaydedildi', { glyph: '💾' });
    this.updateStatus();
  }

  updateStatus() {
    const names = { brush: 'Fırça', eraser: 'Silgi', line: 'Çizgi', rect: 'Dikdörtgen',
                    ellipse: 'Elips', fill: 'Doldur', picker: 'Renk seç' };
    this.status.textContent =
      `${names[this.tool]} · ${this.size} px · ${this.color} · ` +
      `${this.canvas.width}×${this.canvas.height} · ` +
      `${this.undoStack.length - 1} adım geri alınabilir · ${this.path || 'kaydedilmemiş'}`;
  }
}

function hexToRgb(hex) {
  const s = hex.replace('#', '');
  const v = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
