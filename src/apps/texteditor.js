/* ==========================================================================
   OpenOS · apps/texteditor.js — metin ve Markdown düzenleyici

   Satır numaraları, Bul ve Değiştir, canlı Markdown önizlemesi (bölünmüş ya
   da tam), sistem Aç/Kaydet kutuları, kaydedilmemiş değişiklik koruması ve
   imleç konumunu gösteren bir durum çubuğu.
   ========================================================================== */

import { h, clear, on, debounce, escapeHtml } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import { metinMenusu } from '../ui/textfield.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';

const MD_UZANTILARI = ['md', 'markdown', 'mdown'];

export default {
  id: 'texteditor', name: 'Metin Düzenleyici', glyph: 'fileText', tint: ['#ffc84a', '#e08a1e'],
  category: 'work', width: 820, height: 580, minWidth: 420, minHeight: 300, singleton: false,
  keywords: ['metin', 'yazı', 'editor', 'markdown', 'bul', 'değiştir'],
  about: 'Düz metin ve Markdown dosyalarını düzenleyin.',
  mount(ctx) {
    const e = new Editor(ctx);
    ctx.win.onArgs = a => { if (a?.path) e.ac(a.path); };
    return e.el;
  },
};

class Editor {
  constructor(ctx) {
    this.ctx = ctx;
    this.path = null;
    this.dirty = false;
    this.onizlemeKipi = 'kapali';        /* kapali | bolunmus | tam */
    this.sarma = true;
    this.puntoIndeksi = 2;

    this.ta = h('textarea.txt-area', { spellcheck: false, placeholder: 'Yazmaya başlayın…' });
    this.satirlar = h('div.txt-gutter');
    this.prev = h('div.txt-preview.k-scroll');
    this.status = h('div.statusbar');

    this.kurAracCubugu();
    this.kurBulCubugu();

    this.alan = h('div.txt-wrap', this.satirlar, this.ta, this.prev);
    this.el = h('div.app-shell', h('div.content', this.tb, this.bulCubugu, this.alan, this.status));

    this.kurOlaylar();
    this.onizlemeyiUygula();
    this.tazele();

    if (ctx.args?.path) this.ac(ctx.args.path);

    /* Kaydedilmemiş değişiklikle kapatmak sessizce veri kaybettiriyordu.
       Artık üç seçenek sunulur ve vazgeçilirse pencere kapanmaz. */
    ctx.win.onBeforeClose = () => this.kapanabilirMi();
  }

  /* ---------------------------------------------------------- arayüz */
  kurAracCubugu() {
    const dugme = (glyph, baslik, calistir, sinif = '') =>
      h('button.k-btn.v-ghost.icon.s-sm' + sinif, { html: icon(glyph, 14), title: baslik, onclick: calistir });

    this.onizlemeBtn = dugme('eye', 'Markdown önizleme (⌘P)', () => this.onizlemeyiDondur());
    this.sarmaBtn = dugme('alignLeft', 'Satır sarma', () => this.sarmayiDondur());

    this.tb = h('div.toolbar',
      dugme('filePlus', 'Yeni (⌘N)', () => this.yeni()),
      dugme('folderOpen', 'Aç (⌘O)', () => this.acKutusu()),
      dugme('save', 'Kaydet (⌘S)', () => this.kaydet()),
      h('div.tb-sep'),
      dugme('search', 'Bul ve Değiştir (⌘F)', () => this.buluDondur()),
      h('div.k-spacer'),
      h('button.k-btn.v-ghost.s-sm', { text: 'A−', title: 'Yazıyı küçült', onclick: () => this.punto(-1) }),
      h('button.k-btn.v-ghost.s-sm', { text: 'A+', title: 'Yazıyı büyüt', onclick: () => this.punto(+1) }),
      this.sarmaBtn, this.onizlemeBtn,
    );
  }

