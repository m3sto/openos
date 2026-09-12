/* ==========================================================================
   OpenOS · ui/scroller.js — sistemin kendi kaydırma denetimi

   Tarayıcının yerleşik kaydırma çubuğu her platformda başka görünür ve
   Linux/Windows'ta içerikten yer çalar. Burada macOS'taki gibi içeriğin
   *üstünde* duran, boştayken incelip kaybolan, imleç yaklaşınca kalınlaşan
   kendi çubuğumuz var. Tutamak sürüklenebilir, yolağa tıklamak sayfa atlatır,
   çift yön (dikey + yatay) desteklenir.

   Kullanım:
     upgradeScrollers(kok)   — kökün altındaki tüm kaydırılabilir alanları
                               yükseltir ve sonradan eklenenleri izler.
     attachScroller(el)      — tek bir öğeyi elle yükseltir.
   ========================================================================== */

import { h, on, drag } from '../core/util.js';

const HOST = 'os-scroll-host';
const MIN_THUMB = 28;        /* tutamağın en kısa boyu */
const FADE_MS = 900;         /* durduktan sonra sönme gecikmesi */

/** Öğe gerçekten kaydırılabilir mi? (görünürde taşma kuralı var mı) */
function scrollable(el, axis) {
  const ov = getComputedStyle(el)[axis === 'y' ? 'overflowY' : 'overflowX'];
  return ov === 'auto' || ov === 'scroll' || ov === 'overlay';
}

class Scroller {
  constructor(el) {
    this.el = el;
    this.axes = { y: null, x: null };
    this.hideTimer = 0;

    /* Çubuklar kaydırılan öğenin *kardeşi* olmalı, yoksa içerikle birlikte
       kayarlar. Öğenin çevresine konumlandırılmış bir kabuk örülür; kabuk
       öğenin yerleşim rolünü (esneme, taşma) devralır. */
    let host = el.parentElement;
    if (!host || !host.classList.contains(HOST)) {
      host = h('div.' + HOST);
      /* Kabuk, öğenin üst düzendeki rolünü olduğu gibi devralır; yoksa esnek
         bir satırda yerini kaybeder ya da ızgarada başka hücreye düşer. */
      const cs = getComputedStyle(el);
      for (const k of ['flex', 'alignSelf', 'justifySelf', 'gridArea', 'order', 'margin']) {
        host.style[k] = cs[k];
      }
      if (cs.maxHeight !== 'none') host.style.maxHeight = cs.maxHeight;

      /* Mutlak konumlu bir öğeyi sarmak onun konumlandırma bağlamını
         değiştirir: kabuk normal akışa girer, öğe de artık kabuğa göre
         konumlanır ve sayfanın çok altına düşer. Konumu kabuğa devret,
         öğeyi kabuğun içinde sıradan bir kutu yap. */
      if (cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky') {
        host.style.position = cs.position;
        for (const k of ['top', 'right', 'bottom', 'left', 'zIndex']) host.style[k] = cs[k];
        el.style.position = 'relative';
        el.style.top = el.style.right = el.style.bottom = el.style.left = 'auto';
        el.style.width = '100%';
        el.style.height = '100%';
      } else {
        const üst = el.parentElement && getComputedStyle(el.parentElement).display;
        if (üst && !/flex|grid/.test(üst) && cs.height !== 'auto') host.style.height = cs.height;
      }
      /* Sütun akışlı bir kapta kaydırılabilir alan hemen her zaman tam
         genişlik ister; kabuk genişlik bildirmediğinde içerik genişliğine
         düşüyor ve `width: 100%` yazan çocuk onunla birlikte daralıyordu —
         Launchpad ızgarası böyle tek sütuna indi. Bu kural ölçüme
         dayanmadığı için gizli sekmede de, ilk karede de geçerli.
         Çocuğun kendi hizalaması kabuğa taşınır ki ortalanmış dar bir
         öğe ortalanmış kalsın. */
      const ustCs = el.parentElement ? getComputedStyle(el.parentElement) : null;
      const sutunAkis = ustCs && /flex|grid/.test(ustCs.display) &&
                        (ustCs.display.includes('grid') || (ustCs.flexDirection || 'row').startsWith('column'));
      if (sutunAkis) {
        host.style.width = '100%';
        host.style.alignSelf = 'stretch';
        if (cs.alignSelf && cs.alignSelf !== 'auto' && cs.alignSelf !== 'stretch') {
          host.style.alignItems = cs.alignSelf;
        }
      }

      /* Ölçüme dayalı yedek: yukarıdaki kuralın kapsamadığı durumlarda
         sarmalamadan önceki kutu sonrasıyla karşılaştırılır. */
      this._oncekiKutu = el.getBoundingClientRect();
      el.parentNode.insertBefore(host, el);
      host.appendChild(el);
    }
    this.host = host;
    this._kutuyuKoru();
    el.classList.add('os-scroll-body');

    this.bars = {};
    for (const axis of ['y', 'x']) {
      const bar = h(`div.os-sb.${axis}`, h('div.os-sb-thumb'));
      bar.hidden = true;
      host.appendChild(bar);
      this.bars[axis] = bar;
      this.wireBar(axis, bar);
    }

    on(el, 'scroll', () => { this.sync(); this.flash(); }, { passive: true });
    on(host, 'pointerenter', () => { this.sync(); this.flash(true); });
    on(host, 'pointerleave', () => this.flash());

    this.ro = new ResizeObserver(() => { this._kutuyuKoru(); this.sync(); });
    this.ro.observe(el);
    if (el.firstElementChild) this.ro.observe(el.firstElementChild);
    this.mo = new MutationObserver(() => this.sync());
    this.mo.observe(el, { childList: true, subtree: true, characterData: true });

    this.sync();
    el.__osScroller = this;
  }

