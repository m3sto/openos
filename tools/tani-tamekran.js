/* ==========================================================================
   OpenOS · tools/tani-tamekran.js — tam ekran boş içerik tanısı

   Bu hata yalnızca sayfa tam ekrandayken oluşuyor ve tam ekrandayken
   geliştirici konsolu görünmüyor — o yüzden bu araç konsola değil ekrana
   yazar. Paneli tam ekran öğesinin *içine* takar, yoksa üst katmandaki
   öğenin arkasında kalıp kendisi de görünmez olurdu.

   Kullanım:
     1. OpenOS açıkken konsola bu dosyanın tamamını yapıştır, Enter.
     2. Sağ üstte küçük bir panel belirir.
     3. Ayarlar'ı (ya da boş kalan hangi uygulamaysa) aç.
     4. F11 ile tam ekrana geç. Panel kayda devam eder.
     5. Hata göründüğü anda paneldeki "KOPYALA"ya bas, çıktıyı yapıştır.

   Panel ne ölçer: içerik bölmesinin kutusu ve ata zincirindeki her öğenin
   kutusu, opaklığı, görünürlüğü, kırpması. Amaç tek bir soruyu yanıtlamak:
   içerik *ölçülemeyecek kadar küçük mü* (yerleşim hatası) yoksa ölçüleri
   doğru olduğu halde mi boyanmıyor (birleştirme hatası)? İkisi tamamen
   farklı iki hata ve şu ana kadar hangisi olduğunu bilmiyoruz.
   ========================================================================== */

