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
/** id → 'png' | 'glyph'  (probed once, then remembered for the session) */
const known = new Map();

export function iconUrl(id, dark = settings.isDark) {
  return BASE + encodeURIComponent(id) + (dark ? '@dark' : '') + '.png';
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
  if (state === 'png') { drawPng(iconUrl(app.id)); return box; }

  /* unknown yet — show the glyph, probe in the background, upgrade on success */
  drawGlyph();
  const probe = new Image();
  const url = iconUrl(app.id);
  probe.onload = () => { known.set(app.id, 'png'); drawPng(url); };
  probe.onerror = () => {
    if (settings.isDark) {                 /* a dark variant is optional */
      const light = new Image();
      const lurl = iconUrl(app.id, false);
      light.onload = () => { known.set(app.id, 'png'); drawPng(lurl); };
      light.onerror = () => known.set(app.id, 'glyph');
      light.src = lurl;
      return;
    }
    known.set(app.id, 'glyph');
  };
  probe.src = url;
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
