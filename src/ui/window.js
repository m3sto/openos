/* ==========================================================================
   OpenOS · ui/window.js — the window manager
   ========================================================================== */

import { h, clamp, uid, Bus, drag, once, $ } from '../core/util.js';
import { icon } from '../core/icons.js';
import settings from '../core/settings.js';
import { Jelly } from './jelly.js';

const MENUBAR = 28;
const EDGE = 6;

export class Win {
  constructor(wm, app, opts = {}) {
    this.wm = wm;
    this.app = app;
    this.id = uid('win');
    this.args = opts.args || {};
    this.state = 'normal';
    this.title = opts.title || app.name;

    /* The layer can report 0 while the tab is hidden or mid-resize; never let
       that collapse a window to a negative size. */
    const vw = Math.max(320, wm.layer.clientWidth || window.innerWidth || 1024);
    const vh = Math.max(240, wm.layer.clientHeight || window.innerHeight || 768);
    const minW = app.minWidth || 320, minH = app.minHeight || 200;
    const w = Math.max(minW, Math.min(opts.width || app.width, vw - 40));
    const hh = Math.max(minH, Math.min(opts.height || app.height, vh - MENUBAR - 70));
    const off = (wm.order.length % 7) * 26;
    this.w = w; this.h = hh;
    this.x = clamp(Math.round((vw - w) / 2) + off - 60, 12, Math.max(12, vw - w - 12));
    this.y = clamp(Math.round((vh - hh) / 2.4) + off - 30, MENUBAR + 8, Math.max(MENUBAR + 8, vh - hh - 40));

    this.build();
    this.jelly = new Jelly(this.el);
    wm.attach(this);
    if (Jelly.enabled) setTimeout(() => this.jelly.pulse(0.05, 4), 60);
  }

  build() {
    const a = this.app;
    const trafficBtn = (cls, name, fn, label) =>
      h('button.' + cls, { title: label, onclick: e => { e.stopPropagation(); fn(); },
        html: `<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="#000"
                stroke-width="1.5" stroke-linecap="round">${name}</svg>` });

    this.traffic = h('div.traffic',
      trafficBtn('c', '<path d="M3.6 3.6l4.8 4.8M8.4 3.6l-4.8 4.8"/>', () => this.close(), 'Kapat'),
      trafficBtn('m', '<path d="M3.2 6h5.6"/>', () => this.minimize(), 'Küçült'),
      trafficBtn('z', '<path d="M3.4 6h5.2M6 3.4v5.2"/>', () => this.toggleMax(), 'Büyüt'),
    );

    this.titleEl = h('div.win-title', { text: this.title });
    this.trail = h('div.trail');
    this.bar = h('div.win-bar', this.traffic, this.titleEl, this.trail);
    this.body = h('div.win-body');

    this.el = h('div.win', { dataset: { app: a.id, id: this.id } }, this.bar, this.body);
    if (a.resizable !== false) {
      ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'].forEach(d =>
        this.el.appendChild(h('div.rz.' + d, { onpointerdown: e => this.startResize(e, d) })));
    }
    this.place();

