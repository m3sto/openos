/* ==========================================================================
   OpenOS · apps/graphics.js — Grafik İşletici
   Sistemi ölçer ve gerçekten müdahale eder: kare hızını, kare süresini, uzun
   görevleri ve belleği canlı izler; bulanıklık, gölge, hareket ve duvar kâğıdı
   kare hızını kısarak kazanç sağlar; gerektiğinde tarayıcıdan kalıcı depolama
   (daha büyük, atılamaz kota) ister. Otomatik kip, kare hızı düşerse kaliteyi
   kendiliğinden kademe kademe indirir ve toparlayınca geri verir.
   ========================================================================== */

import { h, clear, add, on, fmtBytes, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import settings from '../core/settings.js';
import notify from '../core/notify.js';

export default {
  id: 'graphics', name: 'Grafik İşletici', glyph: 'bolt', tint: ['#30d158', '#0a7b96'],
  category: 'util', width: 900, height: 640, minWidth: 560, minHeight: 420,
  keywords: ['grafik', 'performans', 'fps', 'gpu', 'bellek', 'optimizasyon'],
  about: 'Kare hızını ölçer, kaliteyi yönetir ve tarayıcıdan ek kaynak ister.',
  mount(ctx) { return new Graphics(ctx).el; },
};

const PRESETS = {
  battery:     { label: 'Güç Tasarrufu', glyph: 'battery', blur: 'off',  shadows: 'off',  animations: 'off',  wallpaperFps: 0,  transparency: false },
  balanced:    { label: 'Dengeli',       glyph: 'bolt',    blur: 'low',  shadows: 'flat', animations: 'fast', wallpaperFps: 15, transparency: true },
  performance: { label: 'Performans',    glyph: 'chart',   blur: 'low',  shadows: 'flat', animations: 'full', wallpaperFps: 24, transparency: true },
  quality:     { label: 'Kalite',        glyph: 'sparkles',blur: 'full', shadows: 'full', animations: 'full', wallpaperFps: 30, transparency: true },
};

const PANES = [
  ['monitor', 'İzleme', 'chart', '#30d158'],
  ['quality', 'Kalite', 'sparkles', '#bf5af2'],
  ['memory', 'Bellek ve Depolama', 'database', '#0a84ff'],
  ['hardware', 'Donanım', 'cpu', '#8e8e93'],
];

class Graphics {
  constructor(ctx) {
    this.ctx = ctx;
    this.pane = ctx.args?.pane || 'monitor';
    this.fps = [];            /* son 120 kare hızı örneği */
    this.frames = [];         /* son kare süreleri (ms) */
    this.longTasks = 0;
    this.dropped = 0;
    this.tuneState = 'idle';
    this.lowSince = 0;

    this.sidebar = h('div.sidebar', { style: { width: '196px' } });
    this.body = h('div.content.k-scroll', { style: { padding: '18px 22px', gap: '14px' } });
    this.el = h('div.app-shell', this.sidebar, this.body);
    contextMenu(this.el, () => [
      { header: 'Grafik İşletici' },
      ...Object.entries(PRESETS).map(([k, p]) => ({
        label: p.label, glyph: p.glyph, checked: settings.get('graphics.preset') === k,
        run: () => this.applyPreset(k),
      })),
      '-',
      { label: 'Sayaçları sıfırla', glyph: 'refresh',
        run: () => { this.dropped = 0; this.longTasks = 0; this.fps = []; this.frames = []; } },
      { label: 'Kalıcı depolama iste', glyph: 'database', run: () => this.select('memory') },
    ]);

    this.renderSidebar();
    this.startSampling();
    this.render();

    ctx.win.onClosed = () => this.destroy();
    this.off = settings.bus.on('graphics', () => { if (this.pane === 'quality') this.render(); });
  }

  /* ================== ölçüm ================== */
  startSampling() {
    let last = performance.now();
    let acc = 0, count = 0;
    const tick = (now) => {
      this.raf = requestAnimationFrame(tick);
      const dt = now - last;
      last = now;
      if (dt <= 0 || dt > 2000) return;
      this.frames.push(dt);
      if (this.frames.length > 240) this.frames.shift();
      /* 16.7ms'in iki katını aşan kare, atlanmış sayılır */
      if (dt > 34) this.dropped++;
      acc += dt; count++;
      if (acc >= 500) {                     /* yarım saniyede bir örnek */
        const f = 1000 / (acc / count);
        this.fps.push(f);
        if (this.fps.length > 120) this.fps.shift();
        acc = 0; count = 0;
        this.autoTune(f);
        if (this.pane === 'monitor') this.paintMonitor();
      }
    };
    this.raf = requestAnimationFrame(tick);

    /* Uzun görevler ana iş parçacığını kilitleyen asıl suçludur. */
    try {
      this.obs = new PerformanceObserver(list => { this.longTasks += list.getEntries().length; });
      this.obs.observe({ entryTypes: ['longtask'] });
    } catch { this.obs = null; }
  }

  stat() {
    const f = [...this.frames].sort((a, b) => a - b);
    const q = p => f.length ? f[Math.min(f.length - 1, Math.floor(f.length * p))] : 0;
    const cur = this.fps.length ? this.fps[this.fps.length - 1] : 0;
    const avg = this.fps.length ? this.fps.reduce((a, b) => a + b, 0) / this.fps.length : 0;
    return { cur, avg, p50: q(0.5), p95: q(0.95), worst: f.length ? f[f.length - 1] : 0 };
  }

  /** Kare hızı 5 saniye boyunca düşük kalırsa kaliteyi bir kademe indirir. */
  autoTune(fps) {
    if (!settings.get('graphics.autoTune')) { this.tuneState = 'idle'; return; }
    const now = performance.now();
    if (fps < 34) {
      if (!this.lowSince) this.lowSince = now;
      if (now - this.lowSince > 5000) {
        this.lowSince = 0;
        this.stepDown();
      }
    } else {
      this.lowSince = 0;
    }
  }

  stepDown() {
    const order = ['quality', 'performance', 'balanced', 'battery'];
    const cur = settings.get('graphics.preset');
    const i = order.indexOf(cur);
    if (i < 0 || i >= order.length - 1) return;
    const next = order[i + 1];
    this.applyPreset(next, { auto: true });
    this.tuneState = 'stepped';
    notify.post({
      title: 'Grafik İşletici',
      body: `Kare hızı düştüğü için kalite “${PRESETS[next].label}” kademesine indirildi.`,
      glyph: 'bolt', tint: ['#30d158', '#0a7b96'],
      actions: [{ label: 'Geri al', run: () => this.applyPreset(cur) }],
    });
  }

  applyPreset(key, { auto = false } = {}) {
    const p = PRESETS[key];
    if (!p) return;
    settings.patch({ graphics: {
      preset: key, blur: p.blur, shadows: p.shadows, animations: p.animations,
      wallpaperFps: p.wallpaperFps, transparency: p.transparency,
      autoTune: settings.get('graphics.autoTune'),
      persistedStorage: settings.get('graphics.persistedStorage'),
    } });
    this.dropped = 0; this.longTasks = 0;
    if (!auto) notify.toast(`Kalite: ${p.label}`, { glyph: '⚡️' });
    this.render();
  }

  /* ================== iskelet ================== */
  renderSidebar() {
    clear(this.sidebar);
    this.sidebar.appendChild(h('div.sb-title', { text: 'Grafik' }));
    for (const [id, label, glyph, color] of PANES) {
      this.sidebar.appendChild(h('div.sb-item', {
        dataset: { id }, class: id === this.pane ? 'on' : '', onclick: () => this.select(id),
      }, h('span.ic', { html: icon(glyph, 14), style: { color } }), h('span', { text: label })));
    }
    this.sidebar.appendChild(h('div.k-spacer'));
    this.liveChip = h('div.gfx-chip');
    this.sidebar.appendChild(this.liveChip);
  }

  select(id) {
    this.pane = id;
    this.sidebar.querySelectorAll('.sb-item').forEach(i => i.classList.toggle('on', i.dataset.id === id));
    this.render();
  }

  render() {
    clear(this.body);
    this['p_' + this.pane]?.call(this);
    this.body.scrollTop = 0;
  }

  card(title, ...kids) {
    return h('div.k-card', { style: { display: 'grid', gap: '10px' } },
      title ? h('div.k-text.t-headline', { text: title }) : null, ...kids);
  }
  metric(value, label, tone) {
    return h('div.gfx-metric', { class: tone || '' },
      h('div.v', { text: value }), h('div.l', { text: label }));
  }
  row(glyph, tint, title, sub, control) {
    return h('div.k-row',
      h('div.lead', { style: { background: tint }, html: icon(glyph, 15) }),
      h('div.k-vstack', { style: { flex: 1, minWidth: 0, gap: '1px' } },
        h('div.k-text', { text: title, style: { fontWeight: 520 } }),
        sub ? h('div.k-text.t-caption', { text: sub }) : null), control);
  }
  seg(options, value, onPick) {
    const n = h('div.k-seg');
    options.forEach(([v, label]) => {
      const b = h('button', { text: label, 'aria-selected': String(v === value) });
      on(b, 'click', () => {
        n.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', 'false'));
        b.setAttribute('aria-selected', 'true'); onPick(v);
      });
      n.appendChild(b);
    });
    return n;
  }
  toggle(path, after) {
    const t = h('div.k-toggle', { dataset: { on: settings.get(path) ? '1' : '0' } });
    on(t, 'click', () => { const v = !settings.get(path); settings.set(path, v); t.dataset.on = v ? '1' : '0'; after?.(v); });
    return t;
  }

  /* ================== izleme ================== */
  p_monitor() {
    this.canvas = h('canvas.gfx-chart');
    this.metrics = h('div.gfx-metrics');
    this.notes = h('div.k-text.t-caption', { style: { lineHeight: 1.7 } });

    this.body.append(
      h('div.k-hstack', { style: { gap: '12px' } },
        h('div.k-vstack', { style: { gap: '2px', flex: 1 } },
          h('div.k-text.t-title', { text: 'İzleme' }),
          h('div.k-text.t-callout', { text: 'Kare hızı yarım saniyede bir örneklenir; kare süreleri her karede.' })),
        h('button.k-btn.s-sm', { text: 'Sayaçları sıfırla',
          onclick: () => { this.dropped = 0; this.longTasks = 0; this.fps = []; this.frames = []; } })),
      this.metrics,
      this.card('Kare hızı — son 60 saniye', this.canvas),
      this.card('Yorum', this.notes),
    );
    /* mount() henüz pencereye eklenmemiş bir ağaç döndürür; ilk çizim
       bağlandıktan sonra yapılmalı. */
    requestAnimationFrame(() => this.paintMonitor());
    setTimeout(() => this.paintMonitor(), 0);
    clearInterval(this.repaint);
    this.repaint = setInterval(() => {
      if (this.pane === 'monitor') this.paintMonitor();
    }, 1000);
  }

  paintMonitor() {
    if (!this.canvas || !this.metrics) return;
    const s = this.stat();
    const hidden = document.hidden;
    const tone = f => f >= 55 ? 'good' : f >= 35 ? 'warn' : 'bad';

    const waiting = this.fps.length === 0;
    const fps = v => waiting ? '—' : Math.round(v) + ' FPS';
    clear(this.metrics);
    this.metrics.append(
      this.metric(fps(s.cur), 'anlık', waiting ? '' : tone(s.cur)),
      this.metric(fps(s.avg), 'ortalama', waiting ? '' : tone(s.avg)),
      this.metric(s.p50.toFixed(1) + ' ms', 'kare süresi (medyan)'),
      this.metric(s.p95.toFixed(1) + ' ms', 'kare süresi (p95)', s.p95 > 33 ? 'warn' : ''),
      this.metric(String(this.dropped), 'atlanan kare', this.dropped > 30 ? 'warn' : ''),
      this.metric(String(this.longTasks), 'uzun görev', this.longTasks > 20 ? 'warn' : ''),
    );

    if (this.liveChip) {
      this.liveChip.className = 'gfx-chip ' + tone(s.cur);
      this.liveChip.textContent = `${Math.round(s.cur)} FPS · ${PRESETS[settings.get('graphics.preset')]?.label || ''}`;
    }

    /* grafik */
    const c = this.canvas;
    if (!c.isConnected) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const W = c.clientWidth || 600, H = 130;
    if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0a84ff';
    g.strokeStyle = 'rgba(128,128,128,.18)'; g.lineWidth = 1;
    [30, 60].forEach(f => {
      const y = H - (f / 90) * H;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      g.fillStyle = 'rgba(128,128,128,.6)'; g.font = '9px system-ui';
      g.fillText(f + '', 3, y - 2);
    });

    const data = this.fps.slice(-120);
    if (data.length > 1) {
      const step = W / (data.length - 1);
      g.beginPath();
      data.forEach((f, i) => {
        const y = H - clamp(f / 90, 0, 1) * H;
        i ? g.lineTo(i * step, y) : g.moveTo(0, y);
      });
      g.strokeStyle = accent; g.lineWidth = 2; g.lineJoin = 'round'; g.stroke();
      g.lineTo(W, H); g.lineTo(0, H); g.closePath();
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, accent + '55'); grd.addColorStop(1, 'transparent');
      g.fillStyle = grd; g.fill();
    }

    /* yorum */
    const lines = [];
    if (hidden) lines.push('· Sekme arka planda: tarayıcı kare döngüsünü durdurduğu için ölçüm duraklatıldı.');
    else if (waiting) lines.push('· İlk örnek bekleniyor (yarım saniye)…');
    if (s.avg >= 55) lines.push('· Akıcı. Kalite kademesini yükseltebilirsiniz.');
    else if (s.avg >= 35) lines.push('· Kabul edilebilir ama sınırda. Bulanıklığı “düşük” yapmak en büyük kazancı verir.');
    else if (s.avg > 0) lines.push('· Düşük. Bulanıklık ve gölgeleri kapatın, duvar kâğıdını dondurun.');
    if (this.longTasks > 20) lines.push('· Çok sayıda uzun görev var: ana iş parçacığı JavaScript ile meşgul, bu grafikle ilgili değil.');
    if (this.dropped > 40) lines.push('· Atlanan kare sayısı yüksek; pencere sürüklerken takılma hissedilir.');
    if (settings.get('graphics.blur') === 'full') lines.push('· Bulanıklık tam açık — en pahalı ayar bu.');
    if (!lines.length) lines.push('· Ölçüm topluyor…');
    if (waiting && !hidden) lines.length = 1;
    this.notes.textContent = lines.join('\n');
    this.notes.style.whiteSpace = 'pre-line';
  }

  /* ================== kalite ================== */
  p_quality() {
    const cur = settings.get('graphics.preset');
    const grid = h('div.gfx-presets');
    Object.entries(PRESETS).forEach(([key, p]) => {
      grid.appendChild(h('div.gfx-preset', { 'aria-checked': String(key === cur), onclick: () => this.applyPreset(key) },
        h('div.g', { html: icon(p.glyph, 20) }),
        h('div.k-text', { text: p.label, style: { fontWeight: 600 } }),
        h('div.k-text.t-caption', { text: describe(p) })));
    });

    this.body.append(
      h('div.k-text.t-title', { text: 'Kalite' }),
      h('div.k-text.t-callout', { text: 'Önayar seçin ya da tek tek ayarlayın. Değişiklikler anında uygulanır.' }),
      grid,
      h('div.k-sectitle', { text: 'Ayrıntılar' }),
      h('div.k-group',
        this.row('eye', 'var(--blue)', 'Bulanıklık', 'Cam yüzeyler — en pahalı efekt',
          this.seg([['off', 'Kapalı'], ['low', 'Düşük'], ['full', 'Tam']],
            settings.get('graphics.blur'), v => this.setManual('blur', v))),
        this.row('layers', 'var(--purple)', 'Gölgeler', 'Pencere ve panel gölgeleri',
          this.seg([['off', 'Kapalı'], ['flat', 'Yalın'], ['full', 'Tam']],
            settings.get('graphics.shadows'), v => this.setManual('shadows', v))),
        this.row('bolt', 'var(--orange)', 'Hareket', 'Geçiş ve animasyon süreleri',
          this.seg([['off', 'Kapalı'], ['fast', 'Hızlı'], ['full', 'Tam']],
            settings.get('graphics.animations'), v => this.setManual('animations', v))),
        this.row('wallpaper', 'var(--teal)', 'Duvar kâğıdı', 'Canlı duvar kâğıdının kare hızı',
          this.seg([[0, 'Donuk'], [10, '10'], [15, '15'], [30, '30']],
            settings.get('graphics.wallpaperFps'), v => this.setManual('wallpaperFps', v))),
        this.row('window', 'var(--indigo)', 'Saydamlık', 'Kapatılırsa yüzeyler tamamen opaklaşır',
          this.toggle('graphics.transparency', () => this.render())),
        this.row('sparkles', 'var(--pink)', 'Jöle şiddeti', 'Pencere esneme miktarı',
          this.seg([[0, 'Kapalı'], [0.6, 'Az'], [1, 'Normal'], [1.8, 'Çok']],
            settings.get('desktop.jellyStrength'), v => {
              settings.set('desktop.jelly', v > 0);
              settings.set('desktop.jellyStrength', v || 1);
            }))),
      h('div.k-sectitle', { text: 'Otomatik' }),
      h('div.k-group',
        this.row('chart', 'var(--green)', 'Kendiliğinden ayarla',
          'Kare hızı 5 saniye boyunca 34’ün altında kalırsa kalite bir kademe iner',
          this.toggle('graphics.autoTune'))),
    );
  }

  setManual(key, value) {
    settings.set('graphics.' + key, value);
    settings.set('graphics.preset', 'custom');
    if (this.pane === 'quality') this.render();
  }

  /* ================== bellek ================== */
  async p_memory() {
    this.body.append(h('div.k-text.t-title', { text: 'Bellek ve Depolama' }));
    const box = h('div', { style: { display: 'grid', gap: '14px' } });
    this.body.appendChild(box);

    /* --- JS yığını --- */
    const mem = performance.memory;
    if (mem) {
      const used = mem.usedJSHeapSize, lim = mem.jsHeapSizeLimit;
      const pct = (used / lim) * 100;
      box.appendChild(this.card('JavaScript yığını',
        h('div.k-hstack', { style: { gap: '14px' } },
          this.metric(fmtBytes(used), 'kullanılan'),
          this.metric(fmtBytes(mem.totalJSHeapSize), 'ayrılan'),
          this.metric(fmtBytes(lim), 'tavan')),
        h('div.k-progress', h('i', { style: { width: clamp(pct, 1, 100) + '%' } })),
        h('div.k-text.t-caption', { text:
          `Tavanın %${pct.toFixed(1)}'i kullanılıyor. Bu sınırı tarayıcı koyar; ` +
          'bir sekme daha fazlasını isteyemez — istenebilecek olan depolamadır.' })));
    } else {
      box.appendChild(this.card('JavaScript yığını',
        h('div.k-text.t-callout', { text: 'Bu tarayıcı yığın ölçümünü paylaşmıyor (yalnızca Chromium ailesi paylaşır).' })));
    }

    /* --- kalıcı depolama: gerçekten ek kaynak isteyen kısım --- */
    const est = navigator.storage?.estimate ? await navigator.storage.estimate() : null;
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false;
    settings.set('graphics.persistedStorage', persisted);

    const btn = h('button.k-btn.v-primary.s-sm', {
      text: persisted ? 'Kalıcı depolama etkin' : 'Kalıcı depolama iste',
      disabled: persisted || !navigator.storage?.persist,
    });
    on(btn, 'click', async () => {
      btn.disabled = true; btn.textContent = 'İsteniyor…';
      try {
        const ok = await navigator.storage.persist();
        settings.set('graphics.persistedStorage', ok);
        notify.post({
          title: 'Grafik İşletici',
          body: ok ? 'Kalıcı depolama verildi: veriler artık yer açmak için silinmez ve kota büyür.'
                   : 'Tarayıcı kalıcı depolamayı reddetti. Siteyi yer imlerine ekleyip tekrar deneyin.',
          glyph: 'database', tint: ['#0a84ff', '#5e5ce6'],
        });
        this.render();
      } catch { btn.disabled = false; btn.textContent = 'Kalıcı depolama iste'; }
    });

    const usage = est?.usage || 0, quota = est?.quota || 0;
    box.appendChild(this.card('Site depolaması',
      h('div.k-hstack', { style: { gap: '14px' } },
        this.metric(fmtBytes(usage), 'kullanılan'),
        this.metric(quota ? fmtBytes(quota) : '—', 'ayrılan kota'),
        this.metric(persisted ? 'Kalıcı' : 'Geçici', 'durum', persisted ? 'good' : 'warn')),
      quota ? h('div.k-progress', h('i', { style: { width: clamp((usage / quota) * 100, 0.5, 100) + '%' } })) : null,
      h('div.k-text.t-caption', { style: { whiteSpace: 'pre-line' }, text:
        'Tarayıcı yer sıkıştığında geçici depolamayı uyarmadan siler — OpenOS’un tüm dosya sistemi ' +
        'orada durduğu için bu veri kaybı demektir.\n' +
        'Kalıcı depolama istendiğinde veriler silinemez hâle gelir ve kota belirgin biçimde büyür.' }),
      h('div.k-hstack', { style: { gap: '8px' } }, btn,
        h('button.k-btn.s-sm', { text: 'Yenile', onclick: () => this.render() }))));

    /* --- OpenOS'un kendi tüketimi --- */
    let osBytes = 0;
    try { osBytes = new Blob(Object.values(localStorage)).size; } catch {}
    box.appendChild(this.card('OpenOS verisi',
      h('div.k-hstack', { style: { gap: '14px' } },
        this.metric(fmtBytes(osBytes), 'localStorage'),
        this.metric(String(this.ctx.os.wm.list().length), 'açık pencere'),
        this.metric(String(document.querySelectorAll('*').length), 'DOM düğümü',
          document.querySelectorAll('*').length > 8000 ? 'warn' : '')),
      h('div.k-text.t-caption', { text:
        'DOM düğüm sayısı yükseldikçe düzen ve boyama pahalılaşır; çok sayıda pencereyi kapatmak en hızlı kazançtır.' })));
  }

  /* ================== donanım ================== */
  p_hardware() {
    const gl = detectGL();
    const rows = [
      ['cpu', 'var(--gray)', 'Mantıksal çekirdek', String(navigator.hardwareConcurrency || '—')],
      ['database', 'var(--blue)', 'Cihaz belleği', navigator.deviceMemory ? navigator.deviceMemory + ' GB (yaklaşık)' : 'paylaşılmıyor'],
      ['image', 'var(--purple)', 'Ekran', `${screen.width}×${screen.height} · DPR ${(devicePixelRatio || 1).toFixed(2)}`],
      ['eye', 'var(--teal)', 'Renk alanı', gamut()],
      ['bolt', 'var(--orange)', 'Ölçülen tazeleme', this.refresh ? this.refresh + ' Hz' : 'ölçülüyor…'],
      ['cpu', 'var(--green)', 'GPU', gl.renderer || 'bilinmiyor'],
      ['layers', 'var(--indigo)', 'Grafik yığını', gl.stack],
      ['grid', 'var(--pink)', 'En büyük doku', gl.maxTexture ? gl.maxTexture + ' px' : '—'],
      ['sparkles', 'var(--red)', 'WebGPU', ('gpu' in navigator) ? 'destekleniyor' : 'yok'],
    ];
    this.body.append(
      h('div.k-text.t-title', { text: 'Donanım' }),
      h('div.k-text.t-callout', { text: 'Tarayıcının paylaştığı kadarıyla. Bir web uygulaması donanımı doğrudan göremez.' }),
      h('div.k-group', ...rows.map(([g, t, k, v]) =>
        this.row(g, t, k, null, h('div.k-text.t-secondary', { text: v, style: { maxWidth: '320px', textAlign: 'right' } })))),
      h('div.k-sectitle', { text: 'Not' }),
      h('div.k-card', h('div.k-text.t-caption', { style: { whiteSpace: 'pre-line' }, text:
        'GPU adı WEBGL_debug_renderer_info uzantısından gelir; bazı tarayıcılar parmak izi ' +
        'kaygısıyla bunu gizler ve “bilinmiyor” yazar.\n' +
        'Tazeleme hızı, art arda gelen kareler ölçülerek tahmin edilir.' })),
    );
    this.measureRefresh();
  }

  measureRefresh() {
    let n = 0, t0 = 0;
    const step = (t) => {
      if (!t0) t0 = t;
      if (++n < 60) return requestAnimationFrame(step);
      this.refresh = Math.round(1000 / ((t - t0) / n));
      if (this.pane === 'hardware') this.render();
    };
    requestAnimationFrame(step);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.repaint);
    this.obs?.disconnect();
    this.off?.();
  }
}

/* ------------------------------------------------------------------ */
const describe = p =>
  `bulanıklık ${({ off: 'yok', low: 'düşük', full: 'tam' })[p.blur]} · ` +
  `gölge ${({ off: 'yok', flat: 'yalın', full: 'tam' })[p.shadows]} · ` +
  `duvar ${p.wallpaperFps || 'donuk'}`;

const gamut = () =>
  matchMedia('(color-gamut: rec2020)').matches ? 'Rec. 2020'
  : matchMedia('(color-gamut: p3)').matches ? 'Display P3'
  : matchMedia('(color-gamut: srgb)').matches ? 'sRGB' : 'bilinmiyor';

function detectGL() {
  try {
    const c = document.createElement('canvas');
    const gl2 = c.getContext('webgl2');
    const gl = gl2 || c.getContext('webgl');
    if (!gl) return { stack: 'WebGL yok', renderer: '', maxTexture: 0 };
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      stack: gl2 ? 'WebGL 2' : 'WebGL 1',
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '',
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
  } catch { return { stack: 'okunamadı', renderer: '', maxTexture: 0 }; }
}
