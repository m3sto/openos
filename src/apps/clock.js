/* ==========================================================================
   OpenOS · apps/clock.js — Saat
   Dünya saati, kronometre, geri sayım ve alarm. Zamanlayıcılar gerçek
   zamana (Date.now) bağlıdır; sekme arka plana alınıp zamanlayıcılar
   kısılsa bile geçen süre doğru kalır.
   ========================================================================== */

import { h, clear, on, clamp } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import settings from '../core/settings.js';
import notify from '../core/notify.js';
import vfs, { VFS } from '../core/vfs.js';

export default {
  id: 'clock', name: 'Saat', glyph: 'clock', tint: ['#4c4c52', '#1c1c1e'],
  category: 'util', width: 640, height: 520, minWidth: 420, minHeight: 380,
  keywords: ['saat', 'alarm', 'kronometre', 'zamanlayıcı', 'dünya'],
  about: 'Dünya saati, kronometre, geri sayım ve alarm.',
  mount(ctx) { return new Clock(ctx).el; },
};

const ZONES = [
  ['İstanbul', 'Europe/Istanbul'], ['Londra', 'Europe/London'], ['Berlin', 'Europe/Berlin'],
  ['New York', 'America/New_York'], ['Los Angeles', 'America/Los_Angeles'],
  ['Tokyo', 'Asia/Tokyo'], ['Sidney', 'Australia/Sydney'], ['Dubai', 'Asia/Dubai'],
  ['São Paulo', 'America/Sao_Paulo'], ['Delhi', 'Asia/Kolkata'],
];

const STORE = () => VFS.join(vfs.home, 'Belgeler/saat.json');

class Clock {
  constructor(ctx) {
    this.ctx = ctx;
    this.tab = 'world';
    const saved = vfs.readJSON(STORE(), null) || {};
    this.zones = saved.zones || ['Europe/Istanbul', 'Europe/London', 'America/New_York', 'Asia/Tokyo'];
    this.alarms = saved.alarms || [];

    this.body = h('div.content.k-scroll', { style: { padding: '18px 20px', gap: '14px' } });
    this.tabs = h('div.k-tabs');
    [['world', 'Dünya Saati'], ['stopwatch', 'Kronometre'], ['timer', 'Geri Sayım'], ['alarm', 'Alarm']]
      .forEach(([id, label]) => {
        const b = h('button', { text: label, 'aria-selected': String(id === this.tab),
          onclick: () => this.select(id) });
        this.tabs.appendChild(b);
      });
    this.el = h('div.app-shell', h('div.content', this.tabs, this.body));
    contextMenu(this.el, () => [
      { header: 'Saat' },
      { label: 'Dünya Saati', glyph: 'globe', checked: this.tab === 'world', run: () => this.select('world') },
      { label: 'Kronometre', glyph: 'clock', checked: this.tab === 'stopwatch', run: () => this.select('stopwatch') },
      { label: 'Geri Sayım', glyph: 'clock', checked: this.tab === 'timer', run: () => this.select('timer') },
      { label: 'Alarm', glyph: 'bell', checked: this.tab === 'alarm', run: () => this.select('alarm') },
    ]);

    /* Tek bir saniyelik nabız tüm sekmeleri besler. */
    this.tick = setInterval(() => this.pulse(), 200);
    ctx.win.onClosed = () => { clearInterval(this.tick); this.save(); };
    this.render();
  }

  save() { vfs.writeJSON(STORE(), { zones: this.zones, alarms: this.alarms }); }

  select(id) {
    this.tab = id;
    this.tabs.querySelectorAll('button').forEach((b, i) =>
      b.setAttribute('aria-selected', String(['world', 'stopwatch', 'timer', 'alarm'][i] === id)));
    this.render();
  }

  render() { clear(this.body); this['t_' + this.tab]?.call(this); }

