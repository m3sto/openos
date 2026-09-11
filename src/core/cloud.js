/* ==========================================================================
   OpenOS · cloud.js — OpenOS Cloud client
   Accounts, the App Store catalogue and app publishing. Works in three modes,
   in this order of preference:
     1. Cloud API   — a Cloudflare Worker (accounts, uploads, moderation)
     2. GitHub repo — a plain catalog.json served from raw.githubusercontent
     3. Offline     — the catalogue bundled with the system
   Browsing and installing never require an account; publishing does.
   ========================================================================== */

import { Bus } from './util.js';
import settings from './settings.js';
import { GitHub } from './github.js';

const RAW = 'https://raw.githubusercontent.com';
/** Falls back to the project's own instance when the user hasn't set one. */
export const DEFAULT_ENDPOINT = 'https://opencloud.m3sto-wolfly.workers.dev';
export const DASHBOARD_URL = 'https://m3sto.github.io/openos-cloud/';

export class Cloud {
  constructor() {
    this.bus = new Bus();
    this.catalog = null;
    this.source = 'offline';
    this.lastError = null;
  }

  /* ---------------- configuration ---------------- */
  get endpoint() { return (settings.get('cloud.endpoint') || DEFAULT_ENDPOINT).replace(/\/+$/, ''); }
  get repo() { return settings.get('cloud.repo') || ''; }
  get branch() { return settings.get('cloud.branch') || 'main'; }
  get token() { return settings.get('cloud.token') || ''; }
  get session() { return settings.get('cloud.session') || null; }
  get user() { return this.session?.user || null; }
  get signedIn() { return !!this.session?.token; }
  get hasApi() { return !!this.endpoint; }
  get hasRepo() { return /^[\w.-]+\/[\w.-]+$/.test(this.repo); }
  get canPublish() { return this.signedIn || new GitHub({ token: this.token, repo: this.repo }).configured; }

  github() { return new GitHub({ token: this.token, repo: this.repo, branch: this.branch }); }

  rawUrl(path) {
    return `${RAW}/${this.repo}/${this.branch}/${String(path).split('/').map(encodeURIComponent).join('/')}`;
  }

