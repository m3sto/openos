/* ==========================================================================
   OpenOS · ui/textfield.js — sistemin metin kutusu denetimi

   Tarayıcının çıplak <input>'u bir işletim sistemi denetimi değildir: sağ
   tuş menüsü yoktur, temizleme düğmesi yoktur, geçersiz durumu göstermez,
   çok satırlı hâli içeriğe göre büyümez. Burada hepsi var; üstelik sistemdeki
   *her* metin alanı — uygulamaların kendi yazdığı <input>'lar dahil — aynı
   bağlam menüsünü kazanır.
   ========================================================================== */

import { h, on } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from './menu.js';
import notify from '../core/notify.js';
import clipboard from '../core/clipboard.js';

/* ------------------------------------------------------------------ menü */

const DUZENLENEBILIR = 'input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,[contenteditable=""],[contenteditable="true"]';

function secim(el) {
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  }
  return String(document.getSelection() || '');
}

function yazilabilir(el) {
  return !el.readOnly && !el.disabled;
}

/** Seçili metnin yerine yaz — geri alma yığınını bozmadan. */
function yerineYaz(el, metin) {
  el.focus();
  /* `execCommand` burada bilerek: tarayıcının kendi geri alma yığınına
     yazan tek yol bu. Doğrudan `value` atamak ⌘Z'yi işlevsiz bırakıyor. */
  if (!document.execCommand('insertText', false, metin)) {
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    el.value = el.value.slice(0, a) + metin + el.value.slice(b);
    el.setSelectionRange(a + metin.length, a + metin.length);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/* Sistemin kendi panosu kullanılır: ana bilgisayarın panosuna ne yazılır
   ne de ondan okunur. Bkz. core/clipboard.js */
function panodanAl() { return clipboard.read(); }
function panoyaYaz(metin) { clipboard.write(metin); return true; }

/** Bir metin alanının bağlam menüsü — macOS'taki düzenleme menüsünün aynısı. */
export function metinMenusu(el) {
  const s = secim(el);
  const yaz = yazilabilir(el);
  const dolu = (el.value ?? el.textContent ?? '').length > 0;
  return [
    { label: 'Geri Al', glyph: 'undo', key: '⌘Z', disabled: !yaz,
      run: () => { el.focus(); document.execCommand('undo'); } },
    { label: 'Yinele', glyph: 'redo', key: '⇧⌘Z', disabled: !yaz,
      run: () => { el.focus(); document.execCommand('redo'); } },
    '-',
    { label: 'Kes', glyph: 'scissors', key: '⌘X', disabled: !s || !yaz,
      run: () => { panoyaYaz(s); yerineYaz(el, ''); } },
    { label: 'Kopyala', glyph: 'copy', key: '⌘C', disabled: !s,
      run: () => panoyaYaz(s) },
    { label: 'Yapıştır', glyph: 'clipboard', key: '⌘V', disabled: !yaz || clipboard.bos,
      run: () => { const t = panodanAl(); if (t) yerineYaz(el, t); } },
    '-',
    { label: 'Tümünü Seç', glyph: 'selectAll', key: '⌘A', disabled: !dolu,
      run: () => { el.focus(); el.select?.(); } },
    ...(yaz && dolu ? ['-', { label: 'Temizle', glyph: 'x', danger: true,
      run: () => { el.focus(); el.select?.(); yerineYaz(el, ''); } }] : []),
  ];
}

/**
 * Sistemdeki her metin alanına düzenleme menüsünü bağlar. Tek bir dinleyici
 * belgede durur; sonradan eklenen alanlar da kendiliğinden kapsanır, uygulama
 * yazarının hiçbir şey yapması gerekmez.
 */
export function installTextControls(root = document) {
  if (root.__osTextControls) return;
  root.__osTextControls = true;
  on(root, 'contextmenu', e => {
    const el = e.target.closest?.(DUZENLENEBILIR);
    if (!el) return;
    e.preventDefault(); e.stopPropagation();
    import('./menu.js').then(({ menu }) => menu(metinMenusu(el), { x: e.clientX, y: e.clientY }));
  }, true);
}

/* ------------------------------------------------------------- bileşen */

/**
 * Sistem metin kutusu.
 *
 * @param {object} o
 * @param {string} [o.value]        başlangıç değeri
 * @param {string} [o.placeholder]
 * @param {string} [o.label]        üstte küçük etiket
 * @param {string} [o.help]         altta açıklama
 * @param {string} [o.glyph]        önde simge
 * @param {string} [o.type]         text | password | search | email | number …
 * @param {boolean}[o.multiline]    çok satırlı (içeriğe göre büyür)
 * @param {boolean}[o.clearable]    temizleme düğmesi
 * @param {number} [o.maxLength]    sınır — aşılırsa sayaç kırmızıya döner
 * @param {(v:string)=>string|null} [o.validate] hata metni döndürür ya da null
 * @param {(v:string)=>void} [o.onInput]
 * @param {(v:string)=>void} [o.onEnter]
 */
export function textField(o = {}) {
  const cokSatir = !!o.multiline;
  const giris = cokSatir
    ? h('textarea', { placeholder: o.placeholder || '', rows: o.rows || 3 })
    : h('input', { type: o.type || 'text', placeholder: o.placeholder || '' });
  giris.value = o.value ?? '';
  if (o.maxLength) giris.maxLength = o.maxLength;
  if (o.name) giris.name = o.name;
  if (o.readOnly) giris.readOnly = true;
  if (o.autofocus) setTimeout(() => giris.focus(), 60);

  const kutu = h('div.k-field' + (cokSatir ? '.area' : '') + (o.plain ? '.plain' : ''));
  if (o.glyph) kutu.appendChild(h('span.k-field-ic', { html: icon(o.glyph, 14) }));
  kutu.appendChild(giris);

  const temizle = o.clearable !== false && !o.readOnly
    ? h('button.k-field-clear', { html: icon('x', 11), title: 'Temizle', type: 'button' })
    : null;
  if (temizle) kutu.appendChild(temizle);
  if (o.suffix) kutu.appendChild(h('span.k-field-suffix', { text: o.suffix }));

  const sayac = o.maxLength ? h('span.k-field-count') : null;
  const yardim = h('div.k-field-help', { text: o.help || '' });
  if (!o.help && !o.validate) yardim.hidden = true;

  const kok = h('div.k-textfield',
    o.label ? h('label.k-field-label', { text: o.label }) : null,
    kutu, yardim, sayac);

  /* --- davranış --- */
  /* Çok satırlı alan içeriğe göre büyür; kaydırma çubuğu çıkmadan önce
     kutunun kendisi uzar. */
  const büyüt = () => {
    if (!cokSatir || !o.autogrow) return;
    giris.style.height = 'auto';
    giris.style.height = giris.scrollHeight + 'px';
  };

  const tazele = () => {
    const v = giris.value;
    if (temizle) temizle.hidden = !v.length;
    if (sayac) {
      sayac.textContent = `${v.length} / ${o.maxLength}`;
      sayac.classList.toggle('dolu', v.length >= o.maxLength);
    }
    if (o.validate) {
      const hata = o.validate(v);
      kok.classList.toggle('gecersiz', !!hata);
      yardim.hidden = !(hata || o.help);
      yardim.textContent = hata || o.help || '';
      yardim.classList.toggle('hata', !!hata);
    }
    büyüt();
  };

  on(giris, 'input', () => { tazele(); o.onInput?.(giris.value); });
  on(giris, 'keydown', e => {
    if (e.key === 'Enter' && (!cokSatir || (e.metaKey || e.ctrlKey))) {
      e.preventDefault(); o.onEnter?.(giris.value);
    }
    if (e.key === 'Escape' && giris.value && o.clearable !== false) {
      e.stopPropagation(); giris.value = ''; tazele(); o.onInput?.('');
    }
  });
  if (temizle) on(temizle, 'click', () => {
    giris.value = ''; tazele(); o.onInput?.(''); giris.focus();
  });
  contextMenu(kutu, () => metinMenusu(giris));
  tazele();

  /* Dışarıya küçük bir API — uygulamalar DOM'u kurcalamasın. */
  kok.input = giris;
  Object.defineProperty(kok, 'value', {
    get: () => giris.value,
    set: v => { giris.value = v ?? ''; tazele(); },
  });
  kok.focus = () => giris.focus();
  kok.setError = msg => {
    kok.classList.toggle('gecersiz', !!msg);
    yardim.hidden = !(msg || o.help);
    yardim.textContent = msg || o.help || '';
    yardim.classList.toggle('hata', !!msg);
  };
  return kok;
}

/** Arama kutusu — sistemin her yerinde aynı görünen kısayol. */
export function searchField(o = {}) {
  return textField({ glyph: 'search', type: 'search', placeholder: 'Ara', plain: true, ...o });
}

export default { textField, searchField, installTextControls, metinMenusu };
