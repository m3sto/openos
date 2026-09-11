/* ==========================================================================
   OpenOS · settings.js — the preference store + live theme application
   ========================================================================== */

import { Bus, debounce, shade } from './util.js';

const KEY = 'openos.settings.v1';

export const ACCENTS = [
  { id: 'blue',   name: 'Mavi',    hex: '#0a84ff' },
  { id: 'purple', name: 'Mor',     hex: '#a855f7' },
  { id: 'pink',   name: 'Pembe',   hex: '#f4368a' },
  { id: 'red',    name: 'Kırmızı', hex: '#ff453a' },
  { id: 'orange', name: 'Turuncu', hex: '#ff8f0a' },
  { id: 'yellow', name: 'Sarı',    hex: '#e8b10a' },
  { id: 'green',  name: 'Yeşil',   hex: '#2ec06b' },
  { id: 'teal',   name: 'Turkuaz', hex: '#12b3c8' },
  { id: 'indigo', name: 'İndigo',  hex: '#5e5ce6' },
  { id: 'gray',   name: 'Grafit',  hex: '#7d7f88' },
];

export const DEFAULTS = {
  version: 1,
  firstRun: true,
  locale: 'tr',
  region: 'TR',
  h12: false,
  theme: 'auto',            // light | dark | auto
  accent: '#0a84ff',
  wallpaper: 'aurora',
  wallpaperMotion: true,
  user: { name: 'Kullanıcı', avatar: '🧑‍🚀', password: '' },
  dock: { position: 'bottom', size: 52, magnify: true, autohide: false },
  desktop: { showIcons: true, showWidgets: true, gridSnap: true, jelly: true, jellyStrength: 1 },
  system: { reduceMotion: false, sounds: true, brightness: 100, volume: 60 },
  network: { wifi: true, bluetooth: false, airdrop: true, ssid: 'OpenOS-Net' },
  focus: { dnd: false },
  agent: { enabled: true, allowFs: true, allowApps: true, allowScript: true, logCalls: true },
  cloud: {
    endpoint: 'https://opencloud.m3sto-wolfly.workers.dev',   // OpenOS Cloud API
    repo: 'm3sto/openos-cloud',        // GitHub deposu: katalog + uygulama kaynakları
    deviceName: '',                    // bu kurulumun bulutta görünen adı
    branch: 'main',
    token: '',                         // GitHub fine-grained PAT (yalnızca bu tarayıcıda)
    session: null,                     // { token, user } — OpenOS Cloud oturumu
    autoUpdate: true,
  },
  browser: {
    engine: 'auto',                    // auto | direct | proxy
    proxy: 'https://openbrow-proxy.m3sto-wolfly.workers.dev',   // OpenBrow sayfa motoru
    search: 'duckduckgo',
    homepage: 'openos://start',
    spoofUA: true,
    blockTrackers: true,
    zoom: 100,
    favorites: [],
  },
  privacy: { analytics: false, crashReports: false },
  pinned: ['finder', 'terminal', 'studio', 'notes', 'browser', 'settings'],
  desktopIcons: {},
};

function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k in over) {
    const v = over[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && typeof base?.[k] === 'object' && !Array.isArray(base?.[k]))
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

class Settings {
  constructor() {
    this.bus = new Bus();
    this.data = JSON.parse(JSON.stringify(DEFAULTS));
    this._save = debounce(() => this.persist(), 180);
    this._mq = window.matchMedia('(prefers-color-scheme: dark)');
    this._mq.addEventListener?.('change', () => { if (this.data.theme === 'auto') this.apply(); });
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) { this.data = deepMerge(DEFAULTS, JSON.parse(raw)); return true; }
    } catch (e) { console.warn('[settings] load failed', e); }
    return false;
  }
  persist() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch {} }
  reset() { this.data = JSON.parse(JSON.stringify(DEFAULTS)); this.persist(); this.apply(); }

  /** get('dock.size') */
  get(path, fallback) {
    const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), this.data);
    return v === undefined ? fallback : v;
  }
  /** set('dock.size', 60) */
  set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let o = this.data;
    for (const k of keys) { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; }
    const prev = o[last];
    if (prev === value) return value;
    o[last] = value;
    this._save();
    this.bus.emit('change', path, value, prev);
    this.bus.emit(`change:${path}`, value, prev);
    if (['theme', 'accent', 'system.reduceMotion', 'system.brightness'].includes(path)) this.apply();
    return value;
  }
  patch(obj) { this.data = deepMerge(this.data, obj); this._save(); this.bus.emit('change', '*', obj); this.apply(); }

  get isDark() {
    const t = this.data.theme;
    return t === 'dark' || (t === 'auto' && this._mq.matches);
  }

  /** Push the current settings into CSS custom properties / root attributes. */
  apply() {
    const root = document.documentElement;
    root.setAttribute('data-theme', this.isDark ? 'dark' : 'light');
    root.setAttribute('lang', this.data.locale || 'tr');
    const a = this.data.accent || DEFAULTS.accent;
    root.style.setProperty('--accent', a);
    root.style.setProperty('--accent-hi', shade(a, this.isDark ? 0.22 : 0.16));
    root.style.setProperty('--accent-lo', shade(a, -0.24));
    root.style.setProperty('--accent-fg', '#ffffff');
    root.style.setProperty('--dock-h', (this.data.dock.size + 18) + 'px');
    root.classList.toggle('reduce-motion', !!this.data.system.reduceMotion);
    const b = (this.data.system.brightness ?? 100) / 100;
    const stage = document.getElementById('stage');
    if (stage) stage.style.filter = b < 1 ? `brightness(${0.35 + 0.65 * b})` : '';
    this.bus.emit('applied', this.data);
  }
}

export const settings = new Settings();
export default settings;
