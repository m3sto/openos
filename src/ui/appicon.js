/* ==========================================================================
   OpenOS · ui/appicon.js — the one place an application icon is drawn
   A PNG at assets/icons/apps/<id>.png wins; otherwise the built-in stroke
   glyph is drawn inside the app's gradient squircle. Dark-mode variants are
   picked up automatically from <id>@dark.png.
   ========================================================================== */

import { h, on } from '../core/util.js';
import { icon, hasIcon } from '../core/icons.js';
import settings from '../core/settings.js';

/* Simgeler derleme zamanında çözülüyor.

   Önceki sürüm çalışma zamanında yol kuruyordu: `assets/icons/apps/<id>.webp`
   dizesini elle birleştirip `<img>` ile yokluyor, hangi simgelerin var
   olduğunu ayrı bir `index.json` isteğiyle öğreniyordu. Üç ayrı sorun
   üretiyordu — dizin isteği gelmezse her uygulama için dört başarısız istek,
   taban yolu değişince (alt dizinde yayın, `<base>` etiketi) yolların
   kayması, ve parmak izli önbelleklemenin imkânsızlığı.

   `import.meta.glob` bunların üçünü birden kaldırıyor: klasörün içeriği
   derleme anında biliniyor, URL'leri paketleyici üretiyor (dolayısıyla taban
   yolu ne olursa olsun doğru), ve dosyalar içeriğe göre adlandırılıp sonsuza
   kadar önbelleklenebiliyor. Yoklama yok, dizin dosyası yok, 404 yok. */
const VARLIKLAR = import.meta.glob('../../assets/icons/apps/*.{webp,png}', {
  eager: true, query: '?url', import: 'default',
});

/** id → { acik: url, koyu: url } */
const SIMGELER = (() => {
  const harita = new Map();
  for (const [yol, url] of Object.entries(VARLIKLAR)) {
    const ad = yol.split('/').pop().replace(/\.(webp|png)$/, '');
    const koyuMu = ad.endsWith('@dark');
    const id = koyuMu ? ad.slice(0, -5) : ad;
    const kayit = harita.get(id) || {};
    /* WebP, PNG'yi ezer: aynı görselin ~7 katı küçüğü ve bu sistemi
       çalıştırabilen her tarayıcı destekliyor. */
    const webpMi = yol.endsWith('.webp');
    const alan = koyuMu ? 'koyu' : 'acik';
    if (!kayit[alan] || webpMi) kayit[alan] = url;
    harita.set(id, kayit);
  }
  return harita;
})();

/** Bir uygulamanın simge URL'i — yoksa null. */
export function iconUrl(id, { koyu = false } = {}) {
  const k = SIMGELER.get(id);
  if (!k) return null;
  return (koyu && k.koyu) || k.acik || k.koyu || null;
}

/** Kaç simge paketlendi — tanılama için. */
export function iconCount() { return SIMGELER.size; }

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

  /* Paketlenmiş uygulamalar simgelerini kendi içlerinde taşır; dosya
     sisteminde aramaya gerek yok. */
  if (app.iconUrl) { drawPng(app.iconUrl); return box; }

  /* Simge derleme zamanında biliniyor: yoklama, bekleme ve boş kare yok. */
  const url = app.id ? iconUrl(app.id, { koyu: settings.isDark }) : null;
  if (url) drawPng(url); else drawGlyph();
  return box;
}

/** HTML string form, for the few places that build markup rather than nodes. */
export function appIconHtml(app, size = 32) {
  const tint = app.tint || ['#8e8e93', '#5a5a60'];
  const g = app.glyph || 'window';
  return `<div class="app-icon" style="--ic1:${tint[0]};--ic2:${tint[1]};width:${size}px;height:${size}px">` +
    (hasIcon(g) ? icon(g, Math.round(size * 0.52)) : g) + '</div>';
}

/* Eski yoklama önbelleğini temizleyen işlev artık gereksiz: yoklama yok.
   Dışarıdan çağıran kalmadığı doğrulandı; adı tutulmuyor ki çağıran biri
   sessizce hiçbir şey yapmasın. */
