/* ==========================================================================
   OpenOS · ui/filedialog.js — sistem Aç / Kaydet kutuları

   macOS'taki gibi pencereye *bağlı* bir sayfa olarak iner: hangi uygulamanın
   dosya istediği bellidir, arkadaki uygulama yerinde durur ve kutu kapanana
   dek o pencereyle iş yapılamaz. Pencere verilmezse masaüstü genelinde açılır.

     const yol = await openFile({ win, filters: ['txt', 'md'] });
     const hedef = await saveFile({ win, name: 'Adsız.txt' });

   İkisi de yol döndürür ya da vazgeçilirse null. Dosyayı okuyup yazmak
   çağıranın işidir — kutu yalnızca yolu seçer.
   ========================================================================== */

import { h, clear, on, fmtBytes } from '../core/util.js';
import { icon } from '../core/icons.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';
import { contextMenu } from './menu.js';
import { attachScroller } from './scroller.js';

const KENAR = () => [
  { ad: 'Ana Klasör', yol: vfs.home, glyph: 'home' },
  { ad: 'Masaüstü', yol: VFS.join(vfs.home, 'Masaüstü'), glyph: 'desktop' },
  { ad: 'Belgeler', yol: VFS.join(vfs.home, 'Belgeler'), glyph: 'folder' },
  { ad: 'İndirilenler', yol: VFS.join(vfs.home, 'İndirilenler'), glyph: 'download' },
  { ad: 'Resimler', yol: VFS.join(vfs.home, 'Resimler'), glyph: 'image' },
  { ad: 'Projeler', yol: VFS.join(vfs.home, 'Projeler'), glyph: 'code' },
];

const UZANTI_SIMGE = {
  txt: 'fileText', md: 'fileText', json: 'code', js: 'code', osh: 'code', csv: 'grid',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', svg: 'image', webp: 'image',
  mp3: 'music', wav: 'music', html: 'globe', log: 'fileText',
};

/** Süzgeç listesi ('txt' ya da {ad, uzantilar}) tek biçime getirilir. */
function suzgecleriDuzenle(filters) {
  if (!filters || !filters.length) return null;
  if (typeof filters[0] === 'string') {
    return [{ ad: filters.map(u => '.' + u).join(' '), uzantilar: filters.map(u => u.toLowerCase()) }];
  }
  return filters.map(f => ({ ad: f.ad || f.name, uzantilar: (f.uzantilar || f.exts || []).map(u => u.toLowerCase()) }));
}

class FileDialog {
  /**
   * @param {'ac'|'kaydet'} kip
   * @param {object} o
   */
  constructor(kip, o) {
    this.kip = kip;
    this.o = o;
    this.suzgecler = suzgecleriDuzenle(o.filters);
    this.suzgec = this.suzgecler ? 0 : -1;
    this.secili = new Set();
    this.gecmis = [];
    this.ileri = [];
    this.yol = o.path && vfs.isDir(o.path) ? o.path : vfs.home;
  }

  /** @returns {Promise<string|string[]|null>} */
  ac() {
    return new Promise(resolve => {
      this.bitir = deger => {
        if (this.bitti) return;
        this.bitti = true;
        window.removeEventListener('keydown', this.tus, true);
        this.scrim.classList.add('kapaniyor');
        setTimeout(() => this.scrim.remove(), 180);
        resolve(deger);
      };
      this.kur();
    });
  }