  /**
   * Sarmalama sonrası öğenin daraldığını ölçer ve kabuğa genişliği geri
   * verir. Ölçüm gizli sekmede ya da daha yerleşim yapılmamışken sıfır
   * döner; o durumda karar verilmez ve ölçüm mümkün olunca (ResizeObserver)
   * yeniden denenir — sıfır bir ölçü değil, ölçememenin işaretidir.
   */
  _kutuyuKoru() {
    if (this._kutuKorundu || !this._oncekiKutu) return;
    const once = this._oncekiKutu;
    const simdi = this.el.getBoundingClientRect();
    /* Hiçbir şey ölçülemiyorsa karar verme; bir dahaki sefere. */
    if (!once.width && !once.height) { this._oncekiKutu = simdi.width || simdi.height ? simdi : once; return; }
    if (!simdi.width && !simdi.height) return;

    if (once.width - simdi.width > 1) {
      this.host.style.alignSelf = 'stretch';
      this.host.style.width = '100%';
    }
    if (once.height - simdi.height > 1 && getComputedStyle(this.host).position !== 'absolute') {
      this.host.style.height = '100%';
    }
    this._kutuKorundu = true;
  }

  /** Tutamağı sürüklemek ve yolağa tıklamak. */
  wireBar(axis, bar) {
    const thumb = bar.firstElementChild;
    const M = axis === 'y'
      ? { pos: 'scrollTop', size: 'scrollHeight', view: 'clientHeight', c: 'clientY' }
      : { pos: 'scrollLeft', size: 'scrollWidth', view: 'clientWidth', c: 'clientX' };

    on(thumb, 'pointerdown', e => {
      e.preventDefault(); e.stopPropagation();
      const el = this.el;
      const başla = el[M.pos];
      const yolak = bar[axis === 'y' ? 'clientHeight' : 'clientWidth'];
      const boy = thumb[axis === 'y' ? 'offsetHeight' : 'offsetWidth'];
      const oran = (el[M.size] - el[M.view]) / Math.max(1, yolak - boy);
      bar.classList.add('tutuluyor');
      drag(e, {
        onMove: ({ dx, dy }) => { el[M.pos] = başla + (axis === 'y' ? dy : dx) * oran; },
        onEnd: () => { bar.classList.remove('tutuluyor'); this.flash(); },
      });
    });

    /* Yolağa tıklayınca macOS gibi bir ekran boyu atlanır. */
    on(bar, 'pointerdown', e => {
      if (e.target !== bar) return;
      const r = bar.getBoundingClientRect();
      const tr = thumb.getBoundingClientRect();
      const ileri = axis === 'y' ? e.clientY > tr.bottom : e.clientX > tr.right;
      const geri = axis === 'y' ? e.clientY < tr.top : e.clientX < tr.left;
      if (!ileri && !geri) return;
      void r;
      this.el.scrollBy({
        [axis === 'y' ? 'top' : 'left']: (ileri ? 1 : -1) * this.el[M.view] * 0.9,
        behavior: 'smooth',
      });
    });
  }

