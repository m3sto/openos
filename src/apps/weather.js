/* ==========================================================================
   OpenOS · apps/weather.js — Hava Durumu
   Veri Open-Meteo'dan gelir: anahtarsız, ücretsiz ve kayıt tutmayan bir
   servis. Konum ya tarayıcıdan (izinle) ya da şehir aramasından alınır;
   hiçbir konum bilgisi OpenOS dışına başka bir yere gönderilmez.
   ========================================================================== */

import { h, clear, on } from '../core/util.js';
import { icon } from '../core/icons.js';
import { contextMenu } from '../ui/menu.js';
import vfs, { VFS } from '../core/vfs.js';
import notify from '../core/notify.js';

export default {
  id: 'weather', name: 'Hava Durumu', glyph: 'cloud', tint: ['#4aa8ff', '#0a6ede'],
  category: 'util', width: 760, height: 620, minWidth: 440, minHeight: 420,
  keywords: ['hava', 'durum', 'sıcaklık', 'yağmur', 'tahmin'],
  about: 'Open-Meteo üzerinden anlık durum ve 7 günlük tahmin.',
  mount(ctx) { return new Weather(ctx).el; },
};

const STORE = () => VFS.join(vfs.home, 'Belgeler/hava.json');

/* WMO hava kodları → metin ve simge */
const WMO = {
  0: ['Açık', '☀️'], 1: ['Az bulutlu', '🌤️'], 2: ['Parçalı bulutlu', '⛅️'], 3: ['Kapalı', '☁️'],
  45: ['Sisli', '🌫️'], 48: ['Kırağılı sis', '🌫️'],
  51: ['Hafif çiseleme', '🌦️'], 53: ['Çiseleme', '🌦️'], 55: ['Yoğun çiseleme', '🌧️'],
  56: ['Dondurucu çiseleme', '🌨️'], 57: ['Yoğun dondurucu çiseleme', '🌨️'],
  61: ['Hafif yağmur', '🌦️'], 63: ['Yağmur', '🌧️'], 65: ['Kuvvetli yağmur', '🌧️'],
  66: ['Dondurucu yağmur', '🌨️'], 67: ['Kuvvetli dondurucu yağmur', '🌨️'],
  71: ['Hafif kar', '🌨️'], 73: ['Kar', '❄️'], 75: ['Yoğun kar', '❄️'], 77: ['Kar taneleri', '❄️'],
  80: ['Sağanak', '🌦️'], 81: ['Kuvvetli sağanak', '🌧️'], 82: ['Şiddetli sağanak', '⛈️'],
  85: ['Kar sağanağı', '🌨️'], 86: ['Yoğun kar sağanağı', '❄️'],
  95: ['Gök gürültülü fırtına', '⛈️'], 96: ['Dolulu fırtına', '⛈️'], 99: ['Şiddetli dolulu fırtına', '⛈️'],
};

class Weather {
  constructor(ctx) {
    this.ctx = ctx;
    const saved = vfs.readJSON(STORE(), null) || {};
    this.place = saved.place || { name: 'İstanbul', lat: 41.0138, lon: 28.9497, country: 'Türkiye' };
    this.body = h('div.content.k-scroll', { style: { padding: '0', gap: '0' } });
    this.el = h('div.app-shell', h('div.content', this.buildBar(), this.body));
    contextMenu(this.el, () => [
      { header: 'Hava Durumu' },
      { label: 'Yenile', glyph: 'refresh', run: () => this.load() },
      { label: 'Konumumu kullan', glyph: 'compass', run: () => this.useGeolocation() },
      '-',
      { label: 'Veri kaynağı: Open-Meteo', disabled: true },
    ]);
    this.load();
  }

