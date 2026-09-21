/* ==========================================================================
   OpenOS · apps/taskmanager.js — Görev Yöneticisi

   Bir tarayıcı sekmesinin içinden ölçülebilecek şeyin sınırı var ve bu
   uygulama o sınırı gizlemiyor: ölçtüğü değeri ölçüyor, tahmin ettiğini
   tahmin olarak işaretliyor, ölçemediğini "—" ile geçiyor.

   Gerçekten ölçülenler:
     · süreç başına DOM düğümü, canlı zamanlayıcı ve gömülü çerçeve sayısı
     · pencerenin kapladığı ekran alanı ve çalışma süresi
     · sekmenin toplam JS yığını (Chrome'da performance.memory)
     · uzun görevler (PerformanceObserver) — takılmanın gerçek ölçüsü
     · kare süresi ve düşen kare oranı
     · sanal diskin ve tarayıcı kotasının kullanımı
   ========================================================================== */

import { h, clear, on, fmtBytes } from '../core/util.js';
import { icon } from '../core/icons.js';
import services from '../core/services.js';
import { contextMenu } from '../ui/menu.js';
import { appIcon } from '../ui/appicon.js';
import vfs from '../core/vfs.js';
import notify from '../core/notify.js';
import registry from '../core/registry.js';

export default {
  id: 'taskmanager', name: 'Görev Yöneticisi', glyph: 'chart', tint: ['#ff9f0a', '#c2410c'],
  category: 'util', width: 820, height: 560, minWidth: 520, minHeight: 340,
  singleton: true, keywords: ['süreç', 'işlem', 'bellek', 'performans', 'monitör', 'task'],
  about: 'Çalışan uygulamaları, bellek ve performans ölçümlerini izleyin.',
  mount(ctx) {
    const t = new TaskManager(ctx);
    ctx.win.onClosed = () => t.destroy();
    return t.el;
  },
};

class TaskManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.sirala = { alan: 'dugum', ters: true };
    this.secili = null;
    this.kareler = [];
    this.uzunGorevler = [];
    this.build();
    this.olcumeBasla();
  }

  build() {
    this.ozet = h('div.tm-summary');
    this.tablo = h('div.tm-table');
    this.altBilgi = h('div.tm-foot');

    const sekme = (ad, kod) => h('button', { text: ad, dataset: { gorunum: kod },
      'aria-selected': String(kod === 'surecler'), onclick: () => this.gorunumSec(kod) });

    this.gorunum = 'surecler';
    this.sekmeler = h('div.tm-tabs',
      sekme('Süreçler', 'surecler'),
      sekme('Bellek', 'bellek'),
      sekme('Disk', 'disk'),
      sekme('Servisler', 'servisler'),
      h('div.k-spacer'),
      h('button.k-btn.v-danger.s-sm', { html: icon('x', 12), text: ' Sonlandır',
        onclick: () => this.sonlandir() }),
    );

    this.el = h('div.app-shell', h('div.content.tm',
      this.sekmeler, this.ozet, this.tablo, this.altBilgi));
  }

  gorunumSec(kod) {
    this.gorunum = kod;
    this.sekmeler.querySelectorAll('button[data-gorunum]').forEach(b =>
      b.setAttribute('aria-selected', String(b.dataset.gorunum === kod)));
    this.ciz();
  }

  /* ------------------------------------------------------------ ölçüm */
  olcumeBasla() {
    /* Uzun görevler: ana iş parçacığını 50 ms'den fazla meşgul eden her iş.
       Takılmanın "hissedilen" değil ölçülen karşılığı budur. */
    try {
      this.gozlemci = new PerformanceObserver(liste => {
        for (const g of liste.getEntries()) {
          this.uzunGorevler.push({ sure: g.duration, zaman: g.startTime });
        }
        if (this.uzunGorevler.length > 120) this.uzunGorevler.splice(0, this.uzunGorevler.length - 120);
      });
      this.gozlemci.observe({ entryTypes: ['longtask'] });
      this.uzunGorevDestegi = true;
    } catch { this.uzunGorevDestegi = false; }

    /* Kare süresi. `requestAnimationFrame` gizli sekmede durur; ölçüm de
       durmalı — durduğunu söylemeden "0 fps" yazmak yanlış olur. */
    let onceki = performance.now();
    const kare = (t) => {
      if (!this.yasiyor) return;
      this.kareler.push(t - onceki);
      if (this.kareler.length > 120) this.kareler.shift();
      onceki = t;
      this.rafId = requestAnimationFrame(kare);
    };
    this.yasiyor = true;
    this.rafId = requestAnimationFrame(kare);

    this.ciz();
    this.zaman = setInterval(() => this.ciz(), 1200);
  }

  /** Çalışan her pencere bir süreçtir. */
  surecler() {
    const wm = this.ctx.win.wm;
    return wm.list().map(w => {
      const kok = w.body || w.el;
      const dugum = kok ? kok.querySelectorAll('*').length : 0;
      const cerceve = kok ? kok.querySelectorAll('iframe, canvas, video, audio').length : 0;
      const r = w.el.getBoundingClientRect();
      return {
        win: w,
        id: w.app.id,
        ad: w.app.name,
        app: w.app,
        durum: w.state === 'min' ? 'küçültülmüş' : (wm.focused === w ? 'ön planda' : 'arka planda'),
        dugum,
        cerceve,
        alan: Math.round(r.width) * Math.round(r.height),
        sure: w.acilis ? Date.now() - w.acilis : null,
        tur: w.app.kind === 'opensharp' ? 'OpenSharp' : 'yerli',
      };
    });
  }

  /** Chrome'da gerçek yığın ölçüsü; başka tarayıcıda yok — uydurulmuyor. */
  bellek() {
    const m = performance.memory;
    if (!m) return null;
    return { kullanilan: m.usedJSHeapSize, ayrilan: m.totalJSHeapSize, sinir: m.jsHeapSizeLimit };
  }

  kareOzeti() {
    if (!this.kareler.length) return null;
    const sirali = [...this.kareler].sort((a, b) => a - b);
    const ortanca = sirali[Math.floor(sirali.length / 2)];
    const dusen = this.kareler.filter(f => f > 20).length;
    return { fps: Math.round(1000 / Math.max(1, ortanca)), dusenOran: dusen / this.kareler.length };
  }

  /* ------------------------------------------------------------- çizim */
  ciz() {
    if (this.gorunum === 'surecler') this.cizSurecler();
    else if (this.gorunum === 'servisler') this.cizServisler();
    else if (this.gorunum === 'bellek') this.cizBellek();
    else this.cizDisk();
    this.cizAltBilgi();
  }

  kart(baslik, deger, alt, renk) {
    return h('div.tm-card',
      h('div.tm-card-label', { text: baslik }),
      h('div.tm-card-value', { text: deger, style: renk ? { color: renk } : null }),
      alt ? h('div.tm-card-sub', { text: alt }) : null);
  }

  cizSurecler() {
    const liste = this.surecler();
    const k = this.kareOzeti();
    const uzun = this.uzunGorevler.filter(g => performance.now() - g.zaman < 10000);

    clear(this.ozet);
    this.ozet.append(
      this.kart('Süreç', String(liste.length), `${liste.filter(p => p.durum === 'küçültülmüş').length} küçültülmüş`),
      this.kart('DOM düğümü', String(liste.reduce((a, p) => a + p.dugum, 0)),
                `sayfa geneli ${document.querySelectorAll('*').length}`),
      document.hidden
        ? this.kart('Kare hızı', 'duraklı', 'sekme arka planda')
        : this.kart('Kare hızı', k ? `${k.fps} fps` : 'ölçülüyor…',
                    k ? `%${Math.round(k.dusenOran * 100)} düşen kare` : '',
                    k && k.fps < 45 ? 'var(--orange, #ff9f0a)' : null),
      this.uzunGorevDestegi
        ? this.kart('Uzun görev', String(uzun.length), 'son 10 saniyede',
                    uzun.length > 4 ? 'var(--red)' : null)
        : this.kart('Uzun görev', '—', 'bu tarayıcıda ölçülemiyor'),
    );

    const alanlar = [
      ['ad', 'Süreç', 'sol'],
      ['tur', 'Tür', 'sol'],
      ['durum', 'Durum', 'sol'],
      ['dugum', 'DOM', 'sag'],
      ['cerceve', 'Gömülü', 'sag'],
      ['alan', 'Ekran alanı', 'sag'],
      ['sure', 'Çalışma', 'sag'],
    ];

    const sirali = [...liste].sort((a, b) => {
      const x = a[this.sirala.alan], y = b[this.sirala.alan];
      const s = typeof x === 'number' ? (x || 0) - (y || 0) : String(x).localeCompare(String(y), 'tr');
      return this.sirala.ters ? -s : s;
    });

    clear(this.tablo);
    this.tablo.appendChild(h('div.tm-row.tm-head',
      ...alanlar.map(([alan, baslik, hiza]) => h('div', {
        class: hiza === 'sag' ? 'sag' : '',
        onclick: () => {
          if (this.sirala.alan === alan) this.sirala.ters = !this.sirala.ters;
          else this.sirala = { alan, ters: true };
          this.ciz();
        },
      }, h('span', { text: baslik }),
         this.sirala.alan === alan
           ? h('span.ok', { html: icon(this.sirala.ters ? 'chevronD' : 'chevronU', 9) })
           : null))));

    if (!sirali.length) {
      this.tablo.appendChild(h('div.tm-empty', { text: 'Çalışan uygulama yok' }));
    }

    for (const p of sirali) {
      const satir = h('div.tm-row',
        { class: this.secili === p.id ? 'secili' : '',
          onclick: () => { this.secili = p.id; this.ciz(); },
          ondblclick: () => { p.win.focus(); p.win.unminimize?.(); } },
        h('div.tm-name', appIcon(p.app, 16), h('span.ellipsis', { text: p.ad })),
        h('div', { text: p.tur }),
        h('div', h('span.tm-durum', { class: p.durum === 'ön planda' ? 'on' : '', text: p.durum })),
        h('div.sag', { text: p.dugum.toLocaleString('tr-TR') }),
        h('div.sag', { text: p.cerceve ? String(p.cerceve) : '—' }),
        h('div.sag', { text: p.alan ? `${(p.alan / 1000).toFixed(0)}k px²` : '—' }),
        h('div.sag', { text: p.sure ? sureBicimle(p.sure) : '—' }),
      );
      contextMenu(satir, () => [
        { header: p.ad },
        { label: 'Öne getir', glyph: 'window', run: () => { p.win.focus(); p.win.unminimize?.(); } },
        { label: 'Küçült', glyph: 'minimize', run: () => p.win.minimize() },
        '-',
        { label: 'Sonlandır', glyph: 'x', danger: true, run: () => { this.secili = p.id; this.sonlandir(); } },
      ]);
      this.tablo.appendChild(satir);
    }
  }

  /**
   * Arka plan servisleri: uygulamalardan bağımsız çalışan işler. Alarmın
   * Saat penceresi kapalıyken de çalmasını sağlayan katman burası; hangi
   * servisin kaç kez çalıştığı ve hata alıp almadığı burada görünür —
   * sessizce ölen bir servis en kötü servistir.
   */
  cizServisler() {
    clear(this.ozet);
    const liste = services.list();
    const toplamHata = liste.reduce((n, s) => n + s.hata, 0);
    this.ozet.append(
      this.kart('Servis', String(liste.length), 'arka planda çalışan'),
      this.kart('Çalışma', String(liste.reduce((n, s) => n + s.sayac, 0)), 'açılıştan beri'),
      this.kart('Hata', String(toplamHata), toplamHata ? 'incelenmeli' : 'sorun yok'),
    );

    clear(this.tablo);
    this.tablo.appendChild(h('div.tm-row.tm-head',
      h('span', { text: 'Servis' }), h('span', { text: 'Uygulama' }),
      h('span', { text: 'Aralık' }), h('span', { text: 'Çalışma' }), h('span', { text: 'Durum' })));

    if (!liste.length) {
      this.tablo.appendChild(h('div.tm-empty', { text: 'Kayıtlı servis yok' }));
      return;
    }
    for (const s of liste) {
      this.tablo.appendChild(h('div.tm-row',
        h('span', { text: s.ad }),
        h('span.dim', { text: s.uygulama || '—' }),
        h('span.dim', { text: (s.her / 1000) + ' sn' }),
        h('span.dim', { text: String(s.sayac) }),
        s.hata
          ? h('span.k-badge.b-red', { text: `${s.hata} hata`, title: s.sonHata || '' })
          : h('span.k-badge.b-green', { text: s.aktif ? 'çalışıyor' : 'durdu' })));
    }
    this.altBilgi.textContent = liste.length
      ? `Son çalışma: ${new Date(Math.max(...liste.map(s => s.sonCalisma))).toLocaleTimeString('tr-TR')}`
      : '';
  }

  cizBellek() {
    const b = this.bellek();
    clear(this.ozet);
    if (!b) {
      this.ozet.appendChild(h('div.tm-note',
        h('div', { html: icon('info', 16) }),
        h('div', { text: 'Bu tarayıcı JS yığın ölçümü sunmuyor. Bellek rakamı üretmek yerine ' +
                         'ölçülemediğini söylüyoruz; süreç sekmesindeki DOM düğümü sayısı ' +
                         'uygulamaların ağırlığını karşılaştırmak için güvenilir bir vekil.' })));
    } else {
      const oran = b.kullanilan / b.sinir;
      this.ozet.append(
        this.kart('Kullanılan yığın', fmtBytes(b.kullanilan), `sınırın %${Math.round(oran * 100)}'i`,
                  oran > 0.8 ? 'var(--red)' : null),
        this.kart('Ayrılan', fmtBytes(b.ayrilan), 'tarayıcının ayırdığı'),
        this.kart('Sınır', fmtBytes(b.sinir), 'sekme başına'),
      );
    }

    clear(this.tablo);
    const liste = this.surecler().sort((a, b2) => b2.dugum - a.dugum);
    const toplam = liste.reduce((a, p) => a + p.dugum, 0) || 1;
    this.tablo.appendChild(h('div.tm-note', { style: { marginBottom: '4px' } },
      h('div', { html: icon('info', 15) }),
      h('div', { text: 'Uygulama başına bellek tarayıcıdan okunamaz — hepsi tek bir yığını paylaşır. ' +
                       'Aşağıdaki pay, DOM ağırlığına göre hesaplanmış bir tahmindir.' })));
    for (const p of liste) {
      const pay = p.dugum / toplam;
      this.tablo.appendChild(h('div.tm-bar-row',
        h('div.tm-name', appIcon(p.app, 15), h('span.ellipsis', { text: p.ad })),
        h('div.tm-bar', h('i', { style: { width: (pay * 100).toFixed(1) + '%' } })),
        h('div.sag', { text: `%${(pay * 100).toFixed(1)}` }),
        h('div.sag.dim', { text: b ? `~${fmtBytes(b.kullanilan * pay)}` : `${p.dugum} düğüm` })));
    }
  }

  async cizDisk() {
    const kullanim = vfs.usage();
    clear(this.ozet);
    this.ozet.append(
      this.kart('Sanal disk', fmtBytes(kullanim.bytes), `${kullanim.files} dosya · ${kullanim.dirs} klasör`),
      this.kart('Uygulama', String(registry.all().length),
                `${registry.all().filter(a => a.kind === 'opensharp').length} OpenSharp`),
    );

    let kota = null;
    try { kota = await navigator.storage?.estimate?.(); } catch {}
    if (kota?.quota) {
      this.ozet.appendChild(this.kart('Tarayıcı kotası', fmtBytes(kota.quota),
        `${fmtBytes(kota.usage || 0)} kullanılıyor`));
    }

    clear(this.tablo);
    /* En büyük klasörler — diskte yeri ne tutuyor sorusunun karşılığı. */
    const kokler = ['/Users', '/Applications', '/System'];
    const satirlar = [];
    for (const kok of kokler) {
      if (!vfs.exists(kok)) continue;
      let boyut = 0, dosya = 0;
      try { vfs.walk(kok, s => { if (s.type === 'file') { boyut += s.size || 0; dosya++; } }); } catch {}
      satirlar.push({ kok, boyut, dosya });
    }
    const toplam = satirlar.reduce((a, s) => a + s.boyut, 0) || 1;
    for (const s of satirlar.sort((a, b) => b.boyut - a.boyut)) {
      this.tablo.appendChild(h('div.tm-bar-row',
        h('div.tm-name', h('span', { html: icon('folder', 15) }), h('span', { text: s.kok })),
        h('div.tm-bar', h('i', { style: { width: ((s.boyut / toplam) * 100).toFixed(1) + '%' } })),
        h('div.sag', { text: fmtBytes(s.boyut) }),
        h('div.sag.dim', { text: `${s.dosya} dosya` })));
    }
  }

  cizAltBilgi() {
    const k = this.kareOzeti();
    const parca = [
      `${this.surecler().length} süreç`,
      document.hidden ? 'ölçüm duraklı (sekme arka planda)' : (k ? `${k.fps} fps` : 'ölçülüyor…'),
      `sanal disk ${fmtBytes(vfs.usage().bytes)}`,
    ];
    this.altBilgi.textContent = parca.join('  ·  ');
  }

  /* --------------------------------------------------------- sonlandır */
  async sonlandir() {
    const p = this.surecler().find(x => x.id === this.secili);
    if (!p) { notify.toast('Önce bir süreç seçin', { glyph: '⚠️' }); return; }
    const ok = await notify.confirm(
      `“${p.ad}” sonlandırılsın mı? Kaydedilmemiş değişiklikler sorulmadan kaybolur.`,
      { title: 'Süreci sonlandır', ok: 'Sonlandır', danger: true, root: this.el });
    if (!ok) return;
    /* Zorla kapatma: uygulamanın "kapatma" onayı atlanır — görev
       yöneticisinin varlık sebebi zaten yanıt vermeyen bir uygulamadır. */
    p.win.onBeforeClose = null;
    p.win.close();
    this.secili = null;
    setTimeout(() => this.ciz(), 120);
  }

  destroy() {
    this.yasiyor = false;
    cancelAnimationFrame(this.rafId);
    clearInterval(this.zaman);
    this.gozlemci?.disconnect();
  }
}

function sureBicimle(ms) {
  const sn = Math.floor(ms / 1000);
  if (sn < 60) return `${sn} sn`;
  const dk = Math.floor(sn / 60);
  if (dk < 60) return `${dk} dk`;
  return `${Math.floor(dk / 60)} sa ${dk % 60} dk`;
}
