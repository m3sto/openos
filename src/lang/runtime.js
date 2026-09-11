/* ==========================================================================
   OpenSharp · runtime.js — the element tree → real DOM, using the OS UI kit
   ========================================================================== */

import { h, add, clamp, uid, setStyle } from '../core/util.js';
import { icon, hasIcon } from '../core/icons.js';
import { str, num, truthy, OshElement } from './interpreter.js';

const px = v => (typeof v === 'number' ? v + 'px' : v);

/* Props understood by every component. */
function applyCommon(node, p) {
  const s = node.style;
  if (p.width !== undefined) s.width = px(p.width);
  if (p.height !== undefined) s.height = px(p.height);
  if (p.minWidth !== undefined) s.minWidth = px(p.minWidth);
  if (p.maxWidth !== undefined) s.maxWidth = px(p.maxWidth);
  if (p.padding !== undefined) s.padding = px(p.padding);
  if (p.margin !== undefined) s.margin = px(p.margin);
  if (p.background !== undefined) s.background = p.background;
  if (p.radius !== undefined) s.borderRadius = px(p.radius);
  if (p.color !== undefined) s.color = p.color;
  if (p.opacity !== undefined) s.opacity = p.opacity;
  if (p.grow) s.flex = '1 1 auto';
  if (p.border !== undefined) s.border = p.border;
  if (p.shadow !== undefined) s.boxShadow = p.shadow === true ? 'var(--sh-2)' : p.shadow;
  if (p.hidden) s.display = 'none';
  if (p.font !== undefined) s.fontSize = px(p.font);
  if (p.weight !== undefined) s.fontWeight = p.weight;
  if (p.class) node.className += ' ' + p.class;
  if (p.id) node.dataset.oshId = p.id;
  if (p.tip) node.title = p.tip;
  if (p.style && typeof p.style === 'object') setStyle(node, p.style);
  return node;
}

const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch',
                leading: 'flex-start', trailing: 'flex-end' };

function stack(dir, el, api) {
  const p = el.props;
  const node = h(dir === 'v' ? 'div.k-vstack' : 'div.k-hstack');
  if (p.spacing !== undefined || p.gap !== undefined) node.style.gap = px(p.spacing ?? p.gap);
  if (p.align) node.style.alignItems = ALIGN[p.align] || p.align;
  if (p.justify) node.style.justifyContent = ALIGN[p.justify] || p.justify;
  if (p.wrap) node.classList.add('k-wrap');
  if (p.scroll) node.classList.add('k-scroll');
  applyCommon(node, p);
  add(node, [api.render(el.children)]);
  return node;
}

function handler(api, fn, transform) {
  if (!fn) return null;
  return (...a) => api.invoke(fn, transform ? transform(...a) : a);
}