  buildBar() {
    this.search = h('input', { placeholder: 'Şehir ara…' });
    this.results = h('div.wx-results');
    on(this.search, 'input', () => this.lookup());
    on(this.search, 'keydown', e => { if (e.key === 'Escape') { this.search.value = ''; clear(this.results); } });
    return h('div.toolbar', { style: { position: 'relative' } },
      h('div.k-field.plain', { style: { flex: 1, maxWidth: '280px' } },
        h('span', { html: icon('search', 13), style: { color: 'var(--text-3)' } }), this.search),
      this.results,
      h('div.k-spacer'),
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('compass', 15), title: 'Konumumu kullan',
        onclick: () => this.useGeolocation() }),
      h('button.k-btn.v-ghost.icon.s-sm', { html: icon('refresh', 15), title: 'Yenile',
        onclick: () => this.load() }));
  }

  save() { vfs.writeJSON(STORE(), { place: this.place }); }

  /* ---------------- şehir arama ---------------- */
  async lookup() {
    const q = this.search.value.trim();
    clear(this.results);
    if (q.length < 2) return;
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=tr&format=json`);
      const j = await r.json();
      (j.results || []).forEach(p => {
        this.results.appendChild(h('div.wx-result', {
          onclick: () => {
            this.place = { name: p.name, lat: p.latitude, lon: p.longitude,
                           country: [p.admin1, p.country].filter(Boolean).join(', ') };
            this.search.value = ''; clear(this.results); this.save(); this.load();
          },
        }, h('div.k-text', { text: p.name }),
           h('div.k-text.t-caption', { text: [p.admin1, p.country].filter(Boolean).join(', ') })));
      });
      if (!j.results?.length) this.results.appendChild(h('div.wx-result', h('div.k-text.t-caption', { text: 'Sonuç yok' })));
    } catch {
      this.results.appendChild(h('div.wx-result', h('div.k-text.t-caption', { text: 'Arama başarısız' })));
    }
  }

  useGeolocation() {
    if (!navigator.geolocation) return notify.toast('Bu tarayıcı konum vermiyor', { glyph: '⚠️' });
    notify.toast('Konum isteniyor…', { glyph: '📍' });
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude: lat, longitude: lon } = pos.coords;
        let name = 'Konumum', country = '';
        try {
          const r = await fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=tr&format=json`);
          const j = await r.json();
          if (j.results?.[0]) { name = j.results[0].name; country = j.results[0].country || ''; }
        } catch {}
        this.place = { name, lat, lon, country };
        this.save(); this.load();
      },
      err => notify.alert(err.code === 1
        ? 'Konum izni reddedildi. Şehir arayarak da seçebilirsiniz.'
        : 'Konum alınamadı.', { title: 'Konum', glyph: '📍' }),
      { timeout: 10000 });
  }

  /* ---------------- veri ---------------- */
  async load() {
    clear(this.body);
    this.body.appendChild(h('div.k-empty', h('div.k-spinner'),
      h('div.k-text.t-caption', { text: this.place.name + ' için veri alınıyor…' })));
    const { lat, lon } = this.place;
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${lat}&longitude=${lon}`
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day'
      + '&hourly=temperature_2m,precipitation_probability,weather_code'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
      + '&timezone=auto&forecast_days=7';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      this.render(await res.json());
    } catch (e) {
      clear(this.body);
      this.body.appendChild(h('div.k-empty',
        h('div.glyph', { text: '🌐' }),
        h('div.k-text.t-title2', { text: 'Veri alınamadı' }),
        h('div.k-text.t-callout', { style: { maxWidth: '380px' },
          text: 'Open-Meteo’ya ulaşılamadı: ' + e.message + '. İnternet bağlantınızı kontrol edip yeniden deneyin.' }),
        h('button.k-btn.v-primary.s-sm', { text: 'Yeniden dene', onclick: () => this.load() })));
    }
  }

  render(d) {
    clear(this.body);
    const c = d.current;
    const [label, emoji] = WMO[c.weather_code] || ['—', '🌡️'];
    const day = c.is_day === 1;

    /* ---- kahraman ---- */
    this.body.appendChild(h('div.wx-hero', { class: day ? 'day' : 'night' },
      h('div.wx-place', { text: this.place.name }),
      this.place.country ? h('div.wx-country', { text: this.place.country }) : null,
      h('div.wx-emoji', { text: emoji }),
      h('div.wx-temp', { text: Math.round(c.temperature_2m) + '°' }),
      h('div.wx-label', { text: label }),
      h('div.wx-sub', { text: `Hissedilen ${Math.round(c.apparent_temperature)}° · Nem %${c.relative_humidity_2m} · Rüzgâr ${Math.round(c.wind_speed_10m)} km/s` })));

    /* ---- saatlik ---- */
    const now = new Date();
    const idx = d.hourly.time.findIndex(t => new Date(t) >= now);
    const hours = h('div.wx-hours');
    for (let i = Math.max(0, idx); i < Math.min(d.hourly.time.length, idx + 24); i++) {
      const t = new Date(d.hourly.time[i]);
      const [, em] = WMO[d.hourly.weather_code[i]] || ['', '🌡️'];
      hours.appendChild(h('div.wx-hour',
        h('div.h', { text: i === idx ? 'Şimdi' : String(t.getHours()).padStart(2, '0') }),
        h('div.e', { text: em }),
        h('div.t', { text: Math.round(d.hourly.temperature_2m[i]) + '°' }),
        h('div.p', { text: d.hourly.precipitation_probability?.[i] ? `%${d.hourly.precipitation_probability[i]}` : '' })));
    }
    this.body.append(h('div.k-sectitle', { text: 'Saatlik', style: { padding: '14px 16px 4px' } }), hours);

    /* ---- 7 gün ---- */
    const list = h('div.k-group', { style: { margin: '0 16px' } });
    const maxT = Math.max(...d.daily.temperature_2m_max);
    const minT = Math.min(...d.daily.temperature_2m_min);
    d.daily.time.forEach((t, i) => {
      const date = new Date(t);
      const [lbl, em] = WMO[d.daily.weather_code[i]] || ['—', '🌡️'];
      const lo = d.daily.temperature_2m_min[i], hi = d.daily.temperature_2m_max[i];
      const left = ((lo - minT) / (maxT - minT || 1)) * 100;
      const width = ((hi - lo) / (maxT - minT || 1)) * 100;
      list.appendChild(h('div.k-row',
        h('div.k-text', { text: i === 0 ? 'Bugün' : date.toLocaleDateString('tr-TR', { weekday: 'long' }),
          style: { width: '86px', fontWeight: 520 } }),
        h('div', { text: em, style: { fontSize: '18px', width: '30px', textAlign: 'center' } }),
        h('div.k-text.t-caption', { text: d.daily.precipitation_probability_max[i]
          ? `%${d.daily.precipitation_probability_max[i]}` : '', style: { width: '42px', color: 'var(--blue)' } }),
        h('div.k-text.t-secondary', { text: Math.round(lo) + '°', style: { width: '34px', textAlign: 'right' } }),
        h('div.wx-range', h('i', { style: { left: left + '%', width: Math.max(6, width) + '%' } })),
        h('div.k-text', { text: Math.round(hi) + '°', style: { width: '34px', fontWeight: 560 } })));
    });
    this.body.append(h('div.k-sectitle', { text: '7 günlük', style: { padding: '16px 16px 4px' } }), list);

    /* ---- gün doğumu/batımı ---- */
    const sr = new Date(d.daily.sunrise[0]), ss = new Date(d.daily.sunset[0]);
    const fmt = x => x.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    this.body.append(
      h('div.k-group', { style: { margin: '14px 16px' } },
        h('div.k-row',
          h('div.lead', { style: { background: 'var(--orange)' }, html: icon('sun', 15) }),
          h('div.k-text', { text: 'Gün doğumu', style: { flex: 1 } }),
          h('div.k-text.t-secondary', { text: fmt(sr) })),
        h('div.k-row',
          h('div.lead', { style: { background: 'var(--indigo)' }, html: icon('moon', 15) }),
          h('div.k-text', { text: 'Gün batımı', style: { flex: 1 } }),
          h('div.k-text.t-secondary', { text: fmt(ss) }))),
      h('div.k-text.t-caption', { style: { padding: '0 16px 18px', lineHeight: 1.6 },
        text: `Veri: Open-Meteo · ${d.timezone} · güncelleme ${new Date().toLocaleTimeString('tr-TR')}` }));
  }
}