  pulse() {
    if (this.tab === 'world') this.paintWorld();
    if (this.tab === 'stopwatch') this.paintStopwatch();
    if (this.tab === 'timer') this.paintTimer();
    this.alarmlariTazele();
  }

  /* ==================== dünya saati ==================== */
  t_world() {
    this.worldList = h('div.k-group');
    const add = h('select.k-select', { style: { width: '200px' } },
      h('option', { value: '', text: 'Şehir ekle…' }),
      ...ZONES.filter(z => !this.zones.includes(z[1])).map(([n, tz]) => h('option', { value: tz, text: n })));
    on(add, 'change', () => {
      if (!add.value) return;
      this.zones.push(add.value); this.save(); this.render();
    });
    this.body.append(
      h('div.k-hstack', { style: { gap: '10px' } },
        h('div.k-text.t-title', { text: 'Dünya Saati', style: { flex: 1 } }), add),
      this.worldList);
    this.paintWorld();
  }

  paintWorld() {
    if (!this.worldList || !this.worldList.isConnected) return;
    clear(this.worldList);
    const now = new Date();
    const hereOffset = -now.getTimezoneOffset() / 60;
    this.zones.forEach(tz => {
      const name = (ZONES.find(z => z[1] === tz) || [tz.split('/').pop().replace('_', ' ')])[0];
      const time = now.toLocaleTimeString('tr-TR',
        { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: !!settings.get('h12') });
      const day = now.toLocaleDateString('tr-TR', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
      const off = zoneOffset(tz) - hereOffset;
      const delta = off === 0 ? 'aynı saat' : `${off > 0 ? '+' : ''}${off} saat`;
      const row = h('div.k-row',
        h('div.lead', { style: { background: 'var(--gray)' }, html: icon('globe', 15) }),
        h('div.k-vstack', { style: { flex: 1, gap: '1px' } },
          h('div.k-text', { text: name, style: { fontWeight: 540 } }),
          h('div.k-text.t-caption', { text: `${day} · ${delta}` })),
        h('div.k-text', { text: time, style: { fontSize: '19px', fontVariantNumeric: 'tabular-nums' } }),
        h('button.k-btn.v-ghost.icon.s-sm', { html: icon('x', 13), onclick: () => {
          this.zones = this.zones.filter(z => z !== tz); this.save(); this.render(); } }));
      this.worldList.appendChild(row);
    });
  }

  /* ==================== kronometre ==================== */
  t_stopwatch() {
    this.sw = this.sw || { start: 0, elapsed: 0, running: false, laps: [] };
    this.swDisplay = h('div.clk-big');
    this.swLaps = h('div.k-group', { style: { maxHeight: '180px', overflow: 'auto' } });
    this.swBtn = h('button.k-btn.v-primary.s-lg', { text: this.sw.running ? 'Duraklat' : 'Başlat' });
    on(this.swBtn, 'click', () => {
      if (this.sw.running) { this.sw.elapsed += Date.now() - this.sw.start; this.sw.running = false; }
      else { this.sw.start = Date.now(); this.sw.running = true; }
      this.swBtn.textContent = this.sw.running ? 'Duraklat' : 'Başlat';
    });
    const lap = h('button.k-btn.s-lg', { text: 'Tur', onclick: () => {
      this.sw.laps.unshift(this.swValue()); this.paintLaps();
    } });
    const reset = h('button.k-btn.s-lg', { text: 'Sıfırla', onclick: () => {
      this.sw = { start: 0, elapsed: 0, running: false, laps: [] };
      this.swBtn.textContent = 'Başlat'; this.paintLaps(); this.paintStopwatch();
    } });
    this.body.append(
      h('div.clk-stage', this.swDisplay,
        h('div.k-hstack', { style: { gap: '10px', justifyContent: 'center' } }, this.swBtn, lap, reset)),
      this.swLaps);
    this.paintStopwatch(); this.paintLaps();
  }
  swValue() { return this.sw.elapsed + (this.sw.running ? Date.now() - this.sw.start : 0); }
  paintStopwatch() {
    if (!this.swDisplay || !this.swDisplay.isConnected) return;
    this.swDisplay.textContent = fmtMs(this.swValue());
  }
  paintLaps() {
    if (!this.swLaps) return;
    clear(this.swLaps);
    if (!this.sw.laps.length) {
      this.swLaps.appendChild(h('div.k-row', h('div.k-text.t-caption', { text: 'Tur yok' })));
      return;
    }
    this.sw.laps.forEach((t, i) => {
      const prev = this.sw.laps[i + 1] || 0;
      this.swLaps.appendChild(h('div.k-row',
        h('div.k-text.t-caption', { text: `Tur ${this.sw.laps.length - i}`, style: { width: '60px' } }),
        h('div.k-text.t-mono', { text: fmtMs(t - prev), style: { flex: 1 } }),
        h('div.k-text.t-mono.t-secondary', { text: fmtMs(t) })));
    });
  }

  /* ==================== geri sayım ==================== */
  t_timer() {
    this.tm = this.tm || { endsAt: 0, remaining: 25 * 60000, running: false, total: 25 * 60000 };
    this.tmDisplay = h('div.clk-big');
    this.tmRing = h('div.clk-ring');
    const presets = h('div.k-hstack', { style: { gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
      ...[1, 3, 5, 10, 15, 25, 45, 60].map(m => h('button.k-btn.s-sm', { text: m + ' dk', onclick: () => {
        this.tm = { endsAt: 0, remaining: m * 60000, total: m * 60000, running: false };
        this.tmBtn.textContent = 'Başlat'; this.paintTimer();
      } })));
    this.tmBtn = h('button.k-btn.v-primary.s-lg', { text: this.tm.running ? 'Duraklat' : 'Başlat' });
    on(this.tmBtn, 'click', () => {
      if (this.tm.running) { this.tm.remaining = Math.max(0, this.tm.endsAt - Date.now()); this.tm.running = false; }
      else { this.tm.endsAt = Date.now() + this.tm.remaining; this.tm.running = true; }
      this.tmBtn.textContent = this.tm.running ? 'Duraklat' : 'Başlat';
    });
    this.body.append(
      h('div.clk-stage', this.tmRing, this.tmDisplay,
        h('div.k-hstack', { style: { gap: '10px', justifyContent: 'center' } }, this.tmBtn,
          h('button.k-btn.s-lg', { text: 'Sıfırla', onclick: () => {
            this.tm = { endsAt: 0, remaining: this.tm.total, total: this.tm.total, running: false };
            this.tmBtn.textContent = 'Başlat'; this.paintTimer();
          } }))),
      h('div.k-sectitle', { text: 'Hazır süreler' }), presets);
    this.paintTimer();
  }
  paintTimer() {
    if (!this.tmDisplay || !this.tmDisplay.isConnected) return;
    const left = this.tm.running ? Math.max(0, this.tm.endsAt - Date.now()) : this.tm.remaining;
    this.tmDisplay.textContent = fmtClock(left);
    const pct = this.tm.total ? (1 - left / this.tm.total) * 100 : 0;
    this.tmRing.style.background =
      `conic-gradient(var(--accent) ${pct}%, color-mix(in srgb, var(--text-3) 22%, transparent) ${pct}%)`;
    if (this.tm.running && left <= 0) {
      this.tm.running = false; this.tm.remaining = this.tm.total;
      this.tmBtn.textContent = 'Başlat';
      notify.post({ title: 'Süre doldu', body: 'Geri sayım tamamlandı.', glyph: 'clock',
        tint: ['#4c4c52', '#1c1c1e'], timeout: 0 });
      beep();
    }
  }

  /* ==================== alarm ==================== */
  t_alarm() {
    const time = h('input', { type: 'time', value: '07:00' });
    const label = h('input', { placeholder: 'Etiket (isteğe bağlı)' });
    const add = h('button.k-btn.v-primary', { text: 'Alarm ekle', onclick: () => {
      if (!time.value) return;
      this.alarms.push({ id: Date.now(), at: time.value, label: label.value.trim(), on: true, firedOn: '' });
      label.value = ''; this.save(); this.render();
    } });
    const list = h('div.k-group');
    if (!this.alarms.length) list.appendChild(h('div.k-row', h('div.k-text.t-caption', { text: 'Alarm yok' })));
    this.alarms.forEach(a => {
      const sw = h('div.k-toggle', { dataset: { on: a.on ? '1' : '0' } });
      on(sw, 'click', () => { a.on = !a.on; sw.dataset.on = a.on ? '1' : '0'; this.save(); });
      list.appendChild(h('div.k-row',
        h('div.k-text', { text: a.at, style: { fontSize: '22px', width: '84px', fontVariantNumeric: 'tabular-nums' } }),
        h('div.k-vstack', { style: { flex: 1, gap: '1px' } },
          h('div.k-text', { text: a.label || 'Alarm', style: { fontWeight: 520 } }),
          h('div.k-text.t-caption', { text: 'her gün' })),
        sw,
        h('button.k-btn.v-ghost.icon.s-sm', { html: icon('trash', 13), onclick: () => {
          this.alarms = this.alarms.filter(x => x !== a); this.save(); this.render(); } })));
    });
    this.body.append(
      h('div.k-text.t-title', { text: 'Alarm' }),
      h('div.k-hstack', { style: { gap: '8px' } },
        h('div.k-field', { style: { width: '130px' } }, time),
        h('div.k-field', { style: { flex: 1 } }, label), add),
      list,
      h('div.k-text.t-caption', { text: 'Alarmlar Saat kapalıyken de çalar — sistem servisi olarak arka planda çalışıyorlar. Yalnızca OpenOS sekmesi tamamen kapatılırsa durur.' }));
  }

  /**
   * Alarmları artık bu pencere çalmıyor: işi `services/alarms.js` yapıyor ve
   * pencere kapalıyken de çalışıyor. Burada yalnızca servisin diske yazdığı
   * durumu geri okuyoruz — yoksa çalmış bir alarm listede hâlâ bekliyormuş
   * gibi görünürdü.
   */
  alarmlariTazele() {
    const veri = vfs.readJSON(STORE(), null);
    if (!veri || !Array.isArray(veri.alarms)) return;
    const damga = JSON.stringify(veri.alarms);
    if (damga === this._alarmDamgasi) return;
    this._alarmDamgasi = damga;
    this.alarms = veri.alarms;
    if (this.tab === 'alarm') this.render();
  }
}

/* ------------------------------------------------------------------ */
const pad = (n, w = 2) => String(n).padStart(w, '0');
const fmtMs = ms => `${pad(Math.floor(ms / 60000))}:${pad(Math.floor(ms / 1000) % 60)}.${pad(Math.floor(ms / 10) % 100)}`;
const fmtClock = ms => {
  const s = Math.ceil(ms / 1000);
  const hrs = Math.floor(s / 3600);
  return (hrs ? pad(hrs) + ':' : '') + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60);
};

/** Verilen bölgenin UTC'den saat farkı. */
function zoneOffset(tz) {
  const d = new Date();
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  return Math.round((local - utc) / 3600000);
}

/** Kısa bir uyarı sesi — dosya gerektirmez. */
function beep() {
  if (!settings.get('system.sounds')) return;
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)();
    const vol = (settings.get('system.volume') ?? 60) / 100;
    [0, 0.22, 0.44].forEach(t => {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, a.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3 * vol + 0.001, a.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t + 0.18);
      o.connect(g).connect(a.destination);
      o.start(a.currentTime + t); o.stop(a.currentTime + t + 0.2);
    });
    setTimeout(() => a.close(), 1200);
  } catch {}
}