  kurBulCubugu() {
    this.bulAlani = h('input', { placeholder: 'Bul', spellcheck: false });
    this.degistirAlani = h('input', { placeholder: 'Değiştir', spellcheck: false });
    this.bulSayac = h('span.txt-find-count', { text: '0/0' });
    this.buyukKucuk = h('button.k-btn.v-ghost.s-sm', { text: 'Aa', title: 'Büyük/küçük harfe duyarlı' });
    this.duyarli = false;

    this.bulCubugu = h('div.txt-find',
      h('div.k-field.plain', { style: { flex: '1', maxWidth: '260px' } }, this.bulAlani),
      this.bulSayac,
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('chevronU', 13), title: 'Önceki (⇧⌘G)',
        onclick: () => this.bulGit(-1) }),
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('chevronD', 13), title: 'Sonraki (⌘G)',
        onclick: () => this.bulGit(+1) }),
      this.buyukKucuk,
      h('div.k-field.plain', { style: { flex: '1', maxWidth: '260px' } }, this.degistirAlani),
      h('button.k-btn.s-sm', { text: 'Değiştir', onclick: () => this.degistir(false) }),
      h('button.k-btn.s-sm', { text: 'Tümü', onclick: () => this.degistir(true) }),
      h('div.k-spacer'),
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('x', 13), title: 'Kapat (Esc)',
        onclick: () => this.buluKapat() }),
    );
    this.bulCubugu.hidden = true;

    on(this.buyukKucuk, 'click', () => {
      this.duyarli = !this.duyarli;
      this.buyukKucuk.classList.toggle('v-tinted', this.duyarli);
      this.bulTazele();
    });
    on(this.bulAlani, 'input', () => this.bulTazele());
    on(this.bulAlani, 'keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.bulGit(e.shiftKey ? -1 : +1); }
      if (e.key === 'Escape') { e.preventDefault(); this.buluKapat(); }
    });
    on(this.degistirAlani, 'keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.degistir(e.metaKey || e.ctrlKey); }
      if (e.key === 'Escape') { e.preventDefault(); this.buluKapat(); }
    });
  }

  kurOlaylar() {
    on(this.ta, 'input', () => { this.dirty = true; this.tazele(); this.onizlemeyiCiz(); });
    on(this.ta, 'scroll', () => { this.satirlar.scrollTop = this.ta.scrollTop; }, { passive: true });
    on(this.ta, 'click', () => this.durumTazele());
    on(this.ta, 'keyup', () => this.durumTazele());
    on(this.ta, 'keydown', e => this.tusa(e));

    contextMenu(this.ta, () => [
      ...metinMenusu(this.ta),
      '-',
      { label: 'Kaydet', glyph: 'save', key: '⌘S', run: () => this.kaydet() },
      { label: 'Farklı Kaydet…', glyph: 'save', key: '⇧⌘S', run: () => this.kaydet(true) },
      '-',
      { label: this.onizlemeKipi === 'kapali' ? 'Markdown önizleme' : 'Önizlemeyi kapat',
        glyph: 'eye', run: () => this.onizlemeyiDondur() },
      { label: 'Finder’da göster', glyph: 'folder', disabled: !this.path,
        run: () => this.ctx.openApp('finder', { path: VFS.dirname(this.path) }) },
    ]);
  }

  /** Düzenleyicinin kendi kısayolları. */
  tusa(e) {
    const cmd = e.metaKey || e.ctrlKey;
    if (cmd && e.key.toLowerCase() === 's') { e.preventDefault(); this.kaydet(e.shiftKey); return; }
    if (cmd && e.key.toLowerCase() === 'o') { e.preventDefault(); this.acKutusu(); return; }
    if (cmd && e.key.toLowerCase() === 'n') { e.preventDefault(); this.yeni(); return; }
    if (cmd && e.key.toLowerCase() === 'f') { e.preventDefault(); this.buluDondur(); return; }
    if (cmd && e.key.toLowerCase() === 'p') { e.preventDefault(); this.onizlemeyiDondur(); return; }
    if (cmd && e.key.toLowerCase() === 'g') { e.preventDefault(); this.bulGit(e.shiftKey ? -1 : +1); return; }
    if (e.key === 'Escape' && !this.bulCubugu.hidden) { e.preventDefault(); this.buluKapat(); return; }

    /* Sekme girintisi: seçim varsa satırların tamamı kaydırılır. */
    if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b, value: v } = this.ta;
      if (a === b && !e.shiftKey) return this.yaz('  ');
      const bas = v.lastIndexOf('\n', a - 1) + 1;
      const son = v.indexOf('\n', b) === -1 ? v.length : v.indexOf('\n', b);
      const blok = v.slice(bas, son);
      const yeni = e.shiftKey
        ? blok.replace(/^ {1,2}/gm, '')
        : blok.replace(/^/gm, '  ');
      this.ta.setSelectionRange(bas, son);
      this.yaz(yeni);
      this.ta.setSelectionRange(bas, bas + yeni.length);
      return;
    }

    /* Girintiyi koruyan satır başı. */
    if (e.key === 'Enter' && !e.shiftKey) {
      const v = this.ta.value, a = this.ta.selectionStart;
      const satirBasi = v.lastIndexOf('\n', a - 1) + 1;
      const girinti = (v.slice(satirBasi, a).match(/^[ \t]*/) || [''])[0];
      const madde = (v.slice(satirBasi, a).match(/^[ \t]*([-*+]|\d+\.)\s/) || [])[0];
      if (girinti || madde) {
        e.preventDefault();
        this.yaz('\n' + (madde ? madde.replace(/^\s*/, girinti) : girinti));
      }
    }
  }

  /** Seçimin yerine yazar — tarayıcının geri alma yığınını koruyarak. */
  yaz(metin) {
    this.ta.focus();
    if (!document.execCommand('insertText', false, metin)) {
      const a = this.ta.selectionStart, b = this.ta.selectionEnd;
      this.ta.value = this.ta.value.slice(0, a) + metin + this.ta.value.slice(b);
      this.ta.setSelectionRange(a + metin.length, a + metin.length);
    }
    this.dirty = true; this.tazele(); this.onizlemeyiCiz();
  }

  /* -------------------------------------------------------- dosya işleri */
  async yeni() {
    if (!await this.kapanabilirMi()) return;
    this.ta.value = ''; this.path = null; this.dirty = false;
    this.ctx.setTitle('Adsız');
    this.tazele(); this.onizlemeyiCiz();
    this.ta.focus();
  }

  async acKutusu() {
    const yol = await this.ctx.openFile({
      title: 'Metin Dosyası Aç',
      path: this.path ? VFS.dirname(this.path) : VFS.join(vfs.home, 'Belgeler'),
      filters: [
        { ad: 'Metin belgeleri', uzantilar: ['txt', 'md', 'markdown', 'json', 'js', 'csv', 'log', 'osh'] },
        { ad: 'Tüm dosyalar', uzantilar: [] },
      ],
    });
    if (!yol) return;
    if (!await this.kapanabilirMi()) return;
    this.ac(yol);
  }

  ac(p) {
    try { this.ta.value = vfs.read(p); }
    catch (e) { notify.toast('Dosya okunamadı: ' + e.message, { glyph: '⚠️' }); return; }
    this.path = p; this.dirty = false;
    this.ctx.setTitle(VFS.basename(p));
    this.tazele();
    /* Markdown dosyaları bölünmüş önizlemeyle açılır. */
    this.onizlemeKipi = MD_UZANTILARI.includes(VFS.ext(p)) ? 'bolunmus' : 'kapali';
    this.onizlemeyiUygula();
  }

  async kaydet(farkli = false) {
    let p = this.path;
    if (!p || farkli) {
      p = await this.ctx.saveFile({
        title: farkli ? 'Farklı Kaydet' : 'Kaydet',
        path: this.path ? VFS.dirname(this.path) : VFS.join(vfs.home, 'Belgeler'),
        name: this.path ? VFS.basename(this.path) : 'Adsız.txt',
        filters: [{ ad: 'Metin belgesi', uzantilar: ['txt'] },
                  { ad: 'Markdown', uzantilar: ['md'] },
                  { ad: 'Tüm dosyalar', uzantilar: [] }],
      });
      if (!p) return false;
    }
    try { vfs.write(p, this.ta.value); }
    catch (e) { notify.toast('Kaydedilemedi: ' + e.message, { glyph: '⚠️' }); return false; }
    this.path = p; this.dirty = false;
    this.ctx.setTitle(VFS.basename(p));
    this.tazele();
    notify.toast('Kaydedildi', { glyph: '💾' });
    return true;
  }

  /** Kaydedilmemiş değişiklik varsa üç yollu sorar. @returns {Promise<boolean>} */
  async kapanabilirMi() {
    if (!this.dirty) return true;
    const ad = this.path ? VFS.basename(this.path) : 'Adsız belge';
    const secim = await notify.choose(
      `“${ad}” içindeki değişiklikler kaydedilmedi. Kapatırsanız kaybolur.`,
      { title: 'Değişiklikleri kaydet', glyph: '💾', root: this.el, buttons: [
        { label: 'Kaydet', value: 'kaydet', variant: 'primary' },
        { label: 'Kaydetmeden Kapat', value: 'at', variant: 'danger' },
        { label: 'Vazgeç', value: 'vazgec' },
      ] });
    if (secim === 'kaydet') return this.kaydet();
    return secim === 'at';   /* null (kaçış) da kapatmayı iptal eder */
  }

  /* ------------------------------------------------------------ bul */
  buluDondur() {
    if (this.bulCubugu.hidden) {
      this.bulCubugu.hidden = false;
      const sec = this.ta.value.slice(this.ta.selectionStart, this.ta.selectionEnd);
      if (sec && !sec.includes('\n')) this.bulAlani.value = sec;
      this.bulAlani.focus(); this.bulAlani.select();
      this.bulTazele();
    } else this.buluKapat();
  }
  buluKapat() { this.bulCubugu.hidden = true; this.ta.focus(); }

  eslesmeler() {
    const q = this.bulAlani.value;
    if (!q) return [];
    const metin = this.duyarli ? this.ta.value : this.ta.value.toLowerCase();
    const ara = this.duyarli ? q : q.toLowerCase();
    const sonuc = [];
    let i = metin.indexOf(ara);
    while (i !== -1) { sonuc.push(i); i = metin.indexOf(ara, i + Math.max(1, ara.length)); }
    return sonuc;
  }

  bulTazele() {
    const e = this.eslesmeler();
    this.bulIndeksi = e.length ? Math.min(this.bulIndeksi ?? 0, e.length - 1) : -1;
    this.bulSayac.textContent = e.length ? `${this.bulIndeksi + 1}/${e.length}` : '0/0';
    this.bulSayac.classList.toggle('yok', !!this.bulAlani.value && !e.length);
    if (e.length) this.esleseGit(e[this.bulIndeksi]);
  }

  bulGit(yon) {
    const e = this.eslesmeler();
    if (!e.length) { this.bulSayac.textContent = '0/0'; return; }
    this.bulIndeksi = ((this.bulIndeksi ?? -1) + yon + e.length) % e.length;
    this.bulSayac.textContent = `${this.bulIndeksi + 1}/${e.length}`;
    this.esleseGit(e[this.bulIndeksi]);
  }

  esleseGit(konum) {
    const uz = this.bulAlani.value.length;
    this.ta.focus();
    this.ta.setSelectionRange(konum, konum + uz);
    /* Seçimi görünür kılmak için kaba ama güvenilir yol: satır yüksekliğinden
       hedef kaydırma konumu hesaplanır. */
    const satir = this.ta.value.slice(0, konum).split('\n').length - 1;
    const yukseklik = parseFloat(getComputedStyle(this.ta).lineHeight) || 21;
    const hedef = satir * yukseklik;
    if (hedef < this.ta.scrollTop || hedef > this.ta.scrollTop + this.ta.clientHeight - yukseklik * 2) {
      this.ta.scrollTop = Math.max(0, hedef - this.ta.clientHeight / 2);
    }
    this.durumTazele();
  }

  degistir(tumu) {
    const q = this.bulAlani.value;
    if (!q) return;
    const yeni = this.degistirAlani.value;
    if (tumu) {
      const e = this.eslesmeler();
      if (!e.length) return;
      /* Sondan başa doğru: önceki değişiklik sonraki konumları kaydırmasın. */
      let v = this.ta.value;
      for (let i = e.length - 1; i >= 0; i--) v = v.slice(0, e[i]) + yeni + v.slice(e[i] + q.length);
      this.ta.select();
      this.yaz(v);
      notify.toast(`${e.length} değişiklik yapıldı`, { glyph: '🔁' });
      this.bulIndeksi = -1; this.bulTazele();
      return;
    }
    const sec = this.ta.value.slice(this.ta.selectionStart, this.ta.selectionEnd);
    const uyuyor = this.duyarli ? sec === q : sec.toLowerCase() === q.toLowerCase();
    if (!uyuyor) return this.bulGit(+1);
    this.yaz(yeni);
    this.bulGit(+1);
  }

  /* --------------------------------------------------------- görünüm */
  onizlemeyiDondur() {
    this.onizlemeKipi = this.onizlemeKipi === 'kapali' ? 'bolunmus'
                      : this.onizlemeKipi === 'bolunmus' ? 'tam' : 'kapali';
    this.onizlemeyiUygula();
  }

  onizlemeyiUygula() {
    const k = this.onizlemeKipi;
    this.alan.classList.toggle('bolunmus', k === 'bolunmus');
    this.prev.style.display = k === 'kapali' ? 'none' : '';
    this.ta.style.display = k === 'tam' ? 'none' : '';
    this.satirlar.style.display = k === 'tam' ? 'none' : '';
    this.onizlemeBtn.classList.toggle('v-tinted', k !== 'kapali');
    this.onizlemeBtn.title = k === 'kapali' ? 'Markdown önizleme (⌘P)'
                          : k === 'bolunmus' ? 'Tam önizleme (⌘P)' : 'Önizlemeyi kapat (⌘P)';
    if (k !== 'kapali') this.onizlemeyiCiz();
  }

  sarmayiDondur() {
    this.sarma = !this.sarma;
    this.ta.style.whiteSpace = this.sarma ? 'pre-wrap' : 'pre';
    this.ta.style.overflowX = this.sarma ? 'hidden' : 'auto';
    this.sarmaBtn.classList.toggle('v-tinted', !this.sarma);
    this.satirlariCiz();
  }

  punto(yon) {
    const olcekler = [11, 12, 13, 15, 17, 20];
    this.puntoIndeksi = Math.max(0, Math.min(olcekler.length - 1, this.puntoIndeksi + yon));
    const p = olcekler[this.puntoIndeksi];
    this.ta.style.fontSize = p + 'px';
    this.satirlar.style.fontSize = p + 'px';
    this.satirlariCiz();
  }

  onizlemeyiCiz = debounce(() => {
    if (this.onizlemeKipi === 'kapali') return;
    this.prev.innerHTML = markdown(this.ta.value);
  }, 140);

  /** Satır numaraları. Sarma açıkken numaralar yanıltıcı olur, o yüzden gizlenir. */
  satirlariCiz() {
    if (this.sarma) { this.satirlar.hidden = true; return; }
    this.satirlar.hidden = false;
    const adet = this.ta.value.split('\n').length;
    if (this.satirlar.childElementCount === adet) return;
    clear(this.satirlar);
    const parca = document.createDocumentFragment();
    for (let i = 1; i <= adet; i++) parca.appendChild(h('div', { text: String(i) }));
    this.satirlar.appendChild(parca);
  }

  tazele() { this.satirlariCiz(); this.durumTazele(); }

  durumTazele() {
    const v = this.ta.value;
    const a = this.ta.selectionStart ?? 0;
    const oncesi = v.slice(0, a);
    const satir = oncesi.split('\n').length;
    const sutun = a - (oncesi.lastIndexOf('\n') + 1) + 1;
    const kelime = v.trim() ? v.trim().split(/\s+/).length : 0;
    const secim = (this.ta.selectionEnd ?? a) - a;

    clear(this.status);
    /* `append(null)` düğüm beklemez, "null" dizesi yazar; boşlar elenmeli. */
    this.status.append(...[
      h('span', { text: this.path || 'kaydedilmemiş belge' }),
      h('span.nokta', { text: '·' }),
      h('span', { text: `Satır ${satir}, Sütun ${sutun}` }),
      h('span.nokta', { text: '·' }),
      h('span', { text: `${v.split('\n').length} satır` }),
      h('span.nokta', { text: '·' }),
      h('span', { text: `${kelime} kelime` }),
      h('span.nokta', { text: '·' }),
      h('span', { text: `${v.length} karakter` }),
      secim ? h('span.nokta', { text: '·' }) : null,
      secim ? h('span', { text: `${secim} seçili` }) : null,
      this.dirty ? h('span.txt-dirty', { text: '● değiştirildi' }) : null,
    ].filter(Boolean));
  }
}

