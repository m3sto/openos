/* ==========================================================================
   OpenOS · apps/misc.js — About, Welcome, Help, Activity Monitor, Synth
   ========================================================================== */

import { h, clear, on, fmtBytes, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import vfs from '../core/vfs.js';
import settings from '../core/settings.js';
import registry from '../core/registry.js';
import notify from '../core/notify.js';
import { markdown } from './texteditor.js';
import { appIcon } from '../ui/appicon.js';

/* ==================================================== About ============= */
export const about = {
  id: 'about', name: 'Bu OpenOS Hakkında', glyph: 'info', tint: ['#8e8e93', '#48484a'],
  category: 'system', width: 400, height: 470, resizable: false, hideInLaunchpad: true,
  mount(ctx) {
    const rows = [
      ['Sürüm', `${ctx.version} “${ctx.codename}”`],
      ['Çekirdek', 'opensharp-runtime'],
      ['Dil', 'OpenSharp 1.0'],
      ['Kullanıcı', settings.get('user.name')],
      ['Uygulamalar', String(registry.all().length)],
      ['Depolama', fmtBytes(vfs.usage().bytes)],
    ];
    /* Izgara satırları, yüksekliği belli bir kapta içeriği sığdırmak için
       kendiliğinden sıkışır; `align-content: start` bunu engeller, `k-scroll`
       da taşan kısmı kaydırılabilir yapar. */
    return h('div.about.k-scroll', { style: { padding: '28px 24px', display: 'grid', gap: '16px',
                                     justifyItems: 'center', alignContent: 'start',
                                     textAlign: 'center', width: '100%' } },
      h('div', { html: icon('logo', 78, 2), style: { color: 'var(--accent)' } }),
      h('div.k-text.t-largetitle', { text: 'OpenOS' }),
      h('div.k-text.t-callout', { text: `Sürüm ${ctx.version} “${ctx.codename}”` }),
      h('div.k-group', { style: { width: '100%', textAlign: 'left' } },
        ...rows.map(([k, v]) => h('div.k-row',
          h('div.k-text.t-secondary', { text: k, style: { flex: 1 } }),
          h('div.k-text', { text: v })))),
      h('div.k-hstack', { style: { gap: '8px' } },
        h('button.k-btn.s-sm', { text: 'Sistem Ayarları', onclick: () => ctx.openApp('settings') }),
        h('button.k-btn.s-sm', { text: 'Kılavuz', onclick: () => ctx.openApp('help') })),
      h('div.k-text.t-caption', { text: 'Tamamı tarayıcıda çalışır · sunucu yok · veriler cihazınızda' }));
  },
};

/* ================================================== Welcome ============= */
export const welcome = {
  id: 'welcome', name: 'Hoş Geldiniz', glyph: 'sparkles', tint: ['#5e5ce6', '#bf5af2'],
  category: 'system', width: 620, height: 480, hideInLaunchpad: false,
  about: 'OpenOS’a hızlı bir giriş turu.',
  mount(ctx) {
    const cards = [
      ['sparkles', 'OpenSharp Studio', 'Kendi uygulamanızı yazın, canlı önizleyin, Dock’a kurun.', () => ctx.openApp('studio')],
      ['terminal', 'Terminal', '“help” yazın; dosya sistemi, uygulamalar ve tema komutları.', () => ctx.openApp('terminal')],
      ['package', 'App Store', 'Hazır OpenSharp uygulamalarını tek tıkla kurun.', () => ctx.openApp('appstore')],
      ['robot', 'Ajan Merkezi', 'window.OpenOS API’siyle sistemi otomatikleştirin.', () => ctx.openApp('agenthub')],
      ['wallpaper', 'Görünüm', 'Duvar kâğıdı, tema ve vurgu rengini değiştirin.', () => ctx.openApp('settings', { pane: 'wallpaper' })],
      ['folder', 'Finder', 'Sanal dosya sisteminizi keşfedin.', () => ctx.openApp('finder')],
    ];
    return h('div.k-scroll', { style: { padding: '22px', display: 'grid', gap: '16px', width: '100%' } },
      h('div.k-vstack', { style: { gap: '4px', alignItems: 'center', textAlign: 'center' } },
        h('div.welcome-word', { text: 'Merhaba', style: { fontSize: '44px' } }),
        h('div.k-text.t-callout', { text: `${settings.get('user.name')}, OpenOS’a hoş geldiniz.` })),
      h('div.k-grid', { style: { gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' } },
        ...cards.map(([g, t, s, fn]) => h('div.k-card', {
          style: { display: 'flex', gap: '11px', cursor: 'default', alignItems: 'flex-start' }, onclick: fn },
          h('div.app-icon', { style: { '--ic1': 'var(--accent-hi)', '--ic2': 'var(--accent-lo)', width: '36px', height: '36px' },
            html: icon(g, 18) }),
          h('div.k-vstack', { style: { gap: '2px', flex: 1 } },
            h('div.k-text.t-headline', { text: t }),
            h('div.k-text.t-caption', { text: s }))))),
      h('div.k-text.t-caption', { style: { textAlign: 'center' },
        html: '⌘/Ctrl + Boşluk — Spotlight · F4 — Launchpad · F3 — Mission Control' }));
  },
};

/* ===================================================== Help ============= */
const HELP_MD = `
# OpenOS Kılavuzu

## Masaüstü
- **Dock** — altta; sağ tıklayarak konumunu ve büyütmeyi değiştirin.
- **Menü çubuğu** — sol üstteki logodan sistem menüsü, sağdan Kontrol Merkezi.
- **Spotlight** — \`⌘/Ctrl + Boşluk\`; uygulama, dosya, hesap ve komut arar.
- **Launchpad** \`F4\` · **Mission Control** \`F3\`.

## Pencereler
Başlığından sürükleyin, kenarlardan boyutlandırın. Ekranın kenarına sürüklerseniz
yarım ekrana yapışır, üst kenara sürüklerseniz büyür. Çift tıklama büyütür.

| Kısayol | İşlev |
| --- | --- |
| \`⌘/Ctrl + W\` | Pencereyi kapat |
| \`⌘/Ctrl + M\` | Küçült |
| \`⌘/Ctrl + \\\`\` | Pencereler arasında geç |
| \`⌃⌘F\` | Tam ekran |

## Dosyalar
Finder sanal dosya sistemini gösterir. Her şey tarayıcınızın yerel deposunda tutulur;
Ayarlar → Depolama’dan JSON olarak dışa aktarabilirsiniz.

## OpenSharp
Kendi uygulamalarınızı yazmak için tasarlanmış küçük bir dil. Studio’yu açın,
sağdaki **Belgeler** sekmesinden dilin tamamını görün. Bir dosyayı
**Kur** düğmesiyle gerçek bir uygulamaya dönüştürebilirsiniz.

## Ajanlar
\`window.OpenOS\` altındaki API bir yapay zekâ ajanının sistemi kullanmasını sağlar.
Ajan Merkezi uygulaması canlı belgeler, çağrı günlüğü ve bir deneme konsolu sunar.
`;

export const help = {
  id: 'help', name: 'Kılavuz', glyph: 'question', tint: ['#64d2ff', '#0a84ff'],
  category: 'system', width: 680, height: 560,
  about: 'OpenOS nasıl kullanılır.',
  mount(ctx) {
    return h('div.br-page.k-scroll', { style: { width: '100%' } },
      h('div.br-doc', { html: markdown(HELP_MD), style: { maxWidth: '640px', margin: '0 auto', padding: '24px' } }));
  },
};

/* ========================================= Activity Monitor ============= */
export const activity = {
  id: 'activity', name: 'Etkinlik İzleyici', glyph: 'chart', tint: ['#30d158', '#0c7a34'],
  category: 'util', width: 640, height: 470, minWidth: 420, minHeight: 300,
  keywords: ['sistem', 'izleme', 'performans'],
  about: 'Pencereler, bellek ve depolama kullanımını izleyin.',
  mount(ctx) {
    const canvas = h('canvas', { style: { width: '100%', height: '120px' } });
    const list = h('div.k-group');
    const stats = h('div.k-grid', { style: { gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))' } });
    const el = h('div.k-scroll', { style: { padding: '16px', display: 'grid', gap: '14px', width: '100%', alignContent: 'start' } },
      h('div.k-text.t-title2', { text: 'Etkinlik İzleyici' }), stats,
      h('div.k-sectitle', { text: 'CPU (simüle)' }), canvas,
      h('div.k-sectitle', { text: 'Süreçler' }), list);

    const series = Array.from({ length: 90 }, () => 6 + Math.random() * 10);
    const draw = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr; canvas.height = 120 * dpr;
      const c = canvas.getContext('2d');
      c.scale(dpr, dpr);
      const W = canvas.clientWidth, H = 120;
      c.clearRect(0, 0, W, H);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      c.strokeStyle = 'rgba(128,128,128,.18)'; c.lineWidth = 1;
      for (let i = 1; i < 4; i++) { c.beginPath(); c.moveTo(0, (H / 4) * i); c.lineTo(W, (H / 4) * i); c.stroke(); }
      const step = W / (series.length - 1);
      c.beginPath();
      series.forEach((v, i) => { const y = H - (v / 100) * H; i ? c.lineTo(i * step, y) : c.moveTo(0, y); });
      c.strokeStyle = accent || '#0a84ff'; c.lineWidth = 2; c.stroke();
      c.lineTo(W, H); c.lineTo(0, H); c.closePath();
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, (accent || '#0a84ff') + '55'); g.addColorStop(1, 'transparent');
      c.fillStyle = g; c.fill();
    };

    const stat = (label, value, sub) => h('div.k-card', { style: { display: 'grid', gap: '2px' } },
      h('div.k-text.t-caption', { text: label }),
      h('div.k-text', { text: value, style: { fontSize: '20px', fontWeight: 600 } }),
      sub ? h('div.k-text.t-caption', { text: sub }) : null);

    const tick = () => {
      const wins = ctx.os.wm.list();
      const load = clamp(8 + wins.length * 7 + Math.random() * 14, 2, 96);
      series.push(load); series.shift();
      draw();
      const u = vfs.usage();
      clear(stats);
      const mem = performance.memory
        ? fmtBytes(performance.memory.usedJSHeapSize) : '—';
      stats.append(
        stat('CPU', Math.round(load) + '%', `${wins.length} pencere`),
        stat('Bellek', mem, 'JS yığını'),
        stat('Depolama', fmtBytes(u.bytes), `${u.files} dosya`),
        stat('Çalışma süresi', Math.floor((Date.now() - ctx.os.bootedAt) / 1000) + ' sn', 'oturum'));
      clear(list);
      if (!wins.length) list.appendChild(h('div.k-row', h('div.k-text.t-caption', { text: 'Çalışan pencere yok' })));
      wins.forEach((w, i) => list.appendChild(h('div.k-row',
        appIcon(w.app, 26),
        h('div.k-vstack', { style: { flex: 1, gap: '1px' } },
          h('div.k-text', { text: w.title, style: { fontWeight: 520 } }),
          h('div.k-text.t-caption', { text: `pid ${1000 + i} · ${w.state}` })),
        h('button.k-btn.s-sm.v-ghost', { text: 'Sonlandır', onclick: () => w.close() }))));
    };
    tick();
    const int = setInterval(tick, 1400);
    ctx.win.onClosed = () => clearInterval(int);
    return el;
  },
};

/* ==================================================== Synth ============= */
const NOTES = [
  ['C', 261.63, 0], ['C#', 277.18, 1], ['D', 293.66, 0], ['D#', 311.13, 1], ['E', 329.63, 0],
  ['F', 349.23, 0], ['F#', 369.99, 1], ['G', 392.00, 0], ['G#', 415.30, 1], ['A', 440.00, 0],
  ['A#', 466.16, 1], ['B', 493.88, 0], ['C2', 523.25, 0],
];
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12 };

export const synth = {
  id: 'music', name: 'Synth', glyph: 'music', tint: ['#ff375f', '#7b0b27'],
  category: 'media', width: 560, height: 330, minWidth: 420, minHeight: 280,
  keywords: ['müzik', 'piyano', 'ses', 'synth'],
  about: 'WebAudio ile çalışan küçük bir synth. Klavye: A–K tuşları.',
  mount(ctx) {
    let actx = null, wave = 'triangle', octave = 0;
    const ensure = () => (actx ||= new (window.AudioContext || window.webkitAudioContext)());
    const play = (freq) => {
      const a = ensure();
      const vol = (settings.get('system.volume') ?? 60) / 100;
      const o = a.createOscillator(), g = a.createGain();
      o.type = wave;
      o.frequency.value = freq * Math.pow(2, octave);
      g.gain.setValueAtTime(0.0001, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.25 * vol + 0.001, a.currentTime + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.85);
      o.connect(g).connect(a.destination);
      o.start(); o.stop(a.currentTime + 0.9);
    };

    const keys = h('div.synth-keys');
    NOTES.forEach(([n, f, black], i) => {
      const k = h('div', { class: 'synth-key' + (black ? ' black' : ''), dataset: { i },
        onpointerdown: () => { play(f); k.classList.add('on'); setTimeout(() => k.classList.remove('on'), 130); } },
        h('span', { text: Object.keys(KEYMAP).find(key => KEYMAP[key] === i)?.toUpperCase() || '' }));
      keys.appendChild(k);
    });

    const seg = (label, opts, get, set) => h('div.k-hstack', { style: { gap: '8px' } },
      h('div.k-text.t-caption', { text: label }),
      h('div.k-seg', ...opts.map(([v, l]) => {
        const b = h('button', { text: l, 'aria-selected': String(get() === v) });
        b.addEventListener('click', () => {
          set(v);
          b.parentElement.querySelectorAll('button').forEach(x => x.setAttribute('aria-selected', 'false'));
          b.setAttribute('aria-selected', 'true');
        });
        return b;
      })));

    const el = h('div', { style: { padding: '16px', display: 'grid', gap: '14px', width: '100%', alignContent: 'start' } },
      h('div.k-hstack', { style: { gap: '16px', flexWrap: 'wrap' } },
        seg('Dalga', [['triangle', '△'], ['sine', '∿'], ['square', '▣'], ['sawtooth', '◺']], () => wave, v => wave = v),
        seg('Oktav', [[-1, '−1'], [0, '0'], [1, '+1']], () => octave, v => octave = v)),
      keys,
      h('div.k-text.t-caption', { text: 'Klavyeden çalın: A W S E D F T G Y H U J K' }));

    const onKey = e => {
      if (!ctx.win.el.classList.contains('focused')) return;
      const i = KEYMAP[e.key.toLowerCase()];
      if (i === undefined || e.repeat) return;
      play(NOTES[i][1]);
      const k = keys.children[i];
      k.classList.add('on'); setTimeout(() => k.classList.remove('on'), 130);
    };
    window.addEventListener('keydown', onKey);
    ctx.win.onClosed = () => { window.removeEventListener('keydown', onKey); actx?.close(); };
    return el;
  },
};

export default [about, welcome, help, activity, synth];