(() => {
  document.getElementById('os-tani')?.remove();

  const panel = document.createElement('div');
  panel.id = 'os-tani';
  panel.style.cssText = [
    'position:fixed', 'top:8px', 'right:8px', 'width:430px', 'max-height:70vh',
    'overflow:auto', 'z-index:2147483647', 'background:rgba(12,12,14,.94)',
    'color:#e8e8ea', 'font:11px/1.45 ui-monospace,Menlo,monospace',
    'padding:8px 10px', 'border-radius:10px', 'border:1px solid #3a3a40',
    'box-shadow:0 10px 40px rgba(0,0,0,.6)', 'white-space:pre-wrap',
  ].join(';');

  const baslik = document.createElement('div');
  baslik.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px';
  const btnKopya = document.createElement('button');
  btnKopya.textContent = 'KOPYALA';
  const btnKapat = document.createElement('button');
  btnKapat.textContent = 'KAPAT';
  for (const b of [btnKopya, btnKapat]) {
    b.style.cssText = 'font:10px ui-monospace;padding:2px 7px;border-radius:5px;' +
      'border:1px solid #4a4a52;background:#26262c;color:#e8e8ea;cursor:pointer';
  }
  const durum = document.createElement('span');
  durum.style.cssText = 'flex:1;color:#8a8a94';
  baslik.append(durum, btnKopya, btnKapat);
  const govde = document.createElement('div');
  panel.append(baslik, govde);

  /* Tam ekrana geçen öğe üst katmana alınır; panel o öğenin dışında
     kalırsa arkasında gizlenir. Her geçişte yeniden takıyoruz. */
  const tak = () => (document.fullscreenElement || document.body).appendChild(panel);
  tak();
  document.addEventListener('fullscreenchange', tak);

  const kayit = [];
  let sonImza = '';

  const hedefBul = () => {
    const pencereler = [...document.querySelectorAll('.win')]
      .filter(w => w.style.display !== 'none');
    const odak = document.querySelector('.win.focused') || pencereler[pencereler.length - 1];
    if (!odak) return null;
    /* Bir pencerede birden çok kaydırma alanı olabiliyor (kenar çubuğu +
       ana bölme). Boş kalan ana bölme olduğu için en geniş olanı seçiyoruz;
       kenar çubukları elenir. */
    const adaylar = [...odak.querySelectorAll('.content, .app-body, .os-scroll-body')]
      .filter(x => !x.classList.contains('sidebar') && !x.classList.contains('side'));
    const icerik = adaylar.sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      return rb.width * rb.height - ra.width * ra.height;
    })[0] || odak.querySelector('.content, .app-body, .os-scroll-body');
    return { pencere: odak, icerik };
  };

  const kutu = el => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; };

  const olc = () => {
    const h = hedefBul();
    if (!h || !h.icerik) return { yok: true, vp: [innerWidth, innerHeight] };

    const zincir = [];
    let e = h.icerik;
    while (e && e !== document.documentElement.parentNode) {
      const c = getComputedStyle(e);
      const [w, y] = kutu(e);
      const bayrak = [];
      if (+c.opacity < 1) bayrak.push('OPAKLIK=' + c.opacity);
      if (c.visibility !== 'visible') bayrak.push('GÖRÜNÜRLÜK=' + c.visibility);
      if (c.display === 'none') bayrak.push('DISPLAY=none');
      if (w < 2 || y < 2) bayrak.push('KUTU~0');
      if (c.clipPath !== 'none') bayrak.push('clip-path');
      if (c.backdropFilter !== 'none') bayrak.push('backdrop');
      if (c.filter !== 'none') bayrak.push('filter');
      if (c.contentVisibility && c.contentVisibility !== 'visible') bayrak.push('cv=' + c.contentVisibility);
      if (c.animationName !== 'none') bayrak.push('anim=' + c.animationName + '/' + c.animationFillMode);
      zincir.push({
        ad: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') +
            (e.classList.length ? '.' + [...e.classList].slice(0, 3).join('.') : ''),
        kutu: w + 'x' + y, konum: c.position, bayrak,
      });
      e = e.parentElement;
    }

    /* Çalışan/bekleyen animasyonlar: dolgu kipi yüzünden opaklıkta
       takılı kalan bir öğeyi ancak burada görürüz. */
    let anim = [];
    try {
      anim = document.getAnimations()
        .filter(a => a.playState !== 'finished')
        .slice(0, 8)
        .map(a => (a.animationName || a.constructor.name) + ':' + a.playState);
    } catch {}

    return {
      vp: [innerWidth, innerHeight],
      tamEkran: document.fullscreenElement ? document.fullscreenElement.tagName : 'hayır',
      f11: innerHeight >= screen.height - 2 ? 'evet(muhtemel)' : 'hayır',
      icerikKutu: kutu(h.icerik).join('x'),
      kaydirmaBoyu: h.icerik.scrollHeight,
      cocuk: h.icerik.childElementCount,
      metin: (h.icerik.innerText || '').trim().length,
      zincir, anim,
    };
  };

  const ciz = () => {
    const o = olc();
    const imza = JSON.stringify(o);
    if (imza !== sonImza) { sonImza = imza; kayit.push({ t: Date.now(), o }); }

    if (o.yok) { govde.textContent = 'Açık pencere yok — bir uygulama aç.'; return; }
    const sorunlu = o.zincir.filter(z => z.bayrak.length);
    const tani = o.cocuk > 0 && o.metin > 0 && parseInt(o.icerikKutu) > 50 && !sorunlu.length
      ? '▸ TANI: ölçüler ve içerik SAĞLAM. Ekran boşsa bu bir BOYAMA/BİRLEŞTİRME hatası.'
      : sorunlu.length
        ? '▸ TANI: zincirde sorunlu öğe var (aşağıda büyük harfle).'
        : '▸ TANI: içerik boş ya da kutu sıfır — YERLEŞİM hatası.';

    govde.textContent =
      `viewport ${o.vp.join('x')} · tamekran:${o.tamEkran} · F11:${o.f11}\n` +
      `içerik ${o.icerikKutu} · scrollH ${o.kaydirmaBoyu} · ${o.cocuk} çocuk · ${o.metin} karakter\n` +
      (o.anim.length ? `animasyon: ${o.anim.join(', ')}\n` : '') +
      `\n${tani}\n\n` +
      o.zincir.map(z => `${z.kutu.padEnd(11)} ${z.konum.padEnd(9)} ${z.ad}` +
                        (z.bayrak.length ? '\n            ⚠ ' + z.bayrak.join(' ') : '')).join('\n');
    durum.textContent = `${kayit.length} değişim`;
  };

  const saat = setInterval(ciz, 150);
  ciz();

  btnKapat.onclick = () => { clearInterval(saat); document.removeEventListener('fullscreenchange', tak); panel.remove(); };
  btnKopya.onclick = async () => {
    const metin = kayit.map(k => new Date(k.t).toLocaleTimeString('tr-TR') + '\n' +
      JSON.stringify(k.o, null, 1)).join('\n\n———\n\n');
    try { await navigator.clipboard.writeText(metin); btnKopya.textContent = 'KOPYALANDI'; }
    catch { console.log(metin); btnKopya.textContent = 'KONSOLA YAZDIM'; }
    setTimeout(() => (btnKopya.textContent = 'KOPYALA'), 1500);
  };

  console.log('[tanı] panel açıldı — Ayarlar’ı aç, sonra F11.');
})();