    this.bar.addEventListener('pointerdown', e => {
      if (e.target.closest('button, .tbtn, input, select')) return;
      this.focus(); this.startDrag(e);
    });
    this.bar.addEventListener('dblclick', e => {
      if (e.target.closest('button, .tbtn')) return;
      this.toggleMax();
    });
    this.el.addEventListener('pointerdown', () => this.focus(), true);
  }

  /* ---------------- geometry ---------------- */
  place() {
    const s = this.el.style;
    const n = (v, fallback) => (Number.isFinite(v) ? v : fallback);
    this.x = n(this.x, 40); this.y = n(this.y, MENUBAR + 12);
    this.w = Math.max(this.app.minWidth || 260, n(this.w, 720));
    this.h = Math.max(this.app.minHeight || 180, n(this.h, 480));
    s.left = this.x + 'px'; s.top = this.y + 'px';
    s.width = this.w + 'px'; s.height = this.h + 'px';
  }
  setBounds(x, y, w, hh, animate) {
    this.x = Math.round(x); this.y = Math.round(y);
    this.w = Math.round(w); this.h = Math.round(hh);
    if (animate) {
      this.el.classList.add('snapping');
      setTimeout(() => this.el.classList.remove('snapping'), 220);
    }
    this.place();
    this.wm.bus.emit('resize', this);
  }
  setTitle(t) { this.title = t; this.titleEl.textContent = t; this.wm.bus.emit('title', this); }

  /** Add a toolbar button to the title bar's trailing edge. */
  addBarButton({ glyph, title, onClick, id }) {
    const b = h('button.tbtn', { title, dataset: { id: id || '' }, html: icon(glyph, 16), onclick: onClick });
    this.trail.appendChild(b);
    return b;
  }

  /* ---------------- interaction ---------------- */
  startDrag(e) {
    if (this.state === 'full') return;
    const ox = this.x, oy = this.y;
    const wasMax = this.state === 'max';
    const relX = (e.clientX - this.x) / this.w;
    let hint = null;
    this.el.classList.add('dragging');
    this.jelly.begin(e.clientX, e.clientY, {
      px: (e.clientX - this.x) / this.w,
      py: (e.clientY - this.y) / this.h,
    });

    drag(e, {
      cursor: 'default',
      onMove: ({ dx, dy, x, y, moved }) => {
        if (!moved) return;
        this.jelly.move(x, y);
        if (wasMax && this.state === 'max') {
          this.unmaximize(true);
          this.x = clamp(x - this.w * relX, 0, this.wm.layer.clientWidth - this.w);
          this.y = Math.max(MENUBAR, y - 18);
          this.place();
          return;
        }
        this.x = ox + dx;
        this.y = Math.max(MENUBAR, oy + dy);
        this.place();
        const z = this.wm.snapZone(x, y);
        if (z) { hint = this.wm.showSnapHint(z); } else { this.wm.hideSnapHint(); hint = null; }
      },
      onEnd: ({ x, y, moved }) => {
        this.el.classList.remove('dragging');
        this.jelly.end();
        this.wm.hideSnapHint();
        if (moved) {
          const z = this.wm.snapZone(x, y);
          if (z) this.wm.applySnap(this, z);
          else this.clampIntoView();
        }
      },
    });
  }

  startResize(e, dir) {
    e.stopPropagation();
    if (this.state !== 'normal') this.unmaximize();
    this.focus();
    const o = { x: this.x, y: this.y, w: this.w, h: this.h };
    const min = { w: this.app.minWidth || 320, h: this.app.minHeight || 200 };
    this.el.classList.add('resizing');
    this.jelly.begin(e.clientX, e.clientY, {
      px: dir.includes('w') ? 1 : dir.includes('e') ? 0 : 0.5,
      py: dir.includes('n') ? 1 : dir.includes('s') ? 0 : 0.5,
    });
    drag(e, {
      onMove: ({ dx, dy }) => {
        let { x, y, w, h: hh } = o;
        if (dir.includes('e')) w = Math.max(min.w, o.w + dx);
        if (dir.includes('s')) hh = Math.max(min.h, o.h + dy);
        if (dir.includes('w')) { w = Math.max(min.w, o.w - dx); x = o.x + (o.w - w); }
        if (dir.includes('n')) { hh = Math.max(min.h, o.h - dy); y = Math.max(MENUBAR, o.y + (o.h - hh)); }
        this.setBounds(x, y, w, hh);
      },
      onEnd: () => {
        this.el.classList.remove('resizing');
        this.jelly.end();
        this.wm.bus.emit('resized', this);
      },
    });
  }

  clampIntoView() {
    const vw = this.wm.layer.clientWidth, vh = this.wm.layer.clientHeight;
    this.x = clamp(this.x, -this.w + 90, vw - 90);
    this.y = clamp(this.y, MENUBAR, vh - 40);
    this.place();
  }

  /* ---------------- state ---------------- */
  focus() {
    if (this.wm.focused === this && this.state !== 'min') return;
    this.wm.focus(this);
  }

  toggleMax() { this.state === 'max' ? this.unmaximize(false, true) : this.maximize(); }

  maximize() {
    if (this.state === 'max') return;
    this._restore = { x: this.x, y: this.y, w: this.w, h: this.h };
    this.state = 'max';
    this.el.classList.add('maxed', 'snapping');
    const vw = this.wm.layer.clientWidth, vh = this.wm.layer.clientHeight;
    const dockGap = settings.get('dock.autohide') ? 6 : (settings.get('dock.size') + 22);
    this.setBounds(0, MENUBAR, vw, vh - MENUBAR - (settings.get('dock.position') === 'bottom' ? dockGap : 6));
    setTimeout(() => { this.el.classList.remove('snapping'); this.jelly.pulse(0.05, 0); }, 230);
    this.wm.bus.emit('state', this);
  }
  unmaximize(silent, animate) {
    if (this.state !== 'max' && this.state !== 'snap') return;
    this.state = 'normal';
    this.el.classList.remove('maxed');
    const r = this._restore;
    if (r && !silent) this.setBounds(r.x, r.y, r.w, r.h, animate);
    this.wm.bus.emit('state', this);
  }

  fullscreen() {
    if (this.state === 'full') { this.el.classList.remove('maxed'); this.state = 'normal';
      const r = this._restore; if (r) this.setBounds(r.x, r.y, r.w, r.h, true); this.wm.bus.emit('state', this); return; }
    this._restore = { x: this.x, y: this.y, w: this.w, h: this.h };
    this.state = 'full';
    this.el.classList.add('maxed');
    this.setBounds(0, 0, this.wm.layer.clientWidth, this.wm.layer.clientHeight, true);
    this.wm.bus.emit('state', this);
  }

  minimize() {
    if (this.state === 'min') return;
    this._preMin = this.state;
    this.state = 'min';
    const target = this.wm.dockTarget?.(this.app.id);
    if (target) {
      const dx = target.x - (this.x + this.w / 2), dy = target.y - (this.y + this.h / 2);
      this.el.style.transformOrigin = 'center';
      this.el.style.transform = `translate(${dx}px, ${dy}px) scale(.06)`;
    } else this.el.style.transform = 'scale(.05)';
    this.el.classList.add('minimizing');
    setTimeout(() => { this.el.style.display = 'none'; }, 340);
    this.wm.bus.emit('minimize', this);
    this.wm.focusNext(this);
  }
  restore() {
    if (this.state !== 'min') return;
    this.el.style.display = '';
    requestAnimationFrame(() => {
      this.el.classList.remove('minimizing');
      this.el.style.transform = '';
    });
    this.state = this._preMin === 'max' ? 'max' : 'normal';
    this.wm.focus(this);
    this.wm.bus.emit('restore', this);
  }

  close() {
    if (this._closing) return;
    if (this.onBeforeClose && this.onBeforeClose() === false) return;
    this._closing = true;
    this.el.classList.add('closing');
    this.wm.bus.emit('close', this);
    this.jelly.destroy();
    once(this.el, 'animationend', () => {
      this.el.remove();
      this.wm.detach(this);
      this.onClosed?.();
    });
    setTimeout(() => { if (this.el.isConnected) { this.el.remove(); this.wm.detach(this); } }, 400);
  }
}

