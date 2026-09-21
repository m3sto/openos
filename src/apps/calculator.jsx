/* ==========================================================================
   OpenOS · apps/calculator.jsx — React ile yazılmış ilk sistem uygulaması

   Sistemin React'e geçişinin ilk adımı. Uygulama sözleşmesi değişmedi:
   `mount(ctx)` yine bir DOM düğümü döndürüyor, pencere yöneticisi
   uygulamanın React olduğunu bilmiyor. Değişen tek şey arayüzün nasıl
   tarif edildiği — elle DOM kurup elle güncellemek yerine durumdan türetiyor.

   Hesap mantığı bilerek bir `reducer`'da toplandı: eski sürümde durum yedi
   ayrı alan (`cur`, `prev`, `op`, `fresh`, `tape`…) olarak sınıfa dağılmıştı
   ve her tuş bunların bir kısmını değiştirip sonra elle `show()` çağırıyordu.
   Bir alanı güncelleyip ekranı güncellemeyi unutmak mümkündü. Reducer'da
   durum tek bir nesne: geçiş saf bir işlev, çizim onun sonucu.
   ========================================================================== */

import { useReducer, useEffect, useCallback } from 'react';
import { reactApp, useOs, useContextMenu } from '../react/host.jsx';

const TUSLAR = [
  ['AC', 'fn'], ['±', 'fn'], ['%', 'fn'], ['÷', 'op'],
  ['7', ''], ['8', ''], ['9', ''], ['×', 'op'],
  ['4', ''], ['5', ''], ['6', ''], ['−', 'op'],
  ['1', ''], ['2', ''], ['3', ''], ['+', 'op'],
  ['0', 'wide'], [',', ''], ['=', 'op eq'],
];

const BASLANGIC = { cur: '0', prev: null, op: null, fresh: true, serit: '' };

const bicimle = n => (+n.toFixed(10)).toLocaleString('tr-TR', { maximumFractionDigits: 10 });
const sayi = s => parseFloat(String(s).replace(',', '.')) || 0;

/** Bir işlemi uygular; sonucu ve yeni şeridi döndürür. */
function esittir(d, zincir) {
  if (d.op === null || d.prev === null) return d;
  const a = d.prev, b = sayi(d.cur);
  const r = d.op === '+' ? a + b
          : d.op === '−' ? a - b
          : d.op === '×' ? a * b
          : b === 0 ? NaN : a / b;
  const gecerli = Number.isFinite(r);
  return {
    ...d,
    serit: `${bicimle(a)} ${d.op} ${bicimle(b)} =`,
    cur: gecerli ? String(r).replace('.', ',') : 'Hata',
    prev: gecerli ? r : null,
    fresh: true,
    op: zincir ? d.op : null,
  };
}

function azalt(d, tus) {
  if (/[0-9]/.test(tus)) {
    return { ...d, cur: d.fresh ? tus : (d.cur === '0' ? tus : d.cur + tus), fresh: false };
  }
  switch (tus) {
    case ',':
      if (d.fresh) return { ...d, cur: '0,', fresh: false };
      return d.cur.includes(',') ? d : { ...d, cur: d.cur + ',' };
    case 'AC':  return { ...BASLANGIC };
    case '⌫':   return { ...d, cur: d.cur.length > 1 ? d.cur.slice(0, -1) : '0' };
    case '±':   return { ...d, cur: d.cur.startsWith('-') ? d.cur.slice(1) : '-' + d.cur };
    case '%':   return { ...d, cur: String(sayi(d.cur) / 100).replace('.', ',') };
    case '=':   return esittir(d, false);
    case '+': case '−': case '×': case '÷': {
      /* Zincirleme: `2 + 3 + ` yazınca ikinci `+` önce ilkini bitirir. */
      const temel = (d.op && !d.fresh) ? esittir(d, true) : d;
      const p = sayi(temel.cur);
      return { ...temel, prev: p, op: tus, fresh: true, serit: `${bicimle(p)} ${tus}` };
    }
    default:    return d;
  }
}

/** Ekranda görünen metin — durumdan türetiliyor, ayrıca saklanmıyor. */
function ekranMetni(d) {
  if (d.fresh && d.op !== null && d.prev !== null) return bicimle(d.prev);
  return d.cur.replace('.', ',');
}

const KLAVYE = {
  '/': '÷', '*': '×', '-': '−', Enter: '=', '=': '=',
  Escape: 'AC', Backspace: '⌫', '.': ',', ',': ',',
};

function HesapMakinesi() {
  const { win } = useOs();
  const [durum, bas] = useReducer(azalt, BASLANGIC);
  const metin = ekranMetni(durum);

  /* Klavye yalnızca pencere odaktayken dinlenir: arka plandaki bir hesap
     makinesinin öndeki uygulamanın tuşlarını yutmaması gerekiyor. */
  useEffect(() => {
    const f = (e) => {
      if (!win.el.classList.contains('focused')) return;
      const t = KLAVYE[e.key] || (/^[0-9+%]$/.test(e.key) ? e.key : null);
      if (!t) return;
      e.preventDefault();
      bas(t);
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [win]);

  const kopyala = useCallback(() => {
    navigator.clipboard?.writeText(metin);
  }, [metin]);

  const yapistir = useCallback(async () => {
    try {
      const t = (await navigator.clipboard.readText()).replace(/[^0-9.,-]/g, '');
      if (t) [...t.replace('.', ',')].forEach(c => bas(c));
    } catch { /* pano izni yok */ }
  }, []);

  const menuRef = useContextMenu(() => [
    { header: 'Hesap Makinesi' },
    { label: 'Sonucu kopyala', glyph: 'copy', run: kopyala },
    { label: 'Panodan yapıştır', glyph: 'download', run: yapistir },
    '-',
    { label: 'Temizle', glyph: 'trash', run: () => bas('AC') },
    { label: 'Son basamağı sil', glyph: 'arrowL', run: () => bas('⌫') },
  ]);

  return (
    <div className="calc" ref={menuRef}>
      <div className="calc-tape">{durum.serit}</div>
      <div className="calc-display" style={{ fontSize: metin.length > 9 ? '30px' : '44px' }}>
        {metin}
      </div>
      <div className="calc-pad">
        {TUSLAR.map(([etiket, sinif]) => (
          <button
            key={etiket}
            className={'calc-key' + (sinif ? ' ' + sinif : '')}
            onClick={() => bas(etiket)}
          >
            {etiket}
          </button>
        ))}
      </div>
    </div>
  );
}

export default {
  id: 'calculator', name: 'Hesap Makinesi', glyph: 'calc', tint: ['#ff9f0a', '#c96f00'],
  category: 'util', width: 286, height: 404, minWidth: 240, minHeight: 340, resizable: false,
  keywords: ['hesap', 'matematik', 'calc'],
  about: 'Klavye ile de kullanılabilen hesap makinesi. React ile yazıldı.',
  mount: reactApp(HesapMakinesi, { sinif: 'app-shell' }),
};