  /** Tutamağın boyunu ve konumunu içeriğe göre günceller. */
  sync() {
    const el = this.el;
    for (const axis of ['y', 'x']) {
      const bar = this.bars[axis];
      const size = axis === 'y' ? el.scrollHeight : el.scrollWidth;
      const view = axis === 'y' ? el.clientHeight : el.clientWidth;
      const pos = axis === 'y' ? el.scrollTop : el.scrollLeft;

      const gerek = size - view > 1 && view > 0 && scrollable(el, axis);
      bar.hidden = !gerek;
      if (!gerek) continue;

      const yolak = axis === 'y' ? bar.clientHeight : bar.clientWidth;
      const boy = Math.max(MIN_THUMB, Math.round(yolak * (view / size)));
      const yer = Math.round((yolak - boy) * (pos / (size - view)));
      const t = bar.firstElementChild.style;
      if (axis === 'y') { t.height = boy + 'px'; t.transform = `translateY(${yer}px)`; }
      else { t.width = boy + 'px'; t.transform = `translateX(${yer}px)`; }
    }
    /* İki çubuk birden görünürse köşede çakışmasınlar. */
    this.host.classList.toggle('iki-eksen', !this.bars.y.hidden && !this.bars.x.hidden);
  }

  /** Kaydırma sırasında göster, durunca sönmeye bırak. */
  flash(kalıcı) {
    this.host.classList.add('gorunur');
    clearTimeout(this.hideTimer);
    if (kalıcı) return;
    this.hideTimer = setTimeout(() => this.host.classList.remove('gorunur'), FADE_MS);
  }

  destroy() {
    this.ro?.disconnect(); this.mo?.disconnect();
    clearTimeout(this.hideTimer);
    delete this.el.__osScroller;
  }
}

/** Tek bir öğeye sistem kaydırıcısı takar (zaten varsa tekrar takmaz). */
export function attachScroller(el) {
  if (!el || el.__osScroller) return el.__osScroller;
  return new Scroller(el);
}

/**
 * Kökün altındaki kaydırılabilir her alanı yükseltir ve sonradan eklenen
 * alanları da yakalar. Uygulamalar kendi işaretlemesini değiştirmeden
 * sistemin çubuklarını kazanır.
 */
export function upgradeScrollers(root = document.body) {
  const tara = kök => {
    if (!kök || kök.nodeType !== 1) return;
    const aday = [kök, ...kök.querySelectorAll('*')];
    for (const el of aday) {
      if (el.__osScroller || el.classList.contains(HOST)) continue;
      if (el.closest('.os-sb')) continue;
      if (el.hasAttribute('data-no-scroller')) continue;
      /* Gömülü içerik ve düzenlenebilir alanlar kendi kaydırmasını yönetir. */
      if (el.tagName === 'IFRAME' || el.tagName === 'TEXTAREA' || el.tagName === 'CANVAS') continue;
      if (!scrollable(el, 'y') && !scrollable(el, 'x')) continue;
      if (!el.isConnected) continue;
      attachScroller(el);
    }
  };

  tara(root);
  if (root.__osScrollWatch) return;

  /* Yeni düğümler toplu işlenir. Uçbirim gibi saniyede yüzlerce satır ekleyen
     uygulamalarda her eklemede ağaç taramak pahalıya gelir; zamanlayıcı
     kullanılır, `requestAnimationFrame` değil — gizli sekmede duruyor. */
  const kuyruk = new Set();
  let zaman = 0;
  root.__osScrollWatch = new MutationObserver(kayitlar => {
    for (const k of kayitlar) {
      for (const n of k.addedNodes) if (n.nodeType === 1) kuyruk.add(n);
    }
    if (zaman || !kuyruk.size) return;
    zaman = setTimeout(() => {
      zaman = 0;
      const iş = [...kuyruk]; kuyruk.clear();
      iş.forEach(tara);
    }, 120);
  });
  root.__osScrollWatch.observe(root, { childList: true, subtree: true });
}

export default { attachScroller, upgradeScrollers };