  /* ---------------- http ---------------- */
  async api(path, { method = 'GET', body, auth = false } = {}) {
    if (!this.hasApi) throw new Error('OpenOS Cloud uç noktası ayarlanmadı');
    const res = await fetch(this.endpoint + path, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && this.session?.token ? { Authorization: `Bearer ${this.session.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; }
    catch { data = { raw: text, error: `Sunucu JSON değil, ${(res.headers.get('content-type') || '?')} döndü` }; }
    if (!res.ok) throw new Error(data?.error || data?.message || `Cloud ${res.status}`);
    return data;
  }

  /* ---------------- accounts ---------------- */
  /** A stable, human label for this OpenOS installation in the device list. */
  deviceName() {
    const saved = settings.get('cloud.deviceName');
    if (saved) return saved;
    const ua = navigator.userAgent;
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
      : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
      : /Linux/.test(ua) ? 'Linux' : 'Web';
    const name = `${settings.get('user.name') || 'OpenOS'} · ${os}`;
    settings.set('cloud.deviceName', name);
    return name;
  }

  async signUp({ email, password, handle }) {
    const r = await this.api('/v1/auth/signup', {
      method: 'POST', body: { email, password, handle, device: this.deviceName() } });
    this._setSession(r);
    await this.refresh();
    return this.user;
  }
  async signIn({ email, password }) {
    const r = await this.api('/v1/auth/login', {
      method: 'POST', body: { email, password, device: this.deviceName() } });
    this._setSession(r);
    await this.refresh();
    return this.user;
  }
  async refresh() {
    if (!this.signedIn || !this.hasApi) return null;
    try {
      const r = await this.api('/v1/auth/me', { auth: true });
      this._setSession({ token: this.session.token, user: r.user || r });
      return r.user || r;
    } catch (e) {
      if (/401|403/.test(String(e.message))) this.signOut();
      return null;
    }
  }
  signOut() {
    if (this.signedIn && this.hasApi) this.api('/v1/auth/logout', { method: 'POST', auth: true }).catch(() => {});
    settings.set('cloud.session', null);
    this.bus.emit('auth', null);
  }
  _setSession(r) {
    settings.set('cloud.session', { token: r.token, user: r.user });
    this.bus.emit('auth', r.user);
  }

  /* ---------------- catalogue ---------------- */
  async loadCatalog({ force = false } = {}) {
    if (this.catalog && !force) return this.catalog;
    this.lastError = null;

    if (this.hasApi) {
      try {
        const r = await this.api('/v1/apps');
        this.catalog = normalise(r);
        this.source = 'cloud';
        this.bus.emit('catalog', this.catalog);
        return this.catalog;
      } catch (e) { this.lastError = e.message; }
    }

    if (this.hasRepo) {
      try {
        const res = await fetch(this.rawUrl('catalog.json'), { cache: 'no-cache' });
        if (res.ok) {
          this.catalog = normalise(await res.json());
          this.source = 'github';
          this.bus.emit('catalog', this.catalog);
          return this.catalog;
        }
        this.lastError = `GitHub ${res.status}`;
      } catch (e) { this.lastError = e.message; }
    }

    this.source = 'offline';
    this.catalog = null;
    this.bus.emit('catalog', null);
    return null;
  }

  /** Fetch the OpenSharp source of a catalogue entry. */
  async fetchSource(entry) {
    if (entry.builtin) return entry.src();
    if (this.source === 'cloud') {
      /* Kaynak düz metin döner; JSON bekleyen api() yolundan geçirilemez. */
      const res = await fetch(`${this.endpoint}/v1/apps/${encodeURIComponent(entry.id)}/source`, {
        headers: this.session?.token ? { Authorization: `Bearer ${this.session.token}` } : {},
        cache: 'no-cache',
      });
      if (!res.ok) throw new Error(`Kaynak indirilemedi (${res.status})`);
      const text = await res.text();
      if (!text.trim()) throw new Error('Kaynak boş döndü');
      return text;
    }
    const url = /^https?:/.test(entry.source || '') ? entry.source : this.rawUrl(entry.source || `apps/${entry.id}/app.osh`);
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Kaynak indirilemedi (${res.status})`);
    return res.text();
  }

  /* ---------------- publishing ---------------- */
  /**
   * Publishes through the Cloud API when signed in, otherwise straight to
   * GitHub with the user's token. Returns { where, entry }.
   */
  async publish({ id, name, source, manifest }) {
    if (this.signedIn && this.hasApi) {
      const r = await this.api('/v1/apps', { method: 'POST', auth: true, body: { id, name, source, manifest } });
      this.catalog = null;
      this.bus.emit('publish', r);
      return { where: 'cloud', entry: r.app || r };
    }
    const gh = this.github();
    if (!gh.configured) throw new Error('Yayınlamak için OpenOS Cloud hesabı ya da GitHub belirteci gerekir');
    const entry = await gh.publishApp({ id, name, source, manifest });
    this.catalog = null;
    this.bus.emit('publish', entry);
    return { where: 'github', entry };
  }

  async unpublish(id, name) {
    if (this.signedIn && this.hasApi) {
      await this.api(`/v1/apps/${encodeURIComponent(id)}`, { method: 'DELETE', auth: true });
    } else {
      await this.github().unpublishApp(id, name);
    }
    this.catalog = null;
    return true;
  }

  /** Everything the user has published, from whichever backend answered. */
  async myApps() {
    if (this.signedIn && this.hasApi) {
      const r = await this.api('/v1/apps?mine=1', { auth: true });
      return normalise(r).apps;
    }
    const cat = await this.loadCatalog({ force: true });
    if (!cat) return [];
    const gh = this.github();
    if (!gh.configured) return [];
    try {
      const me = await gh.whoami();
      return cat.apps.filter(a => (a.author || '').toLowerCase() === me.login.toLowerCase());
    } catch { return []; }
  }

  /* ---------------- devices, profile, library ---------------- */
  async devices() {
    const r = await this.api('/v1/devices', { auth: true });
    return r.devices || [];
  }
  async revokeDevice(id) {
    await this.api('/v1/devices/' + encodeURIComponent(id), { method: 'DELETE', auth: true });
    return true;
  }
  async updateProfile({ display, bio, avatar }) {
    const r = await this.api('/v1/profile', { method: 'PUT', auth: true, body: { display, bio, avatar } });
    if (r.user) settings.set('cloud.session', { ...this.session, user: { ...this.user, ...r.user } });
    this.bus.emit('auth', this.user);
    return r.user;
  }
  async uploadAvatar(dataUrl) {
    const r = await this.api('/v1/profile/avatar', { method: 'PUT', auth: true, body: { image: dataUrl } });
    settings.set('cloud.session', { ...this.session, user: { ...this.user, hasAvatarImage: true } });
    this.bus.emit('auth', this.user);
    return r;
  }
  async removeAvatar() {
    await this.api('/v1/profile/avatar', { method: 'DELETE', auth: true });
    settings.set('cloud.session', { ...this.session, user: { ...this.user, hasAvatarImage: false } });
    this.bus.emit('auth', this.user);
  }
  async changePassword(current, next) {
    await this.api('/v1/auth/password', { method: 'PUT', auth: true, body: { current, next } });
    return true;
  }
  async library() {
    const r = await this.api('/v1/library', { auth: true });
    return normalise(r).apps.map((a, i) => ({ ...a, installed: (r.apps || [])[i]?.installed }));
  }
  async stats() { return this.api('/v1/stats'); }
  avatarUrl(handle = this.user?.handle) {
    return handle ? `${this.endpoint}/v1/users/${encodeURIComponent(handle)}/avatar` : '';
  }

  status() {
    return {
      mode: this.source,
      api: this.hasApi ? this.endpoint : null,
      repo: this.hasRepo ? `${this.repo}@${this.branch}` : null,
      signedIn: this.signedIn,
      user: this.user,
      github: new GitHub({ token: this.token, repo: this.repo }).configured,
      error: this.lastError,
      apps: this.catalog?.apps?.length ?? 0,
    };
  }
}

function normalise(r) {
  const apps = (Array.isArray(r) ? r : r.apps || []).map(a => ({
    id: a.id, name: a.name, summary: a.summary || a.description || '',
    author: a.author || a.owner || '', icon: a.icon || 'sparkles',
    tint: Array.isArray(a.tint) ? a.tint : ['#5e5ce6', '#bf5af2'],
    category: a.category || 'Araç', version: a.version || '1.0.0',
    updated: a.updated || a.updated_at || null, size: a.size || 0,
    source: a.source || `apps/${a.id}/app.osh`,
    downloads: a.downloads || 0, remote: true,
  }));
  return { schema: r.schema || 1, name: r.name || 'OpenOS Cloud', updated: r.updated || null, apps };
}

export const cloud = new Cloud();
export default cloud;
