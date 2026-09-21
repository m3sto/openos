/* OpenOS · tanılama — Chrome konsoluna yapıştırın, çıktıyı paylaşın.
   İçerik bölmesinin neden boş göründüğünü tek seferde raporlar. */
(async () => {
  const k = window.__openos?.kernel;
  if (!k) return console.log('OpenOS yüklü değil');
  k.openApp('settings');
  await new Promise(r => setTimeout(r, 1500));
  const win = k.wm.list().find(w => w.app.id === 'settings');
  const ic = win?.el.querySelector('.content');
  const kutu = e => { const b = e.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}`; };

  const zincir = [];
  let n = ic;
  while (n && zincir.length < 6) {
    const cs = getComputedStyle(n);
    zincir.push({
      el: n.tagName.toLowerCase() + '.' + (n.className || '').split(' ').slice(0, 2).join('.'),
      kutu: kutu(n),
      display: cs.display, flex: cs.flex, alignSelf: cs.alignSelf,
      alignItems: cs.alignItems, minHeight: cs.minHeight, height: cs.height,
      overflow: cs.overflow, opacity: cs.opacity, visibility: cs.visibility,
    });
    n = n.parentElement;
  }

  console.log(JSON.stringify({
    gorunum: innerWidth + 'x' + innerHeight,
    icerikCocuk: ic?.childElementCount,
    icerikMetin: (ic?.textContent || '').trim().length,
    ustusteKatman: [...document.querySelectorAll('.k-scrim,.ql-scrim,.sc-scrim,.fd-scrim')]
      .map(e => e.className + ' ' + kutu(e)),
    acikPencere: k.wm.list().map(w => w.app.id),
    zincir,
  }, null, 2));
})();
