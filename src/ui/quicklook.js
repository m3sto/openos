/* ==========================================================================
   OpenOS · ui/quicklook.js — Hızlı Bakış

   Bir dosyanın ne olduğunu anlamak için onu açmak gerekiyordu: uygulama
   yükleniyor, pencere geliyor, sonra "bu değilmiş" deyip kapatıyorsunuz.
   Hızlı Bakış boşluk tuşuyla dosyayı yerinde gösterir; ok tuşlarıyla
   komşularına geçilir, boşluk ya da Esc kapatır.

   Kullanım:
     quickLook(yol, { komsular: [...yollar], acilis: yol => … })
   ========================================================================== */

import { h, clear, on, fmtBytes, escapeHtml } from '../core/util.js';
import { icon, hasIcon } from '../core/icons.js';
import vfs, { VFS } from '../core/vfs.js';

const METIN = ['txt', 'md', 'markdown', 'log', 'csv', 'ini', 'conf', 'yml', 'yaml'];
const KOD = ['osh', 'js', 'mjs', 'json', 'css', 'html', 'xml', 'svg', 'py', 'sh'];
const GORSEL = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'];
const SES = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
const VIDEO = ['mp4', 'webm', 'mkv', 'mov'];

let acikPencere = null;

/** Şu an bir önizleme açık mı? */
export function quickLookOpen() { return !!acikPencere; }

/** Açıksa kapatır. @returns {boolean} kapatıldı mı */
export function closeQuickLook() {
  if (!acikPencere) return false;
  acikPencere.kapat();
  return true;
}

/**
 * @param {string} yol  önizlenecek dosya ya da klasör
 * @param {object} [o]
 * @param {string[]} [o.komsular]  ok tuşlarıyla gezilecek yollar
 * @param {(yol:string)=>void} [o.acilis]  "Aç" düğmesinin yapacağı iş
 */
