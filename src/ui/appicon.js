/* ==========================================================================
   OpenOS · ui/appicon.js — the one place an application icon is drawn
   A PNG at assets/icons/apps/<id>.png wins; otherwise the built-in stroke
   glyph is drawn inside the app's gradient squircle. Dark-mode variants are
   picked up automatically from <id>@dark.png.
   ========================================================================== */

import { h, on } from '../core/util.js';
import { icon, hasIcon } from '../core/icons.js';
import settings from '../core/settings.js';

const BASE = 'assets/icons/apps/';
/** id → çözülmüş url | 'glyph'  (oturum başına bir kez yoklanır) */
const known = new Map();

/* Klasörün içeriği tek bir dizin dosyasından okunur. Yoklamayı kör yapmak
   simgesi olmayan her uygulama için dört başarısız istek üretiyordu; konsol
   404'lerle doluyor ve ağ boşuna meşgul ediliyordu. Dizin gelmezse eski
   davranışa (kör yoklama) dönülür — çevrimdışı bir kopya da çalışsın. */
let dizin = null;
const dizinHazir = fetch(BASE + 'index.json')
  .then(r => (r.ok ? r.json() : null))
  .then(l => { dizin = Array.isArray(l) ? new Set(l) : null; })
  .catch(() => { dizin = null; });

/* WebP önce denenir: aynı görselin PNG'sinden ~7 kat küçük ve bu sistemi
   çalıştırabilen her tarayıcı destekler. PNG ikinci sırada kalır, böylece
   klasöre elle bırakılan PNG'ler de çalışır. */
const EXTS = ['.webp', '.png'];

export function iconUrl(id, ext = '.webp', dark = false) {
  return BASE + encodeURIComponent(id) + (dark ? '@dark' : '') + ext;
}

/**
 * appIcon(app, size) → element
 * `app` needs { id, glyph, tint }. Falls back gracefully and never flashes:
 * the glyph is rendered first and the PNG replaces it only once it decodes.
 */
export function appIcon(app, size = 52, opts = {}) {
  const tint = app.tint || ['#8e8e93', '#5a5a60'];
  const box = h('div.app-icon', {
    style: {
      '--ic1': tint[0], '--ic2': tint[1],
      width: size + 'px', height: size + 'px', fontSize: Math.round(size * 0.52) + 'px',
    },
    title: opts.title || '',
  });

  const drawGlyph = () => {
    box.classList.remove('png');
    const g = app.glyph || 'window';
    box.innerHTML = hasIcon(g) ? icon(g, Math.round(size * 0.52), 1.7) : g;
  };

  const drawPng = (url) => {
    box.classList.add('png');
    box.innerHTML = '';
    box.style.background = 'none';
    box.style.boxShadow = 'none';
    box.appendChild(h('img', { src: url, alt: app.name || app.id, draggable: false,
      style: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' } }));
  };

  const state = known.get(app.id);
  if (state === 'glyph' || !app.id) { drawGlyph(); return box; }
  if (state) { drawPng(state); return box; }

  /* Henüz bilinmiyor: önce glif çizilir, adaylar sırayla yoklanır ve ilk
     yüklenen görsel glifin yerini alır — böylece hiç boş kare görünmez. */
  drawGlyph();

  const candidates = [];
  if (settings.isDark) EXTS.forEach(e => candidates.push(iconUrl(app.id, e, true)));
  EXTS.forEach(e => candidates.push(iconUrl(app.id, e, false)));

  const tryNext = (i) => {
    if (i >= candidates.length) { known.set(app.id, 'glyph'); return; }
    const probe = new Image();
    probe.onload = () => { known.set(app.id, candidates[i]); drawPng(candidates[i]); };
    probe.onerror = () => tryNext(i + 1);
    probe.src = candidates[i];
  };

  /* Dizin varsa ve id listede değilse tek bir istek bile atılmaz; dizin
     alınamadıysa eski kör yoklamaya dönülür. */
  const coz = () => {
    if (dizin && !dizin.has(app.id)) { known.set(app.id, 'glyph'); return; }
    tryNext(0);
  };
  if (dizin === null) dizinHazir.then(coz); else coz();
  return box;
}

/** HTML string form, for the few places that build markup rather than nodes. */
export function appIconHtml(app, size = 32) {
  const tint = app.tint || ['#8e8e93', '#5a5a60'];
  const g = app.glyph || 'window';
  return `<div class="app-icon" style="--ic1:${tint[0]};--ic2:${tint[1]};width:${size}px;height:${size}px">` +
    (hasIcon(g) ? icon(g, Math.round(size * 0.52)) : g) + '</div>';
}

/** Forget the probe cache — used after the user drops new PNGs in. */
export function resetIconCache() { known.clear(); }
