/* ==========================================================================
   OpenOS · ui/shortcuts.js — klavye kısayolları paneli

   Sistemde onlarca kısayol var ve hiçbiri görünmüyordu: Spotlight'ın ⌘Space
   olduğunu bilmeyen onu hiç kullanmıyor. ⌘/ ile açılan bu panel hepsini tek
   yerde, aranabilir biçimde gösterir.

   Kısayollar tek bir kaynakta duruyor; yeni bir kısayol eklerken buraya da
   yazmak zorunda kalmak bilerek: listelenmeyen kısayol yok sayılır.
   ========================================================================== */

import { h, clear, on } from '../core/util.js';
import { icon } from '../core/icons.js';

/** Sistem geneli kısayollar. Uygulamalar kendi listelerini `ek` ile verir. */
export const KISAYOLLAR = [
  ['Sistem', [
    ['⌘', 'Boşluk', 'Spotlight — uygulama, dosya ve komut ara'],
    ['', 'F4', 'Launchpad'],
    ['', 'F3', 'Mission Control'],
    ['⌘', ',', 'Sistem Ayarları'],
    ['⌘', '/', 'Bu panel'],
    ['⌃⌘', 'L', 'Ekranı kilitle'],
    ['', 'Esc', 'Açık katmanları kapat'],
  ]],
  ['Pencereler', [
    ['⌘', 'W', 'Pencereyi kapat'],
    ['⌘', 'M', 'Pencereyi küçült'],
    ['⇧⌘', 'Q', 'Uygulamanın tüm pencerelerini kapat'],
    ['⌘', '`', 'Pencereler arasında geçiş'],
    ['⌘', 'Tab', 'Pencereler arasında geçiş'],
    ['⌃⌘', 'F', 'Tam ekran'],
    ['', 'Kenara sürükle', 'Ekranın yarısına yapıştır'],
  ]],
  ['Finder', [
    ['', 'Boşluk', 'Hızlı Bakış — seçili dosyayı önizle'],
    ['', '← →', 'Hızlı Bakış’ta dosyalar arasında geç'],
    ['', 'Enter', 'Seçiliyi aç'],
    ['⌘', 'Delete', 'Çöp kutusuna at'],
  ]],
  ['Metin', [
    ['⌘', 'C', 'Kopyala — sistemin kendi panosuna'],
    ['⌘', 'V', 'Yapıştır'],
    ['⌘', 'X', 'Kes'],
    ['⌘', 'A', 'Tümünü seç'],
    ['⌘', 'Z', 'Geri al'],
    ['⇧⌘', 'Z', 'Yinele'],
  ]],
  ['Metin Düzenleyici', [
    ['⌘', 'N', 'Yeni belge'],
    ['⌘', 'O', 'Aç'],
    ['⌘', 'S', 'Kaydet'],
    ['⇧⌘', 'S', 'Farklı kaydet'],
    ['⌘', 'F', 'Bul ve Değiştir'],
    ['⌘', 'G', 'Sonraki eşleşme'],
    ['⌘', 'P', 'Markdown önizleme'],
  ]],
  ['OpenSharp Studio', [
    ['⌘', '↩', 'Çalıştır'],
    ['⌘', 'S', 'Kaydet'],
    ['⌘', 'K', 'Komut paleti'],
    ['⌘', 'F', 'Bul'],
    ['⇧⌘', 'E', 'Gezgin'],
    ['⇧⌘', 'F', 'Projede ara'],
    ['⇧⌘', 'M', 'Sorunlar'],
    ['⌘', 'B', 'Kenar çubuğunu gizle'],
    ['⌘', 'J', 'Alt paneli gizle'],
    ['⌘', '/', 'Yorum aç/kapat'],
    ['⇧⌘', 'D', 'Satırı çoğalt'],
    ['⌃', 'Boşluk', 'Tamamlamayı zorla'],
  ]],
  ['Terminal', [
    ['', 'Tab', 'Tamamla'],
    ['', '↑ ↓', 'Komut geçmişi'],
    ['⌘', 'L', 'Ekranı temizle'],
    ['⌃', 'C', 'Komutu iptal et'],
    ['⌘⇧', '↑ ↓', 'Satır satır işaretle'],
    ['⌘', 'A', 'Çıktının tamamını işaretle'],
  ]],
];

let acik = null;

export function shortcutsOpen() { return !!acik; }

export function closeShortcuts() {
  if (!acik) return false;
  acik();
  return true;
}

/** Paneli açar; açıksa kapatır. */
export function toggleShortcuts() {
  if (acik) { closeShortcuts(); return; }
  showShortcuts();
}

export function showShortcuts() {
  closeShortcuts();

  const arama = h('input.sc-search', { placeholder: 'Kısayol ara', spellcheck: false });
  const govde = h('div.sc-body');
  const kutu = h('div.sc',
    h('div.sc-head',
      h('span', { html: icon('bolt', 15) }),
      h('div.k-text.t-headline', { text: 'Klavye Kısayolları' }),
      h('div.k-spacer'),
      h('div.k-field.plain', { style: { width: '210px' } }, arama),
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('x', 14), title: 'Kapat (Esc)',
        onclick: () => kapat() })),
    govde);
  const perde = h('div.sc-scrim', kutu);

  function ciz() {
    const q = arama.value.trim().toLowerCase();
    clear(govde);
    let toplam = 0;

    for (const [grup, satirlar] of KISAYOLLAR) {
      const uyan = q
        ? satirlar.filter(([m, t, a]) =>
            (m + ' ' + t + ' ' + a).toLowerCase().includes(q) || grup.toLowerCase().includes(q))
        : satirlar;
      if (!uyan.length) continue;
      toplam += uyan.length;

      const sutun = h('div.sc-group', h('div.sc-group-title', { text: grup }));
      for (const [degistirici, tus, aciklama] of uyan) {
        sutun.appendChild(h('div.sc-row',
          h('div.sc-keys',
            degistirici ? h('kbd', { text: degistirici }) : null,
            h('kbd', { text: tus })),
          h('div.sc-desc', { text: aciklama })));
      }
      govde.appendChild(sutun);
    }

    if (!toplam) {
      govde.appendChild(h('div.k-empty',
        h('div', { html: icon('search', 26), style: { color: 'var(--text-3)' } }),
        h('div.k-text.t-callout', { text: `“${arama.value}” için kısayol yok` })));
    }
  }

  const tus = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); kapat(); }
  };
  window.addEventListener('keydown', tus, true);

  function kapat() {
    window.removeEventListener('keydown', tus, true);
    perde.classList.add('kapaniyor');
    setTimeout(() => perde.remove(), 150);
    acik = null;
  }

  on(arama, 'input', ciz);
  on(perde, 'pointerdown', e => { if (e.target === perde) kapat(); });

  (document.getElementById('stage') || document.body).appendChild(perde);
  ciz();
  setTimeout(() => arama.focus(), 60);
  acik = kapat;
}

export default showShortcuts;