export function quickLook(yol, o = {}) {
  closeQuickLook();

  const komsular = (o.komsular || []).filter(p => p);
  let indeks = Math.max(0, komsular.indexOf(yol));
  let gecerli = yol;

  const govde = h('div.ql-body');
  const baslik = h('div.ql-title');
  const altBilgi = h('div.ql-foot');
  const sayac = h('span.ql-count');

  const acBtn = h('button.k-btn.v-primary.s-sm', { html: icon('folderOpen', 13), text: ' Aç' });
  const kutu = h('div.ql',
    h('div.ql-head',
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('x', 14), title: 'Kapat (Esc)',
        onclick: () => kapat() }),
      baslik,
      h('div.k-spacer'),
      sayac,
      komsular.length > 1 ? h('button.k-btn.v-ghost.icon.s-sm', { html: icon('chevronL', 14),
        title: 'Önceki (←)', onclick: () => git(-1) }) : null,
      komsular.length > 1 ? h('button.k-btn.v-ghost.icon.s-sm', { html: icon('chevronR', 14),
        title: 'Sonraki (→)', onclick: () => git(+1) }) : null,
      acBtn),
    govde, altBilgi);

  const perde = h('div.ql-scrim', kutu);

  on(acBtn, 'click', () => { const p = gecerli; kapat(); o.acilis?.(p); });
  on(perde, 'pointerdown', e => { if (e.target === perde) kapat(); });

  const tus = e => {
    if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); kapat(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); git(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); git(+1); }
    else if (e.key === 'Enter') { e.preventDefault(); const p = gecerli; kapat(); o.acilis?.(p); }
  };
  window.addEventListener('keydown', tus, true);

  function kapat() {
    window.removeEventListener('keydown', tus, true);
    perde.classList.add('kapaniyor');
    setTimeout(() => perde.remove(), 160);
    acikPencere = null;
  }

  function git(yon) {
    if (komsular.length < 2) return;
    indeks = (indeks + yon + komsular.length) % komsular.length;
    gecerli = komsular[indeks];
    ciz();
  }

  function ciz() {
    const st = vfs.stat(gecerli);
    baslik.textContent = st ? st.name : VFS.basename(gecerli);
    sayac.textContent = komsular.length > 1 ? `${indeks + 1} / ${komsular.length}` : '';
    clear(govde);
    clear(altBilgi);

    if (!st) {
      govde.appendChild(bos('Dosya bulunamadı', 'alert'));
      return;
    }

    altBilgi.append(
      h('span', { text: st.type === 'dir' ? 'Klasör' : (st.ext ? '.' + st.ext : 'dosya') }),
      h('span.nokta', { text: '·' }),
      h('span', { text: st.type === 'dir' ? `${st.size} öğe` : fmtBytes(st.size) }),
      h('span.nokta', { text: '·' }),
      h('span', { text: new Date(st.modified).toLocaleString('tr-TR') }),
      h('div.k-spacer'),
      h('span.ql-path.ellipsis', { text: gecerli.replace(vfs.home, '~') }),
    );

    govde.appendChild(onizleme(st));
  }

  function onizleme(st) {
    if (st.type === 'dir') return klasorOnizleme(st);

    const ext = (st.ext || '').toLowerCase();
    let icerik = '';
    try { icerik = vfs.read(gecerli); } catch { return bos('Okunamadı', 'alert'); }

    /* Sanal diskte ikili veri `data:` URL'i olarak duruyor; türü oradan
       okumak uzantıya güvenmekten sağlam. */
    const veri = /^data:([^;,]+)[;,]/.exec(icerik);
    const mime = veri ? veri[1] : '';

    if (GORSEL.includes(ext) || mime.startsWith('image/')) {
      if (ext === 'svg' && !veri) {
        return h('div.ql-image', { html: icerik });
      }
      return h('div.ql-image', h('img', { src: icerik, alt: st.name }));
    }
    if (SES.includes(ext) || mime.startsWith('audio/')) {
      return h('div.ql-media', h('audio', { src: icerik, controls: true }));
    }
    if (VIDEO.includes(ext) || mime.startsWith('video/')) {
      return h('div.ql-media', h('video', { src: icerik, controls: true, style: { maxWidth: '100%' } }));
    }
    if (veri) {
      /* İkili ama gösterilemeyen tür: ne olduğunu söyle, içini dökme. */
      return bos(`${mime || 'ikili dosya'} · ${fmtBytes(st.size)}`, 'file');
    }

    if (ext === 'json') {
      try { icerik = JSON.stringify(JSON.parse(icerik), null, 2); } catch {}
      return h('pre.ql-code', { text: icerik });
    }
    if (KOD.includes(ext)) return h('pre.ql-code', { text: icerik });
    if (METIN.includes(ext) || !ext) {
      if (ext === 'md' || ext === 'markdown') {
        const kutu2 = h('div.ql-doc.br-doc');
        import('../apps/texteditor.js').then(({ markdown }) => { kutu2.innerHTML = markdown(icerik); });
        return kutu2;
      }
      return h('pre.ql-text', { text: icerik });
    }
    return h('pre.ql-text', { text: icerik.slice(0, 20000) });
  }

  function klasorOnizleme(st) {
    let ogeler = [];
    try { ogeler = vfs.list(gecerli); } catch {}
    if (!ogeler.length) return bos('Bu klasör boş', 'folder');
    const liste = h('div.ql-folder');
    for (const o2 of ogeler.slice(0, 200)) {
      liste.appendChild(h('div.ql-folder-item',
        h('span', { html: icon(o2.type === 'dir' ? 'folder' : 'file', 14) }),
        h('span.ellipsis', { text: o2.name }),
        h('span.dim', { text: o2.type === 'dir' ? '—' : fmtBytes(o2.size) })));
    }
    if (ogeler.length > 200) {
      liste.appendChild(h('div.ql-folder-item.dim', { text: `… ve ${ogeler.length - 200} öğe daha` }));
    }
    void st;
    return liste;
  }

  function bos(metin, glyph) {
    return h('div.ql-empty',
      h('div', { html: icon(hasIcon(glyph) ? glyph : 'file', 30) }),
      h('div.k-text.t-callout', { text: metin }));
  }

  document.getElementById('stage')?.appendChild(perde) || document.body.appendChild(perde);
  ciz();
  acikPencere = { kapat };
  return { kapat };
}

export default quickLook;