  kur() {
    const o = this.o;
    const kaydet = this.kip === 'kaydet';

    this.adAlani = kaydet
      ? h('input.fd-name', { value: o.name || 'Adsız', spellcheck: false,
          onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); this.onayla(); } } })
      : null;

    this.liste = h('div.fd-list.k-scroll');
    this.yolCubugu = h('div.fd-path');
    this.durum = h('div.fd-status');

    this.geriBtn = h('button.k-btn.v-ghost.icon.s-sm', { html: icon('chevronL', 14), title: 'Geri',
      onclick: () => this.geriGit() });
    this.ileriBtn = h('button.k-btn.v-ghost.icon.s-sm', { html: icon('chevronR', 14), title: 'İleri',
      onclick: () => this.ileriGit() });

    this.onayBtn = h('button.k-btn.v-primary.s-lg', { text: o.confirm || (kaydet ? 'Kaydet' : 'Aç'),
      onclick: () => this.onayla() });

    const suzgecSecici = this.suzgecler && this.suzgecler.length > 1
      ? h('select.k-select.s-sm', { onchange: e => { this.suzgec = +e.target.value; this.ciz(); } },
          ...this.suzgecler.map((f, i) => h('option', { value: String(i), text: f.ad })))
      : null;

    const kutu = h('div.fd',
      h('div.fd-bar',
        this.geriBtn, this.ileriBtn,
        h('div.fd-title', { text: o.title || (kaydet ? 'Farklı Kaydet' : 'Dosya Aç') }),
        h('div.k-spacer'),
        h('button.k-btn.v-ghost.icon.s-sm', { html: icon('folderPlus', 14), title: 'Yeni klasör',
          onclick: () => this.yeniKlasor() }),
      ),
      h('div.fd-body',
        h('div.fd-side.k-scroll', ...KENAR().map(k => h('div.fd-fav',
          { onclick: () => this.git(k.yol) },
          h('span', { html: icon(k.glyph, 14) }), h('span', { text: k.ad })))),
        h('div.fd-main', this.yolCubugu, this.liste, this.durum),
      ),
      kaydet ? h('div.fd-save',
        h('label.k-text.t-secondary', { text: 'Ad:' }),
        h('div.k-field.plain', { style: { flex: '1' } }, this.adAlani),
      ) : null,
      h('div.fd-foot',
        suzgecSecici,
        h('div.k-spacer'),
        h('button.k-btn.s-lg', { text: 'Vazgeç', onclick: () => this.bitir(null) }),
        this.onayBtn,
      ),
    );

    this.scrim = h('div.k-scrim.fd-scrim', kutu);
    on(this.scrim, 'pointerdown', e => { if (e.target === this.scrim) this.bitir(null); });

    this.tus = e => {
      if (e.key === 'Escape') { e.stopPropagation(); this.bitir(null); }
      if (e.key === 'Enter' && document.activeElement !== this.adAlani) {
        e.preventDefault(); this.onayla();
      }
    };
    window.addEventListener('keydown', this.tus, true);

    /* Pencereye bağlı sayfa: arkadaki uygulama görünür kalır ama kullanılamaz.
       Pencere verilmezse kutu masaüstünde ortalanır. */
    const host = this.o.win?.el || document.getElementById('stage');
    host.appendChild(this.scrim);
    attachScroller(this.liste);
    this.ciz();
    setTimeout(() => (this.adAlani || this.liste).focus?.(), 60);
    if (this.adAlani) setTimeout(() => {
      const nokta = this.adAlani.value.lastIndexOf('.');
      this.adAlani.focus();
      this.adAlani.setSelectionRange(0, nokta > 0 ? nokta : this.adAlani.value.length);
    }, 70);
  }

  /* ------------------------------------------------------------ gezinme */
  git(yol, gecmiseYaz = true) {
    if (!vfs.isDir(yol)) return;
    if (gecmiseYaz && yol !== this.yol) { this.gecmis.push(this.yol); this.ileri.length = 0; }
    this.yol = yol;
    this.secili.clear();
    this.ciz();
  }
  geriGit() { const y = this.gecmis.pop(); if (y) { this.ileri.push(this.yol); this.git(y, false); } }
  ileriGit() { const y = this.ileri.pop(); if (y) { this.gecmis.push(this.yol); this.git(y, false); } }

  async yeniKlasor() {
    const ad = await notify.prompt('Yeni klasörün adı', { title: 'Yeni Klasör', value: 'Adsız Klasör', root: this.scrim.parentElement });
    if (!ad) return;
    const hedef = vfs.unique(VFS.join(this.yol, ad));
    try { vfs.mkdir(hedef); this.ciz(); }
    catch (e) { notify.toast('Klasör oluşturulamadı: ' + e.message, { glyph: '⚠️' }); }
  }

  /* -------------------------------------------------------------- çizim */
  gorunurler() {
    let ogeler;
    try { ogeler = vfs.list(this.yol); } catch { ogeler = []; }
    const f = this.suzgec >= 0 ? this.suzgecler[this.suzgec] : null;
    return ogeler
      .filter(o => !o.name.startsWith('.'))
      .filter(o => o.type === 'dir' || !f || !f.uzantilar.length ||
                   f.uzantilar.includes((o.ext || '').toLowerCase()))
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'tr') : a.type === 'dir' ? -1 : 1));
  }

  ciz() {
    /* yol çubuğu */
    clear(this.yolCubugu);
    const parcalar = this.yol.split('/').filter(Boolean);
    let biriken = '';
    this.yolCubugu.appendChild(h('span.fd-crumb', { html: icon('hardDrive', 12), onclick: () => this.git('/') }));
    parcalar.forEach((p, i) => {
      biriken += '/' + p;
      const hedef = biriken;
      this.yolCubugu.appendChild(h('span.fd-sep', { html: icon('chevronR', 10) }));
      this.yolCubugu.appendChild(h('span.fd-crumb', {
        text: p, class: i === parcalar.length - 1 ? 'son' : '', onclick: () => this.git(hedef),
      }));
    });

    /* liste */
    clear(this.liste);
    const ogeler = this.gorunurler();
    if (!ogeler.length) {
      this.liste.appendChild(h('div.fd-bos', { text: 'Bu klasörde gösterilecek öğe yok' }));
    }
    for (const o of ogeler) {
      const klasor = o.type === 'dir';
      const satir = h('div.fd-item', { dataset: { yol: o.path } },
        h('span.fd-ic', { html: icon(klasor ? 'folder' : (UZANTI_SIMGE[o.ext] || 'file'), 15) }),
        h('span.fd-ad', { text: o.name }),
        h('span.fd-boy', { text: klasor ? '—' : fmtBytes(o.size || 0) }),
        h('span.fd-tarih', { text: o.modified ? new Date(o.modified).toLocaleDateString('tr-TR') : '' }),
      );
      if (klasor) satir.classList.add('klasor');
      if (this.secili.has(o.path)) satir.classList.add('secili');

      on(satir, 'click', e => this.sec(o, e));
      on(satir, 'dblclick', () => {
        if (klasor) this.git(o.path);
        else { this.secili.clear(); this.secili.add(o.path); this.onayla(); }
      });
      contextMenu(satir, () => [
        { header: o.name },
        { label: klasor ? 'Klasörü Aç' : 'Bunu Seç', glyph: klasor ? 'folder' : 'check',
          run: () => (klasor ? this.git(o.path) : (this.secili.clear(), this.secili.add(o.path), this.onayla())) },
      ]);
      this.liste.appendChild(satir);
    }
    this.durumTazele(ogeler.length);
    this.geriBtn.disabled = !this.gecmis.length;
    this.ileriBtn.disabled = !this.ileri.length;
    this.liste.__osScroller?.sync();
  }

  sec(o, e) {
    if (o.type === 'dir' && this.kip !== 'klasor') {
      /* Klasöre tek tıklama macOS'ta yalnızca seçer; girmek için çift tık. */
      if (!this.o.multiple) this.secili.clear();
    } else if (!this.o.multiple || !(e.metaKey || e.ctrlKey)) {
      this.secili.clear();
    }
    if (this.secili.has(o.path)) this.secili.delete(o.path); else this.secili.add(o.path);
    if (this.adAlani && o.type === 'file') this.adAlani.value = o.name;
    this.ciz();
  }

  durumTazele(adet) {
    const s = [...this.secili];
    this.durum.textContent = s.length
      ? (s.length === 1 ? s[0] : `${s.length} öğe seçildi`)
      : `${adet} öğe`;
    const secilenDosya = s.filter(p => vfs.isFile(p));
    this.onayBtn.disabled = this.kip === 'ac' ? !secilenDosya.length : false;
  }

  /* ------------------------------------------------------------- onayla */
  async onayla() {
    if (this.kip === 'ac') {
      const secilen = [...this.secili].filter(p => vfs.isFile(p));
      if (!secilen.length) {
        /* Klasör seçiliyse içine gir — macOS'ta Aç düğmesi de böyle yapar. */
        const klasor = [...this.secili].find(p => vfs.isDir(p));
        if (klasor) return this.git(klasor);
        return;
      }
      return this.bitir(this.o.multiple ? secilen : secilen[0]);
    }

    let ad = (this.adAlani.value || '').trim();
    if (!ad) { this.adAlani.focus(); return; }
    /* Süzgeç bir uzantı dayatıyorsa ve kullanıcı yazmadıysa eklenir. */
    const f = this.suzgec >= 0 ? this.suzgecler[this.suzgec] : null;
    if (f && f.uzantilar.length && !f.uzantilar.includes(ad.split('.').pop().toLowerCase())) {
      ad += '.' + f.uzantilar[0];
    }
    const hedef = VFS.join(this.yol, ad);

    if (vfs.isDir(hedef)) { notify.toast('Bu adda bir klasör var', { glyph: '⚠️' }); return; }
    if (vfs.exists(hedef)) {
      const ok = await notify.confirm(`“${ad}” zaten var. Üzerine yazılsın mı?`,
        { title: 'Dosyanın üzerine yaz', ok: 'Üzerine Yaz', danger: true, root: this.scrim.parentElement });
      if (!ok) return;
    }
    this.bitir(hedef);
  }
}

/**
 * Dosya seçtirir.
 * @param {object} [o]
 * @param {object} [o.win]       kutunun bağlanacağı pencere
 * @param {string} [o.path]      açılış klasörü
 * @param {string[]|object[]} [o.filters] ['txt','md'] ya da [{ad, uzantilar}]
 * @param {boolean}[o.multiple]  çoklu seçim
 * @returns {Promise<string|string[]|null>}
 */
export function openFile(o = {}) { return new FileDialog('ac', o).ac(); }

/**
 * Kaydedilecek yolu seçtirir; varsa üzerine yazmayı onaylatır.
 * @param {object} [o]
 * @param {string} [o.name] önerilen dosya adı
 * @returns {Promise<string|null>}
 */
export function saveFile(o = {}) { return new FileDialog('kaydet', o).ac(); }

export default { openFile, saveFile };
