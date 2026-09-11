/* ==========================================================================
   OpenOS · core/clipboard.js — sistemin kendi panosu

   OpenOS bir tarayıcı sekmesinde çalışsa da bir işletim sistemi gibi
   davranmalı: kopyaladığınız şey OpenOS'ta kalır, dışarıdan bir şey de
   içeri sızmaz. Bu iki yönlü bir yalıtım:

   · Dışarı: `copy`/`cut` olayları engellenir, metin ana bilgisayarın
     panosuna yazılmaz — yalnızca buradaki depoya girer.
   · İçeri: `paste` olayı engellenir, ana bilgisayardan gelen veri okunmaz;
     yapıştırılan şey her zaman OpenOS'un kendi panosudur.

   Geçmiş tutulur, böylece pano yöneticisi son kopyalananları gösterebilir.
   ========================================================================== */

import { Bus } from './util.js';

const GECMIS_SINIRI = 25;

class Clipboard {
  constructor() {
    this.bus = new Bus();
    this.gecmis = [];            /* en yeni başta */
    this.kurulu = false;
  }

  /** Panodaki metin. */
  get text() { return this.gecmis[0]?.text ?? ''; }
  get bos() { return !this.gecmis.length; }

  /**
   * Panoya yazar.
   * @param {string} metin
   * @param {{kaynak?: string, tur?: string}} [bilgi] hangi uygulamadan geldiği
   */
  write(metin, bilgi = {}) {
    const t = String(metin ?? '');
    if (!t) return '';
    /* Aynı şey art arda kopyalandığında geçmiş şişmesin. */
    if (this.gecmis[0]?.text !== t) {
      this.gecmis.unshift({ text: t, zaman: Date.now(), tur: bilgi.tur || 'metin', kaynak: bilgi.kaynak || null });
      if (this.gecmis.length > GECMIS_SINIRI) this.gecmis.length = GECMIS_SINIRI;
    }
    this.bus.emit('change', t);
    return t;
  }

  /** Panodan okur. Ana bilgisayarın panosuna hiç bakılmaz. */
  read() { return this.text; }

  /** Geçmişteki bir öğeyi başa alır (pano yöneticisinden seçmek gibi). */
  pick(i) {
    const o = this.gecmis[i];
    if (!o) return '';
    this.gecmis.splice(i, 1);
    this.gecmis.unshift({ ...o, zaman: Date.now() });
    this.bus.emit('change', o.text);
    return o.text;
  }

  clear() { this.gecmis.length = 0; this.bus.emit('change', ''); }

  /* ------------------------------------------------------------------ */

  /** Seçili metni, düzenlenebilir alan ya da serbest seçim fark etmeksizin. */
  secim(el) {
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
      return el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0);
    }
    return String(document.getSelection() || '');
  }

  /** Seçimin yerine yazar; tarayıcının geri alma yığınını korur. */
  yaz(el, metin) {
    if (!el) return false;
    el.focus();
    if (document.execCommand('insertText', false, metin)) return true;
    if (el.value === undefined) return false;
    const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? a;
    el.value = el.value.slice(0, a) + metin + el.value.slice(b);
    el.setSelectionRange(a + metin.length, a + metin.length);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  /**
   * Tarayıcının pano olaylarını devralır. Yakalama evresinde dinlenir ki
   * uygulamaların kendi dinleyicilerinden önce karara bağlansın.
   */
  install(root = document) {
    if (this.kurulu) return;
    this.kurulu = true;

    const duzenlenebilir = el =>
      el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

    root.addEventListener('copy', e => {
      e.preventDefault();                       /* ana bilgisayar panosuna yazma */
      const s = this.secim(e.target);
      if (s) this.write(s, { kaynak: this.etkinUygulama() });
    }, true);

    root.addEventListener('cut', e => {
      e.preventDefault();
      const el = e.target;
      const s = this.secim(el);
      if (!s) return;
      this.write(s, { kaynak: this.etkinUygulama() });
      if (duzenlenebilir(el) && !el.readOnly) this.yaz(el, '');
    }, true);

    root.addEventListener('paste', e => {
      /* Ana bilgisayardan gelen veri hiç okunmaz — `clipboardData`ya
         dokunulmadan olay iptal edilir ve yerine sistemin panosu konur. */
      e.preventDefault();
      const el = e.target;
      if (!duzenlenebilir(el) || el.readOnly) return;
      const t = this.read();
      if (t) this.yaz(el, t);
    }, true);

    /* Sürükle-bırak da dışarıdan metin taşır; aynı sınır burada da geçerli. */
    root.addEventListener('drop', e => {
      if (e.dataTransfer?.types?.includes('Files')) return;   /* dosyalar ayrı ele alınır */
      if (duzenlenebilir(e.target)) e.preventDefault();
    }, true);
  }

  etkinUygulama() {
    return document.querySelector('.win.focused')?.dataset?.app || null;
  }
}

const clipboard = new Clipboard();
export default clipboard;