export class WindowManager {
  constructor() {
    this.bus = new Bus();
    this.wins = new Map();
    this.order = [];
    this.focused = null;
    this.z = 100;
    this.snapHint = null;
  }

  mount(layer) {
    this.layer = layer;
    window.addEventListener('resize', () => {
      const vw = layer.clientWidth, vh = layer.clientHeight;
      for (const w of this.wins.values()) {
        if (w.w > vw - 20 || w.h > vh - 60) {
          w.w = Math.min(w.w, Math.max(w.app.minWidth || 320, vw - 40));
          w.h = Math.min(w.h, Math.max(w.app.minHeight || 200, vh - MENUBAR - 70));
        }
        if (w.state === 'max') w.maximize();
        else if (w.state === 'full') w.setBounds(0, 0, layer.clientWidth, layer.clientHeight);
        else w.clampIntoView();
      }
    });
  }

  open(app, opts = {}) {
    if (app.singleton) {
      const ex = [...this.wins.values()].find(w => w.app.id === app.id);
      if (ex) {
        if (ex.state === 'min') ex.restore(); else this.focus(ex);
        if (opts.args && ex.onArgs) ex.onArgs(opts.args);
        return ex;
      }
    }
    const win = new Win(this, app, opts);
    return win;
  }

  attach(win) {
    this.wins.set(win.id, win);
    this.order.push(win);
    this.layer.appendChild(win.el);
    this.focus(win);
    this.bus.emit('open', win);
  }
  detach(win) {
    this.wins.delete(win.id);
    this.order = this.order.filter(w => w !== win);
    if (this.focused === win) { this.focused = null; this.focusNext(win); }
    this.bus.emit('closed', win);
  }