/**
 * Notlar, README'ler ve sistem belgeleri için küçük bir Markdown alt kümesi.
 *
 * Ayrıştırma satır satır yapılır. Önceki sürüm metni yalnızca boş satırlardan
 * bölüyordu; bir başlığın hemen ardından gelen liste, araya boş satır
 * konmadıkça tek bir paragrafa dönüşüyor ve maddeler kayboluyordu — kaynakta
 * son derece yaygın bir yazım.
 */
export function markdown(src) {
  const satirlar = escapeHtml(src).replace(/\r\n?/g, '\n').split('\n');
  const cikti = [];
  let i = 0;

  const liste = (bicim, kalip) => {
    const ogeler = [];
    while (i < satirlar.length && kalip.test(satirlar[i])) {
      ogeler.push(`<li>${inline(satirlar[i].replace(kalip, ''))}</li>`);
      i++;
    }
    cikti.push(`<${bicim}>${ogeler.join('')}</${bicim}>`);
  };

  while (i < satirlar.length) {
    const l = satirlar[i];

    if (!l.trim()) { i++; continue; }

    /* çitli kod bloğu */
    if (/^\s*```/.test(l)) {
      const dil = l.replace(/^\s*```/, '').trim();
      const govde = [];
      i++;
      while (i < satirlar.length && !/^\s*```/.test(satirlar[i])) govde.push(satirlar[i++]);
      i++;
      cikti.push(`<pre${dil ? ` data-dil="${dil}"` : ''}><code>${govde.join('\n')}</code></pre>`);
      continue;
    }

    /* başlık */
    const b = l.match(/^(#{1,6})\s+(.*)$/);
    if (b) { cikti.push(`<h${b[1].length}>${inline(b[2])}</h${b[1].length}>`); i++; continue; }

    /* yatay çizgi */
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l)) { cikti.push('<hr>'); i++; continue; }

    /* alıntı — ardışık satırlar tek blokta toplanır */
    if (/^\s*&gt;\s?/.test(l)) {
      const govde = [];
      while (i < satirlar.length && /^\s*&gt;\s?/.test(satirlar[i])) {
        govde.push(satirlar[i].replace(/^\s*&gt;\s?/, '')); i++;
      }
      cikti.push(`<blockquote>${inline(govde.join(' '))}</blockquote>`);
      continue;
    }

    /* listeler */
    if (/^\s*[-*+]\s+/.test(l)) { liste('ul', /^\s*[-*+]\s+/); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { liste('ol', /^\s*\d+[.)]\s+/); continue; }

    /* paragraf — bir sonraki boş satıra ya da blok başlangıcına dek */
    const govde = [];
    while (i < satirlar.length && satirlar[i].trim()
           && !/^\s*(#{1,6}\s|```|&gt;\s?|[-*+]\s|\d+[.)]\s|-{3,}$)/.test(satirlar[i])) {
      govde.push(satirlar[i]); i++;
    }
    if (govde.length) cikti.push(`<p>${inline(govde.join('<br>'))}</p>`);
    else i++;
  }
  return cikti.join('\n');
}
function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|\W)_([^_]+)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
