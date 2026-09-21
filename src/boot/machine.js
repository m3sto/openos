/* ==========================================================================
   OpenOS · boot/machine.js — makine ayarları (açılış öncesi)

   Sistem doğrudan açılmıyor: önce hangi diskle açılacağı soruluyor. Bir
   sanal makine yöneticisinin yaptığı iş — disk oluştur, disk aç, makineyi
   başlat.

   Ekran bilerek açılış görüntüsünden *önce*: disk seçimi bir sistem
   kararıdır, sistem açıldıktan sonra değiştirilemez. Klasör izni de
   kullanıcı hareketi gerektiriyor ve o hareketin yeri burası.

   Klasör API'si olmayan tarayıcılarda ekran bunu açıkça söylüyor ve
   tarayıcı deposuyla devam etme seçeneği veriyor — sessizce geri düşmek,
   kullanıcının diskinin nerede olduğunu bilmemesi demek olurdu.
   ========================================================================== */

import { h, clear, on, fmtBytes } from '../core/util.js';
import { icon } from '../core/icons.js';
import makineler from '../core/disk.js';

/**
 * @param {HTMLElement} stage
 * @returns {Promise<{depo: object|null}>}  `depo` null ise tarayıcı deposu
 */
export function makineEkrani(stage) {
  return new Promise((coz) => {
    const govde = h('div.mk-body');
    const kok = h('div.mk',
      h('div.mk-card',
        h('div.mk-head',
          h('div.mk-mark', { html: icon('logo', 30) }),
          h('div',
            h('div.mk-title', { text: 'OpenOS' }),
            h('div.mk-sub', { text: 'Makine ayarları' }))),
        govde));
    stage.appendChild(kok);

    const bitir = (depo) => {
      kok.classList.add('cikiyor');
      setTimeout(() => kok.remove(), 260);
      coz({ depo });
    };

    const hata = (metin) => {
      const k = govde.querySelector('.mk-hata');
      if (k) { k.textContent = metin; k.hidden = !metin; }
    };

    /* ---------------------------------------------------------- liste */
    async function cizListe() {
      clear(govde);

      if (!makineler.destekleniyorMu) return cizDesteksiz();

      const liste = await makineler.listele();
      govde.appendChild(h('div.mk-not', { text:
        'Diskiniz seçtiğiniz klasörde tek bir şifreli dosya olarak durur. ' +
        'Tarayıcı verilerini temizlemek onu silmez; kopyalayıp başka bir ' +
        'bilgisayarda açabilirsiniz.' }));

      if (liste.length) {
        const kutu = h('div.mk-liste');
        for (const m of liste) {
          const satir = h('button.mk-makine',
            h('span.mk-disk', { html: icon('hardDrive', 20) }),
            h('span.mk-bilgi',
              h('span.mk-ad', { text: m.ad }),
              h('span.mk-meta', { text:
                `${m.boyut ? fmtBytes(m.boyut) : 'boş'} · son açılış ${
                  m.sonKullanim ? new Date(m.sonKullanim).toLocaleDateString('tr-TR') : '—'}${
                  m.hatirla ? ' · parola hatırlanıyor' : ''}` })),
            h('span.mk-git', { html: icon('chevronR', 16) }));
          on(satir, 'click', () => makineyiAc(m));
          const sil = h('button.mk-sil', { html: icon('trash', 14), title: 'Listeden çıkar' });
          on(sil, 'click', async (e) => {
            e.stopPropagation();
            await makineler.unut(m.id);
            cizListe();
          });
          kutu.appendChild(h('div.mk-makine-satir', satir, sil));
        }
        govde.appendChild(kutu);
        govde.appendChild(h('div.mk-ayrac', { text: 'ya da' }));
      }

      govde.appendChild(h('div.mk-hata', { hidden: true }));
      govde.appendChild(h('div.mk-eylem',
        h('button.k-btn.v-primary.mk-genis', { html: icon('plus', 14), text: ' Yeni disk oluştur',
          onclick: () => cizOlustur() }),
        h('button.k-btn.mk-genis', { html: icon('folderOpen', 14), text: ' Varolan diski aç',
          onclick: () => makineyiAc(null) })));

      govde.appendChild(h('button.mk-gecici', { text: 'Diske yazmadan dene',
        title: 'Veriler yalnızca bu tarayıcıda kalır',
        onclick: () => bitir(null) }));
    }

    /* ------------------------------------------------------ desteklenmiyor */
    function cizDesteksiz() {
      const sebep = makineler.sebep === 'guvensiz-baglam'
        ? 'Klasöre yazma yalnızca güvenli bağlantıda (https ya da localhost) çalışır.'
        : 'Bu tarayıcı klasöre yazmayı desteklemiyor — Chrome, Edge ya da Opera gerekiyor.';
      govde.append(
        h('div.mk-uyari',
          h('span', { html: icon('alert', 18) }),
          h('div',
            h('div.mk-uyari-bas', { text: 'Gerçek disk kullanılamıyor' }),
            h('div.mk-uyari-govde', { text: sebep }))),
        h('div.mk-not', { text:
          'Sistem tarayıcı deposuyla açılacak. Veriler şifreli tutulur ama ' +
          'tarayıcı site verilerini temizlerse silinir ve birkaç megabaytla sınırlıdır.' }),
        h('div.mk-eylem',
          h('button.k-btn.v-primary.mk-genis', { text: 'Tarayıcı deposuyla başlat',
            onclick: () => bitir(null) })));
    }

    /* ------------------------------------------------------------ oluştur */
    function cizOlustur() {
      clear(govde);
      const ad = h('input', { placeholder: 'Makine adı', value: 'OpenOS' });
      const p1 = h('input', { type: 'password', placeholder: 'Disk parolası' });
      const p2 = h('input', { type: 'password', placeholder: 'Parolayı doğrulayın' });
      const hatirla = h('input', { type: 'checkbox', checked: true });
      const hataKutu = h('div.mk-hata', { hidden: true });

      const olustur = h('button.k-btn.v-primary.mk-genis', { text: 'Klasör seç ve oluştur' });
      on(olustur, 'click', async () => {
        hataKutu.hidden = true;
        if (p1.value !== p2.value) { hataKutu.textContent = 'Parolalar aynı değil.'; hataKutu.hidden = false; return; }
        olustur.disabled = true;
        olustur.textContent = 'Oluşturuluyor…';
        try {
          const depo = await makineler.olustur({ ad: ad.value.trim(), parola: p1.value, hatirla: hatirla.checked });
          bitir(depo);
        } catch (e) {
          if (e?.name === 'AbortError') { olustur.disabled = false; olustur.textContent = 'Klasör seç ve oluştur'; return; }
          hataKutu.textContent = e.message;
          hataKutu.hidden = false;
          olustur.disabled = false;
          olustur.textContent = 'Klasör seç ve oluştur';
        }
      });

      govde.append(
        h('div.mk-adim', { text: 'Yeni disk' }),
        h('div.mk-not', { text:
          'Boş bir klasör seçin. İçine `openos.disk` adında tek bir şifreli dosya ' +
          'yazılır — sisteminizin tamamı o dosyadadır.' }),
        h('label.mk-alan', h('span', { text: 'Ad' }), ad),
        h('label.mk-alan', h('span', { text: 'Parola' }), p1),
        h('label.mk-alan', h('span', { text: 'Doğrula' }), p2),
        h('div.mk-not.kucuk', { text:
          'Parola hiçbir yere yazılmaz ve kurtarılamaz. Unutursanız diskteki ' +
          'veriye ulaşmanın bir yolu yoktur.' }),
        h('label.mk-onay', hatirla, h('span', { text: 'Parolayı bu cihazda hatırla' })),
        hataKutu,
        h('div.mk-eylem', olustur,
          h('button.k-btn.mk-genis', { text: 'Geri', onclick: () => cizListe() })));
      setTimeout(() => ad.focus(), 60);
    }

    /* ----------------------------------------------------------- aç/parola */
    async function makineyiAc(m) {
      try {
        const depo = await makineler.ac({ makine: m });
        bitir(depo);
      } catch (e) {
        if (e?.name === 'AbortError') return;
        if (e.kod === 'parola-gerekli' || e.kod === 'parola-yanlis') return cizParola(m, e.kod === 'parola-yanlis');
        hata(e.message);
        const k = govde.querySelector('.mk-hata');
        if (!k) { clear(govde); cizListe(); }
      }
    }

    function cizParola(m, yanlisMi) {
      clear(govde);
      const p = h('input', { type: 'password', placeholder: 'Disk parolası' });
      const hatirla = h('input', { type: 'checkbox' });
      const hataKutu = h('div.mk-hata', { hidden: !yanlisMi, text: yanlisMi ? 'Parola yanlış.' : '' });

      const ac = h('button.k-btn.v-primary.mk-genis', { text: 'Diski aç' });
      const dene = async () => {
        hataKutu.hidden = true;
        ac.disabled = true; ac.textContent = 'Açılıyor…';
        try {
          const depo = await makineler.ac({ makine: m, parola: p.value });
          if (hatirla.checked && depo.makine) await makineler.anahtariSakla(depo.makine, depo.anahtar);
          bitir(depo);
        } catch (e) {
          hataKutu.textContent = e.message;
          hataKutu.hidden = false;
          ac.disabled = false; ac.textContent = 'Diski aç';
          p.select();
        }
      };
      on(ac, 'click', dene);
      on(p, 'keydown', e => { if (e.key === 'Enter') dene(); });

      govde.append(
        h('div.mk-adim', { text: m?.ad || 'Disk' }),
        h('div.mk-not', { text: 'Bu disk şifreli. Açmak için parolasını girin.' }),
        h('label.mk-alan', h('span', { text: 'Parola' }), p),
        h('label.mk-onay', hatirla, h('span', { text: 'Bu cihazda hatırla' })),
        hataKutu,
        h('div.mk-eylem', ac,
          h('button.k-btn.mk-genis', { text: 'Geri', onclick: () => cizListe() })));
      setTimeout(() => p.focus(), 60);
    }

    cizListe();
  });
}

export default makineEkrani;