  focus(win) {
    if (!win || win.state === 'min') return;
    this.focused?.el.classList.remove('focused');
    this.focused = win;
    win.el.classList.add('focused');
    win.el.style.zIndex = ++this.z;
    this.order = this.order.filter(w => w !== win).concat(win);
    this.bus.emit('focus', win);
  }
  focusNext(except) {
    const next = [...this.order].reverse().find(w => w !== except && w.state !== 'min');
    if (next) this.focus(next);
    else { this.focused = null; this.bus.emit('focus', null); }
  }
  byApp(id) { return [...this.wins.values()].filter(w => w.app.id === id); }
  list() { return [...this.wins.values()]; }

  closeAll(appId) { this.byApp(appId).forEach(w => w.close()); }

  cycle(back = false) {
    const open = this.order.filter(w => w.state !== 'min');
    if (open.length < 2) { open[0]?.focus(); return; }
    const i = open.indexOf(this.focused);
    const n = open[(i + (back ? -1 : 1) + open.length) % open.length];
    this.focus(n);
  }

  /* ---------------- snapping ---------------- */
  snapZone(x, y) {
    const vw = this.layer.clientWidth, vh = this.layer.clientHeight;
    if (y <= MENUBAR + EDGE) return 'top';
    if (x <= EDGE) return y > vh * 0.62 ? 'bl' : (y < vh * 0.38 ? 'tl' : 'left');
    if (x >= vw - EDGE) return y > vh * 0.62 ? 'br' : (y < vh * 0.38 ? 'tr' : 'right');
    return null;
  }
  zoneRect(z) {
    const vw = this.layer.clientWidth;
    const top = MENUBAR;
    const dock = settings.get('dock.autohide') ? 8 : settings.get('dock.size') + 24;
    const vh = this.layer.clientHeight - top - dock;
    const half = { w: Math.round(vw / 2), h: Math.round(vh / 2) };
    switch (z) {
      case 'top':   return { x: 0, y: top, w: vw, h: vh };
      case 'left':  return { x: 0, y: top, w: half.w, h: vh };
      case 'right': return { x: half.w, y: top, w: vw - half.w, h: vh };
      case 'tl':    return { x: 0, y: top, w: half.w, h: half.h };
      case 'tr':    return { x: half.w, y: top, w: vw - half.w, h: half.h };
      case 'bl':    return { x: 0, y: top + half.h, w: half.w, h: vh - half.h };
      case 'br':    return { x: half.w, y: top + half.h, w: vw - half.w, h: vh - half.h };
      default: return null;
    }
  }
  showSnapHint(z) {
    const r = this.zoneRect(z);
    if (!this.snapHint) { this.snapHint = h('div.snap-hint'); this.layer.appendChild(this.snapHint); }
    Object.assign(this.snapHint.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
    return r;
  }
  hideSnapHint() { this.snapHint?.remove(); this.snapHint = null; }
  applySnap(win, z) {
    const r = this.zoneRect(z);
    if (z === 'top') { win.maximize(); return; }
    win._restore = win._restore || { x: win.x, y: win.y, w: win.w, h: win.h };
    win.state = 'snap';
    win.setBounds(r.x, r.y, r.w, r.h, true);
    setTimeout(() => win.jelly.pulse(0.055, 0), 210);
  }

  /** Tile every visible window in a grid (Mission Control "tidy"). */
  tile() {
    const open = this.list().filter(w => w.state !== 'min');
    if (!open.length) return;
    const cols = Math.ceil(Math.sqrt(open.length));
    const rows = Math.ceil(open.length / cols);
    const vw = this.layer.clientWidth, top = MENUBAR;
    const vh = this.layer.clientHeight - top - (settings.get('dock.size') + 26);
    open.forEach((w, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      const cw = vw / cols, ch = vh / rows;
      w.state = 'normal'; w.el.classList.remove('maxed');
      w.setBounds(c * cw + 6, top + r * ch + 6, cw - 12, ch - 12, true);
    });
  }
}

export const wm = new WindowManager();
export default wm;