export const COMPONENTS = {
  /* ---------------- layout ---------------- */
  VStack: (el, api) => stack('v', el, api),
  HStack: (el, api) => stack('h', el, api),
  Stack:  (el, api) => stack(el.props.axis === 'h' ? 'h' : 'v', el, api),
  ZStack: (el, api) => applyCommon(add(h('div.k-zstack'), [api.render(el.children)]), el.props),
  Spacer: () => h('div.k-spacer'),
  Divider: (el) => applyCommon(h('div.k-divider'), el.props),
  ScrollView: (el, api) => {
    const n = h('div.k-scroll.k-vstack', { style: { flex: '1 1 auto' } });
    if (el.props.spacing) n.style.gap = px(el.props.spacing);
    if (el.props.padding !== undefined) n.style.padding = px(el.props.padding);
    applyCommon(n, el.props);
    add(n, [api.render(el.children)]);
    return n;
  },
  Grid: (el, api) => {
    const p = el.props;
    const n = h('div.k-grid');
    const cols = p.columns ?? p.cols ?? 2;
    n.style.gridTemplateColumns = typeof cols === 'number'
      ? `repeat(${cols}, minmax(0, 1fr))`
      : (typeof cols === 'string' ? cols : 'repeat(auto-fill, minmax(140px, 1fr))');
    if (p.gap !== undefined || p.spacing !== undefined) n.style.gap = px(p.gap ?? p.spacing);
    applyCommon(n, p);
    add(n, [api.render(el.children)]);
    return n;
  },
  Card: (el, api) => {
    const n = h('div.k-card.k-vstack');
    if (el.props.spacing) n.style.gap = px(el.props.spacing);
    applyCommon(n, el.props);
    if (el.args[0]) n.appendChild(h('div.k-text.t-headline', { text: str(el.args[0]), style: { marginBottom: '6px' } }));
    add(n, [api.render(el.children)]);
    return n;
  },
  Section: (el, api) => {
    const n = h('div.k-vstack', { style: { gap: '6px' } });
    if (el.args[0]) n.appendChild(h('div.k-sectitle', { text: str(el.args[0]) }));
    const g = h('div.k-group');
    add(g, [api.render(el.children)]);
    n.appendChild(g);
    return applyCommon(n, el.props);
  },

  /* ---------------- text ---------------- */
  Label: (el) => {
    const p = el.props;
    const styleName = p.style && typeof p.style === 'string' ? p.style : (p.variant || 'body');
    const map = { display: 't-display', largeTitle: 't-largetitle', title: 't-title', title2: 't-title2',
                  headline: 't-headline', body: 't-body', callout: 't-callout', caption: 't-caption',
                  mono: 't-mono', secondary: 't-secondary', tertiary: 't-tertiary' };
    const n = h('div.k-text', { class: map[styleName] || 't-body' });
    n.textContent = str(el.args[0] ?? p.text ?? '');
    if (p.align) n.style.textAlign = p.align;
    if (p.tint) n.style.color = p.tint;
    if (p.wrap !== false) n.classList.add('t-wrap');
    if (p.lines) { n.style.display = '-webkit-box'; n.style.webkitLineClamp = p.lines;
                   n.style.webkitBoxOrient = 'vertical'; n.style.overflow = 'hidden'; }
    return applyCommon(n, { ...p, style: typeof p.style === 'object' ? p.style : undefined });
  },
  Text: (...a) => COMPONENTS.Label(...a),
  Title: (el) => COMPONENTS.Label({ ...el, props: { ...el.props, style: 'title' } }),
  Caption: (el) => COMPONENTS.Label({ ...el, props: { ...el.props, style: 'caption' } }),
  Code: (el) => applyCommon(h('pre.k-text.t-mono', {
    text: str(el.args[0] ?? ''),
    style: { background: 'var(--surface-2)', padding: '10px 12px', borderRadius: 'var(--r-sm)',
             overflow: 'auto', margin: '0', whiteSpace: 'pre-wrap' },
  }), el.props),

  /* ---------------- controls ---------------- */
  Button: (el, api) => {
    const p = el.props;
    const n = h('button.k-btn', {
      class: [`v-${p.variant || 'secondary'}`, p.size ? `s-${p.size}` : '', p.full ? 'full' : '',
              p.round ? 'round' : ''].filter(Boolean).join(' '),
      disabled: !!p.disabled,
    });
    if (p.icon) n.appendChild(h('span.k-icon', { html: hasIcon(p.icon) ? icon(p.icon, 15) : p.icon }));
    const label = str(el.args[0] ?? p.title ?? '');
    if (label) n.appendChild(h('span', { text: label }));
    else if (p.icon) n.classList.add('icon');
    const cb = p.onClick || p.on_click || p.action || el.args[1];
    if (cb) n.addEventListener('click', () => api.invoke(cb, []));
    return applyCommon(n, p);
  },

  TextField: (el, api) => {
    const p = el.props;
    const input = h('input', {
      type: p.secure ? 'password' : (p.type || 'text'),
      value: str(el.args[0] ?? p.value ?? ''),
      placeholder: str(p.placeholder ?? el.args[1] ?? ''),
    });
    const n = h('div.k-field', input);
    if (p.icon) n.prepend(h('span.k-icon', { html: icon(p.icon, 14), style: { color: 'var(--text-3)' } }));
    input.addEventListener('input', () => {
      if (p.bind) api.setState(p.bind, input.value);
      api.invoke(p.onChange || p.on_change, [input.value]);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') api.invoke(p.onSubmit || p.on_submit, [input.value]);
    });
    api.keepFocus(input, p.id || p.bind);
    return applyCommon(n, p);
  },

  TextArea: (el, api) => {
    const p = el.props;
    const ta = h('textarea', {
      value: str(el.args[0] ?? p.value ?? ''),
      placeholder: str(p.placeholder ?? ''),
      rows: p.rows || 5,
    });
    const n = h('div.k-field.area', ta);
    ta.addEventListener('input', () => {
      if (p.bind) api.setState(p.bind, ta.value);
      api.invoke(p.onChange, [ta.value]);
    });
    api.keepFocus(ta, p.id || p.bind);
    return applyCommon(n, p);
  },

  Toggle: (el, api) => {
    const p = el.props;
    const on = truthy(p.value ?? el.args[1] ?? false);
    const sw = h('div.k-toggle', { dataset: { on: on ? '1' : '0' } });
    const label = str(el.args[0] ?? p.label ?? '');
    const row = h('div.k-hstack', { style: { gap: '10px' } },
      label ? h('div.k-text', { text: label, style: { flex: '1' } }) : null, sw);
    const fire = () => {
      const v = !truthy(p.value ?? false);
      if (p.bind) api.setState(p.bind, v);
      api.invoke(p.onChange, [v]);
    };
    row.addEventListener('click', fire);
    return applyCommon(row, p);
  },

  Checkbox: (el, api) => {
    const p = el.props;
    const on = truthy(p.value);
    const box = h('div', { style: {
      width: '17px', height: '17px', borderRadius: '5px', flex: '0 0 auto',
      background: on ? 'var(--accent)' : 'var(--surface-2)',
      boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--hairline)',
      display: 'grid', placeItems: 'center', color: '#fff',
    }, html: on ? icon('check', 12, 2.6) : '' });
    const row = h('div.k-hstack', { style: { gap: '8px', cursor: 'default' } },
      box, h('div.k-text', { text: str(el.args[0] ?? p.label ?? '') }));
    row.addEventListener('click', () => {
      if (p.bind) api.setState(p.bind, !on);
      api.invoke(p.onChange, [!on]);
    });
    return applyCommon(row, p);
  },

  Slider: (el, api) => {
    const p = el.props;
    const min = num(p.min ?? 0), max = num(p.max ?? 100);
    const val = clamp(num(p.value ?? el.args[0] ?? min), min, max);
    const pct = ((val - min) / (max - min || 1)) * 100;
    const fill = h('i.fill', { style: { width: pct + '%' } });
    const knob = h('i.knob', { style: { left: pct + '%' } });
    const n = h('div.k-slider', h('i.track'), fill, knob);
    const set = e => {
      const r = n.getBoundingClientRect();
      let v = min + ((e.clientX - r.left) / r.width) * (max - min);
      if (p.step) v = Math.round(v / num(p.step)) * num(p.step);
      v = clamp(v, min, max);
      fill.style.width = knob.style.left = (((v - min) / (max - min || 1)) * 100) + '%';
      if (p.bind) api.setState(p.bind, v);
      api.invoke(p.onChange, [v]);
    };
    n.addEventListener('pointerdown', e => {
      n.setPointerCapture(e.pointerId); set(e);
      const mv = ev => set(ev);
      const up = () => { n.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      n.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    return applyCommon(n, p);
  },

  Select: (el, api) => {
    const p = el.props;
    const opts = p.options || el.args[0] || [];
    const sel = h('select.k-select');
    for (const o of opts) {
      const value = (o && typeof o === 'object') ? str(o.value ?? o.id) : str(o);
      const label = (o && typeof o === 'object') ? str(o.label ?? o.name ?? value) : str(o);
      sel.appendChild(h('option', { value, text: label, selected: value === str(p.value) }));
    }
    sel.addEventListener('change', () => {
      if (p.bind) api.setState(p.bind, sel.value);
      api.invoke(p.onChange, [sel.value]);
    });
    return applyCommon(sel, p);
  },

  Segmented: (el, api) => {
    const p = el.props;
    const opts = p.options || el.args[0] || [];
    const n = h('div.k-seg');
    opts.forEach(o => {
      const value = (o && typeof o === 'object') ? str(o.value) : str(o);
      const label = (o && typeof o === 'object') ? str(o.label ?? value) : str(o);
      const b = h('button', { text: label, 'aria-selected': String(value === str(p.value)) });
      b.addEventListener('click', () => {
        if (p.bind) api.setState(p.bind, value);
        api.invoke(p.onChange, [value]);
      });
      n.appendChild(b);
    });
    return applyCommon(n, p);
  },

  /* ---------------- display ---------------- */
  Icon: (el) => {
    const p = el.props;
    const name = str(el.args[0] ?? p.name ?? 'star');
    const n = h('span.k-icon', { html: hasIcon(name) ? icon(name, p.size || 20, p.stroke || 1.7) : name });
    if (p.tint) n.style.color = p.tint;
    if (!hasIcon(name)) n.style.fontSize = px(p.size || 20);
    return applyCommon(n, p);
  },
  Image: (el) => {
    const p = el.props;
    const n = h('img', { src: str(el.args[0] ?? p.src ?? ''), alt: str(p.alt ?? '') });
    n.style.borderRadius = px(p.radius ?? 8);
    n.style.objectFit = p.fit || 'cover';
    if (p.height) n.style.height = px(p.height);
    return applyCommon(n, p);
  },
  Badge: (el) => applyCommon(h('span.k-badge', {
    class: el.props.color ? `b-${el.props.color}` : '',
    text: str(el.args[0] ?? ''),
  }), el.props),
  Progress: (el) => {
    const v = clamp(num(el.props.value ?? el.args[0] ?? 0), 0, 100);
    return applyCommon(h('div.k-progress', h('i', { style: { width: v + '%' } })), el.props);
  },
  Spinner: (el) => applyCommon(h('div.k-spinner'), el.props),
  Avatar: (el) => {
    const p = el.props;
    const n = h('div.k-avatar', { text: str(el.args[0] ?? '🙂'),
      style: { width: px(p.size || 40), height: px(p.size || 40), fontSize: px((p.size || 40) * 0.5) } });
    return applyCommon(n, p);
  },

  List: (el, api) => {
    const n = h('div.k-group');
    add(n, [api.render(el.children)]);
    return applyCommon(n, el.props);
  },
  ListItem: (el, api) => {
    const p = el.props;
    const n = h('div.k-row', { class: (p.onClick || p.onTap) ? 'tappable' : '' });
    const g = p.glyph || p.icon;
    if (g) n.appendChild(h('div.lead', {
      style: { background: p.tint || 'var(--accent)' },
      html: hasIcon(g) ? icon(g, 15) : g,
    }));
    n.appendChild(h('div.k-vstack', { style: { flex: '1', minWidth: 0, gap: '1px' } },
      h('div.k-text', { text: str(el.args[0] ?? p.title ?? ''), style: { fontWeight: 520 } }),
      p.subtitle ? h('div.k-text.t-caption', { text: str(p.subtitle) }) : null));
    if (el.children.length) add(n, [api.render(el.children)]);
    if (p.value !== undefined) n.appendChild(h('div.k-text.t-secondary', { text: str(p.value) }));
    if (p.chevron !== false && (p.onClick || p.onTap)) n.appendChild(h('span.chev', { html: icon('chevronR', 13) }));
    const cb = p.onClick || p.onTap;
    if (cb) n.addEventListener('click', () => api.invoke(cb, []));
    return applyCommon(n, p);
  },

  Empty: (el) => h('div.k-empty',
    h('div.glyph', { text: str(el.props.glyph ?? '📭') }),
    h('div.k-text.t-callout', { text: str(el.args[0] ?? 'Burası boş') })),

  Tabs: (el, api) => {
    const p = el.props;
    const n = h('div.k-vstack', { style: { flex: '1', minHeight: 0 } });
    const bar = h('div.k-tabs');
    const body = h('div.k-scroll', { style: { flex: '1', padding: '12px' } });
    const tabs = el.children.filter(c => c.name === 'Tab');
    const active = str(p.value ?? (tabs[0] && str(tabs[0].props.value ?? tabs[0].args[0])));
    tabs.forEach(t => {
      const value = str(t.props.value ?? t.args[0]);
      const b = h('button', { text: str(t.args[0] ?? value), 'aria-selected': String(value === active) });
      b.addEventListener('click', () => {
        if (p.bind) api.setState(p.bind, value);
        api.invoke(p.onChange, [value]);
      });
      bar.appendChild(b);
      if (value === active) add(body, [api.render(t.children)]);
    });
    n.append(bar, body);
    return applyCommon(n, p);
  },
  Tab: (el, api) => api.render(el.children),

  Canvas: (el, api) => {
    const p = el.props;
    const c = h('canvas', { style: { width: '100%', height: px(p.height || 200), borderRadius: px(p.radius ?? 10) } });
    requestAnimationFrame(() => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr;
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      if (p.draw) api.invoke(p.draw, [makePainter(ctx, c.clientWidth, c.clientHeight)]);
    });
    return applyCommon(c, p);
  },

  WebView: (el) => {
    const n = h('iframe', {
      src: str(el.args[0] ?? el.props.src ?? 'about:blank'),
      style: { width: '100%', height: px(el.props.height || 300), border: '0', borderRadius: '10px' },
      sandbox: 'allow-scripts allow-same-origin allow-forms',
    });
    return applyCommon(n, el.props);
  },
};

/** A tiny drawing façade handed to Canvas(draw:) callbacks. */
function makePainter(ctx, w, h2) {
  const P = {
    width: w, height: h2,
    clear: () => ctx.clearRect(0, 0, w, h2),
    fill: (c) => { ctx.fillStyle = c; return P; },
    stroke: (c, lw) => { ctx.strokeStyle = c; ctx.lineWidth = lw || 1; return P; },
    rect: (x, y, ww, hh, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, ww, hh, r || 0) : ctx.rect(x, y, ww, hh); ctx.fill(); return P; },
    line: (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); return P; },
    circle: (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); return P; },
    ring: (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); return P; },
    text: (t, x, y, size, align) => {
      ctx.font = `${size || 13}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = align || 'left'; ctx.fillText(String(t), x, y); return P;
    },
  };
  return P;
}

/* ---------------- the renderer ---------------- */
export function createRenderer(interp, opts = {}) {
  const focusKey = opts.focusKey || {};
  const api = {
    interp,
    invoke: (fn, args) => {
      if (!fn) return null;
      try { return interp.invoke(fn, args); }
      catch (e) { opts.onError?.(e); return null; }
    },
    setState: (name, value) => interp.setState(name, value),
    render: (children) => renderChildren(children, api),
    keepFocus: (input, key) => {
      if (!key) return;
      input.dataset.focusKey = key;
      if (focusKey.key === key) {
        requestAnimationFrame(() => {
          input.focus();
          try { input.setSelectionRange(focusKey.start ?? input.value.length, focusKey.end ?? input.value.length); } catch {}
        });
      }
    },
  };
  return api;
}

export function renderChildren(children, api) {
  const f = document.createDocumentFragment();
  for (const c of children || []) {
    const node = renderElement(c, api);
    if (node) f.appendChild(node);
  }
  return f;
}

export function renderElement(el, api) {
  if (el === null || el === undefined) return null;
  if (!(el instanceof OshElement)) return document.createTextNode(str(el));
  const comp = COMPONENTS[el.name];
  if (!comp) {
    return h('div.k-text.t-caption', {
      text: `⚠︎ bilinmeyen bileşen: ${el.name}`,
      style: { color: 'var(--orange)', padding: '4px 0' },
    });
  }
  try {
    const node = comp(el, api);
    return node;
  } catch (e) {
    api.onError?.(e);
    return h('div.k-text.t-caption', { text: `⚠︎ ${el.name}: ${e.message}`, style: { color: 'var(--red)' } });
  }
}

export const COMPONENT_NAMES = Object.keys(COMPONENTS);
