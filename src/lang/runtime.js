/* ==========================================================================
   OpenSharp · runtime.js — the element tree → real DOM, using the OS UI kit
   ========================================================================== */

import { h, add, clamp, uid, setStyle } from '../core/util.js';
import { icon, hasIcon } from '../core/icons.js';
import { menu } from '../ui/menu.js';
import { str, num, truthy, OshElement } from './interpreter.js';

const px = v => (typeof v === 'number' ? v + 'px' : v);

/* Props understood by every component. */
/**
 * Değer taşıyan denetimlerde ilk konumsal argüman değerdir:
 *   Select(secim, options: [...])   Segmented(sekme, options: [...])
 * Ama seçenekler konumsal da verilebiliyor:
 *   Select(options: [...])  →  args[0] seçenek listesidir, değer değil.
 * Ayrım `options:` adlandırılmış özelliğinin varlığına bakılarak yapılır;
 * başka türlü bir dizi ile bir değer birbirinden ayırt edilemez.
 */
function konumsalDeger(el, p) {
  return p.value ?? (p.options !== undefined ? el.args[0] : undefined);
}

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
    /* `Toggle(acik, bind: "acik")` yazmak en doğal biçim ve ilk argümanı
        etiket saymak onu ekrana "true" diye bastırıyordu. Mantıksal bir ilk
        argüman her zaman değerdir; etiket olmak için metin olması gerekir. */
    const ilkMantiksal = typeof el.args[0] === 'boolean';
    const on = truthy(p.value ?? (ilkMantiksal ? el.args[0] : el.args[1]) ?? false);
    const sw = h('div.k-toggle', { dataset: { on: on ? '1' : '0' } });
    const label = str((ilkMantiksal ? p.label : (el.args[0] ?? p.label)) ?? '');
    const row = h('div.k-hstack', { style: { gap: '10px' } },
      label ? h('div.k-text', { text: label, style: { flex: '1' } }) : null, sw);
    const fire = () => {
      const v = !on;
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
    const secili = str(konumsalDeger(el, p) ?? '');
    const sel = h('select.k-select');
    for (const o of opts) {
      const value = (o && typeof o === 'object') ? str(o.value ?? o.id) : str(o);
      const label = (o && typeof o === 'object') ? str(o.label ?? o.name ?? value) : str(o);
      sel.appendChild(h('option', { value, text: label, selected: value === secili }));
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
    const secili = str(konumsalDeger(el, p) ?? '');
    const n = h('div.k-seg');
    opts.forEach(o => {
      const value = (o && typeof o === 'object') ? str(o.value) : str(o);
      const label = (o && typeof o === 'object') ? str(o.label ?? value) : str(o);
      const b = h('button', { text: label, 'aria-selected': String(value === secili) });
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

  /* `glyph` bir yerleşik simge adı ya da bir emoji olabilir. Ad verildiğinde
     metin olarak basmak — "fileText" yazmak — yanlış; simge çizilmeli. */
  Empty: (el) => {
    const g = str(el.props.glyph ?? '');
    const gorsel = g && hasIcon(g)
      ? h('div.glyph', { html: icon(g, 30, 1.6), style: { color: 'var(--text-3)' } })
      : h('div.glyph', { text: g || '📭' });
    return applyCommon(h('div.k-empty',
      gorsel,
      h('div.k-text.t-callout', { text: str(el.args[0] ?? el.props.title ?? 'Burası boş') }),
      el.props.detail ? h('div.k-text.t-caption', { text: str(el.props.detail) }) : null,
    ), el.props);
  },

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

    /* Çizim bir sonraki karede yapılır; o zamana dek tuval yerleşmiş ve
       gerçek genişliğini bilir. `requestAnimationFrame` arka plandaki
       sekmede durduğu için orada tuval hiç çizilmiyordu — gizliyken
       zamanlayıcıya düşülür. Genişlik ölçülemiyorsa çizim yapılmaz ve
       ölçüm mümkün olunca yeniden denenir. */
    let sonGen = 0, sonYuk = 0;
    const ciz = () => {
      const gen = c.clientWidth, yuk = c.clientHeight;
      if (!gen || !yuk) return;                 /* henüz yerleşmedi */
      const dpr = Math.min(devicePixelRatio || 1, 2);
      c.width = gen * dpr; c.height = yuk * dpr;
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      if (p.draw) api.invoke(p.draw, [makePainter(ctx, gen, yuk)]);
      sonGen = gen; sonYuk = yuk;
    };

    /* Sınırlı sayıda yeniden deneme kırılgan: tuval o pencerede yerleşmezse
       bir daha hiç çizilmiyor. Boyut gözlemcisi ölçü ne zaman gelirse o
       zaman çizer ve pencere yeniden boyutlandırıldığında da tazeler. */
    const go = new ResizeObserver(() => {
      const gen = c.clientWidth, yuk = c.clientHeight;
      if (!gen || !yuk) return;
      if (gen === sonGen && yuk === sonYuk) return;
      ciz();
    });
    go.observe(c);
    if (document.hidden) setTimeout(ciz, 32); else requestAnimationFrame(ciz);
    return applyCommon(c, p);
  },

  /* ================== denetimler ==================
     Buradaki her öğe sistemin kendi bileşenlerini (`styles/kit.css`) kullanır:
     OpenSharp ile yazılan bir uygulama, yerli uygulamalardan ayırt edilemez
     görünmeli. Kendi stilini kuran bir öğe yok. */

  /** Açılır eylem menüsü. Select bir *değer* seçer; Menu bir *iş* yaptırır. */
  Menu: (el, api) => {
    const p = el.props;
    const ogeler = p.items || el.args[1] || [];
    const b = h('button.k-btn.s-sm', {
      html: (p.glyph && hasIcon(p.glyph) ? icon(p.glyph, 13) : '') ,
      text: ' ' + str(el.args[0] ?? p.label ?? 'Menü'),
    });
    b.addEventListener('click', (e) => {
      const r = b.getBoundingClientRect();
      menu(ogeler.map(o => {
        if (o === '-' || o?.ayrac || o?.separator) return { separator: true };
        return {
          label: str(o.label ?? o.title ?? o),
          glyph: o.glyph, checked: truthy(o.checked), disabled: truthy(o.disabled),
          run: () => api.invoke(o.run ?? o.onSelect ?? p.onSelect, [o.value ?? o.label ?? o]),
        };
      }), { x: r.left, y: r.bottom + 4 });
      e.stopPropagation();
    });
    return applyCommon(b, p);
  },

  /** Birbirini dışlayan seçenekler. */
  RadioGroup: (el, api) => {
    const p = el.props;
    const opts = p.options || el.args[0] || [];
    const gecerli = str(konumsalDeger(el, p) ?? '');
    const n = h('div.k-vstack', { style: { gap: '7px' } });
    for (const o of opts) {
      const value = (o && typeof o === 'object') ? str(o.value) : str(o);
      const label = (o && typeof o === 'object') ? str(o.label ?? value) : str(o);
      const secili = value === gecerli;
      const nokta = h('div', { style: {
        width: '16px', height: '16px', borderRadius: '50%', flex: '0 0 auto',
        background: secili ? 'var(--accent)' : 'var(--surface-2)',
        boxShadow: secili ? 'inset 0 0 0 4px var(--surface)' : 'inset 0 0 0 1px var(--hairline)',
      } });
      const satir = h('div.k-hstack', { style: { gap: '8px', cursor: 'default' } },
        nokta, h('div.k-text', { text: label }));
      satir.addEventListener('click', () => {
        if (p.bind) api.setState(p.bind, value);
        api.invoke(p.onChange, [value]);
      });
      n.appendChild(satir);
    }
    return applyCommon(n, p);
  },

  /**
   * Veri tablosu. `columns` sütunları, `rows` satırları verir; satır bir
   * nesne ya da dizi olabilir. Gerçek uygulamaların en çok ihtiyaç duyduğu
   * ve dilde bulunmayan öğe buydu.
   */
  Table: (el, api) => {
    const p = el.props;
    const sutunlar = (p.columns || el.args[0] || []).map(c =>
      typeof c === 'object' ? { anahtar: str(c.key ?? c.id), baslik: str(c.label ?? c.key), genislik: c.width }
                            : { anahtar: str(c), baslik: str(c) });
    const satirlar = p.rows || el.args[1] || [];
    const izgara = sutunlar.map(c => c.genislik ? px(c.genislik) : '1fr').join(' ');

    const n = h('div.osh-table');
    n.appendChild(h('div.osh-tr.osh-th', { style: { gridTemplateColumns: izgara } },
      ...sutunlar.map(c => h('span', { text: c.baslik }))));

    satirlar.forEach((satir, i) => {
      const hucreler = sutunlar.map((c, j) => {
        const v = Array.isArray(satir) ? satir[j] : (satir?.[c.anahtar]);
        return h('span', { text: v == null ? '' : str(v) });
      });
      const tr = h('div.osh-tr', { style: { gridTemplateColumns: izgara } }, ...hucreler);
      if (p.onSelect) {
        tr.classList.add('tiklanir');
        tr.addEventListener('click', () => api.invoke(p.onSelect, [satir, i]));
      }
      n.appendChild(tr);
    });
    if (!satirlar.length) n.appendChild(h('div.osh-table-bos', { text: str(p.empty ?? 'Kayıt yok') }));
    return applyCommon(n, p);
  },

  /** Arama alanı — simgesi ve temizleme düğmesiyle. */
  SearchField: (el, api) => {
    const p = el.props;
    const inp = h('input', { type: 'search', placeholder: str(el.args[0] ?? p.placeholder ?? 'Ara'),
                             value: str(p.value ?? '') });
    const n = h('div.k-field.osh-search', h('span.ic', { html: icon('search', 13) }), inp);
    inp.addEventListener('input', () => {
      if (p.bind) api.setState(p.bind, inp.value);
      api.invoke(p.onChange, [inp.value]);
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') api.invoke(p.onSubmit, [inp.value]); });
    return applyCommon(n, p);
  },

  /** Sayı artırıcı. Klavyeden de yazılabilir; sınırlar zorlanır. */
  Stepper: (el, api) => {
    const p = el.props;
    const alt = p.min ?? -Infinity, ust = p.max ?? Infinity, adim = num(p.step ?? 1);
    const deger = () => num(p.value ?? el.args[0] ?? 0);
    const inp = h('input.osh-stepper-giris', { type: 'text', value: str(deger()) });
    const yaz = v => {
      const y = clamp(v, alt, ust);
      inp.value = str(y);
      if (p.bind) api.setState(p.bind, y);
      api.invoke(p.onChange, [y]);
    };
    const n = h('div.osh-stepper',
      h('button', { text: '−', onclick: () => yaz(deger() - adim) }),
      inp,
      h('button', { text: '+', onclick: () => yaz(deger() + adim) }));
    inp.addEventListener('change', () => yaz(parseFloat(inp.value) || 0));
    return applyCommon(n, p);
  },

  /** Tarih seçici — tarayıcının yerli seçicisini kullanır. */
  DatePicker: (el, api) => {
    const p = el.props;
    const inp = h('input.k-input', { type: str(p.time ? 'time' : (p.datetime ? 'datetime-local' : 'date')),
                                     value: str(p.value ?? el.args[0] ?? '') });
    inp.addEventListener('change', () => {
      if (p.bind) api.setState(p.bind, inp.value);
      api.invoke(p.onChange, [inp.value]);
    });
    return applyCommon(inp, p);
  },

  ColorPicker: (el, api) => {
    const p = el.props;
    const inp = h('input.osh-renk', { type: 'color', value: str(p.value ?? el.args[0] ?? '#0a84ff') });
    inp.addEventListener('input', () => {
      if (p.bind) api.setState(p.bind, inp.value);
      api.invoke(p.onChange, [inp.value]);
    });
    return applyCommon(inp, p);
  },

  /** Katlanabilir bölüm. */
  Disclosure: (el, api) => {
    const p = el.props;
    const acik = truthy(p.open ?? p.expanded);
    const ok = h('span.osh-ok', { html: icon('chevronR', 13),
      style: { transform: acik ? 'rotate(90deg)' : 'none' } });
    const bas = h('button.osh-disc-bas', ok, h('span', { text: str(el.args[0] ?? p.label ?? '') }));
    const govde = h('div.osh-disc-govde');
    if (acik) add(govde, [api.render(el.children)]);
    bas.addEventListener('click', () => {
      if (p.bind) api.setState(p.bind, !acik);
      api.invoke(p.onToggle, [!acik]);
    });
    return applyCommon(h('div.osh-disc', bas, govde), p);
  },

  Toolbar: (el, api) =>
    applyCommon(add(h('div.toolbar'), [api.render(el.children)]), el.props),

  Chip: (el, api) => {
    const p = el.props;
    const n = h('span.osh-chip', { text: str(el.args[0] ?? p.label ?? '') });
    if (p.tint) n.style.background = str(p.tint);
    if (p.onClick) { n.classList.add('tiklanir'); n.addEventListener('click', () => api.invoke(p.onClick, [])); }
    return applyCommon(n, p);
  },

  /** Satır içi uyarı kutusu. `kind`: info | success | warning | error */
  Alert: (el, api) => {
    const p = el.props;
    const tur = str(p.kind ?? 'info');
    const glyph = { info: 'info', success: 'check', warning: 'alert', error: 'alert' }[tur] || 'info';
    const n = h('div.osh-alert', { dataset: { tur } },
      h('span.ic', { html: icon(glyph, 15) }),
      h('div.osh-alert-govde',
        p.title ? h('div.osh-alert-bas', { text: str(p.title) }) : null,
        h('div', { text: str(el.args[0] ?? p.message ?? '') })));
    if (el.children?.length) add(n.querySelector('.osh-alert-govde'), [api.render(el.children)]);
    return applyCommon(n, p);
  },

  /**
   * Kip pencere. `open` doğruyken perde ve kart çizilir; yanlışken hiçbir
   * şey. Perdeye tıklamak `onClose`'u çağırır — kapatma kararı uygulamanın,
   * çünkü kaydedilmemiş bir işi olabilir.
   */
  Dialog: (el, api) => {
    const p = el.props;
    if (!truthy(p.open)) return h('div', { style: { display: 'none' } });
    const kart = h('div.osh-dialog',
      p.title ? h('div.osh-dialog-bas', { text: str(p.title) }) : null,
      add(h('div.osh-dialog-govde'), [api.render(el.children)]));
    const perde = h('div.osh-dialog-perde', kart);
    perde.addEventListener('pointerdown', e => {
      if (e.target === perde) api.invoke(p.onClose, []);
    });
    return applyCommon(perde, p);
  },

  /**
   * Bağlantı. Doğrudan `<a href>` üretmiyor: sistem her bağlantıyı yakalayıp
   * OpenBrow'a yönlendiriyor ve buradan ana tarayıcıya kaçış olmamalı.
   */
  Link: (el, api) => {
    const p = el.props;
    const hedef = str(p.url ?? p.href ?? '');
    const n = h('button.osh-link', { text: str(el.args[0] ?? p.label ?? hedef) });
    n.addEventListener('click', () => {
      if (p.onClick) return api.invoke(p.onClick, []);
      if (hedef) window.__openos?.kernel?.openApp('browser', { url: hedef, newTab: true });
    });
    return applyCommon(n, p);
  },

  /**
   * Scene3D — OpenSharp uygulamaları için 3B sahne.
   *
   * Three.js'in API'si dile açılmıyor; açılsaydı OpenSharp yazan birinin
   * geometri, malzeme, ışık ve kamera kavramlarını öğrenmesi gerekirdi ve
   * dilin bütün amacı basitlik. Onun yerine bildirimsel bir nesne listesi
   * alıyor — dilin geri kalanına benziyor:
   *
   *   Scene3D(height: 280, arkaplan: "#05060f", donsun: true, nesneler: [
   *     { tur: "kup",    boyut: 1.2, renk: "#0a84ff", konum: [0, 0, 0] },
   *     { tur: "kure",   yaricap: 0.8, renk: "#bf5af2", konum: [2, 0, -1] },
   *     { tur: "simit",  renk: "#30d158", konum: [-2, 0.5, 0], donme: [0.01, 0.02, 0] }
   *   ])
   *
   * Motor tembel yükleniyor: 3B kullanmayan bir uygulama Three.js'i hiç
   * indirmiyor.
   */
  Scene3D: (el, api) => {
    const p = el.props;
    const yukseklik = px(p.height ?? 280);
    const tuval = h('canvas', { style: { width: '100%', height: yukseklik, display: 'block',
                                         borderRadius: '10px' } });
    const nesneler = p.nesneler || p.objects || el.args[0] || [];

    let denetim = null, raf = 0, yokEdildi = false;

    const baslat = async () => {
      let T;
      try { T = await import('three'); }
      catch (e) { console.warn('[osh] 3B motoru yüklenemedi', e); return; }
      if (yokEdildi || !tuval.isConnected) return;

      const renderer = new T.WebGLRenderer({ canvas: tuval, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      const sahne = new T.Scene();
      sahne.background = new T.Color(str(p.arkaplan ?? p.background ?? '#0b0e17'));
      const kamera = new T.PerspectiveCamera(50, 1, 0.1, 200);
      kamera.position.set(0, 1.4, 6);
      kamera.lookAt(0, 0, 0);

      sahne.add(new T.AmbientLight(0xffffff, 1.1));
      const l = new T.DirectionalLight(0xffffff, 2.2);
      l.position.set(3, 5, 4);
      sahne.add(l);

      const geometri = (o) => {
        const tur = str(o.tur ?? o.type ?? 'kup').toLowerCase();
        if (tur === 'kure' || tur === 'sphere')   return new T.SphereGeometry(num(o.yaricap ?? o.radius ?? 0.8), 32, 24);
        if (tur === 'simit' || tur === 'torus')   return new T.TorusGeometry(num(o.yaricap ?? 0.7), num(o.kalinlik ?? 0.26), 20, 48);
        if (tur === 'silindir' || tur === 'cylinder') return new T.CylinderGeometry(num(o.yaricap ?? 0.6), num(o.yaricap ?? 0.6), num(o.boy ?? 1.4), 32);
        if (tur === 'koni' || tur === 'cone')     return new T.ConeGeometry(num(o.yaricap ?? 0.7), num(o.boy ?? 1.4), 32);
        if (tur === 'düzlem' || tur === 'duzlem' || tur === 'plane') return new T.PlaneGeometry(num(o.en ?? 2), num(o.boy ?? 2));
        if (tur === 'ikosahedron' || tur === 'icosahedron') return new T.IcosahedronGeometry(num(o.yaricap ?? 0.8), num(o.detay ?? 0));
        const b = num(o.boyut ?? o.size ?? 1);
        return new T.BoxGeometry(b, b, b);
      };

      const hareketliler = [];
      for (const o of nesneler) {
        const m = new T.MeshStandardMaterial({
          color: new T.Color(str(o.renk ?? o.color ?? '#0a84ff')),
          metalness: num(o.metal ?? 0.15),
          roughness: num(o.puruz ?? 0.42),
          flatShading: !!truthy(o.duzGolge ?? o.flat),
        });
        const mesh = new T.Mesh(geometri(o), m);
        const k = o.konum || o.position || [0, 0, 0];
        mesh.position.set(num(k[0] ?? 0), num(k[1] ?? 0), num(k[2] ?? 0));
        const d = o.donme || o.spin;
        if (d) mesh.userData.donme = [num(d[0] ?? 0), num(d[1] ?? 0), num(d[2] ?? 0)];
        sahne.add(mesh);
        if (mesh.userData.donme) hareketliler.push(mesh);
      }

      const kendiDonsun = truthy(p.donsun ?? p.autoRotate);

      const boyutla = () => {
        const w = tuval.clientWidth || 1, hh = tuval.clientHeight || 1;
        renderer.setSize(w, hh, false);
        kamera.aspect = w / hh;
        kamera.updateProjectionMatrix();
      };
      boyutla();
      const go = new ResizeObserver(boyutla);
      go.observe(tuval);

      const ciz = (ts) => {
        if (yokEdildi || !tuval.isConnected) { temizle(); return; }
        raf = requestAnimationFrame(ciz);
        for (const m of hareketliler) {
          m.rotation.x += m.userData.donme[0];
          m.rotation.y += m.userData.donme[1];
          m.rotation.z += m.userData.donme[2];
        }
        if (kendiDonsun) {
          kamera.position.x = Math.sin(ts * 0.00022) * 6;
          kamera.position.z = Math.cos(ts * 0.00022) * 6;
          kamera.lookAt(0, 0, 0);
        }
        renderer.render(sahne, kamera);
      };

      /* GPU bağlamı sınırlı: sahne DOM'dan çıkınca kaynaklar bırakılmalı,
         yoksa birkaç yeniden çizimde "context lost" alınıyor. */
      const temizle = () => {
        cancelAnimationFrame(raf);
        go.disconnect();
        sahne.traverse(o => {
          o.geometry?.dispose?.();
          if (Array.isArray(o.material)) o.material.forEach(x => x.dispose?.());
          else o.material?.dispose?.();
        });
        renderer.dispose();
        renderer.forceContextLoss?.();
        denetim = null;
      };
      denetim = { temizle };
      raf = requestAnimationFrame(ciz);
    };

    baslat();
    void api;
    return applyCommon(tuval, p);
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
