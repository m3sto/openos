/* ==========================================================================
   OpenOS · ui/menu.js — context menus, dropdown menus, popovers
   ========================================================================== */

import { h, on, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';

let openMenus = [];

export function closeAllMenus() {
  openMenus.forEach(m => { m.el.remove(); m.opts.onClose?.(); });
  openMenus = [];
}

/**
 * items: array of
 *   '-'                                   separator
 *   { header: 'Title' }                   section label
 *   { label, glyph, key, checked, disabled, danger, run, submenu:[...] }
 */
export function menu(items, opts = {}) {
  if (!opts.nested) closeAllMenus();
  const el = h('div.k-menu');
  if (opts.width) el.style.minWidth = opts.width + 'px';

  const build = (list, host) => {
    for (const it of list) {
      if (it === '-' || it === null) { host.appendChild(h('div.mi.sep')); continue; }
      if (it.header) { host.appendChild(h('div.head', { text: it.header })); continue; }
      const row = h('div.mi', { class: [it.disabled && 'disabled', it.danger && 'danger'].filter(Boolean).join(' ') },
        it.checked !== undefined ? h('span.tick', { html: it.checked ? icon('check', 12, 2.4) : '' }) : null,
        it.glyph ? h('span.k-icon', { html: it.glyph.length <= 3 && !/^[a-z]+$/i.test(it.glyph) ? it.glyph : icon(it.glyph, 14) }) : null,
        h('span', { text: it.label }),
        it.submenu ? h('span.key', { html: icon('chevronR', 12) }) : (it.key ? h('span.key', { text: it.key }) : null),
      );
      if (it.danger) row.style.color = 'var(--red)';
      if (!it.disabled) {
        if (it.submenu) {
          let sub = null;
          row.addEventListener('pointerenter', () => {
            if (sub) return;
            const r = row.getBoundingClientRect();
            sub = menu(it.submenu, { x: r.right - 4, y: r.top - 5, nested: true });
            row.addEventListener('pointerleave', e => {
              if (sub && !sub.contains(e.relatedTarget)) { sub.remove(); sub = null; }
            }, { once: true });
          });
        } else {
          row.addEventListener('click', () => { closeAllMenus(); setTimeout(() => it.run?.(), 0); });
        }
      }
      host.appendChild(row);
    }
  };
  build(items, el);

  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  let x = opts.x ?? 0, y = opts.y ?? 0;
  if (opts.anchor) {
    const a = opts.anchor.getBoundingClientRect();
    x = a.left; y = a.bottom + 4;
    el.style.transformOrigin = 'top left';
  }
  x = clamp(x, 4, window.innerWidth - r.width - 4);
  y = clamp(y, 4, window.innerHeight - r.height - 4);
  el.style.left = x + 'px'; el.style.top = y + 'px';

  const entry = { el, opts };
  openMenus.push(entry);
  if (!opts.nested) {
    setTimeout(() => {
      const off1 = on(window, 'pointerdown', e => {
        if (openMenus.some(m => m.el.contains(e.target))) return;
        if (opts.ignore && opts.ignore.contains?.(e.target)) return;
        off1(); off2(); closeAllMenus();
      }, true);
      const off2 = on(window, 'keydown', e => {
        if (e.key === 'Escape') { off1(); off2(); closeAllMenus(); }
      }, true);
    }, 0);
  }
  return el;
}

/** Bind a right-click context menu to an element. */
export function contextMenu(el, builder) {
  return on(el, 'contextmenu', e => {
    const items = typeof builder === 'function' ? builder(e) : builder;
    if (!items || !items.length) return;
    e.preventDefault(); e.stopPropagation();
    menu(items, { x: e.clientX, y: e.clientY });
  });
}

/** A free-form popover panel anchored to an element. */
export function popover(content, { anchor, x, y, width, onClose } = {}) {
  closeAllMenus();
  const el = h('div.k-menu', { style: { padding: '10px', minWidth: (width || 220) + 'px' } }, content);
  document.body.appendChild(el);
  const r = el.getBoundingClientRect();
  let px = x ?? 0, py = y ?? 0;
  if (anchor) { const a = anchor.getBoundingClientRect(); px = a.right - r.width; py = a.bottom + 5; }
  el.style.left = clamp(px, 4, window.innerWidth - r.width - 4) + 'px';
  el.style.top = clamp(py, 4, window.innerHeight - r.height - 4) + 'px';
  openMenus.push({ el, opts: { onClose } });
  setTimeout(() => {
    const off = on(window, 'pointerdown', e => {
      if (el.contains(e.target)) return;
      off(); closeAllMenus();
    }, true);
  }, 0);
  return el;
}
